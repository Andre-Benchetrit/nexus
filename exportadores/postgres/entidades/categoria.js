module.exports = {
  nome: 'categoria',
  fonte: 'postgres',
  schema: 'sysemp',
  tabela: 'categoria',
  destino: { camada: 'bronze' },
  extracao: {
    modo: 'snapshot',
    cursor: 'datamodificacao',
    chavePrimaria: 'id_categoria',
    colunas: [
      'id_categoria',
      'descricao',
      'dt_registro',
      'datamodificacao',
      'datamodificacaoserver',
      'dthr_atualizacao'
    ]
  },
  consulta: {
    habilitadaParaAgente: false,
    colunasPadrao: ['id_categoria', 'descricao', 'datamodificacao']
  }
};
