const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const { criarProvider, PROVIDER_PADRAO } = require('./providers');
const { obterInstrucaoPerfil, obterInstrucoes } = require('./instrucoes');
const {
  ferramentaTecnica,
  instrumentarFerramentas,
  obterFerramentaPorNome,
  obterFerramentasDoPerfil
} = require('./ferramentas');
const {
  pedeMesmaCobertura,
  resolverRoteamentoComContexto
} = require('./roteador');
const {
  completarAnoEmDatas,
  extrairContextoTemporal,
  obterDataReferencia
} = require('./contexto_temporal');
const { aplicarPoliticaArgumentos } = require('./politicas_tools');
const { criarMemoria, pareceContinuacao } = require('./memoria');
const { planejarRecuperacaoTool } = require('./recuperacao_tools');
const { resumirCatalogo } = require('./catalogo_aprofundamento');
const {
  aplicarGarantiasResposta,
  normalizarResultadoTool
} = require('./resposta');

const MAX_RODADAS_NEGOCIO = 4;
const MAX_RODADAS_GENERICAS = 4;
const MAX_RODADAS_APROFUNDAMENTO = 6;
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

async function executarAgente(pergunta, dependencias = {}) {
  if (!pergunta || !pergunta.trim()) throw new Error('Informe uma pergunta.');
  const texto = pergunta.trim();
  const dataReferencia = dependencias.dataReferencia || obterDataReferencia();
  const perguntaNormalizada = completarAnoEmDatas(texto, dataReferencia);
  const contextoTemporal = extrairContextoTemporal(perguntaNormalizada, dataReferencia);
  const memoriaDesabilitada = dependencias.memoria === false
    || (dependencias.provider && dependencias.memoria == null);
  const memoria = memoriaDesabilitada
    ? null
    : dependencias.memoria || criarMemoria({ sessao: dependencias.sessaoMemoria });
  const historicoCurto = memoria?.listarCurta() || [];
  const ultimaPergunta = historicoCurto.at(-1)?.pergunta;
  const perguntaParaRoteamento = pareceContinuacao(texto) && ultimaPergunta
    ? `${ultimaPergunta} ${texto}`
    : texto;
  const roteamento = dependencias.tools
    ? {
      perfil: 'customizado',
      confianca: 'explicita',
      origem: 'tools_customizadas'
    }
    : resolverRoteamentoComContexto(
      texto,
      historicoCurto,
      dependencias.perfilTools || 'automatico'
    );
  const perfilInicial = roteamento.perfil;
  let perfilEfetivo = perfilInicial;
  const roteamentoAutomatico = !dependencias.tools &&
    (dependencias.perfilTools || 'automatico') === 'automatico';
  let ferramentas = dependencias.tools ||
    obterFerramentasDoPerfil(perfilInicial, dependencias);
  const resultadosTools = [];
  const assinaturasExecutadas = new Set();
  const usosTecnicos = { descoberta: 0, final: 0 };
  let aprofundamento = null;
  let ferramentasInstrumentadas = [];

  async function liberarAprofundamento(solicitacao) {
    if (!roteamentoAutomatico) {
      throw new Error('Aprofundamento automatico exige o perfil automatico.');
    }
    if (aprofundamento) {
      throw new Error(`Aprofundamento ja liberado para ${aprofundamento.camada}.`);
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

  if (roteamentoAutomatico) {
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
        resultadosTools.push({
          nome,
          resultado: normalizarResultadoTool(resultado)
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
  const maxRodadas = dependencias.maxRodadas || (roteamentoAutomatico
    ? MAX_RODADAS_APROFUNDAMENTO
    : (
      ['indicadores', 'vendas', 'catalogo', 'negocio'].includes(perfilInicial)
        ? MAX_RODADAS_NEGOCIO
        : MAX_RODADAS_GENERICAS
    ));
  dependencias.onEvento?.(
    `Perfil ${perfilInicial} (${roteamento.confianca}/${roteamento.origem}): ` +
    `${ferramentas.map(({ definicao }) => definicao.name).join(', ')}.`
  );
  if (perguntaNormalizada !== texto) {
    dependencias.onEvento?.(`Data sem ano interpretada com ${dataReferencia.slice(0, 4)}.`);
  }

  const instrucoesBase = obterInstrucoes(
    perfilInicial === 'customizado' ? 'completo' : perfilInicial,
    dataReferencia
  );
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
  const instrucoesComuns = [instrucoesBase, contextoMemoria, contextoCobertura]
    .filter(Boolean);
  const provider = criarProviderConfigurado(dependencias);
  const executarProvider = (itens, instrucoesExtras = []) => provider.executar({
    pergunta: perguntaNormalizada,
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
      aprofundamento
    }
  };
  memoria?.registrarInteracao({
    pergunta: perguntaNormalizada,
    resposta: resultadoFormatado.texto,
    provider: resultado.provider,
    modelo: resultado.modelo,
    perfil: perfilEfetivo
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
    ['--sessao', 'sessaoMemoria']
  ]);

  for (let indice = 0; indice < argumentos.length; indice += 1) {
    const argumento = argumentos[indice];
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
    } else {
      opcoes[destino] = valor;
    }
  }
  return { pergunta: pergunta.join(' '), opcoes };
}

async function main() {
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
  executarAgente,
  lerArgumentos,
  INSTRUCOES,
  MAX_RODADAS_GENERICAS,
  MAX_RODADAS_NEGOCIO,
  MAX_RODADAS_APROFUNDAMENTO,
  PROVIDER_PADRAO
};
