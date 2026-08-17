const { criarProvider } = require('./providers');
const { criarMemoria } = require('./memoria');
const { criarServicoGovernanca } = require('../nexus/governanca');
const { criarServicoAuditoriaIA } = require('../nexus/auditoria_ia');
const { exigeFonteCorporativa } = require('./politica_fonte');

const INSTRUCOES_GENERALISTA = `Voce e o Nexus, assistente corporativo generalista da FID.
Converse em portugues do Brasil, com clareza e objetividade.
Para fatos internos, atuais ou especificos da FID, use consultar_nexus. Nunca invente dados corporativos.
O resultado de consultar_nexus e a unica evidencia corporativa autorizada. Se ele disser que algo nao e suportado ou precisa de esclarecimento, preserve essa limitacao.
Nao mencione nomes de tabelas, camadas ou ferramentas internas que nao estejam no resultado autorizado.`;

const definicaoConsultarNexus = Object.freeze({
  type: 'function',
  name: 'consultar_nexus',
  description: 'Consulta capacidades corporativas do Nexus quando a resposta depende de dados internos da FID.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      objetivo: { type: 'string', description: 'Investigacao corporativa necessaria, em linguagem de negocio.' }
    },
    required: ['objetivo'],
    additionalProperties: false
  }
});

function resolverModoAssistente(valor = process.env.NEXUS_ASSISTANT_MODE || 'corporate') {
  const modo = String(valor).toLowerCase();
  if (!['corporate', 'generalist'].includes(modo)) {
    throw new Error(`Modo de assistente invalido: ${modo}.`);
  }
  return modo;
}

function criarProviderGeneralista(dependencias = {}) {
  if (dependencias.generalistProvider) return dependencias.generalistProvider;
  const nome = dependencias.generalistProviderNome || process.env.NEXUS_GENERALIST_PROVIDER || 'anthropic';
  const modelo = dependencias.generalistModelo || process.env.NEXUS_GENERALIST_MODEL;
  if (!modelo) throw new Error('NEXUS_GENERALIST_MODEL deve ser definido no modo generalist.');
  const fallbackNome = dependencias.generalistFallbackNome || process.env.NEXUS_GENERALIST_FALLBACK_PROVIDER || '';
  const modeloFallback = dependencias.generalistFallbackModelo || process.env.NEXUS_GENERALIST_FALLBACK_MODEL || '';
  return criarProvider({
    nome, modelo,
    cliente: dependencias.generalistCliente,
    fallbackNome: fallbackNome || undefined,
    modeloFallback: modeloFallback || undefined,
    clienteFallback: dependencias.generalistClienteFallback,
    semFallback: !fallbackNome,
    timeoutMs: dependencias.timeoutMs
  });
}

function exigeEntregaCorporativaDireta(resultado) {
  const ferramentas = resultado.roteamento?.ferramentasExecutadas || [];
  const perfil = resultado.roteamento?.perfilEfetivo || resultado.roteamento?.perfilInicial;
  return perfil === 'sql' || ferramentas.includes('construir_sql');
}

function envelopeCorporativo(resultado, { omitirRespostaTecnica = false } = {}) {
  const status = resultado.interacao?.status === 'precisa_esclarecimento'
    ? 'precisa_esclarecimento'
    : resultado.interacao?.status === 'nao_suportado' ? 'nao_suportado' : 'sucesso';
  return {
    status,
    answer: omitirRespostaTecnica
      ? 'O Nexus gerou uma resposta tecnica que sera entregue diretamente ao usuario.'
      : resultado.texto,
    evidence: {
      provenance: 'dados_nexus',
      route: resultado.roteamento?.perfilEfetivo || resultado.roteamento?.perfilInicial || null,
      toolsUsed: resultado.roteamento?.ferramentasExecutadas || [],
      dataCoverage: resultado.roteamento?.decisao?.periodo || null,
      updatedAt: new Date().toISOString()
    }
  };
}

