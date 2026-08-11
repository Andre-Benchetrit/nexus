module.exports = {
  nome: 'bloqueios',
  fonte: 'postgres',
  schema: 'sysemp',
  tabela: 'bloqueios',
  destino: { camada: 'bronze' },
  extracao: {
    modo: 'snapshot',
    chavePrimaria: 'id_bloqueio',
    estrategiaVisaoAtual: 'ultima_execucao',
    colunas: [
      'id_bloqueio',
      'descricao'
    ]
  },
  consulta: {
    habilitadaParaAgente: false,
    colunasPadrao: ['id_bloqueio', 'descricao']
  }
};