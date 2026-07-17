module.exports = {
  nome: 'subgrupo',
  fonte: 'postgres',
  schema: 'sysemp',
  tabela: 'subgrupo',
  destino: { camada: 'bronze' },
  extracao: {
    modo: 'snapshot',
    cursor: 'datamodificacao',
    chavePrimaria: 'id_subgrupo',
    colunas: [
      'id_subgrupo',
      'descricao',
      'dt_registro',
      'datamodificacao',
      'datamodificacaoserver',
      'dthr_atualizacao'
    ]
  },
  consulta: {
    habilitadaParaAgente: false,
    colunasPadrao: ['id_subgrupo', 'descricao', 'datamodificacao']
  }
};
