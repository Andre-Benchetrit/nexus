const { citar } = require('../core/util');
const fatoVenda = require('./fato_venda');

module.exports = {
  nome: 'fato_nota_fiscal',
  tipo: 'fato',
  descricao: 'Uma linha por nota fiscal de saida valida e autorizada.',
  versaoContrato: 1,
  preservaTotalEntrada: false,
  chavePrimaria: 'id_nota_saida',
  fontePrincipal: 'nota_saida',
  fontesBronze: ['nota_saida'],
  fontesSilver: ['fato_venda'],
  colunas: [...fatoVenda.colunas],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_nota_saida', 'id_nr_nf', 'id_pedido_vda_importado',
      'marketplace_pedido', 'data_pedido', 'data_emissao',
      'cliente', 'plataforma', 'valor_total_venda', 'valor_total_liquido_venda'
    ],
    colunasAgente: [...fatoVenda.consulta.colunasAgente]
  },

  construirSql(_contextosBronze, contextosSilver) {
    const documentos = citar(contextosSilver.get('fato_venda').viewAtual);
    return `SELECT * FROM ${documentos} WHERE faturamento_valido = true`;
  },

  construirMetricasRelacionamentosSql(_contextosBronze, contextosSilver) {
    const documentos = citar(contextosSilver.get('fato_venda').viewAtual);
    return `
      SELECT
        count(*) FILTER (
          WHERE faturamento_valido AND id_pedido_vda_importado IS NULL
        ) AS notas_sem_id_pedido_importado,
        count(*) FILTER (
          WHERE faturamento_valido AND coalesce(id_nr_nf, 0) <= 0
        ) AS notas_sem_numero
      FROM ${documentos}
    `;
  }
};
