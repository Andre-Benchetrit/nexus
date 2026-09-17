const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const { criarProvider, PROVIDER_PADRAO } = require('./providers');
const { obterInstrucaoPerfil, obterInstrucoes } = require('./instrucoes');
const {
  ferramentaDeNegocio,
  ferramentaTecnica,
  instrumentarFerramentas,
  obterFerramentaPorNome,
  obterFerramentasDoPerfil
} = require('./ferramentas');
const {
  pedeMesmaCobertura,
  referenciaContextual,
  resolverRoteamentoComContexto
} = require('./roteador');
const {
  completarAnoEmDatas,
  extrairContextoTemporal,
  obterDataReferencia
} = require('./contexto_temporal');
const { aplicarPoliticaArgumentos, validarPoliticaExecucao } = require('./politicas_tools');
const {
  criarMemoria,
  extrairReferenciasTemporais,
  pareceContinuacao
} = require('./memoria');
const { planejarRecuperacaoTool } = require('./recuperacao_tools');
const { resumirCatalogo } = require('./catalogo_aprofundamento');
const {
  dominioCobreSolicitacao,
  extrairReferenciasResultado,
  obterCapacidade,
  validarPlanoSugerido
} = require('./capacidades');
const {
  decisaoDoLegado,
  interpretarRotaSemantica,
  resolverModoRoteador
} = require('./roteador_semantico');
const {
  aplicarGarantiasResposta,
  avaliarSustentacaoFactual,
  criarEnvelopeEvidencia,
  normalizarResultadoTool
} = require('./resposta');
const {
  formatarPerguntas,
  processarMensagemInterativa,
  registrarEsclarecimentoRota,
  resolverModoInteracao
} = require('./interacoes');
const { formatarRespostaSql } = require('../tools/construir_sql');
const { criarServicoGovernanca } = require('../nexus/governanca');
const { criarServicoAuditoriaIA } = require('../nexus/auditoria_ia');
const { criarPoolNexus } = require('../nexus/db');
const { criarEstadoExecucao } = require('./execucao_turno');
const { resolverModoPlaybook } = require('../nexus/memoria_governada');
const {
  avaliarFaixaSemantica,
  maiorFaixa,
  resolverModoEscalonamento,
  selecionarProviderDaFaixa,
  validarProviderParaDados
} = require('./escalonamento_semantico');

const MAX_RODADAS_NEGOCIO = 10;
const MAX_RODADAS_GENERICAS = 10;
const MAX_RODADAS_APROFUNDAMENTO = 10;
const INSTRUCOES = obterInstrucoes('completo');

function criarProviderConfigurado(dependencias) {
  return dependencias.provider || criarProvider({
    nome: dependencias.providerNome,
    modelo: dependencias.modelo,
    cliente: dependencias.cliente,
    fallbackNome: dependencias.fallbackNome,
    modeloFallback: dependencias.modeloFallback,
    clienteFallback: dependencias.clienteFallback,
    semFallback: dependencias.semFallback,
    timeoutMs: dependencias.timeoutMs
  });
}

function assinaturaEstavel(valor) {
  if (Array.isArray(valor)) return valor.map(assinaturaEstavel);
  if (!valor || typeof valor !== 'object') return valor;
  return Object.fromEntries(
    Object.keys(valor).sort().map((chave) => [chave, assinaturaEstavel(valor[chave])])
  );
}

function respostaIndisponibilidadeDocumental() {
  return 'Não consegui consultar a base documental neste momento. ' +
    'Isso é uma indisponibilidade técnica e não significa que o procedimento não exista. ' +
    'Tente novamente em instantes.';
}

function contextoPermiteBronze(pergunta, justificativa) {
  const texto = `${pergunta} ${justificativa}`
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /auditor|diverg|histor|origem|dado bruto|registro bruto|confer|validar/.test(texto);
}

