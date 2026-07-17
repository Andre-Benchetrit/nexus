module.exports = {
  nome: 'transportadora',
  fonte: 'postgres',
  schema: 'sysemp',
  tabela: 'transportadora',
  destino: { camada: 'bronze' },
  extracao: {
    modo: 'snapshot',
    cursor: 'datamodificacao',
    chavePrimaria: 'id_transportadora',
    colunas: [
      'id_transportadora',
      'razsocial',
      'fantasia',
      'cidade',
      'uf',
      'dt_cadastro',
      'dt_alteracao',
      'dt_registro',
      'datamodificacao',
      'datamodificacaoserver'
    ]
  },
  consulta: {
    habilitadaParaAgente: false,
    colunasPadrao: [
      'id_transportadora',
      'razsocial',
      'fantasia',
      'cidade',
      'uf',
      'datamodificacao'
    ]
  }
};
