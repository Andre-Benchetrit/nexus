const { criarLeitorGold } = require('../duckdb/gold');
const { obterObjeto, listarObjetosAgente } = require('../gold/catalogo');
const { criarCamadaModelada } = require('./core/consulta_modelada');

const camada = criarCamadaModelada({
  camada: 'gold',
  descricao: 'com indicadores e metricas oficiais',
  criarLeitor: criarLeitorGold,
  obterObjeto,
  listarObjetosAgente
});

module.exports = {
  definicaoAgregarGold: camada.definicaoAgregar,
  executarAgregarGold: camada.executarAgregar
};
