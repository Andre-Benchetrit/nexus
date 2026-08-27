module.exports = {
  nome: 'kpi_vendas_diario_por_empresa',
  tipo: 'indicador_dimensional',
  descricao: 'Indicadores diarios de pedidos, separados por empresa.',
  versaoContrato: 1,
  chavePrimaria: ['data_referencia', 'id_empresa'],
  fontesSilver: ['fato_pedido'],
  fontesGold: [],
  colunas: [
    'data_referencia', 'id_empresa', 'pedidos_recebidos', 'pedidos_validos',
    'pedidos_cancelados', 'pedidos_pendentes', 'pedidos_faturados',
    'pedidos_devolvidos', 'pedidos_status_conflitante', 'pedidos_com_nota_emitida',
    'clientes_unicos', 'valor_pedidos_recebidos', 'valor_pedidos_validos',
    'valor_cancelado', 'valor_pendente', 'dados_parciais', 'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: ['data_referencia', 'id_empresa', 'pedidos_validos', 'valor_pedidos_validos'],
    colunasAgente: [
      'data_referencia', 'id_empresa', 'pedidos_recebidos', 'pedidos_validos',
      'pedidos_cancelados', 'pedidos_pendentes', 'pedidos_faturados',
      'pedidos_devolvidos', 'pedidos_status_conflitante', 'pedidos_com_nota_emitida',
      'clientes_unicos', 'valor_pedidos_recebidos', 'valor_pedidos_validos',
      'valor_cancelado', 'valor_pendente', 'dados_parciais'
    ]
  },
  construirSql(contextosSilver) {
    const pedidos = `"${contextosSilver.get('fato_pedido').viewAtual}"`;
    return `
      WITH base AS (
        SELECT * FROM ${pedidos}
        WHERE data_pedido IS NOT NULL AND id_empresa IS NOT NULL
      ), limite AS (SELECT max(data_pedido) AS ultima_data FROM base)
      SELECT
        CAST(data_pedido AS DATE) AS data_referencia,
        id_empresa,
        count(*) FILTER (WHERE pedido_recebido) AS pedidos_recebidos,
        count(*) FILTER (WHERE pedido_valido) AS pedidos_validos,
        count(*) FILTER (WHERE pedido_cancelado) AS pedidos_cancelados,
        count(*) FILTER (WHERE pedido_pendente) AS pedidos_pendentes,
        count(*) FILTER (WHERE pedido_faturado) AS pedidos_faturados,
        count(*) FILTER (WHERE pedido_devolvido) AS pedidos_devolvidos,
        count(*) FILTER (WHERE conflito_status) AS pedidos_status_conflitante,
        count(*) FILTER (WHERE pedido_faturado) AS pedidos_com_nota_emitida,
        count(DISTINCT id_cliente) FILTER (WHERE pedido_valido) AS clientes_unicos,
        CAST(coalesce(sum(valor_pedido) FILTER (WHERE pedido_recebido), 0) AS DECIMAL(18,2)) AS valor_pedidos_recebidos,
        CAST(coalesce(sum(valor_pedido) FILTER (WHERE pedido_valido), 0) AS DECIMAL(18,2)) AS valor_pedidos_validos,
        CAST(coalesce(sum(valor_pedido) FILTER (WHERE pedido_cancelado), 0) AS DECIMAL(18,2)) AS valor_cancelado,
        CAST(coalesce(sum(valor_pedido) FILTER (WHERE pedido_pendente), 0) AS DECIMAL(18,2)) AS valor_pendente,
        bool_or(data_pedido = limite.ultima_data) AS dados_parciais,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM base CROSS JOIN limite
      GROUP BY data_pedido, id_empresa
      ORDER BY data_pedido, id_empresa
    `;
  }
};
