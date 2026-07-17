module.exports = {
  nome: 'marca',
  fonte: 'postgres',
  schema: 'sysemp',
  tabela: 'marca',
  destino: { camada: 'bronze' },
  extracao: {
    modo: 'snapshot',
    cursor: 'datamodificacao',
    chavePrimaria: 'id_marca',
    colunas: [
      'id_marca',
      'descricao',
      'dt_registro',
      'datamodificacao',
      'datamodificacaoserver',
      'dthr_atualizacao'
    ]
  },
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: ['id_marca', 'descricao', 'datamodificacao']
  }
};
