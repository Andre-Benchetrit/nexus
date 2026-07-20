module.exports = {
  nome: 'cliente',
  fonte: 'postgres',
  schema: 'sysemp',
  tabela: 'cliente',
  destino: { camada: 'bronze' },
  extracao: {
    modo: 'incremental_data',
    cursor: 'dt_alteracao',
    cursoresIncrementais: ['dt_alteracao', 'dt_cadastro'],
    chavePrimaria: 'id_cliente',
    colunas: ['*']
  },
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_cliente',
      'razsocial',
      'fantasia',
      'id_empresa',
      'ativo',
      'dt_alteracao'
    ]
  }
};
