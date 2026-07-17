module.exports = {
  nome: 'nota_saida',
  fonte: 'postgres',
  schema: 'sysemp',
  tabela: 'nota_saida',
  destino: {
    camada: 'bronze'
  },
  extracao: {
    modo: 'incremental_data',
    // Esta tabela é muito larga (mais de 500 colunas). O streaming evita que o
    // scanner PostgreSQL do DuckDB tente materializar tudo de uma vez.
    transporte: 'copy_stream',
    cursor: 'dt_alteracao',
    cursoresIncrementais: ['dt_alteracao', 'dt_cadastro'],
    chavePrimaria: 'id_nota_saida',
    colunas: ['*']
  },
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_nota_saida',
      'id_cliente',
      'id_empresa',
      'id_nr_nf',
      'data_emissao',
      'data_pedido',
      'situacao',
      'total_nota_fiscal',
      'dt_alteracao',
      'entrega_uf',
      'marketplace_pedido',
      'id_tp_pedido'
    ]
  }
};
