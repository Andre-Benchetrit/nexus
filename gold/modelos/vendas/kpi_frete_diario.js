module.exports = {
  nome: 'kpi_frete_diario',
  tipo: 'indicador_dimensional',
  descricao: 'Valores diarios de frete por plataforma e regra de transporte.',
  versaoContrato: 1,
  chavePrimaria: [
    'data_referencia', 'id_empresa', 'id_plataforma', 'id_regra_transporte'
  ],
  fontesSilver: ['fato_pedido'],
  fontesGold: [],
  colunas: [
    'data_referencia',
    'id_empresa',
    'id_plataforma',
    'plataforma',
    'id_regra_transporte',
    'transporte_regra',
    'id_transportadora',
    'pedidos_validos',
    'pedidos_com_custo_frete',
    'pedidos_sem_custo_frete',
    'cobertura_custo_frete_pct',
    'frete_cobrado',
    'frete_custo',
    'frete_site',
    'resultado_frete',
    'frete_medio_cobrado',
    'frete_medio_custo',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'data_referencia', 'plataforma', 'transporte_regra',
      'pedidos_validos', 'frete_cobrado', 'frete_custo',
      'resultado_frete', 'cobertura_custo_frete_pct'
    ],
    colunasAgente: [
      'data_referencia', 'id_empresa', 'id_plataforma', 'plataforma',
      'id_regra_transporte', 'transporte_regra', 'id_transportadora',
      'pedidos_validos', 'frete_cobrado', 'frete_custo', 'frete_site',
      'pedidos_com_custo_frete', 'pedidos_sem_custo_frete',
      'cobertura_custo_frete_pct',
      'resultado_frete', 'frete_medio_cobrado', 'frete_medio_custo'
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
        coalesce(id_regra_transporte, 0) AS id_regra_transporte,
        any_value(transporte_regra) AS transporte_regra,
        any_value(id_transportadora) AS id_transportadora,
        count(*) FILTER (WHERE pedido_valido) AS pedidos_validos,
        count(*) FILTER (
          WHERE pedido_valido AND valor_frete_custo <> 0
        ) AS pedidos_com_custo_frete,
        count(*) FILTER (
          WHERE pedido_valido AND valor_frete_custo = 0
        ) AS pedidos_sem_custo_frete,
        CAST(
          100.0 * count(*) FILTER (
            WHERE pedido_valido AND valor_frete_custo <> 0
          ) / nullif(count(*) FILTER (WHERE pedido_valido), 0)
          AS DECIMAL(12,4)
        ) AS cobertura_custo_frete_pct,
        CAST(
          coalesce(sum(valor_frete_cobrado) FILTER (WHERE pedido_valido), 0)
          AS DECIMAL(18,2)
        ) AS frete_cobrado,
        CAST(
          coalesce(sum(valor_frete_custo) FILTER (WHERE pedido_valido), 0)
          AS DECIMAL(18,2)
        ) AS frete_custo,
        CAST(
          coalesce(sum(valor_frete_site) FILTER (WHERE pedido_valido), 0)
          AS DECIMAL(18,2)
        ) AS frete_site,
        CASE
          WHEN count(*) FILTER (
            WHERE pedido_valido AND valor_frete_custo <> 0
          ) = count(*) FILTER (WHERE pedido_valido)
          THEN CAST(
            sum(valor_frete_cobrado - valor_frete_custo)
              FILTER (WHERE pedido_valido)
            AS DECIMAL(18,2)
          )
          ELSE NULL
        END AS resultado_frete,
        CAST(
          coalesce(sum(valor_frete_cobrado) FILTER (WHERE pedido_valido), 0) /
            nullif(count(*) FILTER (WHERE pedido_valido), 0)
          AS DECIMAL(18,2)
        ) AS frete_medio_cobrado,
        CASE
          WHEN count(*) FILTER (
            WHERE pedido_valido AND valor_frete_custo <> 0
          ) = count(*) FILTER (WHERE pedido_valido)
          THEN CAST(
            sum(valor_frete_custo) FILTER (WHERE pedido_valido) /
              nullif(count(*) FILTER (WHERE pedido_valido), 0)
            AS DECIMAL(18,2)
          )
          ELSE NULL
        END AS frete_medio_custo,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM ${pedidos}
      WHERE data_pedido IS NOT NULL
      GROUP BY
        data_pedido,
        coalesce(id_empresa, 0),
        coalesce(id_plataforma, 0),
        coalesce(id_regra_transporte, 0)
      ORDER BY data_pedido, id_empresa, id_plataforma, id_regra_transporte
    `;
  }
};
