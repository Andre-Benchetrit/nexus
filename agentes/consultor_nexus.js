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
const { resolverPerfil } = require('./roteador');
const { completarAnoEmDatas, obterDataReferencia } = require('./contexto_temporal');

const MAX_RODADAS_NEGOCIO = 3;
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
  const perfil = dependencias.tools
    ? 'customizado'
    : resolverPerfil(texto, dependencias.perfilTools || 'automatico');
  const ferramentas = dependencias.tools || obterFerramentasDoPerfil(perfil, dependencias);
  const toolsComProgresso = instrumentarFerramentas(ferramentas, dependencias.onEvento);
  const maxRodadas = dependencias.maxRodadas || (
    ['vendas', 'catalogo', 'negocio'].includes(perfil)
      ? MAX_RODADAS_NEGOCIO
      : MAX_RODADAS_GENERICAS
  );
  dependencias.onEvento?.(
    `Perfil ${perfil}: ${ferramentas.map(({ definicao }) => definicao.name).join(', ')}.`
  );
  if (perguntaNormalizada !== texto) {
    dependencias.onEvento?.(`Data sem ano interpretada com ${dataReferencia.slice(0, 4)}.`);
  }

  return criarProviderConfigurado(dependencias).executar({
    pergunta: perguntaNormalizada,
    instrucoes: obterInstrucoes(
      perfil === 'customizado' ? 'completo' : perfil,
      dataReferencia
    ),
    tools: toolsComProgresso,
    maxRodadas,
    onEvento: dependencias.onEvento
  });
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
    ['--perfil', 'perfilTools']
  ]);

  for (let indice = 0; indice < argumentos.length; indice += 1) {
    const argumento = argumentos[indice];
    if (argumento === '--no-fallback') {
      opcoes.semFallback = true;
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