function normalizarHistoricoVisivel(mensagens = []) {
  const normalizadas = [];
  for (const item of mensagens) {
    if (!['user', 'assistant'].includes(item.role) || !item.content) continue;
    if (!normalizadas.length && item.role === 'assistant') continue;
    const anterior = normalizadas.at(-1);
    if (anterior?.role === item.role) anterior.content += `\n\n${item.content}`;
    else normalizadas.push({ role: item.role, content: String(item.content) });
  }
  return normalizadas;
}

async function executarAssistente(pergunta, dependencias = {}) {
  if (!pergunta || !pergunta.trim()) throw new Error('Informe uma pergunta.');
  const memoria = dependencias.memoria || criarMemoria({
    sessao: dependencias.sessaoMemoria,
    backend: dependencias.memoryBackend,
    pool: dependencias.poolNexus,
    principalSlug: dependencias.principalSlug
  });
  if (!memoria.pool && dependencias.auditoriaIA !== false) {
    throw new Error('O modo generalist exige memoria PostgreSQL para auditoria de consumo.');
  }
  const auditoria = dependencias.auditoriaIA === false ? null :
    dependencias.auditoriaIA || criarServicoAuditoriaIA({
      pool: memoria.pool,
      principalSlug: dependencias.principalSlug || memoria.principalSlug,
      sessao: memoria.sessao,
      departamentoSlug: dependencias.departamentoSlug,
      modo: dependencias.usagePolicyMode
    });
  const governanca = dependencias.governanca || (memoria.pool ? criarServicoGovernanca({
    pool: memoria.pool,
    principalSlug: dependencias.principalSlug || memoria.principalSlug,
    sessao: memoria.sessao,
    modo: dependencias.authzMode
  }) : null);
  const turno = auditoria ? await auditoria.iniciarTurno({ finalidade: 'general_chat' }) : {
    id: null, traceId: null, conversationId: null, finalidade: 'general_chat', iniciadoEm: new Date()
  };
  const telemetria = auditoria?.paraTelemetria(turno, { stage: 'generalist_decision' });
  let finalizado = false;
  try {
    const autorizacaoConversa = await governanca?.avaliar(
      'ia_conversar', dependencias.departamentoSlug || null
    );
    if (autorizacaoConversa && !autorizacaoConversa.permitida) {
      const erro = new Error('Acesso negado para a permissao ia.conversar.');
      erro.codigo = 'ACESSO_NEGADO';
      throw erro;
    }
    const historico = auditoria ? await auditoria.listarMensagens() : (dependencias.mensagens || []);
    await auditoria?.registrarMensagem(turno, { papel: 'user', conteudo: pergunta });
    const tarefaAtiva = await memoria.obterTarefaAtiva?.();
    const politica = exigeFonteCorporativa(pergunta, { tarefaAtiva });
    const provider = criarProviderGeneralista(dependencias);
    let consultaCache = null;
    let respostaCorporativaDireta = null;

    async function consultar(objetivo) {
      if (consultaCache) return consultaCache;
      const contextoExecucao = await governanca?.iniciarTool('consultar_nexus', { objetivo }, {
        provider: provider.nome, modelo: provider.modelo,
        traceId: turno.traceId, turnId: turno.id,
        parentCallId: telemetria?.ultimoCallId || null,
        stage: 'generalist_decision', purpose: 'corporate_query',
        departamentoSlug: dependencias.departamentoSlug || null
      });
      const inicio = Date.now();
      try {
        const telemetriaCorporativa = auditoria?.paraTelemetria(turno, {
          parentCallId: contextoExecucao?.callId || telemetria?.ultimoCallId || null,
          purpose: 'corporate_query'
        });
        const executarAgente = dependencias.executarAgenteCorporativo ||
          require('./consultor_nexus').executarAgente;
        const resultado = await executarAgente(objetivo || pergunta, {
          ...dependencias,
          memoria,
          governanca,
          telemetria: telemetriaCorporativa,
          turnoIA: turno,
          auditoriaIA: auditoria,
          purpose: 'corporate_query'
        });
        const entregaDireta = exigeEntregaCorporativaDireta(resultado);
        respostaCorporativaDireta = entregaDireta ? resultado.texto : null;
        consultaCache = envelopeCorporativo(resultado, { omitirRespostaTecnica: entregaDireta });
        await governanca?.concluirTool(contextoExecucao, {
          sucesso: true, duracaoMs: Date.now() - inicio
        });
        if (telemetria && contextoExecucao?.callId) telemetria.ultimoCallId = contextoExecucao.callId;
        return consultaCache;
      } catch (erro) {
        await governanca?.concluirTool(contextoExecucao, {
          sucesso: false, duracaoMs: Date.now() - inicio, erro
        });
        consultaCache = {
          status: 'erro', answer: 'A consulta corporativa esta indisponivel no momento.',
          evidence: { provenance: 'dados_nexus', route: null, toolsUsed: [], dataCoverage: null, updatedAt: null }
        };
        return consultaCache;
      }
    }

    let resultado;
    const mensagens = normalizarHistoricoVisivel([
      ...historico.map((item) => ({ role: item.role, content: item.content })),
      { role: 'user', content: pergunta }
    ]);
    if (politica.obrigatoria) {
      const evidencia = await consultar(pergunta);
      resultado = respostaCorporativaDireta ? {
        texto: respostaCorporativaDireta,
        provider: 'nexus', modelo: null, rodadas: 0
      } : await provider.executar({
          pergunta,
          mensagens: normalizarHistoricoVisivel([...mensagens, {
            role: 'user', content: `Evidencia corporativa autorizada: ${JSON.stringify(evidencia)}`
          }]),
          instrucoes: INSTRUCOES_GENERALISTA,
          tools: [],
          maxRodadas: 2,
          telemetria,
          stage: 'generalist_final',
          purpose: 'corporate_query',
          onEvento: dependencias.onEvento
        });
    } else {
      const contextoProvider = {
        pergunta,
        mensagens,
        instrucoes: INSTRUCOES_GENERALISTA,
        tools: [{
          definicao: definicaoConsultarNexus,
          terminal: false,
          executar: async ({ objetivo }) => JSON.stringify(await consultar(objetivo))
        }],
        maxRodadas: Number(dependencias.maxRodadas || process.env.NEXUS_MAX_RODADAS || 10),
        telemetria,
        stage: 'generalist_response',
        stageFinal: 'generalist_final',
        purpose: 'general_chat',
        onEvento: dependencias.onEvento,
        prepararFallback: async () => consultaCache ? {
          ...contextoProvider,
          mensagens: normalizarHistoricoVisivel([...mensagens, {
            role: 'user',
            content: `Evidencia corporativa autorizada ja consultada: ${JSON.stringify(consultaCache)}`
          }]),
          tools: [],
          stage: 'generalist_final',
          purpose: 'corporate_query',
          prepararFallback: null
        } : { ...contextoProvider, prepararFallback: null }
      };
      resultado = await provider.executar(contextoProvider);
      if (respostaCorporativaDireta) resultado = { ...resultado, texto: respostaCorporativaDireta };
    }
    const proveniencia = consultaCache ? 'dados_nexus' : 'conhecimento_geral';
    await auditoria?.registrarMensagem(turno, {
      papel: 'assistant', conteudo: resultado.texto, proveniencia
    });
    const resumo = await auditoria?.concluirTurno(turno, { sucesso: true, proveniencia });
    finalizado = true;
    return {
      ...resultado,
      traceId: turno.traceId,
      turnId: turno.id,
      proveniencia,
      evidencia: consultaCache?.evidence || null,
      politicaFonte: politica,
      usageSummary: resumo || null
    };
  } catch (erro) {
    if (!finalizado) {
      try { await auditoria?.concluirTurno(turno, { sucesso: false, erro }); } catch (_) { /* erro original prevalece */ }
    }
    throw erro;
  }
}

module.exports = {
  INSTRUCOES_GENERALISTA,
  criarProviderGeneralista,
  definicaoConsultarNexus,
  envelopeCorporativo,
  exigeEntregaCorporativaDireta,
  executarAssistente,
  normalizarHistoricoVisivel,
  resolverModoAssistente
};
