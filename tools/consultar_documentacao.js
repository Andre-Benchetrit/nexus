const { criarServicoDocumentacao } = require('../nexus/documentacao');
const { criarProvider } = require('../agentes/providers');
const { processarImagemLocal } = require('../agentes/image_processing');

const definicaoConsultarDocumentacao = {
  type: 'function',
  name: 'consultar_documentacao',
  description: 'Consulta procedimentos, politicas e manuais publicados e autorizados para o setor ativo. Retorna trechos com documento, versao e pagina.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      consulta: { type: 'string', minLength: 2, maxLength: 1000 },
      documento_id: {
        type: 'string',
        description: 'Identificador de um documento ja consultado. E preenchido pelo Nexus em continuacoes sobre o mesmo documento.'
      },
      limite: { type: 'integer', minimum: 1, maximum: 12 },
      analisar_visual: {
        type: 'boolean',
        description: 'Use true somente quando a pergunta depender de capturas, diagramas ou exemplos visuais do documento.'
      }
    },
    required: ['consulta', 'limite', 'analisar_visual'],
    additionalProperties: false
  }
};

function codigoFalhaDocumental(erro) {
  const codigo = String(erro?.codigo || erro?.code || '').toUpperCase();
  if (codigo === '57014' || /TIMEOUT|TIMEDOUT/.test(codigo)) return 'DOCUMENTACAO_TIMEOUT';
  if (['40001', '40P01'].includes(codigo)) return 'DOCUMENTACAO_CONCORRENCIA';
  if (/^(?:08|53|57P0)/.test(codigo) ||
      ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENETUNREACH', 'ENOTFOUND'].includes(codigo)) {
    return 'DOCUMENTACAO_DEPENDENCIA_INDISPONIVEL';
  }
  return 'DOCUMENTACAO_CONSULTA_INDISPONIVEL';
}

function falhaTecnicaRepetivel(erro) {
  if (Number(erro?.status) >= 400 && Number(erro?.status) < 500) return false;
  const codigo = String(erro?.codigo || erro?.code || '').toUpperCase();
  return !/(?:ACESSO|AUTORIZ|PERMISSAO|INVALID|NAO_ENCONTRADO|NOT_FOUND|LIMITE|MODE_INACTIVE|DISABLED)/.test(codigo);
}

function erroDocumentacaoIndisponivel(causa) {
  const erro = new Error(
    'A base documental esta temporariamente indisponivel. ' +
    'Nao afirme que o documento nao existe e nao substitua a consulta por conhecimento geral.'
  );
  erro.codigo = codigoFalhaDocumental(causa);
  return erro;
}

async function auditarFalhaDocumental(dependencias, resultado, codigo, tentativa) {
  if (!dependencias.auditoriaIA || !dependencias.turnoIA) return;
  try {
    await dependencias.auditoriaIA.registrarEvento?.(dependencias.turnoIA, {
      tipo: resultado === 'retry' ? 'document_retrieval_retry' : 'document_retrieval_failure',
      recurso: 'consultar_documentacao',
      resultado,
      metadados: { erro_codigo: codigo, tentativa }
    });
  } catch (_) {
    // Telemetria nunca deve impedir a recuperacao da consulta documental.
  }
}

async function buscarDocumentacaoComRetry(servico, entrada, dependencias = {}) {
  try {
    return await servico.buscar(entrada);
  } catch (erro) {
    if (!falhaTecnicaRepetivel(erro)) throw erro;
    const codigo = codigoFalhaDocumental(erro);
    await auditarFalhaDocumental(dependencias, 'retry', codigo, 1);
    dependencias.onEvento?.('A consulta documental falhou tecnicamente; repetindo uma vez.');
    dependencias.onCheckpoint?.('documentacao_repetindo', {
      etapa: 'business_reasoning', codigo
    });
    try {
      return await servico.buscar(entrada);
    } catch (erroFinal) {
      if (!falhaTecnicaRepetivel(erroFinal)) throw erroFinal;
      const indisponivel = erroDocumentacaoIndisponivel(erroFinal);
      await auditarFalhaDocumental(dependencias, 'error', indisponivel.codigo, 2);
      throw indisponivel;
    }
  }
}

