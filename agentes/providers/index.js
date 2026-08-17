const { criarProviderGemini } = require('./gemini');
const { criarProviderGroq } = require('./groq');
const { criarProviderOpenAI } = require('./openai');
const { criarProviderAnthropic } = require('./anthropic');
const { criarProviderResiliente } = require('./resiliente');

const PROVIDER_PADRAO = 'gemini';
const PROVIDERS_DISPONIVEIS = ['gemini', 'groq', 'openai', 'anthropic'];

function criarProviderBase(nome, opcoes = {}) {
  if (nome === 'anthropic') return criarProviderAnthropic(opcoes);
  if (nome === 'gemini') return criarProviderGemini(opcoes);
  if (nome === 'groq') return criarProviderGroq(opcoes);
  return criarProviderOpenAI(opcoes);
}

function criarProvider(opcoes = {}) {
  const nome = (opcoes.nome || process.env.LLM_PROVIDER || PROVIDER_PADRAO).toLowerCase();
  if (!PROVIDERS_DISPONIVEIS.includes(nome)) {
    throw new Error(
      `LLM_PROVIDER inválido: ${nome}. Use ${PROVIDERS_DISPONIVEIS.join(' ou ')}.`
    );
  }
  const primario = criarProviderBase(nome, opcoes);
  if (opcoes.semFallback) return primario;

  const fallbackAutomatico = process.env.GROQ_API_KEY && nome !== 'groq' ? 'groq' : null;
  const nomeFallback = (
    opcoes.fallbackNome || process.env.LLM_FALLBACK_PROVIDER || fallbackAutomatico || ''
  ).toLowerCase();

  if (!nomeFallback || nomeFallback === nome) return primario;
  if (!PROVIDERS_DISPONIVEIS.includes(nomeFallback)) {
    throw new Error(
      `Provider de fallback inválido: ${nomeFallback}. Use ${PROVIDERS_DISPONIVEIS.join(', ')}.`
    );
  }

  const fallback = criarProviderBase(nomeFallback, {
    modelo: opcoes.modeloFallback,
    cliente: opcoes.clienteFallback,
    timeoutMs: opcoes.timeoutMs
  });

  return criarProviderResiliente(primario, fallback, {
    tentativasExtras: opcoes.tentativasExtras,
    atrasoMs: opcoes.atrasoMs,
    esperar: opcoes.esperar
  });
}

module.exports = {
  criarProvider,
  criarProviderBase,
  PROVIDER_PADRAO,
  PROVIDERS_DISPONIVEIS
};
