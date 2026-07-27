module.exports = {
  nome: 'kpi_plataforma_diario',
  tipo: 'indicador_dimensional',
  descricao: 'Funil comercial diario por plataforma, no grao correto de pedido.',
  versaoContrato: 1,
  chavePrimaria: ['data_referencia', 'id_empresa', 'id_plataforma'],
  fontesSilver: ['fato_pedido'],
  fontesGold: [],
  colunas: [
    'data_referencia',
    'id_empresa',
    'id_plataforma',
    'plataforma',
    'pedidos_recebidos',
    'pedidos_validos',
    'pedidos_cancelados',
    'pedidos_pendentes',
    'pedidos_faturados',
    'pedidos_devolvidos',
    'pedidos_status_conflitante',
    'valor_pedidos_recebidos',
    'valor_pedidos_validos',
    'ticket_medio_pedido',
    'taxa_cancelamento_pct',
    'taxa_emissao_pct',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'data_referencia', 'plataforma', 'pedidos_validos',
      'pedidos_cancelados', 'pedidos_pendentes', 'pedidos_faturados',
      'pedidos_devolvidos', 'valor_pedidos_validos', 'ticket_medio_pedido'
    ],
    colunasAgente: [
      'data_referencia', 'id_empresa', 'id_plataforma', 'plataforma',
      'pedidos_recebidos', 'pedidos_validos', 'pedidos_cancelados',
      'pedidos_pendentes', 'pedidos_faturados',
      'pedidos_devolvidos', 'pedidos_status_conflitante',
      'valor_pedidos_recebidos',
      'valor_pedidos_validos', 'ticket_medio_pedido',
      'taxa_cancelamento_pct', 'taxa_emissao_pct'
    ]
  },

  construirSql(contextosSilver) {
    const pedidos = `"${contextosSilver.get('fato_pedido').viewAtual}"`;
    return `
      SELECT
        CAST(data_pedido AS DATE) AS data_referencia,
        coalesce(id_empresa, 0) AS id_empresa,
        coalesce(id_plataforma, 0) AS id_plataforma,
        any_value(plataforma) AS plataforma,
        count(*) FILTER (WHERE pedido_recebido) AS pedidos_recebidos,
        count(*) FILTER (WHERE pedido_valido) AS pedidos_validos,
        count(*) FILTER (WHERE pedido_cancelado) AS pedidos_cancelados,
        count(*) FILTER (WHERE pedido_pendente) AS pedidos_pendentes,
        count(*) FILTER (WHERE pedido_faturado) AS pedidos_faturados,
        count(*) FILTER (WHERE pedido_devolvido) AS pedidos_devolvidos,
        count(*) FILTER (WHERE conflito_status) AS pedidos_status_conflitante,
        CAST(
          coalesce(sum(valor_pedido) FILTER (WHERE pedido_recebido), 0)
          AS DECIMAL(18,2)
        ) AS valor_pedidos_recebidos,
        CAST(
          coalesce(sum(valor_pedido) FILTER (WHERE pedido_valido), 0)
          AS DECIMAL(18,2)
        ) AS valor_pedidos_validos,
        CAST(
          coalesce(sum(valor_pedido) FILTER (WHERE pedido_valido), 0) /
            nullif(count(*) FILTER (WHERE pedido_valido), 0)
          AS DECIMAL(18,2)
        ) AS ticket_medio_pedido,
        CAST(
          100.0 * count(*) FILTER (WHERE pedido_cancelado) /
            nullif(count(*) FILTER (WHERE pedido_recebido), 0)
          AS DECIMAL(12,4)
        ) AS taxa_cancelamento_pct,
        CAST(
          100.0 * count(*) FILTER (WHERE pedido_faturado) /
            nullif(count(*) FILTER (WHERE pedido_valido), 0)
          AS DECIMAL(12,4)
        ) AS taxa_emissao_pct,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM ${pedidos}
      WHERE data_pedido IS NOT NULL
      GROUP BY data_pedido, coalesce(id_empresa, 0), coalesce(id_plataforma, 0)
      ORDER BY data_pedido, id_empresa, id_plataforma
    `;
  }
};