async function interpretarPaginas(resultados, pergunta, servico, dependencias) {
  const candidatos = [];
  for (const item of resultados) {
    if (!item.pagina_visual_disponivel || !item.pagina) continue;
    const chave = `${item.documento_id}:${item.pagina}`;
    if (!candidatos.some((candidato) => candidato.chave === chave)) candidatos.push({ ...item, chave });
  }
  const maximo = Math.min(3, Math.max(1,
    Number(dependencias.knowledgeVisionMaxPages || process.env.NEXUS_KNOWLEDGE_VISION_MAX_PAGES || 2)));
  const selecionados = candidatos.slice(0, maximo);
  if (!selecionados.length) return { status: 'sem_paginas_visuais', paginas: [] };
  const nomeProvider = dependencias.knowledgeVisionProviderNome ||
    process.env.NEXUS_KNOWLEDGE_VISION_PROVIDER || process.env.NEXUS_VISION_PROVIDER || 'anthropic';
  const modelo = dependencias.knowledgeVisionModelo || process.env.NEXUS_KNOWLEDGE_VISION_MODEL ||
    process.env.NEXUS_VISION_MODEL;
  if (!modelo) return { status: 'indisponivel', codigo: 'KNOWLEDGE_VISION_MODEL_REQUIRED', paginas: [] };
  let contexto = null;
  const inicio = Date.now();
  try {
    contexto = await dependencias.governanca?.iniciarTool('interpretar_imagem', {
      quantidade: selecionados.length
    }, {
      provider: nomeProvider, modelo,
      departamentoSlug: dependencias.departamentoSlug || null,
      traceId: dependencias.turnoIA?.traceId || null,
      turnId: dependencias.turnoIA?.id || null,
      parentCallId: dependencias.telemetria?.ultimoCallId || null,
      stage: 'vision_interpretation', purpose: 'document_vision'
    });
    const blocos = [{ type: 'text', text: `Pergunta do usuario: ${pergunta}\nAnalise somente os exemplos visuais das paginas autorizadas. Nao invente etapas que nao estejam visiveis.` }];
    for (const item of selecionados) {
      const imagem = await servico.abrirPaginaVisual(item.documento_id, item.pagina, {
        departmentId: dependencias.departamentoId || null
      });
      const local = await processarImagemLocal(imagem, {
        ocrWorker: dependencias.ocrWorker,
        detectarCodigo: dependencias.detectarCodigo
      });
      if (local.sensibilidade?.sensivel) {
        const erro = new Error('A pagina documental nao pode ser enviada ao provider visual.');
        erro.codigo = local.sensibilidade.codigo || 'DOCUMENT_VISION_SENSITIVE';
        throw erro;
      }
      blocos.push({ type: 'text', text: `Documento: ${item.titulo}; versao ${item.versao}; pagina ${item.pagina}.` });
      blocos.push({ type: 'image', source: { type: 'base64', media_type: local.mime, data: local.buffer.toString('base64') } });
    }
    const provider = dependencias.knowledgeVisionProvider || criarProvider({
      nome: nomeProvider, modelo, cliente: dependencias.knowledgeVisionCliente, semFallback: true
    });
    const resposta = await provider.executar({
      pergunta,
      mensagens: [{ role: 'user', content: blocos }],
      instrucoes: 'Descreva apenas informacoes relevantes visiveis nas paginas fornecidas. Identifique a fonte por documento, versao e pagina.',
      tools: [], maxRodadas: 1, telemetria: dependencias.telemetria,
      stage: 'vision_interpretation', purpose: 'document_vision',
      onEvento: dependencias.onEvento, onCheckpoint: dependencias.onCheckpoint
    });
    await dependencias.governanca?.concluirTool(contexto, {
      sucesso: true, duracaoMs: Date.now() - inicio
    });
    return { status: 'sucesso', texto: resposta.texto, paginas: selecionados.map((item) => ({
      documento_id: item.documento_id, titulo: item.titulo, versao: item.versao,
      pagina: item.pagina, citacao: item.citacao
    })) };
  } catch (erro) {
    if (contexto) await dependencias.governanca?.concluirTool(contexto, {
      sucesso: false, duracaoMs: Date.now() - inicio, erro
    });
    return { status: 'indisponivel',
      codigo: String(erro.codigo || erro.code || erro.name || 'VISION_ERROR'), paginas: [] };
  }
}

async function executarConsultarDocumentacao(argumentos, dependencias = {}) {
  if (!argumentos || typeof argumentos !== 'object' || Array.isArray(argumentos)) {
    throw new Error('Argumentos de documentacao invalidos.');
  }
  const modo = String(dependencias.knowledgeMode || process.env.NEXUS_KNOWLEDGE_MODE || 'v1').toLowerCase();
  if (!['off', 'shadow', 'v1'].includes(modo)) throw new Error(`NEXUS_KNOWLEDGE_MODE invalido: ${modo}.`);
  if (modo !== 'v1') {
    const erro = new Error('Base documental ainda nao esta ativa para respostas.');
    erro.codigo = 'KNOWLEDGE_MODE_INACTIVE';
    throw erro;
  }
  const servico = dependencias.servicoDocumentacao || criarServicoDocumentacao({
    pool: dependencias.poolNexus || dependencias.pool,
    principalId: dependencias.principalId,
    storage: dependencias.knowledgeStorage,
    embeddings: dependencias.knowledgeEmbeddings
  });
  const resultado = await buscarDocumentacaoComRetry(servico, {
    consulta: argumentos.consulta,
    documentId: argumentos.documento_id || null,
    limite: argumentos.limite,
    departmentId: dependencias.departamentoId || null
  }, dependencias);
  if (argumentos.analisar_visual === true && resultado.status === 'sucesso') {
    resultado.analise_visual = await interpretarPaginas(resultado.resultados,
      argumentos.consulta, servico, dependencias);
  }
  return resultado;
}

module.exports = { buscarDocumentacaoComRetry, codigoFalhaDocumental,
  definicaoConsultarDocumentacao, erroDocumentacaoIndisponivel,
  executarConsultarDocumentacao, interpretarPaginas };
