const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const { criarProvider, PROVIDER_PADRAO } = require('./providers');
const { obterInstrucaoPerfil, obterInstrucoes } = require('./instrucoes');
const {
  instrumentarFerramentas,
  obterFerramentasDoPerfil
} = require('./ferramentas');
const {
  pedeMesmaCobertura,
  resolverRoteamentoComContexto
} = require('./roteador');
const { completarAnoEmDatas, obterDataReferencia } = require('./contexto_temporal');
const { criarMemoria, pareceContinuacao } = require('./memoria');
const { planejarRecuperacaoTool } = require('./recuperacao_tools');
const {
  aplicarGarantiasResposta,
  normalizarResultadoTool
} = require('./resposta');

const MAX_RODADAS_NEGOCIO = 4;
const MAX_RODADAS_GENERICAS = 4;
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

async function executarAgente(pergunta, dependencias = {}) {
  if (!pergunta || !pergunta.trim()) throw new Error('Informe uma pergunta.');
  const texto = pergunta.trim();
  const dataReferencia = dependencias.dataReferencia || obterDataReferencia();
  const perguntaNormalizada = completarAnoEmDatas(texto, dataReferencia);
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
  let ferramentas = dependencias.tools ||
    obterFerramentasDoPerfil(perfilInicial, dependencias);
  const resultadosTools = [];
  const instrumentar = (itens) => instrumentarFerramentas(
    itens,
    dependencias.onEvento,
    {
      mostrarArgumentos: dependencias.debugTools === true,
      onResultado(nome, resultado) {
        resultadosTools.push({
          nome,
          resultado: normalizarResultadoTool(resultado)
        });
      }
    }
  );
  const maxRodadas = dependencias.maxRodadas || (
    ['indicadores', 'vendas', 'catalogo', 'negocio'].includes(perfilInicial)
      ? MAX_RODADAS_NEGOCIO
      : MAX_RODADAS_GENERICAS
  );
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
    tools: instrumentar(itens),
    maxRodadas,
    onEvento: dependencias.onEvento
  });
  let resultado;
  let recuperacao = null;
  try {
    resultado = await executarProvider(ferramentas);
  } catch (erro) {
    const roteamentoAutomatico = !dependencias.tools &&
      (dependencias.perfilTools || 'automatico') === 'automatico';
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
    resultado = await executarProvider(ferramentas, [
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
      toolRecuperada: recuperacao?.nome || null
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
  PROVIDER_PADRAO
};
