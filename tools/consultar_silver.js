const { criarLeitorSilver } = require('../duckdb/silver');
const { obterObjeto, listarObjetosAgente } = require('../silver/catalogo');
const { criarCamadaModelada } = require('./core/consulta_modelada');

const camada = criarCamadaModelada({
  camada: 'silver',
  descricao: 'enriquecidos e aprovados para perguntas de negocio',
  criarLeitor: criarLeitorSilver,
  obterObjeto,
  listarObjetosAgente
});

module.exports = {
  definicaoConsultarSilver: camada.definicaoConsultar,
  executarConsultarSilver: camada.executarConsultar,
  obterPoliticaSilver: camada.obterPolitica,
  OBJETOS_PERMITIDOS_AGENTE: camada.objetosPermitidos
};
