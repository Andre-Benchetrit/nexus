module.exports = {
  nome: 'kpi_vendas_diario',
  tipo: 'indicador',
  descricao: 'Indicadores diarios no grao de um pedido comercial PD.',
  versaoContrato: 2,
  chavePrimaria: 'data_referencia',
  fontesSilver: ['fato_pedido'],
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
    'pedidos_faturados',
    'pedidos_devolvidos',
    'pedidos_status_conflitante',
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
      'pedidos_pendentes', 'pedidos_faturados',
      'pedidos_devolvidos', 'pedidos_status_conflitante', 'valor_pedidos_validos',
      'ticket_medio_pedido', 'taxa_cancelamento_pct',
      'taxa_emissao_pct', 'dados_parciais'
    ],
    colunasAgente: [
      'data_referencia', 'ano', 'mes', 'dia_mes', 'dia_semana',
      'pedidos_recebidos', 'pedidos_validos', 'pedidos_cancelados',
      'pedidos_pendentes', 'pedidos_faturados',
      'pedidos_devolvidos', 'pedidos_status_conflitante',
      'pedidos_com_nota_emitida',
      'clientes_unicos', 'valor_pedidos_recebidos',
      'valor_pedidos_validos', 'valor_cancelado', 'valor_pendente',
      'ticket_medio_pedido', 'taxa_cancelamento_pct',
      'taxa_emissao_pct', 'dados_parciais'
    ]
  },

  construirSql(contextosSilver) {
    const pedidos = `"${contextosSilver.get('fato_pedido').viewAtual}"`;
    return `
      WITH base AS (
        SELECT *
        FROM ${pedidos}
        WHERE data_pedido IS NOT NULL
      ), limite AS (
        SELECT max(data_pedido) AS ultima_data FROM base
      )
      SELECT
        CAST(data_pedido AS DATE) AS data_referencia,
        CAST(extract(year FROM data_pedido) AS INTEGER) AS ano,
        CAST(extract(month FROM data_pedido) AS INTEGER) AS mes,
        CAST(extract(day FROM data_pedido) AS INTEGER) AS dia_mes,
        CAST(extract(isodow FROM data_pedido) AS INTEGER) AS dia_semana,
        count(*) FILTER (WHERE pedido_recebido) AS pedidos_recebidos,
        count(*) FILTER (WHERE pedido_valido) AS pedidos_validos,
        count(*) FILTER (WHERE pedido_cancelado) AS pedidos_cancelados,
        count(*) FILTER (WHERE pedido_pendente) AS pedidos_pendentes,
        count(*) FILTER (WHERE pedido_faturado) AS pedidos_faturados,
        count(*) FILTER (WHERE pedido_devolvido) AS pedidos_devolvidos,
        count(*) FILTER (WHERE conflito_status) AS pedidos_status_conflitante,
        count(*) FILTER (WHERE pedido_faturado) AS pedidos_com_nota_emitida,
        count(DISTINCT id_cliente) FILTER (WHERE pedido_valido) AS clientes_unicos,
        CAST(
          coalesce(sum(valor_pedido) FILTER (WHERE pedido_recebido), 0)
          AS DECIMAL(18,2)
        ) AS valor_pedidos_recebidos,
        CAST(
          coalesce(sum(valor_pedido) FILTER (WHERE pedido_valido), 0)
          AS DECIMAL(18,2)
        ) AS valor_pedidos_validos,
        CAST(
          coalesce(sum(valor_pedido) FILTER (WHERE pedido_cancelado), 0)
          AS DECIMAL(18,2)
        ) AS valor_cancelado,
        CAST(
          coalesce(sum(valor_pedido) FILTER (WHERE pedido_pendente), 0)
          AS DECIMAL(18,2)
        ) AS valor_pendente,
        CAST(
          coalesce(sum(valor_pedido) FILTER (WHERE pedido_valido), 0) /
            nullif(count(*) FILTER (WHERE pedido_valido), 0)
          AS DECIMAL(18,2)
        ) AS ticket_medio_pedido,
        CAST(
          100.0 * count(*) FILTER (WHERE pedido_cancelado) /
            nullif(count(*) FILTER (WHERE pedido_recebido), 0)
          AS DECIMAL(9,4)
        ) AS taxa_cancelamento_pct,
        CAST(
          100.0 * count(*) FILTER (WHERE pedido_faturado) /
            nullif(count(*) FILTER (WHERE pedido_valido), 0)
          AS DECIMAL(9,4)
        ) AS taxa_emissao_pct,
        bool_or(data_pedido = limite.ultima_data) AS dados_parciais,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM base
      CROSS JOIN limite
      GROUP BY data_pedido
      ORDER BY data_pedido
    `;
  },

  construirMetricasQualidadeSql(contextosSilver) {
    const pedidos = `"${contextosSilver.get('fato_pedido').viewAtual}"`;
    return `
      SELECT
        count(*) AS registros_fonte,
        count(*) FILTER (WHERE data_pedido IS NULL) AS registros_sem_data_pedido,
        count(*) FILTER (WHERE tipo_pedido IS NULL OR trim(tipo_pedido) = '')
          AS registros_sem_tipo_pedido,
        count(*) FILTER (WHERE conflito_status) AS pedidos_com_status_conflitante,
        min(data_pedido) AS cobertura_inicio,
        max(data_pedido) AS cobertura_fim
      FROM ${pedidos}
    `;
  }
};
