#!/usr/bin/env node

const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

const Fastify = require('fastify');
const helmet = require('@fastify/helmet');
const rateLimit = require('@fastify/rate-limit');
const multipart = require('@fastify/multipart');
const { criarPoolNexus } = require('../../nexus/db');
const {
  ErroHub, criarServicoHub, decisaoPermissao, faixaMinimaDaComposicao, resolverIdentidadeMicrosoft
} = require('../../nexus/hub');
const { verificarTokenHub } = require('../../nexus/hub_token');
const { criarLakeStorage } = require('../../nexus/lake_storage');
const { criarAttachmentStorage } = require('../../nexus/attachment_storage');
const { criarServicoAnexos, processarFilaLimpeza } = require('../../nexus/anexos');
const { criarServicoInteligenciaAnexos } = require('../../nexus/attachment_intelligence_store');
const { criarArtifactStorage } = require('../../nexus/artifact_storage');
const { criarServicoArtefatos, processarFilaLimpezaArtefatos } = require('../../nexus/artefatos');
const { criarDatasetStorage } = require('../../nexus/dataset_storage');
const { criarServicoDatasets, processarFilaLimpezaDatasets } = require('../../nexus/datasets');
const { criarKnowledgeStorage } = require('../../nexus/knowledge_storage');
const { criarKnowledgeOneDrivePublisher } = require('../../nexus/knowledge_onedrive_publisher');
const { criarServicoDocumentacao } = require('../../nexus/documentacao');
const { executarAssistente } = require('../../agentes/assistente_nexus');

function eventoSse(nome, dados) {
  return `event: ${nome}\ndata: ${JSON.stringify(dados)}\n\n`;
}

function codigoErro(erro) {
  const valor = erro?.codigo || erro?.code || erro?.name || 'ERRO_INTERNO';
  return /^[A-Za-z0-9_-]{2,80}$/.test(String(valor)) ? String(valor).toUpperCase() : 'ERRO_INTERNO';
}

function nomeDownloadSeguro(valor, padrao = 'arquivo') {
  return String(valor || padrao).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 180) || padrao;
}

function statusDoCheckpoint(item = {}) {
  const tipo = String(item.tipo || '');
  if (/recuperando_analise/.test(tipo)) return 'recuperando_analise';
  if (/comparando_anexos/.test(tipo)) return 'comparando_anexos';
  if (/analisando_anexo|attachment_analysis/.test(tipo)) return 'analisando_anexo';
  if (/indexando_anexo|attachment_index/.test(tipo)) return 'indexando_anexo';
  if (/politica|policy_validation/.test(tipo)) return 'validando_politicas';
  if (/web|pesquisa/.test(tipo)) return 'consultando_web';
  if (/extraindo_texto/.test(tipo)) return 'extraindo_texto';
  if (/arquivo_gerado_validado|artifact_validation/.test(tipo)) return 'validando_arquivo_gerado';
  if (/gerando_arquivo|artifact_generation/.test(tipo)) return 'gerando_arquivo';
  if (/analisando_arquivo|file_analysis/.test(tipo)) return 'extraindo_conteudo';
  if (/ocr|imagem_local|anexo/.test(tipo)) return 'processando_imagem';
  if (/vision|visao/.test(tipo)) return 'interpretando_imagem';
  if (/rota|router|faixa_semantica/.test(tipo)) return 'planejando';
  if (/tool.*(?:prepar|inicio)|ferramenta.*suger/.test(tipo)) return 'consultando_dados';
  if (/tool.*(?:conclu|result)|evidencia/.test(tipo)) return 'validando_evidencias';
  if (/provider|modelo|resposta/.test(tipo)) return 'interpretando';
  if (/tarefa_concluida/.test(tipo)) return 'preparando_resposta';
  return null;
}

function statusDoEvento(texto) {
  const valor = String(texto || '').toLowerCase();
  if (/roteador|perfil|plano validado|faixa semantica/.test(valor)) return 'planejando';
  if (/executando tool|aprofundamento/.test(valor)) return 'consultando_dados';
  if (/tool .*conclu|sustent|evidenc|sintese/.test(valor)) return 'validando_evidencias';
  if (/aguardando resposta|rodada/.test(valor)) return 'interpretando';
  return null;
}

