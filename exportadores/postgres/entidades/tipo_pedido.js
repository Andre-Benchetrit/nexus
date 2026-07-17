module.exports = {
  nome: 'tipo_pedido',
  fonte: 'postgres',
  schema: 'sysemp',
  tabela: 'tipo_pedido',
  destino: { camada: 'bronze' },
  extracao: {
    modo: 'snapshot',
    cursor: 'datamodificacao',
    chavePrimaria: 'id_tp_pedido',
    colunas: [
      'id_tp_pedido',
      'descricao',
      'tipo',
      'permite_faturamento',
      'bloqueado',
      'id_nat_operacao',
      'dt_registro',
      'datamodificacao',
      'datamodificacaoserver',
      'dthr_atualizacao'
    ]
  },
  consulta: {
    habilitadaParaAgente: false,
    colunasPadrao: [
      'id_tp_pedido',
      'descricao',
      'tipo',
      'permite_faturamento',
      'bloqueado',
      'id_nat_operacao',
      'datamodificacao'
    ]
  }
};
