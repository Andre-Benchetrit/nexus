module.exports = {
  nome: 'produto_inventario',
  fonte: 'postgres',
  schema: 'sysemp',
  tabela: 'produto_inventario',
  destino: { camada: 'bronze' },
  extracao: {
    modo: 'snapshot',
    transporte: 'copy_stream',
    cursor: 'dthr_atualizacao',
    chavePrimaria: 'id_sequencia',
    colunas: [
      'id_sequencia',
      'id_produto',
      'id_empresa',
      'lote_serie',
      'localizacao',
      'estoque_minimo',
      'estoque_maximo',
      'estoque_seguranca',
      'estoque',
      'qtde_reserva',
      'dthr_atualizacao',
      'estoque_assistencia',
      'estoque_avaliacao',
      'estoque_deposito',
      'estoque_perda',
      'estoque_terceiro',
      'estoque_fifo'
    ]
  },
  consulta: {
    habilitadaParaAgente: false,
    colunasPadrao: [
      'id_produto',
      'id_empresa',
      'estoque',
      'qtde_reserva',
      'dthr_atualizacao'
    ]
  }
};
