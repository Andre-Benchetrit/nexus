const { citar, flagBooleano, texto } = require('../core/util');

module.exports = {
  nome: 'dim_tipo_pedido',
  tipo: 'dimensao',
  descricao: 'Tipos de pedido com regras de faturamento e bloqueio padronizadas.',
  versaoContrato: 1,
  chavePrimaria: 'id_tp_pedido',
  fontePrincipal: 'tipo_pedido',
  fontesBronze: ['tipo_pedido'],
  colunas: [
    'id_tp_pedido',
    'tipo_pedido',
    'codigo_tipo_pedido',
    'permite_faturamento',
    'tipo_pedido_bloqueado',
    'id_nat_operacao',
    'dt_registro',
    'dt_alteracao',
    'fonte_sistema',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_tp_pedido', 'tipo_pedido', 'codigo_tipo_pedido', 'permite_faturamento'
    ],
    colunasAgente: [
      'id_tp_pedido', 'tipo_pedido', 'codigo_tipo_pedido',
      'permite_faturamento', 'tipo_pedido_bloqueado', 'id_nat_operacao',
      'dt_registro', 'dt_alteracao'
    ]
  },

  construirSql(contextosBronze) {
    const tipos = citar(contextosBronze.get('tipo_pedido').viewAtual);
    return `
      SELECT
        t.id_tp_pedido,
        ${texto('t.descricao')} AS tipo_pedido,
        ${texto('t.tipo')} AS codigo_tipo_pedido,
        ${flagBooleano('t.permite_faturamento')} AS permite_faturamento,
        ${flagBooleano('t.bloqueado')} AS tipo_pedido_bloqueado,
        t.id_nat_operacao,
        t.dt_registro,
        coalesce(t.datamodificacaoserver, t.datamodificacao, t.dthr_atualizacao)
          AS dt_alteracao,
        'postgres.sysemp.tipo_pedido' AS fonte_sistema,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM ${tipos} t
    `;
  }
};