function estabilizarDecisaoComHistorico(decisao, pergunta, historico = []) {
  const anterior = historico.at(-1);
  const dominioAnterior = anterior?.rota?.dominioPrimario ||
    String(anterior?.perfil || '').split('+')[0] || null;
  const texto = String(pergunta || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const camposEnriquecimento = [
    [/\bean\b|codigo(?:s)? de barra(?:s)?/, 'ean'],
    [/\bsku(?:s)?\b/, 'sku'],
    [/\bmarketplace[_ ]pedido\b/, 'marketplace_pedido']
  ].filter(([padrao]) => padrao.test(texto)).map(([, campo]) => campo);
  const enriquecerBloqueios = dominioAnterior === 'bloqueios_estoque' &&
    (decisao.dominioPrimario === 'bloqueios_estoque' || referenciaContextual(pergunta)) &&
    camposEnriquecimento.some(
      (campo) => ['ean', 'sku'].includes(campo)
    );
  if (enriquecerBloqueios) {
    const pedidos = anterior?.referencias?.marketplace_pedido ||
      anterior?.entidades?.marketplace_pedido || [];
    return {
      ...decisao,
      dominioPrimario: 'bloqueios_estoque',
      dominiosSecundarios: (decisao.dominiosSecundarios || []).filter(
        (dominio) => dominio !== 'bloqueios_estoque'
      ),
      intencao: 'enriquecer',
      camposSolicitados: [...new Set([
        ...(decisao.camposSolicitados || []),
        ...camposEnriquecimento
      ])],
      entidades: pedidos.length ? [{
        tipo: 'marketplace_pedido', valores: [...pedidos], origem: 'memoria'
      }] : decisao.entidades,
      codigosMotivo: [
        ...(decisao.codigosMotivo || []),
        'enriquecimento_contextual_deterministico'
      ]
    };
  }
  if (
    !dominioAnterior ||
    dominioAnterior === decisao.dominioPrimario ||
    !referenciaContextual(pergunta)
  ) return decisao;
  if (!dominioCobreSolicitacao(
    dominioAnterior,
    decisao.intencao,
    decisao.camposSolicitados
  )) return decisao;
  return {
    ...decisao,
    dominioPrimario: dominioAnterior,
    dominiosSecundarios: decisao.dominiosSecundarios.filter(
      (dominio) => dominio !== dominioAnterior
    ),
    codigosMotivo: [
      ...decisao.codigosMotivo,
      'dominio_anterior_preservado_por_capacidade'
    ]
  };
}

function resolverContextoTemporalDaSolicitacao(perguntaAtual, historico, dataReferencia) {
  const atual = String(perguntaAtual || '').trim();
  const direto = extrairContextoTemporal(atual, dataReferencia);
  if (direto) return direto;
  const normalizado = atual.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const anoCurto = /^(?:(?:e\s+)?(?:de fato|na verdade|correto|corretamente|quis dizer|corrigindo)\s+)?(?:o\s+ano\s+)?((?:19|20)\d{2})[.! ]*$/.exec(normalizado);
  if (anoCurto) {
    const anteriorComMes = [...(historico || [])].reverse().find((item) =>
      /\b(?:janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i
        .test(String(item?.pergunta || item?.perguntaAutonoma || ''))
    );
    if (anteriorComMes) {
      const anterior = String(anteriorComMes.pergunta || anteriorComMes.perguntaAutonoma)
        .replace(/[?!.,;:\s]+$/g, '');
      const resolvido = extrairContextoTemporal(`${anterior} de ${anoCurto[1]}`, dataReferencia);
      if (resolvido) return { ...resolvido, origem: 'correcao_ano_continuacao' };
    }
  }
  if (pareceContinuacao(atual) || referenciaContextual(atual)) {
    const anteriorComPeriodo = [...(historico || [])].reverse().find((item) => {
      const periodo = item?.periodo || item?.rota?.periodo;
      const inicio = periodo?.data_inicial || periodo?.inicio;
      const fim = periodo?.data_final || periodo?.fim;
      return /^\d{4}-\d{2}-\d{2}$/.test(String(inicio || '')) &&
        /^\d{4}-\d{2}-\d{2}$/.test(String(fim || ''));
    });
    if (anteriorComPeriodo) {
      const periodo = anteriorComPeriodo.periodo || anteriorComPeriodo.rota.periodo;
      return {
        tipo: 'periodo_explicito', origem: 'periodo_anterior_estruturado',
        inicio: periodo.data_inicial || periodo.inicio,
        fim: periodo.data_final || periodo.fim
      };
    }
  }
  return null;
}

function aplicarContextoTemporalNaDecisao(decisao, temporal) {
  if (!decisao || !temporal?.inicio || !temporal?.fim) return decisao;
  return {
    ...decisao,
    periodo: {
      data_inicial: temporal.inicio,
      data_final: temporal.fim,
      referencia: temporal.origem || 'normalizacao_deterministica'
    },
    codigosMotivo: [...new Set([
      ...(decisao.codigosMotivo || []),
      'periodo_normalizado_deterministicamente'
    ])]
  };
}

async function executarAgenteInterno(pergunta, dependencias = {}) {
  if (!pergunta || !pergunta.trim()) throw new Error('Informe uma pergunta.');
  const texto = pergunta.trim();
  const estadoExecucao = dependencias.estadoExecucao || criarEstadoExecucao({
    objetivo: texto,
    modo: dependencias.handoffMode,
    onCheckpoint: dependencias.onCheckpoint
  });
  estadoExecucao.atualizarContexto({ objetivo: texto, etapa: 'corporate_entry' });
  const dataReferencia = dependencias.dataReferencia || obterDataReferencia();
  let perguntaNormalizada = completarAnoEmDatas(texto, dataReferencia);
  const memoriaDesabilitada = dependencias.memoria === false
    || (dependencias.provider && dependencias.memoria == null);
  const memoria = memoriaDesabilitada
    ? null
    : dependencias.memoria || criarMemoria({
      sessao: dependencias.sessaoMemoria,
      backend: dependencias.memoryBackend,
      pool: dependencias.poolNexus,
      principalSlug: dependencias.principalSlug,
      departamentoSlug: dependencias.departamentoSlug
    });
  const governanca = dependencias.governanca || (memoria?.pool
    ? criarServicoGovernanca({
      pool: memoria.pool,
      principalSlug: dependencias.principalSlug || memoria.principalSlug,
      sessao: memoria.sessao,
      modo: dependencias.authzMode
    })
    : null);
  const modoInteracao = resolverModoInteracao(dependencias);
  const interacao = await processarMensagemInterativa(perguntaNormalizada, {
    ...dependencias,
    interactionMode: modoInteracao,
    memoria,
    dataReferencia
  });
  if (interacao.acao === 'responder') {
    return {
      texto: interacao.texto,
      provider: 'protocolo_interacao',
      modelo: null,
      rodadas: 0,
      interacao: {
        modo: modoInteracao,
        status: interacao.status || 'precisa_esclarecimento',
        tarefa: interacao.tarefa || null
      },
      roteamento: { esclarecimento: interacao.status !== 'nao_suportado' }
    };
  }
  if (interacao.acao === 'executar' && interacao.ferramenta === 'construir_sql') {
    const ferramentaSql = obterFerramentaPorNome('construir_sql', dependencias);
    if (!ferramentaSql) throw new Error('A ferramenta construir_sql nao esta registrada.');
    let resultadoSql;
    try {
      const contextoGovernanca = await governanca?.iniciarTool(
        'construir_sql', interacao.argumentos,
        {
          provider: 'compilador_sql', modelo: null,
          traceId: dependencias.turnoIA?.traceId || null,
          turnId: dependencias.turnoIA?.id || null,
          parentCallId: dependencias.telemetria?.ultimoCallId || null,
          stage: 'business_reasoning', purpose: dependencias.purpose || 'corporate_query'
        }
      );
      const inicioSql = Date.now();
      try {
        estadoExecucao.prepararTool('construir_sql', interacao.argumentos, {
          efeito: 'leitura', idempotencia: true
        });
        resultadoSql = await ferramentaSql.executar(interacao.argumentos);
        estadoExecucao.concluirTool('construir_sql', interacao.argumentos, resultadoSql, {
          execucaoId: contextoGovernanca?.execucaoId || null
        });
        await governanca?.concluirTool(contextoGovernanca, {
          sucesso: true, duracaoMs: Date.now() - inicioSql
        });
      } catch (erro) {
        estadoExecucao.falharTool('construir_sql', interacao.argumentos, erro);
        await governanca?.concluirTool(contextoGovernanca, {
          sucesso: false, duracaoMs: Date.now() - inicioSql, erro
        });
        throw erro;
      }
    } catch (erro) {
      if (interacao.tarefa?.id) await memoria?.atualizarEstadoTarefa?.(interacao.tarefa.id, 'ativa');
      throw erro;
    }
    if (interacao.tarefa?.id) await memoria?.atualizarEstadoTarefa?.(interacao.tarefa.id, 'concluida');
    estadoExecucao.checkpoint('tarefa_concluida', {
      etapa: 'business_reasoning', dados: { tipo: 'construir_sql' }
    });
    const resultadoEstruturado = typeof resultadoSql === 'string'
      ? JSON.parse(resultadoSql)
      : resultadoSql;
    const respostaSql = formatarRespostaSql(resultadoEstruturado);
    dependencias.onEvento?.(`SQL: ${JSON.stringify({
      status: resultadoEstruturado.status,
      explain: Boolean(resultadoEstruturado.explain),
      fontes: resultadoEstruturado.fontes
    })}`);
    await memoria?.registrarInteracao({
      pergunta: texto,
      perguntaAutonoma: interacao.tarefa?.contexto?.perguntaOriginal || texto,
      resposta: resultadoEstruturado.status === 'validado'
        ? 'Consulta SQL gerada e validada por EXPLAIN.'
        : 'Consulta SQL gerada como rascunho nao validado.',
      provider: 'compilador_sql',
      modelo: null,
      perfil: 'sql',
      ferramentas: [{
        nome: 'construir_sql',
        argumentos: { tarefa_id: interacao.tarefa?.id || null },
        referencias: {},
        atualizadoEm: new Date().toISOString()
      }],
      campos: interacao.argumentos.campos,
      filtros: interacao.argumentos.filtros,
      periodo: interacao.argumentos.periodo
    });
    return {
      texto: respostaSql,
      provider: 'compilador_sql',
      modelo: null,
      rodadas: 0,
      interacao: { modo: modoInteracao, status: 'pronto', tarefa: interacao.tarefa },
      roteamento: {
        perfilInicial: 'sql', perfilEfetivo: 'sql', origem: 'protocolo_interacao',
        ferramentasExecutadas: ['construir_sql']
      }
    };
  }
  if (interacao.acao === 'continuar' && interacao.texto) {
    perguntaNormalizada = interacao.texto;
  }
  const historicoCurto = await memoria?.listarCurta() || [];
  const contextoTemporal = resolverContextoTemporalDaSolicitacao(
    dependencias.perguntaAtual || perguntaNormalizada,
    historicoCurto,
    dataReferencia
  );
  const modoPlaybook = resolverModoPlaybook(dependencias.playbookMode);
  const playbooks = modoPlaybook === 'off' ? [] : await memoria?.buscarPlaybooks?.(perguntaNormalizada) || [];
  if (modoPlaybook === 'shadow' && playbooks.length) {
    dependencias.onEvento?.(`Playbook shadow: ${playbooks.length} orientacao(oes) aplicavel(is).`);
  }
  const ultimaPergunta = historicoCurto.at(-1)?.pergunta;
  const perguntaParaRoteamento = pareceContinuacao(perguntaNormalizada) && ultimaPergunta
    ? `${ultimaPergunta} ${perguntaNormalizada}`
    : perguntaNormalizada;
  const roteamentoLegado = dependencias.tools
    ? {
      perfil: 'customizado',
      confianca: 'explicita',
      origem: 'tools_customizadas'
    }
    : resolverRoteamentoComContexto(
      perguntaNormalizada,
      historicoCurto,
      dependencias.perfilTools || 'automatico'
    );
  const modoRoteador = dependencias.tools ? 'legacy' : resolverModoRoteador(dependencias);
  const decisaoLegada = dependencias.tools
    ? null
    : decisaoDoLegado(perguntaParaRoteamento, roteamentoLegado, historicoCurto);
  let decisaoSemantica = null;
  let erroRoteadorSemantico = null;
  if (
    !dependencias.tools &&
    (dependencias.perfilTools || 'automatico') === 'automatico' &&
    modoRoteador !== 'legacy'
  ) {
    try {
      decisaoSemantica = await interpretarRotaSemantica(
        perguntaNormalizada,
        await memoria?.montarContextoEstruturado?.() || [],
        { ...dependencias, estadoExecucao, dataReferencia, contextoTemporal,
          playbooks: modoPlaybook === 'assist' ? playbooks : [] }
      );
      decisaoSemantica = estabilizarDecisaoComHistorico(
        decisaoSemantica,
        perguntaNormalizada,
        historicoCurto
      );
      decisaoSemantica = aplicarContextoTemporalNaDecisao(decisaoSemantica, contextoTemporal);
      dependencias.onEvento?.(
        `Roteador semantico: ${JSON.stringify({
          modo: modoRoteador,
          dominio: decisaoSemantica.dominioPrimario,
          secundarios: decisaoSemantica.dominiosSecundarios,
          intencao: decisaoSemantica.intencao,
          confianca: decisaoSemantica.confianca,
          normalizacaoEntidades: decisaoSemantica.normalizacaoEntidades,
          ferramentasSugeridas: decisaoSemantica.planoSugerido.map((item) => item.ferramenta),
          capacidadesAusentes: decisaoSemantica.capacidadesAusentes
        })}`
      );
      if (modoRoteador === 'shadow') {
        const divergiu = decisaoSemantica.dominioPrimario !== decisaoLegada.dominioPrimario;
        dependencias.onEvento?.(
          `Roteador shadow: ${JSON.stringify({
            divergiu,
            legado: decisaoLegada.dominioPrimario,
            v2: decisaoSemantica.dominioPrimario
          })}`
        );
      }
    } catch (erro) {
      erroRoteadorSemantico = erro;
      dependencias.onEvento?.(
        `Roteador semantico indisponivel; usando fallback local: ${erro.message}`
      );
    }
  }
  const usarDecisaoSemantica = modoRoteador === 'v2' && decisaoSemantica;
  const decisaoRota = usarDecisaoSemantica ? decisaoSemantica : decisaoLegada;
  const planoValidado = decisaoRota
    ? validarPlanoSugerido(decisaoRota)
    : { ferramentas: [], rejeitadas: [], capacidadesAusentes: [] };
  estadoExecucao.atualizarContexto({
    perguntaAutonoma: decisaoRota?.perguntaAutonoma || perguntaNormalizada,
    etapa: 'business_reasoning',
    rota: decisaoRota,
    plano: planoValidado,
    capacidadesAusentes: planoValidado.capacidadesAusentes || []
  });
  const roteamento = usarDecisaoSemantica
    ? {
      perfil: decisaoRota.dominioPrimario,
      confianca: decisaoRota.confianca,
      origem: 'roteador_semantico'
    }
    : roteamentoLegado;
  const perfilInicial = roteamento.perfil;
  let perfilEfetivo = usarDecisaoSemantica
    ? [perfilInicial, ...decisaoRota.dominiosSecundarios].join('+')
    : perfilInicial;
  if (dependencias.sourceMode === 'dados' && perfilInicial === 'documentacao') {
    const textoResposta = 'Esta pergunta parece pedir uma orientação de procedimento, mas este turno está no modo Consultar dados. Selecione Verificar documentação ou Automático para eu consultar procedimentos, políticas e manuais autorizados.';
    dependencias.onEvento?.('Modo Consultar dados bloqueou o acesso cruzado a documentacao.');
    return {
      texto: textoResposta,
      provider: 'nexus', modelo: null, rodadas: 0,
      interacao: { status: 'precisa_esclarecimento', motivo: 'modo_fonte_incompativel' },
      roteamento: {
        perfilInicial, perfilEfetivo, origem: roteamento.origem,
        ferramentasExecutadas: [], respostaPronta: true,
        decisao: decisaoRota, esclarecimento: true
      }
    };
  }
  const roteamentoAutomatico = !dependencias.tools &&
    (dependencias.perfilTools || 'automatico') === 'automatico';
  let ferramentas;
  if (dependencias.tools) {
    ferramentas = dependencias.tools;
  } else if (usarDecisaoSemantica) {
    ferramentas = planoValidado.ferramentas
      .map((nome) => obterFerramentaPorNome(nome, dependencias))
      .filter(Boolean);
    if (ferramentas.length > 1) {
      ferramentas = ferramentas.map((item) => ferramentaDeNegocio(item.definicao.name)
        ? { ...item, terminal: false }
        : item);
    }
  } else {
    ferramentas = obterFerramentasDoPerfil(perfilInicial, dependencias);
  }
  const modoEscalonamento = resolverModoEscalonamento(
    dependencias.semanticEscalationMode
  );
  const faixaInicial = avaliarFaixaSemantica({
    decisao: decisaoRota || {
      dominioPrimario: perfilInicial,
      dominiosSecundarios: [],
      intencao: 'listar',
      confianca: roteamento.confianca
    },
    plano: planoValidado,
    faixaForcada: dependencias.semanticTier
  });
  const selecaoInicial = modoEscalonamento === 'v1'
    ? selecionarProviderDaFaixa(faixaInicial.faixa, dependencias, 'dados_corporativos')
    : { usarAtual: true, permitido: true, motivo: `modo_${modoEscalonamento}` };
  if (!selecaoInicial.permitido) {
    dependencias.onEvento?.(
      `Escalonamento semantico: provider de ${faixaInicial.faixa} ignorado por ` +
      `politica de dados (${selecaoInicial.motivo}).`
    );
  }
  let provider = criarProviderDaFaixa(dependencias, selecaoInicial);
  const faixaSemantica = {
    modo: modoEscalonamento,
    inicial: faixaInicial.faixa,
    final: faixaInicial.faixa,
    pontosIniciais: faixaInicial.pontos,
    pontosFinais: faixaInicial.pontos,
    motivos: faixaInicial.motivos,
    transformacoes: faixaInicial.transformacoes,
    providerInicial: provider.nome || dependencias.providerNome || null,
    modeloInicial: provider.modelo || dependencias.modelo || null,
    providerRecomendado: selecaoInicial.provider || null,
    providerBloqueado: selecaoInicial.permitido === false,
    sinteseEscalonada: false
  };
  if (dependencias.telemetria) dependencias.telemetria.semanticTier = faixaInicial.faixa;
  estadoExecucao.atualizarContexto({ faixaSemantica });
  estadoExecucao.checkpoint('faixa_semantica_decidida', {
    etapa: 'business_reasoning',
    dados: { faixa: faixaInicial.faixa, pontos: faixaInicial.pontos, modo: modoEscalonamento }
  });
  await auditarFaixaSemantica(dependencias, {
    ...faixaInicial,
    modo: modoEscalonamento,
    providerSelecionado: faixaSemantica.providerInicial
  });
  const resultadosTools = [];
  const usosTecnicos = { descoberta: 0, final: 0 };
  let camadaTecnicaAtiva = null;
  let aprofundamento = null;
  let ferramentasInstrumentadas = [];

  if (usarDecisaoSemantica && (
    decisaoRota.precisaEsclarecimento ||
    (decisaoRota.dominioPrimario === 'hibrido' && decisaoRota.confianca < 0.45) ||
    planoValidado.ferramentas.length === 0
  )) {
    const resposta = decisaoRota.perguntaEsclarecimento ||
      'Pode especificar qual informacao de negocio voce deseja consultar?';
    const tarefaInteracao = modoInteracao === 'v1'
      ? await registrarEsclarecimentoRota(memoria, {
          perguntaOriginal: perguntaNormalizada,
          perguntaEsclarecimento: resposta
        }, dependencias.onEvento)
      : null;
    await memoria?.registrarInteracao({
      pergunta: perguntaNormalizada,
      perguntaAutonoma: decisaoRota.perguntaAutonoma,
      resposta,
      provider: decisaoRota.provider,
      modelo: decisaoRota.modelo,
      perfil: decisaoRota.dominioPrimario,
      rota: decisaoRota,
      plano: planoValidado
    });
    return {
      texto: tarefaInteracao ? formatarPerguntas(tarefaInteracao) : resposta,
      provider: decisaoRota.provider || 'roteador',
      modelo: decisaoRota.modelo || null,
      rodadas: 1,
      roteamento: {
        perfilInicial,
        perfilEfetivo,
        confianca: decisaoRota.confianca,
        origem: decisaoRota.origem,
        modo: modoRoteador,
        decisao: decisaoRota,
        plano: planoValidado,
        esclarecimento: true
      },
      interacao: tarefaInteracao ? {
        modo: modoInteracao,
        status: 'precisa_esclarecimento',
        tarefa: tarefaInteracao
      } : null
    };
  }

  async function liberarAprofundamento(solicitacao) {
    if (!roteamentoAutomatico) {
      throw new Error('Aprofundamento automatico exige o perfil automatico.');
    }
    if (aprofundamento) {
      throw new Error(`Aprofundamento ja liberado para ${aprofundamento.camada}.`);
    }
    if (
      usarDecisaoSemantica &&
      !planoValidado.capacidadesAusentes.length
    ) {
      throw new Error(
        'Aprofundamento negado: a rota validada nao registrou capacidade ausente.'
      );
    }
    if (
      solicitacao.camada === 'bronze' &&
      !contextoPermiteBronze(perguntaNormalizada, solicitacao.justificativa)
    ) {
      throw new Error('Bronze foi negado: use-o somente para auditoria, historico ou divergencia.');
    }
    const novas = obterFerramentasDoPerfil(solicitacao.camada, dependencias)
      .filter((item) => !ferramentasInstrumentadas.some(
        (atual) => atual.definicao.name === item.definicao.name
      ));
    aprofundamento = { ...solicitacao, ferramentas: novas.map((item) => item.definicao.name) };
    perfilEfetivo = `${perfilInicial}+${solicitacao.camada}`;
    ferramentasInstrumentadas.push(...instrumentar(novas));
    dependencias.onEvento?.(
      `Aprofundamento ${solicitacao.camada} liberado (${solicitacao.finalidade}): ` +
      solicitacao.justificativa
    );
    return {
      liberado: true,
      camada: solicitacao.camada,
      finalidade: solicitacao.finalidade,
      ferramentas: aprofundamento.ferramentas,
      catalogo: resumirCatalogo(solicitacao.camada),
      instrucao: 'Use somente os nomes de colunas deste catalogo. Para ranking de linhas prontas, use consultar com ordenacao; contar retorna apenas quantidade de linhas. Se ainda houver duvida, descreva um objeto. Nao solicite aprofundamento novamente.'
    };
  }

  const exporGatewayAprofundamento = roteamentoAutomatico && (
    !usarDecisaoSemantica || planoValidado.capacidadesAusentes.length > 0
  ) && (
    !usarDecisaoSemantica ||
    !ferramentas.some((item) => ferramentaTecnica(item.definicao.name))
  );
  if (exporGatewayAprofundamento) {
    const gateway = obterFerramentaPorNome('solicitar_aprofundamento', {
      ...dependencias,
      liberarAprofundamento
    });
    ferramentas = [
      ...ferramentas.map((item) => ({ ...item, terminal: false })),
      gateway
    ];
  }
  const instrumentar = (itens) => instrumentarFerramentas(
    itens,
    dependencias.onEvento,
    {
      mostrarArgumentos: dependencias.debugTools === true,
      normalizarArgumentos: (nome, argumentos) => aplicarPoliticaArgumentos(
        nome,
        argumentos,
        {
          temporal: contextoTemporal,
          decisao: decisaoRota,
          pergunta: perguntaNormalizada,
          perguntaAtual: dependencias.perguntaAtual || perguntaNormalizada,
          referenciasAnteriores: historicoCurto.at(-1)?.referencias || {}
        }
      ),
      async onArgumentosNormalizados(nome, ajustes) {
        if (!dependencias.auditoriaIA || !dependencias.turnoIA) return;
        await dependencias.auditoriaIA.registrarEvento?.(dependencias.turnoIA, {
          tipo: 'tool_arguments_normalized',
          recurso: nome,
          resultado: 'normalized',
          metadados: {
            fields: ajustes.map((item) => item.campo),
            adjustments_count: ajustes.length
          }
        });
      },
      async antesDeExecutar(nome, argumentos) {
        validarPoliticaExecucao(nome, { temporal: contextoTemporal, dataReferencia });
        if (ferramentaTecnica(nome)) {
          const descoberta = nome.startsWith('consultar_') &&
            /^(listar_|descrever_)/.test(argumentos.operacao || '');
          const tipo = descoberta ? 'descoberta' : 'final';
          const camada = nome.match(/_(gold|silver|bronze)$/)?.[1] || null;
          const orcamento = planoValidado.orcamentoTecnico || { descoberta: 1, final: 1 };
          if (camadaTecnicaAtiva && camada !== camadaTecnicaAtiva) {
            throw new Error(
              `Consulta tecnica em ${camada} rejeitada: a camada ${camadaTecnicaAtiva} ja foi autorizada neste plano.`
            );
          }
          if (usosTecnicos[tipo] >= Number(orcamento[tipo] || 1)) {
            throw new Error(`Orcamento de chamadas tecnicas de ${tipo} excedido para o plano validado.`);
          }
        }
        return governanca?.iniciarTool(nome, argumentos, {
          provider: provider.nome || dependencias.providerNome || process.env.LLM_PROVIDER || null,
          modelo: provider.modelo || dependencias.modelo || null,
          departamentoSlug: dependencias.departamentoSlug || null,
          traceId: dependencias.turnoIA?.traceId || null,
          turnId: dependencias.turnoIA?.id || null,
          parentCallId: dependencias.telemetria?.ultimoCallId || null,
          stage: 'business_reasoning',
          purpose: dependencias.purpose || 'corporate_query'
        });
      },
      async onResultado(nome, resultado, argumentos, execucao) {
        const normalizado = normalizarResultadoTool(resultado);
        const assinatura = `${nome}:${JSON.stringify(assinaturaEstavel(argumentos))}`;
        if (!resultadosTools.some((item) => item.assinatura === assinatura)) {
          resultadosTools.push({
            assinatura,
            nome,
            argumentos,
            resultado: normalizado,
            referencias: extrairReferenciasResultado(normalizado)
          });
        }
        if (ferramentaTecnica(nome) && !execucao?.reutilizado) {
          const descoberta = nome.startsWith('consultar_') &&
            /^(listar_|descrever_)/.test(argumentos.operacao || '');
          usosTecnicos[descoberta ? 'descoberta' : 'final'] += 1;
          camadaTecnicaAtiva ||= nome.match(/_(gold|silver|bronze)$/)?.[1] || null;
        }
        if (!execucao?.reutilizado) {
          await governanca?.concluirTool(execucao?.contextoExecucao, {
            sucesso: true, duracaoMs: execucao?.duracaoMs
          });
        }
      },
      async onErro(_nome, erro, _argumentos, execucao) {
        await governanca?.concluirTool(execucao?.contextoExecucao, {
          sucesso: false, duracaoMs: execucao?.duracaoMs, erro
        });
      },
      estadoExecucao,
      obterPolitica: (nome) => {
        const capacidade = obterCapacidade(nome);
        return capacidade ? {
          efeito: capacidade.efeito,
          idempotencia: capacidade.idempotencia,
          politicaReutilizacao: capacidade.politicaReutilizacao
        } : { efeito: 'leitura', idempotencia: true, politicaReutilizacao: 'mesmo_turno' };
      },
      extrairReferencias: (resultado) => extrairReferenciasResultado(
        normalizarResultadoTool(resultado)
      ),
      extrairResultadoHandoff: (nome, resultado) => {
        const capacidade = obterCapacidade(nome);
        return capacidade?.extratorEvidenciaHandoff
          ? capacidade.extratorEvidenciaHandoff(resultado)
          : resultado;
      }
    }
  );
  ferramentasInstrumentadas = instrumentar(ferramentas);
  const maxRodadas = Number(
    dependencias.maxRodadas || process.env.NEXUS_MAX_RODADAS || (roteamentoAutomatico
    ? MAX_RODADAS_APROFUNDAMENTO
    : (
      ['indicadores', 'vendas', 'catalogo', 'negocio'].includes(perfilInicial)
        ? MAX_RODADAS_NEGOCIO
        : MAX_RODADAS_GENERICAS
    ))
  );
  if (!Number.isInteger(maxRodadas) || maxRodadas < 1 || maxRodadas > 20) {
    throw new Error('maxRodadas deve ser um inteiro entre 1 e 20.');
  }
  dependencias.onEvento?.(
    `Perfil ${perfilInicial} (${roteamento.confianca}/${roteamento.origem}): ` +
    `${ferramentas.map(({ definicao }) => definicao.name).join(', ')}.`
  );
  if (usarDecisaoSemantica) {
    dependencias.onEvento?.(
      `Plano validado: ${JSON.stringify({
        aceitas: planoValidado.ferramentas,
        rejeitadas: planoValidado.rejeitadas,
        capacidadesAusentes: planoValidado.capacidadesAusentes,
        orcamentoTecnico: planoValidado.orcamentoTecnico
      })}`
    );
  }
  if (modoEscalonamento !== 'off') {
    dependencias.onEvento?.(
      `Faixa semantica ${modoEscalonamento}: ${JSON.stringify({
        faixa: faixaInicial.faixa,
        pontos: faixaInicial.pontos,
        motivos: faixaInicial.motivos,
        provider: faixaSemantica.providerInicial,
        providerRecomendado: faixaSemantica.providerRecomendado
      })}`
    );
  }
  if (perguntaNormalizada !== texto) {
    dependencias.onEvento?.(`Data sem ano interpretada com ${dataReferencia.slice(0, 4)}.`);
  }

  const perfilInstrucoes = perfilInicial === 'customizado' || perfilInicial === 'hibrido'
    ? (perfilInicial === 'customizado' ? 'completo' : 'hibrido')
    : perfilInicial;
  const instrucoesBase = obterInstrucoes(
    perfilInstrucoes,
    dataReferencia
  );
  const instrucoesDominiosSecundarios = (decisaoRota?.dominiosSecundarios || [])
    .map(obterInstrucaoPerfil)
    .filter(Boolean);
  const contextoMemoria = await memoria?.montarContexto(perguntaParaRoteamento);
  const contextoPlaybook = modoPlaybook === 'assist' && playbooks.length
    ? [
      'Playbooks aprovados aplicaveis (somente orientacao; o plano validado e as permissoes prevalecem):',
      ...playbooks.map((item) => `- ${item.conteudo}`)
    ].join('\n') : '';
  const ultimaDataCompleta = [...historicoCurto]
    .reverse()
    .find((item) => item.referencias?.ultimaDataCompleta)
    ?.referencias.ultimaDataCompleta;
  const contextoCobertura = pedeMesmaCobertura(texto) && ultimaDataCompleta
    ? (
      'Contexto temporal da pergunta atual: "mesma cobertura" significa usar o mesmo ' +
      `dia de corte da ultima data completa anterior (${ultimaDataCompleta}) no novo ` +
      'periodo, limitado ao ultimo dia do mes. Consulte novamente a tool.'
    )
    : '';
  const contextoRota = usarDecisaoSemantica
    ? `Rota validada: ${JSON.stringify({
      perguntaAutonoma: decisaoRota.perguntaAutonoma,
      dominioPrimario: decisaoRota.dominioPrimario,
      dominiosSecundarios: decisaoRota.dominiosSecundarios,
      intencao: decisaoRota.intencao,
      entidades: decisaoRota.entidades,
      periodo: decisaoRota.periodo,
      filtros: planoValidado.filtrosAceitos,
      camposSolicitados: decisaoRota.camposSolicitados,
      ferramentas: planoValidado.ferramentas,
      transformacoesSolicitadas: decisaoRota.transformacoesSolicitadas,
      requisitosResposta: decisaoRota.requisitosResposta,
      faixaSemantica: faixaInicial.faixa
    })}`
    : '';
  const instrucoesComuns = [
    instrucoesBase,
    ...instrucoesDominiosSecundarios,
    contextoRota,
    contextoMemoria,
    contextoPlaybook,
    contextoCobertura
  ]
    .filter(Boolean);
  const executarProvider = (itens, instrucoesExtras = []) => provider.executar({
    pergunta: usarDecisaoSemantica
      ? decisaoRota.perguntaAutonoma || perguntaNormalizada
      : perguntaNormalizada,
    instrucoes: [...instrucoesComuns, ...instrucoesExtras]
      .filter(Boolean)
      .join('\n\n'),
    tools: itens,
    maxRodadas,
    onEvento: dependencias.onEvento,
    telemetria: dependencias.telemetria,
    stage: 'business_reasoning',
    purpose: dependencias.purpose || 'corporate_query',
    parentCallId: dependencias.telemetria?.ultimoCallId || null,
    estadoExecucao,
    handoffMode: dependencias.handoffMode,
    debugFallback: dependencias.debugFallback === true,
    onCheckpoint: (tipo, dados) => estadoExecucao.checkpoint(tipo, {
      etapa: dados.etapa,
      provider: dados.provider,
      callId: dados.callId,
      dados
    }),
    onHandoff: dependencias.onHandoff
  });
  let resultado;
  let recuperacao = null;
  try {
    resultado = await executarProvider(ferramentasInstrumentadas);
  } catch (erro) {
    recuperacao = roteamentoAutomatico
      ? planejarRecuperacaoTool(erro, ferramentas, dependencias)
      : null;
    if (recuperacao && usarDecisaoSemantica) {
      const capacidade = obterCapacidade(recuperacao.nome);
      const dominiosPermitidos = new Set([
        decisaoRota.dominioPrimario,
        ...decisaoRota.dominiosSecundarios
      ]);
      if (!capacidade || !dominiosPermitidos.has(capacidade.dominio)) {
        recuperacao = null;
      }
    }
    if (!recuperacao) throw erro;

    dependencias.onEvento?.(
      `Roteamento ampliado: ${recuperacao.nome} foi solicitada pelo provider.`
    );
    estadoExecucao.checkpoint('rota_recuperada', {
      etapa: 'business_reasoning', dados: { ferramenta: recuperacao.nome }
    });
    resultadosTools.length = 0;
    ferramentas = [
      ...ferramentas,
      recuperacao.ferramenta
    ].map((ferramenta) => ({ ...ferramenta, terminal: false }));
    perfilEfetivo = recuperacao.perfil;
    ferramentasInstrumentadas = instrumentar(ferramentas);
    resultado = await executarProvider(ferramentasInstrumentadas, [
      obterInstrucaoPerfil(recuperacao.perfil),
      `Recuperacao de roteamento: a fachada ${recuperacao.nome} agora esta disponivel.`
    ]);
  }
  let sustentacaoFactual = avaliarSustentacaoFactual(resultado.texto, resultadosTools);
  const evidenciaFactual = criarEnvelopeEvidencia(resultadosTools, decisaoRota || {});
  const faixaFinalAvaliada = avaliarFaixaSemantica({
    decisao: decisaoRota || {
      dominioPrimario: perfilInicial,
      dominiosSecundarios: [],
      intencao: 'listar',
      confianca: roteamento.confianca
    },
    plano: planoValidado,
    ferramentasExecutadas: resultadosTools.map((item) => item.nome),
    resultadosTools,
    aprofundamento,
    recuperacao,
    faixaForcada: dependencias.semanticTier
  });
  let faixaFinal = maiorFaixa(faixaInicial.faixa, faixaFinalAvaliada.faixa);
  if (sustentacaoFactual.status === 'revisao_necessaria') {
    faixaFinal = 'avancada';
    faixaFinalAvaliada.motivos.push('identificador_sem_evidencia');
  }
  faixaSemantica.final = faixaFinal;
  if (dependencias.telemetria) dependencias.telemetria.semanticTier = faixaFinal;
  faixaSemantica.pontosFinais = Math.max(faixaInicial.pontos, faixaFinalAvaliada.pontos);
  faixaSemantica.motivos = [...new Set([
    ...faixaSemantica.motivos,
    ...faixaFinalAvaliada.motivos
  ])];
  const houvePromocao = faixaFinal !== faixaInicial.faixa;
  if (houvePromocao) {
    estadoExecucao.checkpoint('faixa_semantica_promovida', {
      etapa: 'business_reasoning',
      dados: { de: faixaInicial.faixa, para: faixaFinal, motivos: faixaSemantica.motivos }
    });
  }
  if (modoEscalonamento === 'v1' && houvePromocao && resultadosTools.length) {
    const selecaoFinal = selecionarProviderDaFaixa(
      faixaFinal,
      dependencias,
      'dados_corporativos'
    );
    const providerFinal = criarProviderDaFaixa(dependencias, selecaoFinal, provider);
    const mudouProvider = !selecaoFinal.usarAtual && selecaoFinal.permitido && (
      providerFinal.nome !== provider.nome || providerFinal.modelo !== provider.modelo
    );
    if (mudouProvider) {
      const evidencias = resultadosTools.map((item) => ({
        ferramenta: item.nome,
        argumentos: item.argumentos,
        resultado: item.resultado,
        referencias: item.referencias
      }));
      try {
        const sintetizado = await providerFinal.executar({
          pergunta: decisaoRota?.perguntaAutonoma || perguntaNormalizada,
          instrucoes: [
            ...instrucoesComuns,
            'Intervencao semantica: produza a resposta final somente com as evidencias abaixo.',
            'Nao solicite novas ferramentas, nao invente filtros ou metricas e preserve limites e cobertura.',
            `Evidencias corporativas autorizadas: ${JSON.stringify(evidencias)}`
          ].join('\n\n'),
          tools: [],
          maxRodadas: 1,
          onEvento: dependencias.onEvento,
          telemetria: dependencias.telemetria,
          stage: 'business_reasoning',
          purpose: 'semantic_synthesis',
          parentCallId: dependencias.telemetria?.ultimoCallId || null,
          estadoExecucao,
          handoffMode: dependencias.handoffMode,
          debugFallback: dependencias.debugFallback === true,
          onCheckpoint: (tipo, dados) => estadoExecucao.checkpoint(tipo, {
            etapa: dados.etapa,
            provider: dados.provider,
            callId: dados.callId,
            dados
          }),
          onHandoff: dependencias.onHandoff
        });
        resultado = sintetizado;
        sustentacaoFactual = avaliarSustentacaoFactual(resultado.texto, resultadosTools);
        provider = providerFinal;
        faixaSemantica.sinteseEscalonada = true;
        faixaSemantica.providerFinal = providerFinal.nome;
        faixaSemantica.modeloFinal = providerFinal.modelo;
        dependencias.onEvento?.(
          `Intervencao semantica concluida na faixa ${faixaFinal} por ${providerFinal.nome}.`
        );
      } catch (erroIntervencao) {
        faixaSemantica.falhaIntervencao = erroIntervencao.codigo ||
          erroIntervencao.code || erroIntervencao.name || 'ERRO_INTERVENCAO';
        dependencias.onEvento?.(
          'Intervencao semantica indisponivel; preservando a resposta corporativa comprovada.'
        );
      }
    }
  }
  await auditarFaixaSemantica(dependencias, {
    ...faixaFinalAvaliada,
    faixa: faixaFinal,
    modo: modoEscalonamento,
    providerSelecionado: faixaSemantica.providerFinal || faixaSemantica.providerInicial
  }, 'final');
  const intencaoFinal = decisaoRota?.intencao || 'listar';
  const transformacoesFinais = faixaFinalAvaliada.transformacoes || [];
  const falhaDocumental = (perfilInicial === 'documentacao' || perfilEfetivo === 'documentacao') &&
    evidenciaFactual.status === 'error';
  const exigeSintese = !falhaDocumental && (
    ['comparar', 'explicar', 'diagnosticar', 'auditar'].includes(intencaoFinal) ||
    evidenciaFactual.status === 'partial' ||
    resultadosTools.length > 1 ||
    transformacoesFinais.some((item) => [
      'comparar_periodos', 'calcular_derivacao', 'explicar_variacao', 'combinar_evidencias'
    ].includes(item))
  );
  const respostaPronta = falhaDocumental || (
    ['complete', 'empty'].includes(evidenciaFactual.status) &&
    sustentacaoFactual.status !== 'revisao_necessaria' && !exigeSintese
  );
  if (dependencias.auditoriaIA && dependencias.turnoIA) {
    await dependencias.auditoriaIA.registrarEvento?.(dependencias.turnoIA, {
      tipo: 'corporate_evidence',
      recurso: perfilEfetivo,
      resultado: evidenciaFactual.status,
      metadados: {
        evidence_status: evidenciaFactual.status,
        synthesis_required: exigeSintese,
        tools_count: resultadosTools.length
      }
    });
  }
  const resultadoFormatado = {
    ...resultado,
    texto: falhaDocumental
      ? respostaIndisponibilidadeDocumental()
      : aplicarGarantiasResposta(resultado.texto, resultadosTools),
    roteamento: {
      perfilInicial,
      perfilEfetivo,
      confianca: roteamento.confianca,
      origem: roteamento.origem,
      toolRecuperada: recuperacao?.nome || null,
      aprofundamento,
      modo: modoRoteador,
      decisao: decisaoRota,
      plano: planoValidado,
      faixaSemantica,
      sustentacaoFactual,
      respostaPronta,
      exigeSintese,
      evidenciaFactual,
      ferramentasExecutadas: resultadosTools.map((item) => item.nome),
      fontesDocumentais: resultadosTools.flatMap((item) => item.resultado?.fontes_download || []),
      shadow: modoRoteador === 'shadow' && decisaoSemantica ? {
        dominioLegado: decisaoLegada.dominioPrimario,
        dominioV2: decisaoSemantica.dominioPrimario,
        divergiu: decisaoLegada.dominioPrimario !== decisaoSemantica.dominioPrimario
      } : null,
      fallbackSemantico: erroRoteadorSemantico?.message || null
    },
    // Evidência estruturada privada para materialização local. A camada generalista
    // remove este campo antes de responder e nunca o inclui no histórico do modelo.
    _resultadosTools: resultadosTools
  };
  const entidadesMemoria = {};
  for (const item of resultadosTools) {
    for (const [chave, valores] of Object.entries(item.referencias || {})) {
      entidadesMemoria[chave] ||= [];
      entidadesMemoria[chave].push(...valores);
    }
  }
  for (const [chave, valores] of Object.entries(entidadesMemoria)) {
    entidadesMemoria[chave] = [...new Set(valores)];
  }
  await memoria?.registrarInteracao({
    pergunta: perguntaNormalizada,
    perguntaAutonoma: decisaoRota?.perguntaAutonoma || perguntaNormalizada,
    resposta: resultadoFormatado.texto,
    provider: resultado.provider,
    modelo: resultado.modelo,
    perfil: perfilEfetivo,
    rota: decisaoRota,
    plano: planoValidado,
    ferramentas: resultadosTools.map((item) => ({
      nome: item.nome,
      argumentos: item.argumentos,
      referencias: item.referencias,
      atualizadoEm: item.resultado?.atualizado_em || item.resultado?.ultimaConstrucao || null
    })),
    entidades: entidadesMemoria,
    periodo: decisaoRota?.periodo,
    filtros: planoValidado.filtrosAceitos || decisaoRota?.filtros,
    campos: decisaoRota?.camposSolicitados,
    referencias: {
      ...entidadesMemoria,
      ...extrairReferenciasTemporais(resultadoFormatado.texto)
    }
  });
  return resultadoFormatado;
}

function criarProviderDaFaixa(dependencias, selecao, providerAtual = null) {
  if (
    dependencias.provider ||
    !selecao ||
    selecao.usarAtual ||
    !selecao.permitido
  ) {
    const atual = providerAtual || criarProviderConfigurado(dependencias);
    if (!dependencias.provider) {
      const politica = validarProviderParaDados(
        atual.nome,
        'dados_corporativos',
        dependencias
      );
      if (!politica.permitido) {
        const erro = new Error(
          `Provider ${atual.nome} bloqueado para dados corporativos: ${politica.motivo}.`
        );
        erro.codigo = 'PROVIDER_DATA_POLICY_DENIED';
        throw erro;
      }
    }
    return atual;
  }
  const selecionado = criarProvider({
    nome: selecao.provider,
    modelo: selecao.modelo,
    fallbackNome: dependencias.fallbackNome,
    modeloFallback: dependencias.modeloFallback,
    cliente: dependencias.clientesPorProvider?.[selecao.provider],
    clienteFallback: dependencias.clienteFallback,
    semFallback: dependencias.semFallback,
    timeoutMs: dependencias.timeoutMs
  });
  return selecionado;
}

async function auditarFaixaSemantica(dependencias, decisao, fase = 'inicial') {
  if (!dependencias.auditoriaIA || !dependencias.turnoIA) return;
  if (typeof dependencias.auditoriaIA.registrarFaixaSemantica === 'function') {
    await dependencias.auditoriaIA.registrarFaixaSemantica(
      dependencias.turnoIA,
      { ...decisao, fase }
    );
    return;
  }
  await dependencias.auditoriaIA.registrarEvento?.(dependencias.turnoIA, {
    tipo: 'semantic_tier_decision',
    recurso: fase,
    resultado: decisao.faixa,
    metadados: {
      semantic_score: decisao.pontos,
      motivos: decisao.motivos,
      modo: decisao.modo,
      provider_recomendado: decisao.providerSelecionado || null
    }
  });
}

async function executarAgente(pergunta, dependencias = {}) {
  if (dependencias.turnoIA || dependencias.telemetria || dependencias.auditoriaIA === false) {
    return executarAgenteInterno(pergunta, dependencias);
  }
  const memoriaDesabilitada = dependencias.memoria === false
    || (dependencias.provider && dependencias.memoria == null);
  const memoria = memoriaDesabilitada ? null : dependencias.memoria || criarMemoria({
    sessao: dependencias.sessaoMemoria,
    backend: dependencias.memoryBackend,
    pool: dependencias.poolNexus,
    principalSlug: dependencias.principalSlug,
    departamentoSlug: dependencias.departamentoSlug
  });
  if (!memoria?.pool && dependencias.provider) {
    return executarAgenteInterno(pergunta, { ...dependencias, memoria });
  }
  const poolAuditoria = memoria?.pool || dependencias.poolNexus || criarPoolNexus();
  const poolCriado = !memoria?.pool && !dependencias.poolNexus;
  const auditoria = criarServicoAuditoriaIA({
    pool: poolAuditoria,
    principalSlug: dependencias.principalSlug || memoria?.principalSlug,
    sessao: memoria?.sessao || dependencias.sessaoMemoria || 'padrao',
    departamentoSlug: dependencias.departamentoSlug,
    modo: dependencias.usagePolicyMode
  });
  const turno = await auditoria.iniciarTurno({ finalidade: 'corporate_query' });
  const telemetria = auditoria.paraTelemetria(turno, {
    stage: 'business_reasoning', purpose: 'corporate_query'
  });
  const onHandoff = async (evento) => {
    await auditoria.registrarEvento(turno, {
      tipo: 'provider_handoff', recurso: evento.providerAnterior,
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
        ) || 0
      }
    });
    await dependencias.onHandoff?.(evento);
  };
  try {
    const resultado = await executarAgenteInterno(pergunta, {
      ...dependencias, memoria, auditoriaIA: auditoria, turnoIA: turno,
      telemetria, purpose: 'corporate_query', onHandoff
    });
    const resumo = await auditoria.concluirTurno(turno, {
      sucesso: true,
      proveniencia: 'dados_nexus'
    });
    return { ...resultado, traceId: turno.traceId, turnId: turno.id, usageSummary: resumo };
  } catch (erro) {
    try { await auditoria.concluirTurno(turno, { sucesso: false, erro }); } catch (_) { /* preserva erro */ }
    throw erro;
  } finally {
    if (poolCriado) await poolAuditoria.end();
  }
}

