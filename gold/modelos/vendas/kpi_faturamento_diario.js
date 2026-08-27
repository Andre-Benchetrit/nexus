module.exports = {
  nome: 'kpi_faturamento_diario',
  tipo: 'indicador',
  descricao: 'Indicadores fiscais diarios pela data de emissao da nota.',
  versaoContrato: 2,
  chavePrimaria: 'data_referencia',
  fontesSilver: ['fato_nota_fiscal', 'fato_venda'],
  fontesGold: [],
  colunas: [
    'data_referencia',
    'ano',
    'mes',
    'dia_mes',
    'dia_semana',
    'notas_emitidas',
    'clientes_faturados',
    'faturamento_emitido',
    'faturamento_total',
    'devolucoes_vinculadas',
    'valor_devolucoes',
    'faturamento_liquido',
    'ticket_medio_faturado',
    'notas_com_prazo_calculavel',
    'soma_prazo_emissao_dias',
    'prazo_medio_emissao_dias',
    'dados_parciais',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'data_referencia', 'notas_emitidas', 'faturamento_emitido',
      'faturamento_total', 'valor_devolucoes', 'faturamento_liquido',
      'ticket_medio_faturado', 'prazo_medio_emissao_dias', 'dados_parciais'
    ],
    colunasAgente: [
      'data_referencia', 'ano', 'mes', 'dia_mes', 'dia_semana',
      'notas_emitidas', 'clientes_faturados', 'faturamento_emitido',
      'faturamento_total', 'devolucoes_vinculadas', 'valor_devolucoes',
      'faturamento_liquido',
      'ticket_medio_faturado', 'notas_com_prazo_calculavel',
      'soma_prazo_emissao_dias', 'prazo_medio_emissao_dias', 'dados_parciais'
    ]
  },

  construirSql(contextosSilver) {
    const vendas = `"${contextosSilver.get('fato_nota_fiscal').viewAtual}"`;
    const documentos = `"${contextosSilver.get('fato_venda').viewAtual}"`;
    return `
      WITH base_vendas AS (
        SELECT
          *,
          CASE
            WHEN data_pedido IS NOT NULL AND data_emissao >= data_pedido
              THEN date_diff('day', data_pedido, data_emissao)
            ELSE NULL
          END AS prazo_emissao_dias
        FROM ${vendas}
        WHERE data_emissao IS NOT NULL
      ), vendas_diarias AS (
        SELECT
          CAST(data_emissao AS DATE) AS data_referencia,
          count(*) AS notas_emitidas,
          count(DISTINCT id_cliente) AS clientes_faturados,
          coalesce(sum(valor_total_venda), 0) AS faturamento_emitido,
          coalesce(sum(valor_total_liquido_venda), 0) AS faturamento_total,
          count(prazo_emissao_dias) AS notas_com_prazo_calculavel,
          coalesce(sum(prazo_emissao_dias), 0) AS soma_prazo_emissao_dias,
          avg(prazo_emissao_dias) AS prazo_medio_emissao_dias
        FROM base_vendas
        GROUP BY data_emissao
      ), vendas_por_pedido AS (
        SELECT
          id_empresa,
          id_pedido_vda_importado,
          min(CAST(data_emissao AS DATE)) AS data_venda_original
        FROM ${vendas}
        WHERE id_pedido_vda_importado IS NOT NULL
        GROUP BY id_empresa, id_pedido_vda_importado
        HAVING count(DISTINCT CAST(data_emissao AS DATE)) = 1
      ), vendas_por_marketplace AS (
        SELECT
          id_empresa,
          regexp_replace(
            upper(trim(coalesce(marketplace_pedido, ''))),
            '_.*$',
            ''
          ) AS marketplace_pedido_base,
          min(CAST(data_emissao AS DATE)) AS data_venda_original
        FROM ${vendas}
        WHERE trim(coalesce(marketplace_pedido, '')) <> ''
        GROUP BY id_empresa, marketplace_pedido_base
        HAVING count(DISTINCT CAST(data_emissao AS DATE)) = 1
      ), devolucoes_base AS (
        SELECT
          *,
          regexp_replace(
            upper(trim(coalesce(marketplace_pedido, ''))),
            '_.*$',
            ''
          ) AS marketplace_pedido_base
        FROM ${documentos}
        WHERE devolucao_faturamento = true
      ), devolucoes_vinculadas AS (
        SELECT
          dv.id_nota_saida,
          dv.valor_total_liquido_venda,
          coalesce(
            CAST(original.data_emissao AS DATE),
            pedido.data_venda_original,
            marketplace.data_venda_original
          ) AS data_referencia
        FROM devolucoes_base dv
        LEFT JOIN ${vendas} original
          ON original.id_nota_saida = dv.id_nota_saida_original
        LEFT JOIN vendas_por_pedido pedido
          ON pedido.id_empresa = dv.id_empresa
          AND pedido.id_pedido_vda_importado = dv.id_pedido_vda_importado
        LEFT JOIN vendas_por_marketplace marketplace
          ON marketplace.id_empresa = dv.id_empresa
          AND marketplace.marketplace_pedido_base = dv.marketplace_pedido_base
          AND marketplace.marketplace_pedido_base <> ''
      ), devolucoes_diarias AS (
        SELECT
          data_referencia,
          count(*) AS devolucoes_vinculadas,
          coalesce(sum(valor_total_liquido_venda), 0) AS valor_devolucoes
        FROM devolucoes_vinculadas
        WHERE data_referencia IS NOT NULL
        GROUP BY data_referencia
      ), datas AS (
        SELECT data_referencia FROM vendas_diarias
        UNION
        SELECT data_referencia FROM devolucoes_diarias
      ), limite AS (
        SELECT max(data_referencia) AS ultima_data FROM datas
      )
      SELECT
        d.data_referencia,
        CAST(extract(year FROM d.data_referencia) AS INTEGER) AS ano,
        CAST(extract(month FROM d.data_referencia) AS INTEGER) AS mes,
        CAST(extract(day FROM d.data_referencia) AS INTEGER) AS dia_mes,
        CAST(extract(isodow FROM d.data_referencia) AS INTEGER) AS dia_semana,
        coalesce(v.notas_emitidas, 0) AS notas_emitidas,
        coalesce(v.clientes_faturados, 0) AS clientes_faturados,
        CAST(coalesce(v.faturamento_emitido, 0) AS DECIMAL(18,2)) AS faturamento_emitido,
        CAST(coalesce(v.faturamento_total, 0) AS DECIMAL(18,2)) AS faturamento_total,
        coalesce(dev.devolucoes_vinculadas, 0) AS devolucoes_vinculadas,
        CAST(coalesce(dev.valor_devolucoes, 0) AS DECIMAL(18,2)) AS valor_devolucoes,
        CAST(
          coalesce(v.faturamento_total, 0) - coalesce(dev.valor_devolucoes, 0)
          AS DECIMAL(18,2)
        ) AS faturamento_liquido,
        CAST(coalesce(v.faturamento_emitido, 0) / nullif(v.notas_emitidas, 0) AS DECIMAL(18,2))
          AS ticket_medio_faturado,
        coalesce(v.notas_com_prazo_calculavel, 0) AS notas_com_prazo_calculavel,
        coalesce(v.soma_prazo_emissao_dias, 0) AS soma_prazo_emissao_dias,
        CAST(v.prazo_medio_emissao_dias AS DECIMAL(18,2)) AS prazo_medio_emissao_dias,
        d.data_referencia = limite.ultima_data AS dados_parciais,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM datas d
      LEFT JOIN vendas_diarias v USING (data_referencia)
      LEFT JOIN devolucoes_diarias dev USING (data_referencia)
      CROSS JOIN limite
      ORDER BY d.data_referencia
    `;
  },

  construirMetricasQualidadeSql(contextosSilver) {
    const vendas = `"${contextosSilver.get('fato_nota_fiscal').viewAtual}"`;
    const documentos = `"${contextosSilver.get('fato_venda').viewAtual}"`;
    return `
      WITH metricas_notas AS (
        SELECT
          count(*) FILTER (WHERE faturamento_valido = true) AS notas_marcadas_emitidas,
          count(*) FILTER (WHERE faturamento_valido = true AND data_emissao IS NULL)
            AS notas_emitidas_sem_data,
          count(*) FILTER (
            WHERE faturamento_valido = true AND data_emissao IS NOT NULL
              AND data_pedido IS NOT NULL AND data_emissao < data_pedido
          ) AS emissoes_anteriores_ao_pedido,
          count(*) FILTER (WHERE faturamento_valido = true AND coalesce(id_nr_nf, 0) <= 0)
            AS notas_emitidas_sem_numero,
          min(data_emissao) FILTER (WHERE faturamento_valido = true) AS cobertura_inicio,
          max(data_emissao) FILTER (WHERE faturamento_valido = true) AS cobertura_fim
        FROM ${vendas}
      ), vendas_por_pedido AS (
        SELECT id_empresa, id_pedido_vda_importado
        FROM ${vendas}
        WHERE id_pedido_vda_importado IS NOT NULL
        GROUP BY id_empresa, id_pedido_vda_importado
        HAVING count(DISTINCT CAST(data_emissao AS DATE)) = 1
      ), vendas_por_marketplace AS (
        SELECT id_empresa,
          regexp_replace(upper(trim(coalesce(marketplace_pedido, ''))), '_.*$', '')
            AS marketplace_pedido_base
        FROM ${vendas}
        WHERE trim(coalesce(marketplace_pedido, '')) <> ''
        GROUP BY id_empresa, marketplace_pedido_base
        HAVING count(DISTINCT CAST(data_emissao AS DATE)) = 1
      ), devolucoes_base AS (
        SELECT
          *,
          regexp_replace(upper(trim(coalesce(marketplace_pedido, ''))), '_.*$', '')
            AS marketplace_pedido_base
        FROM ${documentos}
        WHERE devolucao_faturamento = true
      ), devolucoes AS (
        SELECT
          dv.*,
          original.id_nota_saida IS NOT NULL AS vinculo_nota_original,
          pedido.id_pedido_vda_importado IS NOT NULL AS vinculo_pedido,
          marketplace.marketplace_pedido_base IS NOT NULL AS vinculo_marketplace
        FROM devolucoes_base dv
        LEFT JOIN ${vendas} original
          ON original.id_nota_saida = dv.id_nota_saida_original
        LEFT JOIN vendas_por_pedido pedido
          ON pedido.id_empresa = dv.id_empresa
          AND pedido.id_pedido_vda_importado = dv.id_pedido_vda_importado
        LEFT JOIN vendas_por_marketplace marketplace
          ON marketplace.id_empresa = dv.id_empresa
          AND marketplace.marketplace_pedido_base = dv.marketplace_pedido_base
          AND marketplace.marketplace_pedido_base <> ''
      ), metricas_devolucoes AS (
        SELECT
          count(*) AS devolucoes_autorizadas,
          count(*) FILTER (WHERE vinculo_nota_original) AS devolucoes_por_nota_original,
          count(*) FILTER (WHERE NOT vinculo_nota_original AND vinculo_pedido)
            AS devolucoes_por_pedido,
          count(*) FILTER (
            WHERE NOT vinculo_nota_original AND NOT vinculo_pedido AND vinculo_marketplace
          ) AS devolucoes_por_marketplace,
          count(*) FILTER (
            WHERE NOT vinculo_nota_original AND NOT vinculo_pedido AND NOT vinculo_marketplace
          ) AS devolucoes_sem_vinculo_univoco,
          CAST(coalesce(sum(valor_total_liquido_venda) FILTER (
            WHERE NOT vinculo_nota_original AND NOT vinculo_pedido AND NOT vinculo_marketplace
          ), 0) AS DECIMAL(18,2)) AS valor_devolucoes_sem_vinculo_univoco
        FROM devolucoes
      )
      SELECT * FROM metricas_notas CROSS JOIN metricas_devolucoes
    `;
  }
};
