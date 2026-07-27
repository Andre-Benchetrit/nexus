module.exports = {
  nome: 'kpi_estoque_diario',
  tipo: 'kpi',
  descricao: 'Fotografia diaria dos alertas de estoque e da marca mais afetada.',
  versaoContrato: 1,
  chavePrimaria: 'data_referencia',
  fontesSilver: [],
  fontesGold: ['risco_ruptura_produto'],
  colunas: [
    'data_referencia',
    'produtos_elegiveis_estoque',
    'produtos_ruptura_atual',
    'produtos_risco_critico',
    'produtos_risco_alto',
    'produtos_risco_medio',
    'produtos_alerta_30d',
    'marca_mais_alertas',
    'produtos_alerta_marca_lider',
    'saida_30d_marca_lider',
    'estoque_atualizado_em',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'data_referencia',
      'produtos_ruptura_atual',
      'produtos_risco_critico',
      'produtos_risco_alto',
      'produtos_risco_medio',
      'produtos_alerta_30d',
      'marca_mais_alertas',
      'produtos_alerta_marca_lider'
    ],
    colunasAgente: [
      'data_referencia',
      'produtos_elegiveis_estoque',
      'produtos_ruptura_atual',
      'produtos_risco_critico',
      'produtos_risco_alto',
      'produtos_risco_medio',
      'produtos_alerta_30d',
      'marca_mais_alertas',
      'produtos_alerta_marca_lider',
      'saida_30d_marca_lider',
      'estoque_atualizado_em'
    ]
  },

  construirSql(_contextosSilver, contextosGold) {
    const riscos = `"${contextosGold.get('risco_ruptura_produto').viewAtual}"`;
    return `
      WITH por_marca_base AS (
        SELECT
          coalesce(nullif(trim(marca), ''), 'SEM MARCA') AS marca,
          count(*) AS produtos_alerta,
          sum(saida_venda_30d) AS saida_30d
        FROM ${riscos}
        WHERE risco_ruptura_30d = true
        GROUP BY coalesce(nullif(trim(marca), ''), 'SEM MARCA')
      ), por_marca AS (
        SELECT
          *,
          row_number() OVER (
            ORDER BY produtos_alerta DESC, saida_30d DESC, marca
          ) AS posicao
        FROM por_marca_base
      )
      SELECT
        max(data_referencia) AS data_referencia,
        count(*) AS produtos_elegiveis_estoque,
        count(*) FILTER (
          WHERE classificacao_risco = 'RUPTURA_ATUAL'
        ) AS produtos_ruptura_atual,
        count(*) FILTER (
          WHERE classificacao_risco = 'CRITICO'
        ) AS produtos_risco_critico,
        count(*) FILTER (
          WHERE classificacao_risco = 'ALTO'
        ) AS produtos_risco_alto,
        count(*) FILTER (
          WHERE classificacao_risco = 'MEDIO'
        ) AS produtos_risco_medio,
        count(*) FILTER (
          WHERE risco_ruptura_30d = true
        ) AS produtos_alerta_30d,
        (SELECT marca FROM por_marca WHERE posicao = 1) AS marca_mais_alertas,
        (SELECT produtos_alerta FROM por_marca WHERE posicao = 1)
          AS produtos_alerta_marca_lider,
        CAST(
          (SELECT saida_30d FROM por_marca WHERE posicao = 1)
          AS DECIMAL(18,4)
        ) AS saida_30d_marca_lider,
        max(dthr_atualizacao_estoque) AS estoque_atualizado_em,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM ${riscos}
    `;
  }
};
