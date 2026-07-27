module.exports = {
  nome: 'log_estoque',
  fonte: 'postgres',
  schema: 'sysemp',
  tabela: 'log_estoque',
  destino: { camada: 'bronze' },
  extracao: {
    modo: 'incremental_data',
    transporte: 'copy_stream',
    cursor: 'data_hora',
    chavePrimaria: 'id_sequencia',
    colunas: [
      'id_sequencia',
      'data_hora',
      'descricao',
      'dc',
      'origem',
      'qtde',
      'id_origem',
      'id_produto',
      'id_empresa',
      'lote_serie',
      'localizacao',
      'estoque',
      'id_parceiro',
      'id_estoque',
      'custo',
      'custo_medio',
      'serie',
      'nr_nf'
    ]
  },
  consulta: {
    habilitadaParaAgente: false,
    colunasPadrao: [
      'id_sequencia',
      'data_hora',
      'id_produto',
      'id_empresa',
      'dc',
      'origem',
      'qtde',
      'estoque'
    ]
  }
};
