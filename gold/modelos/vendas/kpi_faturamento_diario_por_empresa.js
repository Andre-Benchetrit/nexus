module.exports = {
  nome: 'kpi_faturamento_diario_por_empresa',
  tipo: 'indicador_dimensional',
  descricao: 'Indicadores fiscais diarios, separados por empresa.',
  versaoContrato: 2,
  chavePrimaria: ['data_referencia', 'id_empresa'],
  fontesSilver: ['fato_nota_fiscal', 'fato_venda'],
  fontesGold: [],
  colunas: [
    'data_referencia', 'id_empresa', 'notas_emitidas', 'faturamento_emitido',
    'faturamento_total', 'devolucoes_vinculadas', 'valor_devolucoes',
    'faturamento_liquido',
    'notas_com_prazo_calculavel', 'soma_prazo_emissao_dias', 'dados_parciais', 'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'data_referencia', 'id_empresa', 'notas_emitidas', 'faturamento_total',
      'valor_devolucoes', 'faturamento_liquido'
    ],
    colunasAgente: [
      'data_referencia', 'id_empresa', 'notas_emitidas', 'faturamento_emitido',
      'faturamento_total', 'devolucoes_vinculadas', 'valor_devolucoes',
      'faturamento_liquido',
      'notas_com_prazo_calculavel', 'soma_prazo_emissao_dias', 'dados_parciais'
    ]
  },
  construirSql(contextosSilver) {
    const vendas = `"${contextosSilver.get('fato_nota_fiscal').viewAtual}"`;
    const documentos = `"${contextosSilver.get('fato_venda').viewAtual}"`;
    return `
      WITH base_vendas AS (
        SELECT *, CASE
          WHEN data_pedido IS NOT NULL AND data_emissao >= data_pedido
            THEN date_diff('day', data_pedido, data_emissao)
          ELSE NULL
        END AS prazo_emissao_dias
        FROM ${vendas}
        WHERE data_emissao IS NOT NULL AND id_empresa IS NOT NULL
      ), vendas_diarias AS (
        SELECT
          CAST(data_emissao AS DATE) AS data_referencia,
          id_empresa,
          count(*) AS notas_emitidas,
          coalesce(sum(valor_total_venda), 0) AS faturamento_emitido,
          coalesce(sum(valor_total_liquido_venda), 0) AS faturamento_total,
          count(prazo_emissao_dias) AS notas_com_prazo_calculavel,
          coalesce(sum(prazo_emissao_dias), 0) AS soma_prazo_emissao_dias
        FROM base_vendas
        GROUP BY data_emissao, id_empresa
      ), vendas_por_pedido AS (
        SELECT id_empresa, id_pedido_vda_importado,
          min(CAST(data_emissao AS DATE)) AS data_venda_original
        FROM ${vendas}
        WHERE id_pedido_vda_importado IS NOT NULL
        GROUP BY id_empresa, id_pedido_vda_importado
        HAVING count(DISTINCT CAST(data_emissao AS DATE)) = 1
      ), vendas_por_marketplace AS (
        SELECT id_empresa,
          regexp_replace(upper(trim(coalesce(marketplace_pedido, ''))), '_.*$', '')
            AS marketplace_pedido_base,
          min(CAST(data_emissao AS DATE)) AS data_venda_original
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
        WHERE devolucao_faturamento = true AND id_empresa IS NOT NULL
      ), devolucoes_vinculadas AS (
        SELECT
          dv.id_nota_saida,
          dv.id_empresa,
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
        SELECT data_referencia, id_empresa,
          count(*) AS devolucoes_vinculadas,
          coalesce(sum(valor_total_liquido_venda), 0) AS valor_devolucoes
        FROM devolucoes_vinculadas
        WHERE data_referencia IS NOT NULL
        GROUP BY data_referencia, id_empresa
      ), chaves AS (
        SELECT data_referencia, id_empresa FROM vendas_diarias
        UNION
        SELECT data_referencia, id_empresa FROM devolucoes_diarias
      ), limite AS (SELECT max(data_referencia) AS ultima_data FROM chaves)
      SELECT
        c.data_referencia,
        c.id_empresa,
        coalesce(v.notas_emitidas, 0) AS notas_emitidas,
        CAST(coalesce(v.faturamento_emitido, 0) AS DECIMAL(18,2)) AS faturamento_emitido,
        CAST(coalesce(v.faturamento_total, 0) AS DECIMAL(18,2)) AS faturamento_total,
        coalesce(dev.devolucoes_vinculadas, 0) AS devolucoes_vinculadas,
        CAST(coalesce(dev.valor_devolucoes, 0) AS DECIMAL(18,2)) AS valor_devolucoes,
        CAST(
          coalesce(v.faturamento_total, 0) - coalesce(dev.valor_devolucoes, 0)
          AS DECIMAL(18,2)
        ) AS faturamento_liquido,
        coalesce(v.notas_com_prazo_calculavel, 0) AS notas_com_prazo_calculavel,
        coalesce(v.soma_prazo_emissao_dias, 0) AS soma_prazo_emissao_dias,
        c.data_referencia = limite.ultima_data AS dados_parciais,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM chaves c
      LEFT JOIN vendas_diarias v USING (data_referencia, id_empresa)
      LEFT JOIN devolucoes_diarias dev USING (data_referencia, id_empresa)
      CROSS JOIN limite
      ORDER BY c.data_referencia, c.id_empresa
    `;
  }
};
