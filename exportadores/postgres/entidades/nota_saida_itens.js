module.exports = {
  nome: 'nota_saida_itens',
  fonte: 'postgres',
  schema: 'sysemp',
  tabela: 'nota_saida_itens',
  destino: { camada: 'bronze' },
  extracao: {
    modo: 'incremental_data',
    transporte: 'copy_stream',
    cursor: 'dthr_atualizacao',
    cursoresIncrementais: ['dthr_atualizacao', 'dt_registro'],
    // A origem garante unicidade por nota + numero sequencial do item.
    // O mesmo produto pode aparecer em varios itens da mesma nota.
    chavePrimaria: ['id_nota_saida', 'item'],
    colunas: [
      'id_nota_saida',
      'item',
      'id_nr_nf',
      'serie',
      'id_empresa',
      'id_cliente',
      'data_emissao',
      'id_produto',
      'id_tp_pedido',
      'qtde',
      'qtde_faturada',
      'qtde_devolvida',
      'valor_bruto',
      'valor_desconto',
      'vr_desconto_total',
      'desconto_total_item',
      'valor_liquido',
      'valor_total_liquido',
      'vr_frete',
      'vr_seguro',
      'vr_outros',
      'vr_acrescimo',
      'vr_financeiro',
      'custo_produto',
      'custo_medio',
      'comissao',
      'valor_comissao_ml',
      'movimenta_estoque',
      'gera_financeiro',
      'item_marketplace',
      'id_nat_operacao_item',
      'ncm_codigo',
      'dt_registro',
      'datamodificacao',
      'datamodificacaoserver',
      'dthr_atualizacao'
    ]
  },
  consulta: {
    habilitadaParaAgente: false,
    colunasPadrao: [
      'id_nota_saida',
      'item',
      'id_produto',
      'qtde',
      'valor_liquido',
      'dthr_atualizacao'
    ]
  }
};
