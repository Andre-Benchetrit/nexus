module.exports = {
  nome: 'produto',
  fonte: 'postgres',
  schema: 'sysemp',
  tabela: 'produto',
  destino: { camada: 'bronze' },
  extracao: {
    modo: 'incremental_data',
    cursor: 'dt_alteracao',
    cursoresIncrementais: ['dt_alteracao', 'dt_cadastro'],
    chavePrimaria: 'id_produto',
    colunas: ['*']
  },
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_produto',
      'descricao',
      'cod_barra',
      'codigo_auxiliar',
      'cod_fabrica',
      'id_grupo',
      'estoque',
      'dt_cadastro',
      'dt_alteracao',
      'peso_liquido',
      'altura',
      'largura',
      'comprimento',
    ]
  }
};
