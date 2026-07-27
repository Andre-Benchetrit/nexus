const { citar } = require('../core/util');
const fatoVendaItem = require('./fato_venda_item');

module.exports = {
  nome: 'fato_nota_fiscal_item',
  tipo: 'fato',
  descricao: 'Itens de notas fiscais validas, sem pedidos PD ou documentos reversos.',
  versaoContrato: 1,
  preservaTotalEntrada: false,
  chavePrimaria: ['id_nota_saida', 'item'],
  fontePrincipal: 'nota_saida_itens',
  fontesBronze: ['nota_saida_itens'],
  fontesSilver: ['fato_venda_item'],
  colunas: [...fatoVendaItem.colunas],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_nota_saida', 'id_nr_nf', 'item', 'data_emissao',
      'descricao_produto', 'marca', 'quantidade', 'valor_total_item'
    ],
    colunasAgente: [...fatoVendaItem.consulta.colunasAgente]
  },

  construirSql(_contextosBronze, contextosSilver) {
    const itens = citar(contextosSilver.get('fato_venda_item').viewAtual);
    return `SELECT * FROM ${itens} WHERE faturamento_valido = true`;
  },

  construirMetricasRelacionamentosSql(_contextosBronze, contextosSilver) {
    const itens = citar(contextosSilver.get('fato_venda_item').viewAtual);
    return `
      SELECT
        count(*) FILTER (
          WHERE faturamento_valido AND id_pedido_vda_importado IS NULL
        ) AS itens_faturados_sem_id_pedido_importado,
        count(*) FILTER (
          WHERE faturamento_valido AND id_produto IS NULL
        ) AS itens_faturados_sem_produto
      FROM ${itens}
    `;
  }
};