function lerArgumentos(argumentos) {
  const opcoes = {};
  const pergunta = [];
  const opcoesComValor = new Map([
    ['--provider', 'providerNome'],
    ['--model', 'modelo'],
    ['--fallback-provider', 'fallbackNome'],
    ['--fallback-model', 'modeloFallback'],
    ['--timeout', 'timeoutMs'],
    ['--perfil', 'perfilTools'],
    ['--sessao', 'sessaoMemoria'],
    ['--router-mode', 'routerMode'],
    ['--router-provider', 'routerProviderNome'],
    ['--router-model', 'routerModelo'],
    ['--interaction-mode', 'interactionMode'],
    ['--memory-backend', 'memoryBackend'],
    ['--authz-mode', 'authzMode'],
    ['--usage-policy-mode', 'usagePolicyMode'],
    ['--principal', 'principalSlug'],
    ['--setor', 'departamentoSlug'],
    ['--max-rodadas', 'maxRodadas'],
    ['--assistant-mode', 'assistantMode'],
    ['--generalist-provider', 'generalistProviderNome'],
    ['--generalist-model', 'generalistModelo'],
    ['--generalist-fallback-provider', 'generalistFallbackNome'],
    ['--generalist-fallback-model', 'generalistFallbackModelo'],
    ['--handoff-mode', 'handoffMode'],
    ['--playbook-mode', 'playbookMode'],
    ['--memory-automation-mode', 'memoryAutomationMode'],
    ['--memory-review-provider', 'memoryReviewProviderNome'],
    ['--memory-review-model', 'memoryReviewModelo'],
    ['--semantic-escalation-mode', 'semanticEscalationMode'],
    ['--semantic-tier', 'semanticTier'],
    ['--basic-provider', 'basicProviderNome'],
    ['--basic-model', 'basicModelo'],
    ['--assisted-provider', 'assistedProviderNome'],
    ['--assisted-model', 'assistedModelo'],
    ['--advanced-provider', 'advancedProviderNome'],
    ['--advanced-model', 'advancedModelo'],
    ['--gemini-usage-mode', 'geminiUsageMode']
  ]);

  for (let indice = 0; indice < argumentos.length; indice += 1) {
    const argumento = argumentos[indice];
    if (argumento === '--') continue;
    if (argumento === '--no-fallback') {
      opcoes.semFallback = true;
      continue;
    }
    if (argumento === '--debug-tools') {
      opcoes.debugTools = true;
      continue;
    }
    if (argumento === '--debug-fallback') {
      opcoes.debugFallback = true;
      continue;
    }
    if (argumento === '--sem-memoria') {
      opcoes.memoria = false;
      continue;
    }
    const destino = opcoesComValor.get(argumento);
    if (!destino) {
      pergunta.push(argumento);
      continue;
    }
    const valor = argumentos[++indice];
    if (!valor) throw new Error(`${argumento} exige um valor.`);
    if (argumento === '--timeout') {
      const timeout = Number(valor);
      if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 120_000) {
        throw new Error('--timeout deve ser um inteiro entre 1000 e 120000 milissegundos.');
      }
      opcoes[destino] = timeout;
    } else if (argumento === '--max-rodadas') {
      const maxRodadas = Number(valor);
      if (!Number.isInteger(maxRodadas) || maxRodadas < 1 || maxRodadas > 20) {
        throw new Error('--max-rodadas deve ser um inteiro entre 1 e 20.');
      }
      opcoes[destino] = maxRodadas;
    } else {
      opcoes[destino] = valor;
    }
  }
  return { pergunta: pergunta.join(' '), opcoes };
}

