function citar(nome) {
  return `"${nome.replace(/"/g, '""')}"`;
}

module.exports = {
  nome: 'bloqueio_sem_estoque_pedido',
  tipo: 'indicador_operacional',
  descricao:
    'Uma linha por pedido elegivel com bloqueio ativo por falta de estoque.',
  versaoContrato: 1,
  permiteVazio: true,
  chavePrimaria: 'id_nota_saida',
  fontesSilver: [],
  fontesGold: ['bloqueio_sem_estoque_item'],
  colunas: [
    'id_nota_saida',
    'marketplace_pedido',
    'descricao_bloqueio',
    'quantidade_ocorrencias',
    'quantidade_produtos_identificados',
    'quantidade_ocorrencias_sem_produto',
    'produtos_identificados',
    'canal_venda',
    'dt_limite_expedicao',
    'primeiro_bloqueio_em',
    'canal_meli_coleta_ext',
    'meli_incluido_por_limite_hoje'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_nota_saida',
      'marketplace_pedido',
      'quantidade_ocorrencias',
      'quantidade_produtos_identificados',
      'produtos_identificados',
      'canal_venda',
      'dt_limite_expedicao',
      'primeiro_bloqueio_em'
    ],
    colunasAgente: [
      'id_nota_saida', 'marketplace_pedido', 'descricao_bloqueio',
      'quantidade_ocorrencias', 'quantidade_produtos_identificados',
      'quantidade_ocorrencias_sem_produto', 'produtos_identificados',
      'canal_venda', 'dt_limite_expedicao', 'primeiro_bloqueio_em',
      'canal_meli_coleta_ext', 'meli_incluido_por_limite_hoje'
    ]
  },

  construirSql(_contextosSilver, contextosGold) {
    const detalhe = citar(
      contextosGold.get('bloqueio_sem_estoque_item').viewAtual
    );
    return `
      SELECT
        id_nota_saida,
        max(marketplace_pedido) AS marketplace_pedido,
        max(descricao_bloqueio) AS descricao_bloqueio,
        count(*) AS quantidade_ocorrencias,
        count(DISTINCT id_produto) FILTER (WHERE id_produto > 0)
          AS quantidade_produtos_identificados,
        count(*) FILTER (WHERE id_produto = 0)
          AS quantidade_ocorrencias_sem_produto,
        string_agg(
          DISTINCT coalesce(descricao_produto, sku, cast(id_produto AS VARCHAR)),
          ' | '
          ORDER BY coalesce(descricao_produto, sku, cast(id_produto AS VARCHAR))
        ) FILTER (WHERE id_produto > 0) AS produtos_identificados,
        max(canal_venda) AS canal_venda,
        max(dt_limite_expedicao) AS dt_limite_expedicao,
        min(dthr_bloqueio) AS primeiro_bloqueio_em,
        bool_or(canal_meli_coleta_ext) AS canal_meli_coleta_ext,
        bool_or(meli_incluido_por_limite_hoje) AS meli_incluido_por_limite_hoje
      FROM ${detalhe}
      GROUP BY id_nota_saida
    `;
  }
};
