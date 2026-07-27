module.exports = {
  nome: 'kpi_pedidos_pagos_diario',
  tipo: 'indicador',
  descricao: 'Pedidos pagos por data do pedido, conforme itens de notas autorizadas.',
  versaoContrato: 1,
  chavePrimaria: 'data_referencia',
  fontesSilver: ['fato_pedido_item'],
  fontesGold: [],
  colunas: [
    'data_referencia', 'pedidos_pagos', 'valor_pedidos_pagos',
    'ticket_medio_pedido_pago', 'dados_parciais', 'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'data_referencia', 'pedidos_pagos', 'valor_pedidos_pagos',
      'ticket_medio_pedido_pago', 'dados_parciais'
    ],
    colunasAgente: [
      'data_referencia', 'pedidos_pagos', 'valor_pedidos_pagos',
      'ticket_medio_pedido_pago', 'dados_parciais'
    ]
  },

  construirSql(contextosSilver) {
    const itens = `"${contextosSilver.get('fato_pedido_item').viewAtual}"`;
    return `
      WITH base AS (
        SELECT *
        FROM ${itens}
        WHERE pedido_pago = true AND data_pedido IS NOT NULL
      ), limite AS (
        SELECT max(data_pedido) AS ultima_data FROM base
      )
      SELECT
        CAST(data_pedido AS DATE) AS data_referencia,
        count(DISTINCT (id_empresa, id_pedido_vda_importado)) AS pedidos_pagos,
        CAST(coalesce(sum(valor_pedido_pago_item), 0) AS DECIMAL(18,2))
          AS valor_pedidos_pagos,
        CAST(
          coalesce(sum(valor_pedido_pago_item), 0) /
            nullif(count(DISTINCT (id_empresa, id_pedido_vda_importado)), 0)
          AS DECIMAL(18,2)
        ) AS ticket_medio_pedido_pago,
        bool_or(data_pedido = limite.ultima_data) AS dados_parciais,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM base
      CROSS JOIN limite
      GROUP BY data_pedido
      ORDER BY data_pedido
    `;
  },

  construirMetricasQualidadeSql(contextosSilver) {
    const itens = `"${contextosSilver.get('fato_pedido_item').viewAtual}"`;
    return `
      SELECT
        count(*) FILTER (WHERE pedido_pago = true) AS itens_pagos,
        count(*) FILTER (WHERE pedido_pago = true AND data_pedido IS NULL)
          AS itens_pagos_sem_data,
        min(data_pedido) FILTER (WHERE pedido_pago = true) AS cobertura_inicio,
        max(data_pedido) FILTER (WHERE pedido_pago = true) AS cobertura_fim
      FROM ${itens}
    `;
  }
};
