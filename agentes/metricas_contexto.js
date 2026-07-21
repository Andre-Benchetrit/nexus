const { obterFerramentasDoPerfil } = require('./ferramentas');
const { obterInstrucoes } = require('./instrucoes');

function medirContexto(perfil) {
  const instrucoes = obterInstrucoes(perfil, '2026-07-20');
  const definicoes = obterFerramentasDoPerfil(perfil).map(({ definicao }) => definicao);
  const caracteresPrompt = instrucoes.length;
  const caracteresTools = JSON.stringify(definicoes).length;
  const caracteresTotal = caracteresPrompt + caracteresTools;
  return {
    perfil,
    ferramentas: definicoes.map(({ name }) => name),
    caracteresPrompt,
    caracteresTools,
    caracteresTotal,
    tokensEstimados: Math.ceil(caracteresTotal / 4)
  };
}

function medirTodosPerfis() {
  return ['vendas', 'catalogo', 'negocio', 'silver', 'bronze', 'completo']
    .map(medirContexto);
}

module.exports = { medirContexto, medirTodosPerfis };
