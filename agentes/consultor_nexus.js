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
const { aplicarPoliticaArgumentos } = require('./politicas_tools');
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
  normalizarResultadoTool
} = require('./resposta');
const {
  formatarPerguntas,
  processarMensagemInterativa,
  registrarEsclarecimentoRota,
  resolverModoInteracao
} = require('./interacoes');
const { formatarRespostaSql } = require('../tools/construir_sql');

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

function contextoPermiteBronze(pergunta, justificativa) {
  const texto = `${pergunta} ${justificativa}`
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /auditor|diverg|histor|origem|dado bruto|registro bruto|confer|validar/.test(texto);
}

function estabilizarDecisaoComHistorico(decisao, pergunta, historico = []) {
  const anterior = historico.at(-1);
  const dominioAnterior = anterior?.rota?.dominioPrimario ||
    String(anterior?.perfil || '').split('+')[0] || null;
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

async function executarAgente(pergunta, dependencias = {}) {
  if (!pergunta || !pergunta.trim()) throw new Error('Informe uma pergunta.');
  const texto = pergunta.trim();
  const dataReferencia = dependencias.dataReferencia || obterDataReferencia();
  let perguntaNormalizada = completarAnoEmDatas(texto, dataReferencia);
  const memoriaDesabilitada = dependencias.memoria === false
    || (dependencias.provider && dependencias.memoria == null);
  const memoria = memoriaDesabilitada
    ? null
    : dependencias.memoria || criarMemoria({ sessao: dependencias.sessaoMemoria });
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
      resultadoSql = await ferramentaSql.executar(interacao.argumentos);
    } catch (erro) {
      if (interacao.tarefa?.id) memoria?.atualizarEstadoTarefa?.(interacao.tarefa.id, 'ativa');
      throw erro;
    }
    if (interacao.tarefa?.id) memoria?.atualizarEstadoTarefa?.(interacao.tarefa.id, 'concluida');
    const resultadoEstruturado = typeof resultadoSql === 'string'
      ? JSON.parse(resultadoSql)
      : resultadoSql;
    const respostaSql = formatarRespostaSql(resultadoEstruturado);
    dependencias.onEvento?.(`SQL: ${JSON.stringify({
      status: resultadoEstruturado.status,
      explain: Boolean(resultadoEstruturado.explain),
      fontes: resultadoEstruturado.fontes
    })}`);
    memoria?.registrarInteracao({
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
  const contextoTemporal = extrairContextoTemporal(perguntaNormalizada, dataReferencia);
  const historicoCurto = memoria?.listarCurta() || [];
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
        memoria?.montarContextoEstruturado?.() || [],
        dependencias
      );
      decisaoSemantica = estabilizarDecisaoComHistorico(
        decisaoSemantica,
        perguntaNormalizada,
        historicoCurto
      );
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
  const resultadosTools = [];
  const assinaturasExecutadas = new Set();
  const usosTecnicos = { descoberta: 0, final: 0 };
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
      ? registrarEsclarecimentoRota(memoria, {
          perguntaOriginal: perguntaNormalizada,
          perguntaEsclarecimento: resposta
        }, dependencias.onEvento)
      : null;
    memoria?.registrarInteracao({
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
        { temporal: contextoTemporal }
      ),
      antesDeExecutar(nome, argumentos) {
        const assinatura = `${nome}:${JSON.stringify(assinaturaEstavel(argumentos))}`;
        if (assinaturasExecutadas.has(assinatura)) {
          throw new Error(`Chamada repetida bloqueada para ${nome}.`);
        }
        assinaturasExecutadas.add(assinatura);
        if (!ferramentaTecnica(nome)) return;
        const descoberta = nome.startsWith('consultar_') &&
          /^(listar_|descrever_)/.test(argumentos.operacao || '');
        const tipo = descoberta ? 'descoberta' : 'final';
        if (usosTecnicos[tipo] >= 1) {
          throw new Error(`Limite de uma chamada tecnica de ${tipo} por pergunta excedido.`);
        }
      },
      onResultado(nome, resultado, argumentos) {
        const normalizado = normalizarResultadoTool(resultado);
        resultadosTools.push({
          nome,
          argumentos,
          resultado: normalizado,
          referencias: extrairReferenciasResultado(normalizado)
        });
        if (ferramentaTecnica(nome)) {
          const descoberta = nome.startsWith('consultar_') &&
            /^(listar_|descrever_)/.test(argumentos.operacao || '');
          usosTecnicos[descoberta ? 'descoberta' : 'final'] += 1;
        }
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
        capacidadesAusentes: planoValidado.capacidadesAusentes
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
  const contextoMemoria = memoria?.montarContexto(perguntaParaRoteamento);
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
      ferramentas: planoValidado.ferramentas
    })}`
    : '';
  const instrucoesComuns = [
    instrucoesBase,
    ...instrucoesDominiosSecundarios,
    contextoRota,
    contextoMemoria,
    contextoCobertura
  ]
    .filter(Boolean);
  const provider = criarProviderConfigurado(dependencias);
  const executarProvider = (itens, instrucoesExtras = []) => provider.executar({
    pergunta: usarDecisaoSemantica
      ? decisaoRota.perguntaAutonoma || perguntaNormalizada
      : perguntaNormalizada,
    instrucoes: [...instrucoesComuns, ...instrucoesExtras]
      .filter(Boolean)
      .join('\n\n'),
    tools: itens,
    maxRodadas,
    onEvento: dependencias.onEvento
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
  const resultadoFormatado = {
    ...resultado,
    texto: aplicarGarantiasResposta(resultado.texto, resultadosTools),
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
      ferramentasExecutadas: resultadosTools.map((item) => item.nome),
      shadow: modoRoteador === 'shadow' && decisaoSemantica ? {
        dominioLegado: decisaoLegada.dominioPrimario,
        dominioV2: decisaoSemantica.dominioPrimario,
        divergiu: decisaoLegada.dominioPrimario !== decisaoSemantica.dominioPrimario
      } : null,
      fallbackSemantico: erroRoteadorSemantico?.message || null
    }
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
  memoria?.registrarInteracao({
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
    ['--max-rodadas', 'maxRodadas']
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
  const resultado = await executarAgente(pergunta, {
    ...opcoes,
    onEvento: (mensagem) => console.error(`[agente] ${mensagem}`)
  });
  console.log(resultado.texto);
  if (resultado.fallbackDe) {
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
  configurarTerminalUtf8,
  executarAgente,
  lerArgumentos,
  INSTRUCOES,
  MAX_RODADAS_GENERICAS,
  MAX_RODADAS_NEGOCIO,
  MAX_RODADAS_APROFUNDAMENTO,
  PROVIDER_PADRAO
};
