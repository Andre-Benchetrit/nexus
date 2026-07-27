const { citar } = require('../core/util');
const { documentoPedido } = require('../core/regras_venda');
const fatoVendaItem = require('./fato_venda_item');

const COLUNAS_EXTRAS = [
  'pedido_recebido',
  'pedido_cancelado',
  'pedido_faturado',
  'pedido_devolvido',
  'pedido_com_nota_cancelada',
  'pedido_pendente',
  'pedido_valido',
  'conflito_status',
  'status_consolidado'
];

module.exports = {
  nome: 'fato_pedido_item',
  tipo: 'fato',
  descricao: 'Itens do documento PD, uma linha por item de pedido comercial.',
  versaoContrato: 1,
  preservaTotalEntrada: false,
  chavePrimaria: ['id_empresa', 'id_pedido_vda_importado', 'item'],
  fontePrincipal: 'nota_saida_itens',
  fontesBronze: ['nota_saida_itens'],
  fontesSilver: ['fato_venda_item', 'fato_pedido'],
  colunas: [...fatoVendaItem.colunas, ...COLUNAS_EXTRAS],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_pedido_vda_importado', 'item', 'marketplace_pedido',
      'data_pedido', 'descricao_produto', 'marca', 'quantidade',
      'valor_pedido_pago_item', 'status_consolidado'
    ],
    colunasAgente: [...fatoVendaItem.consulta.colunasAgente, ...COLUNAS_EXTRAS]
  },

  construirSql(_contextosBronze, contextosSilver) {
    const itens = citar(contextosSilver.get('fato_venda_item').viewAtual);
    const pedidos = citar(contextosSilver.get('fato_pedido').viewAtual);
    return `
      SELECT
        i.*,
        p.pedido_recebido,
        p.pedido_cancelado,
        p.pedido_faturado,
        p.pedido_devolvido,
        p.pedido_com_nota_cancelada,
        p.pedido_pendente,
        p.pedido_valido,
        p.conflito_status,
        p.status_consolidado
      FROM ${itens} i
      INNER JOIN ${pedidos} p
        ON p.id_empresa = i.id_empresa
        AND p.id_pedido_vda_importado = i.id_pedido_vda_importado
        AND p.id_nota_saida_pedido = i.id_nota_saida
      WHERE ${documentoPedido('i')}
    `;
  },

  construirMetricasRelacionamentosSql(_contextosBronze, contextosSilver) {
    const itens = citar(contextosSilver.get('fato_venda_item').viewAtual);
    const pedidos = citar(contextosSilver.get('fato_pedido').viewAtual);
    return `
      SELECT
        count(*) FILTER (
          WHERE ${documentoPedido('i')} AND p.id_pedido_vda_importado IS NULL
        ) AS itens_pd_sem_pedido_correspondente
      FROM ${itens} i
      LEFT JOIN ${pedidos} p
        ON p.id_empresa = i.id_empresa
        AND p.id_pedido_vda_importado = i.id_pedido_vda_importado
        AND p.id_nota_saida_pedido = i.id_nota_saida
    `;
  }
};
