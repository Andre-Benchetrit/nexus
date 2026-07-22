module.exports = {
  nome: 'kpi_faturamento_diario',
  tipo: 'indicador',
  descricao: 'Indicadores fiscais diarios pela data de emissao da nota.',
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
    'notas_emitidas',
    'clientes_faturados',
    'faturamento_emitido',
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
      'ticket_medio_faturado', 'prazo_medio_emissao_dias', 'dados_parciais'
    ],
    colunasAgente: [
      'data_referencia', 'ano', 'mes', 'dia_mes', 'dia_semana',
      'notas_emitidas', 'clientes_faturados', 'faturamento_emitido',
      'ticket_medio_faturado', 'notas_com_prazo_calculavel',
      'soma_prazo_emissao_dias', 'prazo_medio_emissao_dias', 'dados_parciais'
    ]
  },

  construirSql(contextosSilver) {
    const vendas = `"${contextosSilver.get('fato_venda').viewAtual}"`;
    return `
      WITH base AS (
        SELECT
          *,
          CASE
            WHEN data_pedido IS NOT NULL AND data_emissao >= data_pedido
              THEN date_diff('day', data_pedido, data_emissao)
            ELSE NULL
          END AS prazo_emissao_dias
        FROM ${vendas}
        WHERE faturamento_valido = true AND data_emissao IS NOT NULL
      ), limite AS (
        SELECT max(data_emissao) AS ultima_data FROM base
      )
      SELECT
        CAST(data_emissao AS DATE) AS data_referencia,
        CAST(extract(year FROM data_emissao) AS INTEGER) AS ano,
        CAST(extract(month FROM data_emissao) AS INTEGER) AS mes,
        CAST(extract(day FROM data_emissao) AS INTEGER) AS dia_mes,
        CAST(extract(isodow FROM data_emissao) AS INTEGER) AS dia_semana,
        count(*) AS notas_emitidas,
        count(DISTINCT id_cliente) AS clientes_faturados,
        CAST(coalesce(sum(valor_total_venda), 0) AS DECIMAL(18,2)) AS faturamento_emitido,
        CAST(coalesce(sum(valor_total_venda), 0) / nullif(count(*), 0) AS DECIMAL(18,2))
          AS ticket_medio_faturado,
        count(prazo_emissao_dias) AS notas_com_prazo_calculavel,
        coalesce(sum(prazo_emissao_dias), 0) AS soma_prazo_emissao_dias,
        CAST(avg(prazo_emissao_dias) AS DECIMAL(18,2)) AS prazo_medio_emissao_dias,
        bool_or(data_emissao = limite.ultima_data) AS dados_parciais,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM base
      CROSS JOIN limite
      GROUP BY data_emissao
      ORDER BY data_emissao
    `;
  },

  construirMetricasQualidadeSql(contextosSilver) {
    const vendas = `"${contextosSilver.get('fato_venda').viewAtual}"`;
    return `
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
    `;
  }
};
