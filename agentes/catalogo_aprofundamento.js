const gold = require('../gold/catalogo');
const silver = require('../silver/catalogo');
const bronze = require('../exportadores/catalogo');

function itensDaCamada(camada) {
  if (camada === 'gold') {
    return gold.listarObjetosAgente().map((nome) => {
      const item = gold.obterObjeto(nome);
      return {
        nome,
        descricao: item.descricao || item.tipo || 'objeto Gold',
        colunas: item.consulta.colunasAgente || item.consulta.colunasPadrao || []
      };
    });
  }
  if (camada === 'silver') {
    return silver.listarObjetosAgente().map((nome) => {
      const item = silver.obterObjeto(nome);
      return {
        nome,
        descricao: item.descricao || item.tipo || 'objeto Silver',
        colunas: item.consulta.colunasAgente || item.consulta.colunasPadrao || []
      };
    });
  }
  if (camada === 'bronze') {
    return bronze.listarEntidadesAgente().map((nome) => {
      const item = bronze.obterEntidade(nome);
      return {
        nome,
        descricao: item.descricao || `entidade bruta ${nome}`,
        colunas: item.consulta.colunasAgente || item.consulta.colunasPadrao || []
      };
    });
  }
  throw new Error(`Camada desconhecida: ${camada}.`);
}

function resumirCatalogo(camada) {
  return itensDaCamada(camada)
    .map(({ nome, descricao, colunas }) => (
      `${nome} [${colunas.join(',')}]: ${descricao}`
    ))
    .join('; ');
}

module.exports = { itensDaCamada, resumirCatalogo };
