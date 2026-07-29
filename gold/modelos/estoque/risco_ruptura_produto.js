module.exports = {
  nome: 'risco_ruptura_produto',
  tipo: 'indicador',
  descricao: 'Risco atual e projetado de ruptura por produto da empresa 10.',
  versaoContrato: 2,
  chavePrimaria: 'id_produto',
  fontesSilver: [
    'fato_estoque_atual',
    'fato_movimento_estoque',
    'fato_agendamento_compra'
  ],
  fontesGold: [],
  colunas: [
    'id_produto',
    'descricao_produto',
    'sku',
    'ean',
    'id_grupo',
    'grupo',
    'id_subgrupo',
    'subgrupo',
    'id_marca',
    'marca',
    'id_categoria',
    'categoria',
    'data_referencia',
    'estoque_disponivel',
    'quantidade_reservada',
    'custo_produto_atual',
    'valor_estoque_custo',
    'saida_venda_7d',
    'saida_venda_30d',
    'saida_venda_90d',
    'media_diaria_saida_90d',
    'dias_cobertura',
    'data_estimada_ruptura',
    'classificacao_risco',
    'prioridade_risco',
    'ruptura_atual',
    'risco_ruptura_30d',
    'tem_demanda_recente',
    'tem_reposicao_prevista',
    'proxima_data_prevista',
    'tem_entrega_atrasada',
    'data_entrega_atrasada_mais_antiga',
    'tem_recebimento_indicado_7d',
    'data_ultimo_recebimento_indicado',
    'estoque_zero_com_recebimento_indicado_7d',
    'reposicao_incluida_no_estoque_calculado',
    'janela_demanda_dias',
    'premissa_sem_reposicao',
    'cobertura_movimentos_inicio',
    'cobertura_movimentos_fim',
    'dthr_atualizacao_estoque',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_produto',
      'descricao_produto',
      'marca',
      'estoque_disponivel',
      'saida_venda_30d',
      'media_diaria_saida_90d',
      'dias_cobertura',
      'data_estimada_ruptura',
      'classificacao_risco'
    ],
    colunasAgente: [
      'id_produto', 'descricao_produto', 'sku', 'ean',
      'id_grupo', 'grupo', 'id_subgrupo', 'subgrupo',
      'id_marca', 'marca', 'id_categoria', 'categoria',
      'data_referencia', 'estoque_disponivel', 'quantidade_reservada',
      'custo_produto_atual', 'valor_estoque_custo',
      'saida_venda_7d', 'saida_venda_30d', 'saida_venda_90d',
      'media_diaria_saida_90d', 'dias_cobertura', 'data_estimada_ruptura',
      'classificacao_risco', 'prioridade_risco', 'ruptura_atual',
      'risco_ruptura_30d', 'tem_demanda_recente', 'janela_demanda_dias',
      'tem_reposicao_prevista', 'proxima_data_prevista',
      'tem_entrega_atrasada', 'data_entrega_atrasada_mais_antiga',
      'tem_recebimento_indicado_7d', 'data_ultimo_recebimento_indicado',
      'estoque_zero_com_recebimento_indicado_7d',
      'reposicao_incluida_no_estoque_calculado',
      'premissa_sem_reposicao', 'cobertura_movimentos_inicio',
      'cobertura_movimentos_fim', 'dthr_atualizacao_estoque'
    ]
  },

  construirSql(contextosSilver) {
    const estoque = `"${contextosSilver.get('fato_estoque_atual').viewAtual}"`;
    const movimentos = `"${contextosSilver.get('fato_movimento_estoque').viewAtual}"`;
    const agendamentos = `"${contextosSilver.get('fato_agendamento_compra').viewAtual}"`;
    return `
      WITH limite AS (
        SELECT
          max(data_referencia) AS data_referencia,
          min(data_referencia) AS cobertura_inicio,
          max(data_referencia) AS cobertura_fim
        FROM ${movimentos}
        WHERE empresa_analisada = true
      ), demanda AS (
        SELECT
          m.id_produto,
          CAST(coalesce(sum(m.quantidade_saida) FILTER (
            WHERE m.data_referencia > l.data_referencia - INTERVAL 7 DAY
          ), 0) AS DECIMAL(18,4)) AS saida_venda_7d,
          CAST(coalesce(sum(m.quantidade_saida) FILTER (
            WHERE m.data_referencia > l.data_referencia - INTERVAL 30 DAY
          ), 0) AS DECIMAL(18,4)) AS saida_venda_30d,
          CAST(coalesce(sum(m.quantidade_saida), 0) AS DECIMAL(18,4)) AS saida_venda_90d
        FROM ${movimentos} m
        CROSS JOIN limite l
        WHERE m.empresa_analisada = true
          AND m.movimento_venda = true
          AND m.data_referencia > l.data_referencia - INTERVAL 90 DAY
        GROUP BY m.id_produto
      ), logistica AS (
        SELECT
          a.id_produto,
          bool_or(
            a.status_logistico = 'PREVISTO'
            AND a.data_prevista >= l.data_referencia
          ) AS tem_reposicao_prevista,
          min(a.data_prevista) FILTER (
            WHERE a.status_logistico = 'PREVISTO'
              AND a.data_prevista >= l.data_referencia
          ) AS proxima_data_prevista,
          bool_or(a.entrega_atrasada OR a.status_logistico = 'NAO_RECEBIDO')
            AS tem_entrega_atrasada,
          min(a.data_prevista) FILTER (
            WHERE a.entrega_atrasada OR a.status_logistico = 'NAO_RECEBIDO'
          ) AS data_entrega_atrasada_mais_antiga,
          bool_or(
            a.tem_evidencia_recebimento
            AND a.data_entrada > l.data_referencia - INTERVAL 7 DAY
            AND a.data_entrada <= l.data_referencia
          ) AS tem_recebimento_indicado_7d,
          max(a.data_entrada) FILTER (
            WHERE a.tem_evidencia_recebimento
              AND a.data_entrada <= l.data_referencia
          ) AS data_ultimo_recebimento_indicado
        FROM ${agendamentos} a
        CROSS JOIN limite l
        WHERE a.id_produto IS NOT NULL
        GROUP BY a.id_produto
      ), base AS (
        SELECT
          e.*,
          l.data_referencia,
          l.cobertura_inicio,
          l.cobertura_fim,
          coalesce(d.saida_venda_7d, 0) AS saida_venda_7d,
          coalesce(d.saida_venda_30d, 0) AS saida_venda_30d,
          coalesce(d.saida_venda_90d, 0) AS saida_venda_90d,
          coalesce(lo.tem_reposicao_prevista, false) AS tem_reposicao_prevista,
          lo.proxima_data_prevista,
          coalesce(lo.tem_entrega_atrasada, false) AS tem_entrega_atrasada,
          lo.data_entrega_atrasada_mais_antiga,
          coalesce(lo.tem_recebimento_indicado_7d, false)
            AS tem_recebimento_indicado_7d,
          lo.data_ultimo_recebimento_indicado,
          CAST(coalesce(d.saida_venda_90d, 0) / 90.0 AS DECIMAL(18,4))
            AS media_diaria_saida_90d
        FROM ${estoque} e
        CROSS JOIN limite l
        LEFT JOIN demanda d ON d.id_produto = e.id_produto
        LEFT JOIN logistica lo ON lo.id_produto = e.id_produto
        WHERE e.empresa_analisada = true
          AND e.produto_ativo = true
          AND e.envia_site = true
      ), calculada AS (
        SELECT
          *,
          CASE
            WHEN media_diaria_saida_90d > 0 AND estoque_disponivel > 0
              THEN CAST(estoque_disponivel / media_diaria_saida_90d AS DECIMAL(18,2))
            WHEN media_diaria_saida_90d > 0 AND estoque_disponivel <= 0 THEN 0
            ELSE NULL
          END AS dias_cobertura
        FROM base
      ), classificada AS (
        SELECT
          *,
          CASE
            WHEN media_diaria_saida_90d > 0 AND estoque_disponivel <= 0
              THEN 'RUPTURA_ATUAL'
            WHEN dias_cobertura <= 7 THEN 'CRITICO'
            WHEN dias_cobertura <= 15 THEN 'ALTO'
            WHEN dias_cobertura <= 30 THEN 'MEDIO'
            WHEN dias_cobertura > 30 THEN 'SAUDAVEL'
            WHEN estoque_disponivel <= 0 THEN 'SEM_ESTOQUE_SEM_GIRO'
            ELSE 'SEM_GIRO'
          END AS classificacao_risco
        FROM calculada
      )
      SELECT
        id_produto,
        descricao_produto,
        sku,
        ean,
        id_grupo,
        grupo,
        id_subgrupo,
        subgrupo,
        id_marca,
        marca,
        id_categoria,
        categoria,
        data_referencia,
        estoque_disponivel,
        quantidade_reservada,
        custo_produto_atual,
        valor_estoque_custo,
        saida_venda_7d,
        saida_venda_30d,
        saida_venda_90d,
        media_diaria_saida_90d,
        dias_cobertura,
        CASE
          WHEN dias_cobertura IS NOT NULL
            THEN data_referencia + CAST(ceil(dias_cobertura) AS INTEGER)
          ELSE NULL
        END AS data_estimada_ruptura,
        classificacao_risco,
        CASE classificacao_risco
          WHEN 'RUPTURA_ATUAL' THEN 1
          WHEN 'CRITICO' THEN 2
          WHEN 'ALTO' THEN 3
          WHEN 'MEDIO' THEN 4
          WHEN 'SAUDAVEL' THEN 5
          WHEN 'SEM_ESTOQUE_SEM_GIRO' THEN 6
          ELSE 7
        END AS prioridade_risco,
        classificacao_risco = 'RUPTURA_ATUAL' AS ruptura_atual,
        classificacao_risco IN ('RUPTURA_ATUAL', 'CRITICO', 'ALTO', 'MEDIO')
          AS risco_ruptura_30d,
        media_diaria_saida_90d > 0 AS tem_demanda_recente,
        tem_reposicao_prevista,
        proxima_data_prevista,
        tem_entrega_atrasada,
        data_entrega_atrasada_mais_antiga,
        tem_recebimento_indicado_7d,
        data_ultimo_recebimento_indicado,
        estoque_disponivel <= 0 AND tem_recebimento_indicado_7d
          AS estoque_zero_com_recebimento_indicado_7d,
        false AS reposicao_incluida_no_estoque_calculado,
        90 AS janela_demanda_dias,
        true AS premissa_sem_reposicao,
        cobertura_inicio AS cobertura_movimentos_inicio,
        cobertura_fim AS cobertura_movimentos_fim,
        dthr_atualizacao_estoque,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM classificada
    `;
  },

  construirMetricasQualidadeSql(contextosSilver) {
    const estoque = `"${contextosSilver.get('fato_estoque_atual').viewAtual}"`;
    const movimentos = `"${contextosSilver.get('fato_movimento_estoque').viewAtual}"`;
    return `
      SELECT
        count(*) FILTER (
          WHERE empresa_analisada = true AND produto_ativo = true AND envia_site = true
        ) AS produtos_elegiveis,
        count(*) FILTER (
          WHERE empresa_analisada = true AND produto_ativo = true
            AND envia_site = true AND estoque_disponivel < 0
        ) AS produtos_com_estoque_negativo,
        count(*) FILTER (
          WHERE empresa_analisada = true AND descricao_produto IS NULL
        ) AS estoques_sem_produto_correspondente,
        (
          SELECT min(data_referencia) FROM ${movimentos}
          WHERE empresa_analisada = true
        ) AS cobertura_inicio,
        (
          SELECT max(data_referencia) FROM ${movimentos}
          WHERE empresa_analisada = true
        ) AS cobertura_fim
      FROM ${estoque}
    `;
  }
};
