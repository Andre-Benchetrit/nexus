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
    colunas: [
      'id_cliente',
      'razsocial',
      'fantasia',
      'id_empresa',
      'pessoafj',
      'cidade',
      'id_uf',
      'ativo',
      'funcionario_vend',
      'transportadora',
      'id_funcao',
      'dt_cadastro',
      'dt_alteracao'
    ]
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
    ],
    colunasAgente: [
      'id_cliente',
      'razsocial',
      'fantasia',
      'id_empresa',
      'pessoafj',
      'cidade',
      'id_uf',
      'ativo',
      'funcionario_vend',
      'transportadora',
      'id_funcao',
      'dt_cadastro',
      'dt_alteracao'
    ]
  }
};
