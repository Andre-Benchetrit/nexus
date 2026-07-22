const { objetos: catalogoPadrao } = require('../gold/catalogo');
const {
  criarLeitorSilver,
  descobrirExecucoesSilver,
  LIMITE_MAXIMO
} = require('./silver');

function criarLeitorGold(opcoes = {}) {
  return criarLeitorSilver({
    ...opcoes,
    camada: 'gold',
    catalogo: opcoes.catalogo || catalogoPadrao
  });
}

function descobrirExecucoesGold(raizLake, objeto) {
  return descobrirExecucoesSilver(raizLake, objeto, 'gold');
}

module.exports = { criarLeitorGold, descobrirExecucoesGold, LIMITE_MAXIMO };
