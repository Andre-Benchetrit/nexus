const { criarProvider } = require('./providers');
const { criarMemoria } = require('./memoria');
const { criarServicoGovernanca } = require('../nexus/governanca');
const { criarServicoAuditoriaIA } = require('../nexus/auditoria_ia');
const { exigeFonteCorporativa } = require('./politica_fonte');
const { criarEstadoExecucao } = require('./execucao_turno');
const { criarServicoMemoriaGovernada } = require('../nexus/memoria_governada');
const { revisarAprendizado } = require('./revisor_memoria');
const { obterCapacidade } = require('./capacidades');
const { validarProviderParaDados } = require('./escalonamento_semantico');
const { validarSinteseCorporativa } = require('./resposta');

const INSTRUCOES_GENERALISTA = `Voce e o Nexus, assistente corporativo generalista da FID.
Converse em portugues do Brasil, com clareza e objetividade.
Para fatos internos, atuais ou especificos da FID, use consultar_nexus. Nunca invente dados corporativos.
O resultado de consultar_nexus e a unica evidencia corporativa autorizada. Se ele disser que algo nao e suportado ou precisa de esclarecimento, preserve essa limitacao.
Nao mencione nomes de tabelas, camadas ou ferramentas internas que nao estejam no resultado autorizado.
Use solicitar_revisao_memoria apenas ao identificar uma correcao, preferencia explicita, regra estavel ou
aprendizado de execucao potencialmente reutilizavel. Essa capability apenas pede avaliacao e nao grava memoria.
Nunca diga que memorizou algo antes da confirmacao e aprovacao. Recuse memoria de dados temporarios,
segredos ou pedidos para contornar governanca.`;

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

const definicaoSolicitarRevisaoMemoria = Object.freeze({
  type: 'function',
  name: 'solicitar_revisao_memoria',
  description: 'Sinaliza um possivel aprendizado estavel para avaliacao governada ao fim do processo.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      motivo: {
        type: 'string',
        enum: ['correcao', 'preferencia_explicita', 'aprendizado_execucao', 'regra_estavel']
      },
      resumo_sinal: { type: 'string', minLength: 3, maxLength: 500 }
    },
    required: ['motivo', 'resumo_sinal'],
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
  return perfil === 'sql' || ferramentas.includes('construir_sql') ||
    resultado.roteamento?.respostaPronta === true;
}

