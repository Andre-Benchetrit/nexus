const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const { criarProvider, PROVIDER_PADRAO } = require('./providers');
const { obterInstrucoes } = require('./instrucoes');
const {
  instrumentarFerramentas,
  obterFerramentasDoPerfil
} = require('./ferramentas');
const { pedeMesmaCobertura, resolverPerfilComContexto } = require('./roteador');
const { completarAnoEmDatas, obterDataReferencia } = require('./contexto_temporal');
const { criarMemoria, pareceContinuacao } = require('./memoria');

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
  const perfil = dependencias.tools
    ? 'customizado'
    : resolverPerfilComContexto(
      texto,
      historicoCurto,
      dependencias.perfilTools || 'automatico'
    );
  const ferramentas = dependencias.tools || obterFerramentasDoPerfil(perfil, dependencias);
  const toolsComProgresso = instrumentarFerramentas(
    ferramentas,
    dependencias.onEvento,
    { mostrarArgumentos: dependencias.debugTools === true }
  );
  const maxRodadas = dependencias.maxRodadas || (
    ['indicadores', 'vendas', 'catalogo', 'negocio'].includes(perfil)
      ? MAX_RODADAS_NEGOCIO
      : MAX_RODADAS_GENERICAS
  );
  dependencias.onEvento?.(
    `Perfil ${perfil}: ${ferramentas.map(({ definicao }) => definicao.name).join(', ')}.`
  );
  if (perguntaNormalizada !== texto) {
    dependencias.onEvento?.(`Data sem ano interpretada com ${dataReferencia.slice(0, 4)}.`);
  }

  const instrucoesBase = obterInstrucoes(
    perfil === 'customizado' ? 'completo' : perfil,
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
  const resultado = await criarProviderConfigurado(dependencias).executar({
    pergunta: perguntaNormalizada,
    instrucoes: [instrucoesBase, contextoMemoria, contextoCobertura]
      .filter(Boolean)
      .join('\n\n'),
    tools: toolsComProgresso,
    maxRodadas,
    onEvento: dependencias.onEvento
  });
  memoria?.registrarInteracao({
    pergunta: perguntaNormalizada,
    resposta: resultado.texto,
    provider: resultado.provider,
    modelo: resultado.modelo,
    perfil
  });
  return resultado;
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
