const { obterFerramentaPorNome, obterFerramentasDoPerfil } = require('./ferramentas');
const { obterInstrucoes } = require('./instrucoes');

function medirContexto(perfil) {
  const instrucoes = obterInstrucoes(perfil, '2026-07-20');
  const ferramentas = obterFerramentasDoPerfil(perfil);
  if (!['gold', 'silver', 'bronze', 'completo'].includes(perfil)) {
    ferramentas.push(obterFerramentaPorNome('solicitar_aprofundamento'));
  }
  const definicoes = ferramentas.map(({ definicao }) => definicao);
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
  return [
    'indicadores', 'estoque', 'estoque_reposicoes', 'reposicoes', 'produto',
    'bloqueios_estoque',
    'desempenho', 'frete', 'operacao',
    'vendas', 'catalogo', 'pessoas',
    'negocio', 'hibrido', 'gold', 'silver', 'bronze', 'completo'
  ]
    .map(medirContexto);
}

module.exports = { medirContexto, medirTodosPerfis };