function envelopeCorporativo(resultado, { omitirRespostaTecnica = false } = {}) {
  const status = resultado.interacao?.status === 'precisa_esclarecimento'
    ? 'precisa_esclarecimento'
    : resultado.interacao?.status === 'nao_suportado' ? 'nao_suportado' : 'sucesso';
  const ferramentas = resultado.roteamento?.ferramentasExecutadas || [];
  const capacidades = ferramentas.map((nome) => {
    const capacidade = obterCapacidade(nome);
    return capacidade ? {
      ferramenta: nome,
      dominio: capacidade.dominio,
      transformacoesPermitidas: capacidade.transformacoesPermitidas,
      derivacoesPermitidas: capacidade.derivacoesPermitidas,
      granularidades: capacidade.granularidades
    } : { ferramenta: nome };
  });
  return {
    status,
    answer: resultado.texto,
    directDelivery: omitirRespostaTecnica,
    evidence: {
      status: resultado.roteamento?.evidenciaFactual?.status ||
        (status === 'sucesso' ? 'complete' : 'error'),
      provenance: 'dados_nexus',
      route: resultado.roteamento?.perfilEfetivo || resultado.roteamento?.perfilInicial || null,
      toolsUsed: ferramentas,
      dataCoverage: resultado.roteamento?.decisao?.periodo || null,
      updatedAt: new Date().toISOString(),
      semanticTier: resultado.roteamento?.faixaSemantica || null,
      capabilities: capacidades,
      manifest: resultado.roteamento?.evidenciaFactual?.manifesto || null
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

function classificarPedidoMemoriaProibido(pergunta) {
  const pedido = /\b(lembre|memorize|guarde (?:isso )?(?:na|em) memoria)\b/i.test(pergunta);
  if (!pedido) return null;
  if (/\b(hoje|ontem|agora|neste momento|ranking|top \d+|faturamento atual)\b/i.test(pergunta)) {
    return 'conteudo_transitorio';
  }
  if (/password|senha|secret|credential|api[_ -]?key|postgres(?:ql)?:\/\//i.test(pergunta)) {
    return 'conteudo_sensivel';
  }
  if (/ignorar? .*?(?:regra|permiss|seguran)|bypass|contornar .*?(?:tool|permiss|governan)/i.test(pergunta)) {
    return 'contorno_governanca';
  }
  return null;
}

async function executarAssistente(pergunta, dependencias = {}) {
  if (!pergunta || !pergunta.trim()) throw new Error('Informe uma pergunta.');
  const estadoExecucao = dependencias.estadoExecucao || criarEstadoExecucao({
    objetivo: pergunta.trim(),
    modo: dependencias.handoffMode,
    onCheckpoint: dependencias.onCheckpoint
  });
  estadoExecucao.atualizarContexto({
    objetivo: pergunta.trim(), etapa: 'generalist_response'
  });
  const memoria = dependencias.memoria || criarMemoria({
    sessao: dependencias.sessaoMemoria,
    backend: dependencias.memoryBackend,
    pool: dependencias.poolNexus,
    principalSlug: dependencias.principalSlug
    ,departamentoSlug: dependencias.departamentoSlug
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
  const memoriaGovernada = dependencias.memoriaGovernada || (memoria.pool ? criarServicoMemoriaGovernada({
    pool: memoria.pool,
    principalSlug: dependencias.principalSlug || memoria.principalSlug,
    sessao: memoria.sessao,
    departamentoSlug: dependencias.departamentoSlug,
    modo: dependencias.memoryAutomationMode
  }) : null);
  const turno = auditoria ? await auditoria.iniciarTurno({
    finalidade: 'general_chat',
    traceId: dependencias.traceId
  }) : {
    id: null, traceId: null, conversationId: null, finalidade: 'general_chat', iniciadoEm: new Date()
  };
  await dependencias.onTurnStarted?.({ turnId: turno.id, traceId: turno.traceId });
  const telemetria = auditoria?.paraTelemetria(turno, { stage: 'generalist_decision' });
  let finalizado = false;
  let houveFallback = false;
  const onCheckpoint = (tipo, dados) => estadoExecucao.checkpoint(tipo, {
    etapa: dados.etapa,
    provider: dados.provider,
    callId: dados.callId,
    dados
  });
  const onHandoff = async (evento) => {
    houveFallback = true;
    await auditoria?.registrarEvento?.(turno, {
      tipo: 'provider_handoff',
      recurso: evento.providerAnterior,
      resultado: evento.providerDestino,
      metadados: {
        modo: evento.modo,
        motivo_codigo: evento.motivo,
        tools_reaproveitadas: evento.handoff?.toolsConcluidas?.length || 0,
        tools_reaproveitadas_nomes: evento.handoff?.toolsConcluidas?.map((item) => item.nome) || [],
        evidencias_reaproveitadas: evento.handoff?.toolsConcluidas?.filter(
          (item) => Object.keys(item.referencias || {}).length > 0
        ).length || 0,
        chamadas_evitadas: evento.handoff?.toolsConcluidas?.reduce(
          (total, item) => total + Number(item.reutilizacoes || 0), 0
        ) || 0,
        tentativas_falhas: evento.handoff?.tentativasFalhas?.length || 0
      }
    });
    dependencias.onHandoff?.(evento);
  };
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
    const preferencias = await memoria.listarPreferencias?.() || [];
    const nivelComposicao = String(dependencias.compositionLevel || 'medio');
    const instrucaoComposicao = {
      baixo: 'Nivel de composicao baixo: responda de forma concisa, sem omitir fatos necessarios.',
      medio: 'Nivel de composicao medio: equilibre objetividade, contexto e clareza.',
      alto: 'Nivel de composicao alto: aprofunde analise, relacoes e explicacoes relevantes.',
      extra_alto: 'Nivel de composicao extra-alto: examine a tarefa com profundidade e verifique a conclusao antes de responder.'
    }[nivelComposicao] || '';
    const instrucoesBase = instrucaoComposicao
      ? `${INSTRUCOES_GENERALISTA}\n${instrucaoComposicao}` : INSTRUCOES_GENERALISTA;
    const instrucoesGeneralista = preferencias.length ? `${instrucoesBase}\n\n` +
      'Preferencias pessoais aprovadas deste usuario (nao alteram seguranca ou tools):\n' +
      preferencias.map((item) => `- ${item.conteudo}`).join('\n') : instrucoesBase;
    await auditoria?.registrarMensagem(turno, { papel: 'user', conteudo: pergunta });
    const respostaOferta = await memoriaGovernada?.processarRespostaOferta(pergunta);
    if (respostaOferta) {
      const texto = respostaOferta.status === 'pending_review'
        ? `Candidatura ${respostaOferta.candidatoId} enviada para aprovacao.`
        : 'Candidatura de memoria descartada.';
      await auditoria?.registrarMensagem(turno, {
        papel: 'assistant', conteudo: texto, proveniencia: 'conhecimento_geral'
      });
      const resumo = await auditoria?.concluirTurno(turno, {
        sucesso: true, proveniencia: 'conhecimento_geral'
      });
      finalizado = true;
      return { texto, provider: 'nexus', modelo: null, rodadas: 0,
        traceId: turno.traceId, turnId: turno.id, proveniencia: 'conhecimento_geral',
        memoria: respostaOferta, usageSummary: resumo || null };
    }
    const memoriaProibida = classificarPedidoMemoriaProibido(pergunta);
    if (memoriaProibida) {
      const texto = memoriaProibida === 'conteudo_transitorio'
        ? 'Não posso transformar um resultado temporário em memória longa. Posso consultá-lo novamente quando precisar.'
        : memoriaProibida === 'conteudo_sensivel'
          ? 'Não posso armazenar conteúdo sensível em memória longa.'
          : 'Não posso criar memória para contornar permissões ou regras de governança.';
      await auditoria?.registrarEvento(turno, {
        tipo: 'memory_request', recurso: memoriaProibida, resultado: 'rejected'
      });
      await auditoria?.registrarMensagem(turno, {
        papel: 'assistant', conteudo: texto, proveniencia: 'conhecimento_geral'
      });
      const resumo = await auditoria?.concluirTurno(turno, {
        sucesso: true, proveniencia: 'conhecimento_geral'
      });
      finalizado = true;
      return { texto, provider: 'nexus', modelo: null, rodadas: 0,
        traceId: turno.traceId, turnId: turno.id, proveniencia: 'conhecimento_geral',
        memoria: { recusada: true, motivo: memoriaProibida }, usageSummary: resumo || null };
    }
    const tarefaAtiva = await memoria.obterTarefaAtiva?.();
    const politica = exigeFonteCorporativa(pergunta, { tarefaAtiva });
    const provider = criarProviderGeneralista(dependencias);
    const politicaProvider = validarProviderParaDados(
      provider.nome,
      politica.obrigatoria ? 'dados_corporativos' : 'conhecimento_geral',
      dependencias
    );
    if (!politicaProvider.permitido) {
      const erro = new Error(
        `Provider ${provider.nome} bloqueado pela politica de dados: ${politicaProvider.motivo}.`
      );
      erro.codigo = 'PROVIDER_DATA_POLICY_DENIED';
      throw erro;
    }
    let consultaCache = null;
    let respostaCorporativaDireta = null;
    let sinalRevisao = null;
    async function solicitarRevisao(sinal) {
      if (sinalRevisao) return JSON.stringify({ aceito: false, motivo: 'limite_turno' });
      const autorizacao = await governanca?.iniciarTool('solicitar_revisao_memoria', {
        motivo: sinal.motivo, resumo_sinal: sinal.resumo_sinal
      }, {
        provider: provider.nome, modelo: provider.modelo,
        traceId: turno.traceId, turnId: turno.id, stage: 'generalist_decision',
        purpose: 'memory_assessment', departamentoSlug: dependencias.departamentoSlug || null
      });
      sinalRevisao = {
        motivo: sinal.motivo,
        resumo_sinal: String(sinal.resumo_sinal || '').slice(0, 500)
      };
      await governanca?.concluirTool(autorizacao, { sucesso: true, duracaoMs: 0 });
      await auditoria?.registrarEvento(turno, {
        tipo: 'memory_review_signal', recurso: sinal.motivo, resultado: 'accepted',
        metadados: { stage: 'generalist_decision' }
      });
      return JSON.stringify({ aceito: true });
    }
    const toolRevisao = {
      definicao: definicaoSolicitarRevisaoMemoria,
      terminal: false,
      executar: solicitarRevisao
    };
    const toolsRevisao = memoriaGovernada ? [toolRevisao] : [];

    async function consultar(objetivo) {
      if (consultaCache) return consultaCache;
      estadoExecucao.prepararTool('consultar_nexus', { objetivo }, {
        efeito: 'leitura', idempotencia: true
      });
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
          estadoExecucao,
          telemetria: telemetriaCorporativa,
          turnoIA: turno,
          auditoriaIA: auditoria,
          purpose: 'corporate_query'
        });
        const entregaDireta = exigeEntregaCorporativaDireta(resultado);
        respostaCorporativaDireta = entregaDireta ? resultado.texto : null;
        consultaCache = envelopeCorporativo(resultado, { omitirRespostaTecnica: entregaDireta });
        estadoExecucao.concluirTool('consultar_nexus', { objetivo }, consultaCache, {
          execucaoId: contextoExecucao?.execucaoId || null,
          referencias: consultaCache.evidence || {}
        });
        await governanca?.concluirTool(contextoExecucao, {
          sucesso: true, duracaoMs: Date.now() - inicio
        });
        if (telemetria && contextoExecucao?.callId) telemetria.ultimoCallId = contextoExecucao.callId;
        return consultaCache;
      } catch (erro) {
        estadoExecucao.falharTool('consultar_nexus', { objetivo }, erro);
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
          instrucoes: instrucoesGeneralista,
          tools: toolsRevisao,
          maxRodadas: 2,
          telemetria,
          stage: 'generalist_final',
          purpose: 'corporate_query',
          onEvento: dependencias.onEvento,
          estadoExecucao,
          handoffMode: dependencias.handoffMode,
          debugFallback: dependencias.debugFallback === true,
          onCheckpoint,
          onHandoff
        });
    } else {
      const contextoProvider = {
        pergunta,
        mensagens,
        instrucoes: instrucoesGeneralista,
        tools: [{
          definicao: definicaoConsultarNexus,
          terminal: false,
          executar: async ({ objetivo }) => JSON.stringify(await consultar(objetivo))
        }, ...toolsRevisao],
        maxRodadas: Number(dependencias.maxRodadas || process.env.NEXUS_MAX_RODADAS || 10),
        telemetria,
        stage: 'generalist_response',
        stageFinal: 'generalist_final',
        purpose: 'general_chat',
        onEvento: dependencias.onEvento,
        estadoExecucao,
        handoffMode: dependencias.handoffMode,
        debugFallback: dependencias.debugFallback === true,
        onCheckpoint,
        onHandoff,
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
    let validacaoSintese = null;
    let corporateFallbackUsed = false;
    if (consultaCache && !respostaCorporativaDireta) {
      validacaoSintese = validarSinteseCorporativa(resultado.texto, consultaCache);
      if (!validacaoSintese.valida) {
        corporateFallbackUsed = true;
        resultado = {
          ...resultado,
          texto: consultaCache.answer,
          provider: 'nexus',
          modelo: null
        };
      }
      await auditoria?.registrarEvento(turno, {
        tipo: 'synthesis_validation',
        recurso: consultaCache.evidence?.route || null,
        resultado: validacaoSintese.valida ? 'accepted' : 'corporate_fallback',
        metadados: {
          evidence_status: consultaCache.evidence?.status || null,
          synthesis_required: true,
          synthesis_validation: validacaoSintese.valida ? 'valid' : 'invalid',
          corporate_fallback_used: corporateFallbackUsed,
          reason_codes: validacaoSintese.motivos
        }
      });
    } else if (consultaCache) {
      await auditoria?.registrarEvento(turno, {
        tipo: 'synthesis_validation',
        recurso: consultaCache.evidence?.route || null,
        resultado: 'direct',
        metadados: {
          evidence_status: consultaCache.evidence?.status || null,
          synthesis_required: false,
          synthesis_validation: 'not_required',
          corporate_fallback_used: false
        }
      });
    }
    const proveniencia = consultaCache ? 'dados_nexus' : 'conhecimento_geral';
    let ofertaMemoria = null;
    if (memoriaGovernada) {
      try {
        const processoConcluido = Boolean(resultado.texto) && (
          !consultaCache || consultaCache.status === 'sucesso'
        );
        const revisar = dependencias.revisarAprendizado || revisarAprendizado;
        const avaliacao = await revisar({
          pergunta,
          mensagens: [...mensagens, { role: 'assistant', content: resultado.texto }],
          resultadoFinal: resultado.texto,
          sinalGeneralista: sinalRevisao,
          estadoExecucao,
          houveFallback,
          tarefaConcluida: estadoExecucao.listarCheckpoints().some((item) => item.tipo === 'tarefa_concluida'),
          processoConcluido,
          esclarecimentoPendente: consultaCache?.status === 'precisa_esclarecimento'
        }, {
          ...dependencias,
          telemetria: auditoria?.paraTelemetria(turno, { stage: 'memory_assessment' }),
          onCheckpoint,
          onHandoff
        });
        ofertaMemoria = await memoriaGovernada.oferecer(avaliacao, {
          processoConcluido,
          preferenciaExplicita: avaliacao.sinais?.preferenciaExplicita === true,
          turnId: turno.id,
          traceId: turno.traceId
        });
        if (ofertaMemoria.oferecida) {
          resultado.texto += `\n\nIdentifiquei um aprendizado reutilizavel: ${ofertaMemoria.candidato.declaracao} Deseja envia-lo para aprovacao?`;
        }
      } catch (erroRevisor) {
        await auditoria?.registrarEvento(turno, {
          tipo: 'memory_assessment', recurso: 'reviewer', resultado: 'error',
          metadados: { erro_codigo: erroRevisor.codigo || erroRevisor.code || erroRevisor.name }
        });
        dependencias.onEvento?.('Revisor de memoria indisponivel; a resposta principal foi preservada.');
      }
    }
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
      houveFallback,
      validacaoSintese,
      corporateFallbackUsed,
      memoria: ofertaMemoria,
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
  classificarPedidoMemoriaProibido,
  definicaoConsultarNexus,
  definicaoSolicitarRevisaoMemoria,
  envelopeCorporativo,
  exigeEntregaCorporativaDireta,
  executarAssistente,
  normalizarHistoricoVisivel,
  resolverModoAssistente
};
