module.exports = {
  nome: 'grupo',
  fonte: 'postgres',
  schema: 'sysemp',
  tabela: 'grupo',
  destino: { camada: 'bronze' },
  extracao: {
    modo: 'snapshot',
    cursor: 'datamodificacao',
    chavePrimaria: 'id_grupo',
    colunas: [
      'id_grupo',
      'descricao',
      'dt_registro',
      'datamodificacao',
      'datamodificacaoserver',
      'dthr_atualizacao'
    ]
  },
  consulta: {
    habilitadaParaAgente: false,
    colunasPadrao: ['id_grupo', 'descricao', 'datamodificacao']
  }
};
