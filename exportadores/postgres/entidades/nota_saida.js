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
    cursor: 'dt_alteracao',
    chavePrimaria: 'id_nota_saida',
    colunas: ['*']
  },
  consulta: {
    colunasPadrao: [
      'id_nota_saida',
      'id_cliente',
      'id_empresa',
      'id_nr_nf',
      'data_emissao',
      'situacao',
      'total_nota_fiscal',
      'dt_alteracao',
      'entrega_uf',
      'marketplace_pedido',
      'id_tp_pedido'
    ]
  }
};