function rotuloStatus(codigo) {
  return {
    interpretando: 'Interpretando sua solicitação',
    planejando: 'Planejando a melhor resposta',
    consultando_dados: 'Consultando dados autorizados',
    validando_evidencias: 'Validando as evidências',
    validando_politicas: 'Validando políticas e orientações',
    preparando_resposta: 'Preparando a resposta',
    consultando_web: 'Pesquisando fontes na internet',
    processando_imagem: 'Processando a imagem com segurança',
    extraindo_texto: 'Extraindo texto e códigos',
    interpretando_imagem: 'Interpretando o conteúdo visual',
    recebendo_arquivo: 'Recebendo o arquivo',
    validando_arquivo: 'Validando o arquivo com segurança',
    extraindo_conteudo: 'Extraindo o conteúdo relevante',
    analisando_planilha: 'Analisando a planilha localmente',
    extraindo_imagens: 'Extraindo imagens do documento',
    interpretando_paginas: 'Interpretando as páginas selecionadas',
    indexando_anexo: 'Indexando o anexo com segurança',
    analisando_anexo: 'Analisando o anexo',
    comparando_anexos: 'Comparando os anexos',
    recuperando_analise: 'Recuperando a análise já validada',
    gerando_arquivo: 'Gerando o arquivo solicitado',
    validando_arquivo_gerado: 'Validando o arquivo gerado'
  }[codigo] || 'Pensando';
}

function validarResultadoTurno(resultado) {
  if (!resultado || typeof resultado.texto !== 'string' || !resultado.texto.trim()) {
    throw new ErroHub(
      'RESPOSTA_VAZIA',
      'O Nexus concluiu o processamento sem produzir uma resposta valida. Tente novamente.',
      502
    );
  }
  return resultado;
}

function validarModoFonte(valor) {
  const modo = String(valor || 'automatico').toLowerCase();
  if (!['automatico', 'dados', 'documentacao', 'web'].includes(modo)) {
    throw new ErroHub('MODO_FONTE_INVALIDO', 'Selecione uma funcao valida para a mensagem.', 400);
  }
  return modo;
}

