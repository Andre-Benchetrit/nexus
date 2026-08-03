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
  definicaoConsultarGold: camada.definicaoConsultar,
  executarConsultarGold: camada.executarConsultar,
  obterPoliticaGold: camada.obterPolitica,
  OBJETOS_GOLD_PERMITIDOS_AGENTE: camada.objetosPermitidos
};
