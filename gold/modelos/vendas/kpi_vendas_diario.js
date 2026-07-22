module.exports = {
  nome: 'kpi_vendas_diario',
  tipo: 'indicador',
  descricao: 'Indicadores diarios de pedidos pela data do pedido.',
  versaoContrato: 1,
  chavePrimaria: 'data_referencia',
  fontesSilver: ['fato_venda'],
  fontesGold: [],
  colunas: [
    'data_referencia',
    'ano',
    'mes',
    'dia_mes',
    'dia_semana',
    'pedidos_recebidos',
    'pedidos_validos',
    'pedidos_cancelados',
    'pedidos_pendentes',
    'pedidos_com_nota_emitida',
    'clientes_unicos',
    'valor_pedidos_recebidos',
    'valor_pedidos_validos',
    'valor_cancelado',
    'valor_pendente',
    'ticket_medio_pedido',
    'taxa_cancelamento_pct',
    'taxa_emissao_pct',
    'dados_parciais',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'data_referencia', 'pedidos_validos', 'pedidos_cancelados',
      'pedidos_pendentes', 'valor_pedidos_validos', 'ticket_medio_pedido',
      'taxa_cancelamento_pct', 'taxa_emissao_pct', 'dados_parciais'
    ],
    colunasAgente: [
      'data_referencia', 'ano', 'mes', 'dia_mes', 'dia_semana',
      'pedidos_recebidos', 'pedidos_validos', 'pedidos_cancelados',
      'pedidos_pendentes', 'pedidos_com_nota_emitida', 'clientes_unicos',
      'valor_pedidos_recebidos', 'valor_pedidos_validos', 'valor_cancelado',
      'valor_pendente', 'ticket_medio_pedido', 'taxa_cancelamento_pct',
      'taxa_emissao_pct', 'dados_parciais'
    ]
  },

  construirSql(contextosSilver) {
    const vendas = `"${contextosSilver.get('fato_venda').viewAtual}"`;
    return `
      WITH base AS (
        SELECT
          *,
          upper(trim(coalesce(tipo_pedido, ''))) AS tipo_normalizado,
          starts_with(upper(trim(coalesce(tipo_pedido, ''))), 'CANCELADO') AS cancelado,
          upper(trim(coalesce(tipo_pedido, ''))) = 'ORÇAMENTO' AS orcamento,
          faturamento_valido AS emitido
        FROM ${vendas}
        WHERE data_pedido IS NOT NULL
      ), preparada AS (
        SELECT
          *,
          (NOT cancelado AND NOT orcamento) AS valido,
          (NOT orcamento) AS recebido,
          (NOT emitido AND NOT cancelado AND NOT orcamento) AS pendente
        FROM base
      ), limite AS (
        SELECT max(data_pedido) AS ultima_data FROM preparada
      )
      SELECT
        CAST(data_pedido AS DATE) AS data_referencia,
        CAST(extract(year FROM data_pedido) AS INTEGER) AS ano,
        CAST(extract(month FROM data_pedido) AS INTEGER) AS mes,
        CAST(extract(day FROM data_pedido) AS INTEGER) AS dia_mes,
        CAST(extract(isodow FROM data_pedido) AS INTEGER) AS dia_semana,
        count(*) FILTER (WHERE recebido) AS pedidos_recebidos,
        count(*) FILTER (WHERE valido) AS pedidos_validos,
        count(*) FILTER (WHERE cancelado) AS pedidos_cancelados,
        count(*) FILTER (WHERE pendente) AS pedidos_pendentes,
        count(*) FILTER (WHERE valido AND emitido) AS pedidos_com_nota_emitida,
        count(DISTINCT id_cliente) FILTER (WHERE valido) AS clientes_unicos,
        CAST(coalesce(sum(valor_total_venda) FILTER (WHERE recebido), 0) AS DECIMAL(18,2))
          AS valor_pedidos_recebidos,
        CAST(coalesce(sum(valor_total_venda) FILTER (WHERE valido), 0) AS DECIMAL(18,2))
          AS valor_pedidos_validos,
        CAST(coalesce(sum(valor_total_venda) FILTER (WHERE cancelado), 0) AS DECIMAL(18,2))
          AS valor_cancelado,
        CAST(coalesce(sum(valor_total_venda) FILTER (WHERE pendente), 0) AS DECIMAL(18,2))
          AS valor_pendente,
        CAST(
          coalesce(sum(valor_total_venda) FILTER (WHERE valido), 0) /
            nullif(count(*) FILTER (WHERE valido), 0)
          AS DECIMAL(18,2)
        ) AS ticket_medio_pedido,
        CAST(
          100.0 * count(*) FILTER (WHERE cancelado) /
            nullif(count(*) FILTER (WHERE recebido), 0)
          AS DECIMAL(9,4)
        ) AS taxa_cancelamento_pct,
        CAST(
          100.0 * count(*) FILTER (WHERE valido AND emitido) /
            nullif(count(*) FILTER (WHERE valido), 0)
          AS DECIMAL(9,4)
        ) AS taxa_emissao_pct,
        bool_or(data_pedido = limite.ultima_data) AS dados_parciais,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM preparada
      CROSS JOIN limite
      GROUP BY data_pedido
      ORDER BY data_pedido
    `;
  },

  construirMetricasQualidadeSql(contextosSilver) {
    const vendas = `"${contextosSilver.get('fato_venda').viewAtual}"`;
    return `
      SELECT
        count(*) AS registros_fonte,
        count(*) FILTER (WHERE data_pedido IS NULL) AS registros_sem_data_pedido,
        count(*) FILTER (WHERE tipo_pedido IS NULL OR trim(tipo_pedido) = '')
          AS registros_sem_tipo_pedido,
        min(data_pedido) AS cobertura_inicio,
        max(data_pedido) AS cobertura_fim
      FROM ${vendas}
    `;
  }
};
