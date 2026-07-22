module.exports = {
  nome: 'painel_executivo_diario',
  tipo: 'painel',
  descricao: 'Resumo executivo diario com pedidos, faturamento e comparacoes.',
  versaoContrato: 1,
  chavePrimaria: 'data_referencia',
  fontesSilver: [],
  fontesGold: ['kpi_vendas_diario', 'kpi_faturamento_diario', 'kpi_pedidos_pagos_diario'],
  colunas: [
    'data_referencia',
    'pedidos_validos',
    'pedidos_cancelados',
    'pedidos_pendentes',
    'valor_pedidos_validos',
    'pedidos_pagos',
    'valor_pedidos_pagos',
    'ticket_medio_pedido',
    'taxa_cancelamento_pct',
    'taxa_emissao_pct',
    'notas_emitidas',
    'faturamento_emitido',
    'ticket_medio_faturado',
    'prazo_medio_emissao_dias',
    'pedidos_validos_7d',
    'valor_pedidos_validos_7d',
    'notas_emitidas_7d',
    'faturamento_emitido_7d',
    'pedidos_validos_30d',
    'valor_pedidos_validos_30d',
    'notas_emitidas_30d',
    'faturamento_emitido_30d',
    'valor_pedidos_dia_anterior',
    'variacao_valor_pedidos_dia_pct',
    'faturamento_dia_anterior',
    'variacao_faturamento_dia_pct',
    'dados_parciais',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'data_referencia', 'pedidos_validos', 'valor_pedidos_validos',
      'pedidos_pagos', 'valor_pedidos_pagos',
      'notas_emitidas', 'faturamento_emitido', 'pedidos_validos_7d',
      'faturamento_emitido_7d', 'variacao_valor_pedidos_dia_pct',
      'variacao_faturamento_dia_pct', 'dados_parciais'
    ],
    colunasAgente: [
      'data_referencia', 'pedidos_validos', 'pedidos_cancelados',
      'pedidos_pendentes', 'valor_pedidos_validos', 'pedidos_pagos',
      'valor_pedidos_pagos', 'ticket_medio_pedido',
      'taxa_cancelamento_pct', 'taxa_emissao_pct', 'notas_emitidas',
      'faturamento_emitido', 'ticket_medio_faturado',
      'prazo_medio_emissao_dias', 'pedidos_validos_7d',
      'valor_pedidos_validos_7d', 'notas_emitidas_7d',
      'faturamento_emitido_7d', 'pedidos_validos_30d',
      'valor_pedidos_validos_30d', 'notas_emitidas_30d',
      'faturamento_emitido_30d', 'valor_pedidos_dia_anterior',
      'variacao_valor_pedidos_dia_pct', 'faturamento_dia_anterior',
      'variacao_faturamento_dia_pct', 'dados_parciais'
    ]
  },

  construirSql(_contextosSilver, contextosGold) {
    const vendas = `"${contextosGold.get('kpi_vendas_diario').viewAtual}"`;
    const faturamento = `"${contextosGold.get('kpi_faturamento_diario').viewAtual}"`;
    const pagos = `"${contextosGold.get('kpi_pedidos_pagos_diario').viewAtual}"`;
    return `
      WITH base AS (
        SELECT
          coalesce(v.data_referencia, f.data_referencia, p.data_referencia) AS data_referencia,
          coalesce(v.pedidos_validos, 0) AS pedidos_validos,
          coalesce(v.pedidos_cancelados, 0) AS pedidos_cancelados,
          coalesce(v.pedidos_pendentes, 0) AS pedidos_pendentes,
          coalesce(v.valor_pedidos_validos, 0) AS valor_pedidos_validos,
          coalesce(p.pedidos_pagos, 0) AS pedidos_pagos,
          coalesce(p.valor_pedidos_pagos, 0) AS valor_pedidos_pagos,
          v.ticket_medio_pedido,
          v.taxa_cancelamento_pct,
          v.taxa_emissao_pct,
          coalesce(f.notas_emitidas, 0) AS notas_emitidas,
          coalesce(f.faturamento_emitido, 0) AS faturamento_emitido,
          f.ticket_medio_faturado,
          f.prazo_medio_emissao_dias,
          coalesce(v.dados_parciais, false) OR coalesce(f.dados_parciais, false)
            OR coalesce(p.dados_parciais, false)
            AS dados_parciais
        FROM ${vendas} v
        FULL OUTER JOIN ${faturamento} f USING (data_referencia)
        FULL OUTER JOIN ${pagos} p USING (data_referencia)
      ), acumulado AS (
        SELECT
          *,
          sum(pedidos_validos) OVER (
            ORDER BY data_referencia RANGE BETWEEN INTERVAL 6 DAY PRECEDING AND CURRENT ROW
          ) AS pedidos_validos_7d,
          sum(valor_pedidos_validos) OVER (
            ORDER BY data_referencia RANGE BETWEEN INTERVAL 6 DAY PRECEDING AND CURRENT ROW
          ) AS valor_pedidos_validos_7d,
          sum(notas_emitidas) OVER (
            ORDER BY data_referencia RANGE BETWEEN INTERVAL 6 DAY PRECEDING AND CURRENT ROW
          ) AS notas_emitidas_7d,
          sum(faturamento_emitido) OVER (
            ORDER BY data_referencia RANGE BETWEEN INTERVAL 6 DAY PRECEDING AND CURRENT ROW
          ) AS faturamento_emitido_7d,
          sum(pedidos_validos) OVER (
            ORDER BY data_referencia RANGE BETWEEN INTERVAL 29 DAY PRECEDING AND CURRENT ROW
          ) AS pedidos_validos_30d,
          sum(valor_pedidos_validos) OVER (
            ORDER BY data_referencia RANGE BETWEEN INTERVAL 29 DAY PRECEDING AND CURRENT ROW
          ) AS valor_pedidos_validos_30d,
          sum(notas_emitidas) OVER (
            ORDER BY data_referencia RANGE BETWEEN INTERVAL 29 DAY PRECEDING AND CURRENT ROW
          ) AS notas_emitidas_30d,
          sum(faturamento_emitido) OVER (
            ORDER BY data_referencia RANGE BETWEEN INTERVAL 29 DAY PRECEDING AND CURRENT ROW
          ) AS faturamento_emitido_30d
        FROM base
      )
      SELECT
        atual.data_referencia,
        atual.pedidos_validos,
        atual.pedidos_cancelados,
        atual.pedidos_pendentes,
        atual.valor_pedidos_validos,
        atual.pedidos_pagos,
        atual.valor_pedidos_pagos,
        atual.ticket_medio_pedido,
        atual.taxa_cancelamento_pct,
        atual.taxa_emissao_pct,
        atual.notas_emitidas,
        atual.faturamento_emitido,
        atual.ticket_medio_faturado,
        atual.prazo_medio_emissao_dias,
        atual.pedidos_validos_7d,
        atual.valor_pedidos_validos_7d,
        atual.notas_emitidas_7d,
        atual.faturamento_emitido_7d,
        atual.pedidos_validos_30d,
        atual.valor_pedidos_validos_30d,
        atual.notas_emitidas_30d,
        atual.faturamento_emitido_30d,
        anterior.valor_pedidos_validos AS valor_pedidos_dia_anterior,
        CAST(
          100.0 * (atual.valor_pedidos_validos - anterior.valor_pedidos_validos) /
            nullif(anterior.valor_pedidos_validos, 0)
          AS DECIMAL(12,4)
        ) AS variacao_valor_pedidos_dia_pct,
        anterior.faturamento_emitido AS faturamento_dia_anterior,
        CAST(
          100.0 * (atual.faturamento_emitido - anterior.faturamento_emitido) /
            nullif(anterior.faturamento_emitido, 0)
          AS DECIMAL(12,4)
        ) AS variacao_faturamento_dia_pct,
        atual.dados_parciais,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM acumulado atual
      LEFT JOIN acumulado anterior
        ON anterior.data_referencia = atual.data_referencia - INTERVAL 1 DAY
      ORDER BY atual.data_referencia
    `;
  }
};