async function criarServidor(opcoes = {}) {
  const logger = opcoes.logger ?? { level: process.env.NEXUS_API_LOG_LEVEL || 'info' };
  const maxUploadBytes = Math.max(
    Number(process.env.NEXUS_IMAGE_MAX_BYTES || 10 * 1024 * 1024),
    Number(process.env.NEXUS_FILES_MAX_BYTES || 25 * 1024 * 1024),
    Number(process.env.NEXUS_KNOWLEDGE_MAX_BYTES || 50 * 1024 * 1024)
  );
  const app = Fastify({ logger, trustProxy: true,
    bodyLimit: Math.max(64 * 1024, maxUploadBytes + 64 * 1024) });
  const pool = opcoes.pool || criarPoolNexus();
  const lakeStorage = opcoes.lakeStorage || criarLakeStorage();
  const attachmentStorage = opcoes.attachmentStorage || criarAttachmentStorage();
  const artifactStorage = opcoes.artifactStorage || criarArtifactStorage();
  const datasetStorage = opcoes.datasetStorage || criarDatasetStorage();
  const datasetsMode = String(opcoes.datasetsMode || process.env.NEXUS_DATASETS_MODE || 'off').toLowerCase();
  const knowledgeStorage = opcoes.knowledgeStorage || criarKnowledgeStorage();
  const knowledgePublisher = opcoes.knowledgePublisher || (
    String(process.env.NEXUS_KNOWLEDGE_ONEDRIVE_WRITE_ENABLED || '0') === '1'
      ? criarKnowledgeOneDrivePublisher() : null
  );
  const executor = opcoes.executarAssistente || executarAssistente;
  let timerLimpezaAnexos = null;
  let timerLimpezaArtefatos = null;
  let timerLimpezaDatasets = null;
  // Compatibilidade apenas para testes/integracoes antigas. A API nao cria nem
  // executa o scheduler: em producao, somente nexus-lake-worker atualiza o lake.
  const agendador = opcoes.agendador || null;

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' }
  });
  await app.register(rateLimit, {
    max: Number(process.env.NEXUS_API_RATE_LIMIT_PER_MINUTE || 120),
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ator?.principalId || request.ip
  });
  await app.register(multipart, {
    limits: { files: 1, fileSize: maxUploadBytes }
  });

  app.decorateRequest('ator', null);
  app.addHook('preHandler', async (request) => {
    if (request.url.startsWith('/health/')) return;
    const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    let payload;
    try { payload = verificarTokenHub(token); } catch (_) {
      throw new ErroHub('NAO_AUTENTICADO', 'Sessao invalida ou expirada.', 401);
    }
    request.ator = payload;
    if (request.url === '/v1/auth/resolve') {
      if (payload.typ !== 'auth') throw new ErroHub('TOKEN_INVALIDO', 'Token de autenticacao invalido.', 401);
      return;
    }
    if (payload.typ !== 'session' || !payload.pid) {
      throw new ErroHub('TOKEN_INVALIDO', 'Token de sessao invalido.', 401);
    }
    const principal = (await pool.query(
      'SELECT id,slug,ativo FROM nexus.principals WHERE id=$1 AND slug=$2',
      [payload.pid, payload.sub]
    )).rows[0];
    if (!principal?.ativo) throw new ErroHub('NAO_AUTENTICADO', 'Usuario inativo.', 401);
  });

  app.setErrorHandler((erro, request, reply) => {
    const status = erro.status || erro.statusCode || 500;
    request.log.error({
      event: 'api_error', code: codigoErro(erro), status,
      stage: erro.etapaProcessamento || undefined,
      durationMs: erro.tempoProcessamentoMs || undefined,
      err: status >= 500 ? erro : undefined
    });
    reply.code(status).send({ error: {
      code: codigoErro(erro),
      message: status >= 500 ? 'O Nexus encontrou um erro operacional.' : erro.message
    } });
  });

  function servico(request) {
    return criarServicoHub({
      pool,
      principalId: request.ator.pid,
      principalSlug: request.ator.sub
    });
  }

  function anexos(request, departmentId = null, onStatus = null) {
    const inteligencia = criarServicoInteligenciaAnexos({
      pool, storage: attachmentStorage, principalId: request.ator.pid, departmentId
    });
    return criarServicoAnexos({ pool, storage: attachmentStorage,
      principalId: request.ator.pid, departmentId, inteligencia, onStatus });
  }

  function inteligenciaAnexos(request, departmentId = null) {
    return criarServicoInteligenciaAnexos({
      pool, storage: attachmentStorage, principalId: request.ator.pid, departmentId
    });
  }

  function artefatos(request) {
    return criarServicoArtefatos({ pool, storage: artifactStorage, principalId: request.ator.pid });
  }

  function datasets(request, departmentId = null) {
    return criarServicoDatasets({ pool, storage: datasetStorage, principalId: request.ator.pid,
      departmentId, modo: datasetsMode });
  }

  function documentacao(request) {
    return criarServicoDocumentacao({
      pool, storage: knowledgeStorage, principalId: request.ator.pid,
      embeddings: opcoes.knowledgeEmbeddings, publisher: knowledgePublisher
    });
  }

  async function exigirPermissao(request, permissao, departmentId, mensagem) {
    const autorizacao = await decisaoPermissao(pool, request.ator.pid, permissao, departmentId || null);
    if (!autorizacao.permitida) {
      throw new ErroHub('ACESSO_NEGADO', mensagem || 'Você não possui permissão para esta operação.', 403);
    }
    return autorizacao;
  }

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    let banco = false;
    try { await pool.query('SELECT 1'); banco = true; } catch (_) { banco = false; }
    const [lake, arquivos, artefatosHealth, datasetsHealth] = await Promise.all([
      lakeStorage.verificarSaude(), attachmentStorage.verificarSaude(), artifactStorage.verificarSaude(),
      datasetsMode === 'off' ? Promise.resolve({ saudavel: true, tipo: 'disabled' })
        : datasetStorage.verificarSaude()
    ]);
    const exigeDados = String(process.env.NEXUS_LAKE_REQUIRE_DATA || '0') === '1';
    const dadosDisponiveis = !exigeDados || lake.possuiObjetos === true ||
      Number(lake.camadas?.silver || 0) + Number(lake.camadas?.gold || 0) > 0;
    const pronto = banco && lake.saudavel && arquivos.saudavel && artefatosHealth.saudavel &&
      datasetsHealth.saudavel && dadosDisponiveis;
    if (!pronto) reply.code(503);
    return { status: pronto ? 'ready' : 'not_ready', database: banco,
      lake: { healthy: lake.saudavel, type: lake.tipo, datasets: lake.camadas || {} },
      files: { healthy: arquivos.saudavel, type: arquivos.tipo },
      artifacts: { healthy: artefatosHealth.saudavel, type: artefatosHealth.tipo },
      temporaryDatasets: { healthy: datasetsHealth.saudavel, type: datasetsHealth.tipo } };
  });

  app.post('/v1/auth/resolve', async (request) => resolverIdentidadeMicrosoft(pool, {
    tenantId: request.ator.tenantId,
    subjectId: request.ator.subjectId,
    email: request.ator.email,
    name: request.ator.name
  }));

  app.get('/v1/me', async (request) => servico(request).perfil());
  app.get('/v1/suggestions', async (request) => {
    const perfil = await servico(request).perfil();
    const corporativo = perfil.permissoes.includes('ia.nexus.consultar');
    return {
      items: corporativo ? [
        'Quais pedidos estão bloqueados por falta de estoque hoje?',
        'Mostre o faturamento deste mês até agora.',
        'Quais produtos tiveram menor giro nos últimos 30 dias?',
        'Temos agendamentos de chegada de produtos para hoje?'
      ] : [
        'Explique de forma simples o que é EBITDA.',
        'Ajude-me a organizar as prioridades desta semana.',
        'Revise este texto e deixe-o mais objetivo.'
      ]
    };
  });

  app.get('/v1/conversations', async (request) => servico(request).listarConversas({
    arquivadas: request.query?.archived === 'true',
    cursor: request.query?.cursor,
    limite: request.query?.limit
  }));
  app.post('/v1/conversations', async (request, reply) => {
    const criada = await servico(request).criarConversa(request.body || {});
    reply.code(201);
    return criada;
  });
  app.patch('/v1/conversations/:id', async (request) =>
    servico(request).atualizarConversa(request.params.id, request.body || {}));
  app.delete('/v1/conversations/:id', async (request) => {
    const chaves = await anexos(request).chavesDaConversa(request.params.id);
    const chavesArtefatos = await artefatos(request).chavesDaConversa(request.params.id);
    const chavesDatasets = datasetsMode === 'off' ? []
      : await datasets(request).chavesDaConversa(request.params.id);
    const resultado = await servico(request).excluirConversa(request.params.id);
    await anexos(request).finalizarExclusaoConversa(request.params.id, chaves);
    await artefatos(request).finalizarExclusaoConversa(request.params.id, chavesArtefatos);
    if (datasetsMode !== 'off') {
      await datasets(request).finalizarExclusaoConversa(request.params.id, chavesDatasets);
    }
    return resultado;
  });
  app.get('/v1/conversations/:id/messages', async (request) =>
    servico(request).listarMensagens(request.params.id, {
      cursor: request.query?.cursor, limite: request.query?.limit
    }));
  app.get('/v1/conversations/:id/turns/:requestId', async (request) =>
    servico(request).obterSolicitacao(request.params.id, request.params.requestId));
  app.post('/v1/conversations/:id/messages/:messageId/select', async (request) =>
    servico(request).selecionarVariante(request.params.id, request.params.messageId));

  app.post('/v1/conversations/:id/attachments', async (request, reply) => {
    const inicio = Date.now();
    let etapa = 'recebendo_arquivo';
    try {
      const conversa = await servico(request).obterConversa(request.params.id);
      const arquivo = await request.file();
      if (!arquivo) throw new ErroHub('ANEXO_AUSENTE', 'Selecione um arquivo para enviar.');
      const imagem = String(arquivo.mimetype || '').startsWith('image/') || /\.(?:png|jpe?g|webp)$/i.test(String(arquivo.filename || ''));
      etapa = 'autorizando_arquivo';
      const autorizacao = await decisaoPermissao(pool, request.ator.pid,
        imagem ? 'ia.imagem.processar_local' : 'ia.arquivo.processar_local', conversa.department_id);
      if (!autorizacao.permitida) throw new ErroHub('ACESSO_NEGADO', 'Você não possui permissão para processar este arquivo.', 403);
      etapa = 'recebendo_arquivo';
      const buffer = await arquivo.toBuffer();
      if (arquivo.file.truncated) throw new ErroHub('ANEXO_GRANDE', 'O arquivo excede o limite permitido.');
      etapa = 'validando_arquivo';
      const item = await anexos(request, conversa.department_id, (evento) => {
        if (evento?.etapa) etapa = evento.etapa;
      }).salvar(request.params.id, {
        buffer, fileName: arquivo.filename, mediaType: arquivo.mimetype
      });
      request.log.info({ event: 'attachment_upload_completed', format: item.format,
        bytes: Number(item.bytes), stage: item.analysis_status || 'ready',
        cacheHit: item.cache_hit === true, durationMs: Date.now() - inicio });
      reply.code(201);
      return { id: item.id, mediaType: item.media_type, bytes: Number(item.bytes),
        width: item.width, height: item.height, status: item.status, kind: item.kind,
        name: item.file_name, format: item.format, pages: item.page_count,
        sheets: item.sheet_count, cells: item.cell_count, createdAt: item.criado_em,
        analysisStatus: item.analysis_status || item.status, cacheHit: item.cache_hit === true,
        url: `/api/nexus/conversations/${request.params.id}/attachments/${item.id}` };
    } catch (erro) {
      erro.etapaProcessamento ||= etapa;
      erro.tempoProcessamentoMs ||= Date.now() - inicio;
      throw erro;
    }
  });
  app.get('/v1/conversations/:id/attachments/:attachmentId/status', async (request) =>
    anexos(request).obterStatus(request.params.id, request.params.attachmentId));
  app.get('/v1/conversations/:id/attachments/:attachmentId', async (request, reply) => {
    const servicoAnexos = anexos(request);
    const metadados = await servicoAnexos.obter(request.params.id, request.params.attachmentId);
    await exigirPermissao(request, metadados.kind === 'image'
      ? 'ia.imagem.processar_local' : 'ia.arquivo.processar_local', metadados.department_id,
    'Você não possui permissão para baixar este anexo.');
    const { item, buffer } = await servicoAnexos.abrir(request.params.id, request.params.attachmentId);
    reply.header('Content-Type', item.media_type);
    reply.header('Cache-Control', 'private, max-age=3600');
    const disposition = item.kind === 'image' ? 'inline' : 'attachment';
    reply.header('Content-Disposition', `${disposition}; filename="${nomeDownloadSeguro(item.file_name)}"`);
    return reply.send(buffer);
  });
  app.delete('/v1/conversations/:id/attachments/:attachmentId', async (request) =>
    anexos(request).excluir(request.params.id, request.params.attachmentId));
  app.get('/v1/conversations/:id/artifacts/:artifactId', async (request, reply) => {
    const servicoArtefatos = artefatos(request);
    const metadados = await servicoArtefatos.obter(request.params.id, request.params.artifactId);
    await exigirPermissao(request, 'ia.arquivo.gerar', metadados.department_id,
      'Você não possui permissão para baixar este arquivo gerado.');
    const { item, buffer } = await servicoArtefatos.abrir(request.params.id, request.params.artifactId);
    reply.header('Content-Type', item.media_type);
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Content-Disposition', `attachment; filename="${nomeDownloadSeguro(item.file_name)}"`);
    return reply.send(buffer);
  });
  app.delete('/v1/conversations/:id/artifacts/:artifactId', async (request) =>
    artefatos(request).excluir(request.params.id, request.params.artifactId));

  app.post('/v1/conversations/:id/turns', {
    config: { rateLimit: { max: Number(process.env.NEXUS_TURN_RATE_LIMIT_PER_MINUTE || 20), timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const hub = servico(request);
    const retryMessageId = request.body?.retryMessageId ? String(request.body.retryMessageId) : null;
    const retry = retryMessageId
      ? await hub.prepararNovaTentativa(request.params.id, retryMessageId) : null;
    const attachmentIds = retry?.attachmentIds ||
      (Array.isArray(request.body?.attachmentIds) ? request.body.attachmentIds.map(String) : []);
    const pergunta = String(retry?.message || request.body?.message ||
      (attachmentIds.length ? 'Analise os arquivos anexados.' : '')).trim();
    if (!pergunta || pergunta.length > 20_000) {
      throw new ErroHub('MENSAGEM_INVALIDA', 'Informe uma mensagem de ate 20.000 caracteres.');
    }
    const sourceMode = validarModoFonte(retry?.sourceMode || request.body?.sourceMode);
    const conversaTurno = await hub.obterConversa(request.params.id);
    const servicoAnexosTurno = anexos(request, conversaTurno.department_id);
    for (const attachmentId of attachmentIds) {
      const metadados = await servicoAnexosTurno.obter(request.params.id, attachmentId);
      await exigirPermissao(request, metadados.kind === 'image'
        ? 'ia.imagem.processar_local' : 'ia.arquivo.analisar', conversaTurno.department_id,
      'Você não possui permissão para analisar este anexo.');
    }
    const anexosTurno = await servicoAnexosTurno.resolverParaTurno(request.params.id, attachmentIds);
    const inicio = await hub.iniciarSolicitacao(request.params.id, {
      clientRequestId: request.body?.clientRequestId,
      compositionLevel: request.body?.compositionLevel
    });
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    let conectado = true;
    let ultimoStatus = null;
    reply.raw.on('close', () => { conectado = false; });
    const enviar = (nome, dados) => {
      if (conectado && !reply.raw.destroyed) reply.raw.write(eventoSse(nome, dados));
    };
    const etapa = (codigo, detalhes = {}) => {
      if (!codigo || codigo === ultimoStatus && detalhes.cacheHit == null) return;
      ultimoStatus = codigo;
      enviar('stage.changed', { code: codigo, label: rotuloStatus(codigo),
        ...(detalhes.cacheHit == null ? {} : { cacheHit: detalhes.cacheHit === true }),
        ...(detalhes.attachments ? { attachments: detalhes.attachments } : {}) });
    };

    enviar('turn.accepted', {
      requestId: inicio.request.id,
      traceId: inicio.request.trace_id,
      reused: inicio.reused,
      status: inicio.request.status
    });
    if (inicio.reused) {
      if (inicio.request.status === 'success') {
        const mensagens = await hub.listarMensagens(request.params.id, { limite: 10 });
        const final = [...mensagens].reverse().find((item) => item.role === 'assistant');
        if (final) enviar('turn.completed', { message: final, reused: true });
      } else etapa('interpretando');
      reply.raw.end();
      return;
    }

    await hub.marcarSolicitacao(inicio.request.id, 'running');
    etapa('interpretando');
    try {
      const composicao = inicio.request.composition_level;
      const servicoArtefatosTurno = artefatos(request);
      const servicoDatasetsTurno = datasets(request, inicio.conversation.department_id);
      const resultado = validarResultadoTurno(await executor(pergunta, {
        assistantMode: 'generalist',
        sessaoMemoria: inicio.conversation.chave_sessao,
        principalSlug: request.ator.sub,
        departamentoSlug: inicio.conversation.department_slug,
        principalId: request.ator.pid,
        conversationId: inicio.conversation.id,
        departamentoId: inicio.conversation.department_id,
        poolNexus: pool,
        memoryBackend: 'postgres',
        authzMode: 'enforce',
        interactionMode: 'v1',
        routerMode: process.env.NEXUS_ROUTER_MODE || 'v2',
        handoffMode: process.env.NEXUS_HANDOFF_MODE || 'v1',
        semanticEscalationMode: process.env.NEXUS_SEMANTIC_ESCALATION_MODE || 'shadow',
        semanticTier: faixaMinimaDaComposicao(composicao),
        compositionLevel: composicao,
        sourceMode,
        traceId: inicio.request.trace_id,
        anexos: anexosTurno,
        servicoAnexos: anexos(request),
        servicoInteligenciaAnexos: inteligenciaAnexos(request, inicio.conversation.department_id),
        servicoArtefatos: servicoArtefatosTurno,
        servicoDatasets: servicoDatasetsTurno,
        filesMode: process.env.NEXUS_FILES_MODE || 'off',
        artifactsMode: process.env.NEXUS_ARTIFACTS_MODE || 'off',
        datasetsMode,
        retryRootMessageId: retry?.rootMessageId || null,
        existingUserMessageId: retry?.userMessageId || null,
        onTurnStarted: async ({ turnId }) => {
          await hub.marcarSolicitacao(inicio.request.id, 'running', { turnId });
          if (!retry) await anexos(request).vincularTurno(attachmentIds, turnId);
        },
        onCheckpoint: (item) => etapa(statusDoCheckpoint(item), {
          cacheHit: item?.dados?.cacheHit,
          attachments: item?.dados?.attachments
        }),
        onEvento: (texto) => etapa(statusDoEvento(texto))
      }));
      etapa('preparando_resposta');
      await Promise.all([
        hub.marcarSolicitacao(inicio.request.id, 'success', { turnId: resultado.turnId }),
        hub.concluirAtividade(request.params.id, pergunta, resultado.turnId, composicao)
      ]);
      if (resultado.memoria?.oferecida) {
        enviar('memory.offer', {
          id: resultado.memoria.candidato.id,
          statement: resultado.memoria.candidato.declaracao,
          expiresAt: resultado.memoria.candidato.expiraOfertaEm
        });
      }
      enviar('turn.completed', {
        message: {
          turnId: resultado.turnId,
          traceId: resultado.traceId,
          role: 'assistant',
          content: resultado.texto,
          provenance: resultado.proveniencia,
          sourceMode,
           evidence: resultado.evidencia || (resultado.fontesWeb?.length ? { sources: resultado.fontesWeb } : null),
           artifacts: resultado.artefatos || [],
           knowledgeSources: resultado.fontesDocumentais || [],
           attachmentAnalysis: resultado.analiseAnexos || null,
          usage: resultado.usageSummary
        }
      });
    } catch (erro) {
      await hub.marcarSolicitacao(inicio.request.id, 'error', { erro });
      enviar('turn.failed', { code: codigoErro(erro),
        message: erro.status && erro.status < 500 ? erro.message : 'Nao foi possivel concluir esta resposta.' });
    } finally {
      if (conectado && !reply.raw.destroyed) reply.raw.end();
    }
  });

  app.post('/v1/memory-offers/:id/respond', async (request) =>
    servico(request).responderOferta(request.body?.conversationId, request.params.id, request.body?.action));

  app.get('/v1/knowledge', async (request) => documentacao(request).listar({
    departmentId: request.query?.departmentId || null,
    status: request.query?.status === 'all' ? null : request.query?.status || 'publicado',
    busca: request.query?.search || '', limite: request.query?.limit
  }));
  app.post('/v1/knowledge', async (request, reply) => {
    const criado = await documentacao(request).criarRascunho(request.body || {});
    reply.code(201);
    return criado;
  });
  app.get('/v1/knowledge/:id', async (request) => documentacao(request).obter(request.params.id, {
    departmentId: request.query?.departmentId || null
  }));
  app.patch('/v1/knowledge/:id', async (request) =>
    documentacao(request).atualizarRascunho(request.params.id, request.body || {}));
  app.post('/v1/knowledge/:id/submit', async (request) =>
    documentacao(request).enviarParaRevisao(request.params.id, request.body?.departmentId || null));
  app.post('/v1/knowledge/:id/publish', async (request) =>
    documentacao(request).publicar(request.params.id, request.body || {}));
  app.post('/v1/knowledge/:id/request-changes', async (request) =>
    documentacao(request).solicitarAjustes(request.params.id, request.body || {}));
  app.post('/v1/knowledge/:id/move', async (request) =>
    documentacao(request).realocarDocumento(request.params.id, request.body || {}));
  app.get('/v1/knowledge/:id/download/:format', async (request, reply) => {
    const formato = String(request.params.format || '').toLowerCase();
    const buffer = await documentacao(request).abrirPublicado(request.params.id, formato, {
      departmentId: request.query?.departmentId || null
    });
    reply.header('Content-Type', formato === 'docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="documento.${formato}"`);
    return reply.send(buffer);
  });
  app.get('/v1/knowledge/:id/download/source', async (request, reply) => {
    const origem = await documentacao(request).abrirFontePublicada(request.params.id, {
      departmentId: request.query?.departmentId || null
    });
    reply.header('Content-Type', origem.mediaType || 'application/octet-stream');
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Content-Disposition', `attachment; filename="${nomeDownloadSeguro(origem.fileName, 'documento')}"`);
    return reply.send(origem.buffer);
  });
  app.get('/v1/knowledge/:id/pages/:page/image', async (request, reply) => {
    const buffer = await documentacao(request).abrirPaginaVisual(
      request.params.id, Number(request.params.page), { departmentId: request.query?.departmentId || null }
    );
    reply.header('Content-Type', 'image/png');
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(buffer);
  });

  app.post('/v1/admin/knowledge/import', async (request, reply) => {
    const campos = {};
    let arquivo = null;
    for await (const parte of request.parts()) {
      if (parte.type === 'file') {
        if (arquivo) throw new ErroHub('IMPORTACAO_INVALIDA', 'Envie somente um documento por requisicao.', 400);
        arquivo = { buffer: await parte.toBuffer(), nomeArquivo: parte.filename, mediaType: parte.mimetype };
      } else campos[parte.fieldname] = parte.value;
    }
    if (!arquivo) throw new ErroHub('DOCUMENTO_AUSENTE', 'Selecione um documento para importar.', 400);
    const resultado = await documentacao(request).registrarImportacao({
      ...arquivo, titulo: campos.titulo, tipo: campos.tipo || 'procedimento',
      escopo: campos.escopo || 'setor', departmentId: campos.departmentId || null,
      externalDriveId: campos.externalDriveId || null,
      externalItemId: campos.externalItemId || null,
      externalPath: campos.externalPath || null,
      modificadoEm: campos.modificadoEm || null
    });
    reply.code(201);
    return resultado;
  });

  app.get('/v1/admin/principals', async (request) => servico(request).listarPrincipals());
  app.post('/v1/admin/principals', async (request, reply) => {
    const criado = await servico(request).cadastrarPrincipal(request.body || {});
    reply.code(201);
    return criado;
  });
  app.patch('/v1/admin/principals/:id', async (request) =>
    servico(request).atualizarPrincipal(request.params.id, request.body || {}));
  app.put('/v1/admin/principals/:id/assignments', async (request) =>
    servico(request).substituirAtribuicoes(request.params.id, request.body || {}));
  app.get('/v1/admin/departments', async (request) => servico(request).listarSetores());
  app.get('/v1/admin/roles', async (request) => servico(request).listarPapeis());
  app.post('/v1/admin/departments', async (request, reply) => {
    const criado = await servico(request).cadastrarSetor(request.body || {});
    reply.code(201);
    return criado;
  });
  app.patch('/v1/admin/departments/:id', async (request) =>
    servico(request).atualizarSetor(request.params.id, request.body || {}));
  app.get('/v1/admin/usage', async (request) => servico(request).relatorioCustos(request.query || {}));
  app.get('/v1/admin/audit', async (request) => servico(request).listarAuditoria(request.query || {}));
  app.get('/v1/admin/audit/:traceId', async (request) => servico(request).obterTrace(request.params.traceId));
  app.get('/v1/admin/memory-candidates', async (request) =>
    servico(request).listarCandidaturasMemoria(request.query || {}));
  app.post('/v1/admin/memory-candidates/:id/review', async (request) =>
    servico(request).revisarCandidaturaMemoria(request.params.id, request.body || {}));
  app.get('/v1/admin/lake', async (request) => {
    await servico(request).listarAuditoria({ limite: 1 });
    const health = await lakeStorage.verificarSaude();
    const eventos = (await pool.query(`SELECT resultado,metadados,criado_em FROM nexus.audit_events
      WHERE tipo='lake_scheduler' ORDER BY criado_em DESC LIMIT 10`)).rows;
    const ultimaExecucao = (await pool.query(`SELECT id,mode,status,scheduled_type,started_at,
      finished_at,duration_ms,failure_count,blocked_count,error_code
      FROM nexus.lake_pipeline_runs ORDER BY started_at DESC,id DESC LIMIT 1`)).rows[0] || null;
    const etapas = ultimaExecucao ? (await pool.query(`SELECT layer,object_key,source_key,action,
      status,started_at,finished_at,duration_ms,row_count,checksum,blocked_by,error_code
      FROM nexus.lake_pipeline_stages WHERE run_id=$1
      ORDER BY started_at NULLS FIRST,layer,object_key`, [ultimaExecucao.id])).rows : [];
    const workerEnabled = String(process.env.NEXUS_LAKE_WORKER_ENABLED || '0') === '1';
    return { health, backend: lakeStorage.tipo, workerEnabled,
      schedulerEnabled: workerEnabled, executor: 'worker',
      latestRun: ultimaExecucao ? { ...ultimaExecucao, stages: etapas } : null, events: eventos };
  });

  app.addHook('onReady', async () => {
    await pool.query(`UPDATE nexus.hub_turn_requests SET status='interrupted',
      erro_codigo='PROCESS_RESTART',concluido_em=now()
      WHERE status IN ('accepted','running') AND criado_em<now()-interval '30 minutes'`);
    agendador?.iniciar?.();
    timerLimpezaAnexos = setInterval(() => processarFilaLimpeza({ pool, storage: attachmentStorage })
      .catch((erro) => app.log.warn({ event: 'attachment_cleanup_error', code: codigoErro(erro) })), 5 * 60 * 1000);
    timerLimpezaAnexos.unref?.();
    timerLimpezaArtefatos = setInterval(() => processarFilaLimpezaArtefatos({ pool, storage: artifactStorage })
      .catch((erro) => app.log.warn({ event: 'artifact_cleanup_error', code: codigoErro(erro) })), 5 * 60 * 1000);
    timerLimpezaArtefatos.unref?.();
    if (datasetsMode !== 'off') {
      timerLimpezaDatasets = setInterval(() => processarFilaLimpezaDatasets({ pool, storage: datasetStorage })
        .catch((erro) => app.log.warn({ event: 'dataset_cleanup_error', code: codigoErro(erro) })), 5 * 60 * 1000);
      timerLimpezaDatasets.unref?.();
    }
  });
  app.addHook('onClose', async () => {
    agendador?.parar?.();
    if (timerLimpezaAnexos) clearInterval(timerLimpezaAnexos);
    if (timerLimpezaArtefatos) clearInterval(timerLimpezaArtefatos);
    if (timerLimpezaDatasets) clearInterval(timerLimpezaDatasets);
    if (!opcoes.lakeStorage) await lakeStorage.fechar?.();
    if (!opcoes.pool) await pool.end();
  });

  return app;
}

if (require.main === module) {
  criarServidor().then((app) => app.listen({
    port: Number(process.env.PORT || process.env.NEXUS_API_PORT || 3001), host: '0.0.0.0'
  })).catch((erro) => {
    process.stderr.write(`Falha ao iniciar Nexus API: ${codigoErro(erro)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  criarServidor, eventoSse, statusDoCheckpoint, statusDoEvento, validarResultadoTurno
};
