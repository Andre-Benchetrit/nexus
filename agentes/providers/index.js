const { criarProviderGemini } = require('./gemini');
const { criarProviderOpenAI } = require('./openai');

const PROVIDER_PADRAO = 'gemini';
const PROVIDERS_DISPONIVEIS = ['gemini', 'openai'];

function criarProvider(opcoes = {}) {
  const nome = (opcoes.nome || process.env.LLM_PROVIDER || PROVIDER_PADRAO).toLowerCase();
  if (!PROVIDERS_DISPONIVEIS.includes(nome)) {
    throw new Error(
      `LLM_PROVIDER inválido: ${nome}. Use ${PROVIDERS_DISPONIVEIS.join(' ou ')}.`
    );
  }
  return nome === 'gemini'
    ? criarProviderGemini(opcoes)
    : criarProviderOpenAI(opcoes);
}

module.exports = {
  criarProvider,
  PROVIDER_PADRAO,
  PROVIDERS_DISPONIVEIS
};