function configurarTerminalUtf8(dependencias = {}) {
  const plataforma = dependencias.plataforma || process.platform;
  const stdout = dependencias.stdout || process.stdout;
  const stderr = dependencias.stderr || process.stderr;
  stdout.setDefaultEncoding?.('utf8');
  stderr.setDefaultEncoding?.('utf8');
  if (
    plataforma === 'win32' &&
    (stdout.isTTY || stderr.isTTY) &&
    process.env.NEXUS_CLI_UTF8 !== '0'
  ) {
    const executar = dependencias.execFileSync || require('node:child_process').execFileSync;
    try {
      executar('chcp.com', ['65001'], { stdio: 'ignore', windowsHide: true });
    } catch (_) {
      // A resposta continua em UTF-8 mesmo se o terminal não permitir trocar a code page.
    }
  }
}

async function main() {
  configurarTerminalUtf8();
  const { pergunta, opcoes } = lerArgumentos(process.argv.slice(2));
  const { executarAssistente, resolverModoAssistente } = require('./assistente_nexus');
  const modoAssistente = resolverModoAssistente(opcoes.assistantMode);
  const executor = modoAssistente === 'generalist' ? executarAssistente : executarAgente;
  const resultado = await executor(pergunta, {
    ...opcoes,
    onEvento: (mensagem) => console.error(`[agente] ${mensagem}`)
  });
  console.log(resultado.texto);
  if (resultado.proveniencia) {
    const rotulo = resultado.proveniencia === 'dados_nexus'
      ? `dados do Sysemp${resultado.evidencia?.updatedAt ? ` - atualizacao ${resultado.evidencia.updatedAt}` : ''}`
      : 'conhecimento geral do modelo';
    console.error(`[fonte] ${rotulo}`);
  }
  if (resultado.traceId) console.error(`[trace] ${resultado.traceId}`);
  if (resultado.fallbackDe && opcoes.debugFallback) {
    console.error(
      `[fallback] ${resultado.fallbackDe} indisponível; resposta gerada por ` +
      `${resultado.provider} (${resultado.modelo}).`
    );
  }
}

if (require.main === module) {
  main().catch((erro) => {
    console.error(`Erro: ${erro.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  aplicarContextoTemporalNaDecisao,
  configurarTerminalUtf8,
  executarAgente,
  lerArgumentos,
  resolverContextoTemporalDaSolicitacao,
  respostaIndisponibilidadeDocumental,
  INSTRUCOES,
  MAX_RODADAS_GENERICAS,
  MAX_RODADAS_NEGOCIO,
  MAX_RODADAS_APROFUNDAMENTO,
  PROVIDER_PADRAO
};
