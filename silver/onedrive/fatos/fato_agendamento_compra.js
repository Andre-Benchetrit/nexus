const { citar } = require('../../postgres/core/util');

module.exports = {
  nome: 'fato_agendamento_compra',
  tipo: 'fato',
  descricao:
    'Parcelas de compras agendadas e seus sinais logísticos, sem alterar o estoque oficial.',
  versaoContrato: 3,
  chavePrimaria: 'id_agendamento_compra',
  fontePrincipal: 'agendamento_compra',
  fontesBronze: ['agendamento_compra'],
  fontesSilver: ['dim_produto'],
  preservaTotalEntrada: false,
  colunas: [
    'id_agendamento_compra',
    'id_linha_agendamento_origem',
    'numero_pedido_compra',
    'fornecedor',
    'fornecedor_anotacao',
    'marcacao_nao_recebido',
    'data_prevista',
    'data_entrada_original',
    'data_entrada',
    'data_entrada_corrigida_dia_mes',
    'dias_atraso_recebimento',
    'id_produto_planilha',
    'id_produto',
    'sku',
    'descricao_produto',
    'id_marca',
    'marca',
    'id_grupo',
    'grupo',
    'codigo_fabrica',
    'relacionamento_produto',
    'quantidade_pedida',
    'quantidade_recebida',
    'quantidade_pendente',
    'custo_unitario',
    'valor_total',
    'numero_nf_entrada',
    'afericao_quantidade',
    'total_sysemp',
    'status_entrega_anotacao',
    'status_logistico',
    'tem_evidencia_recebimento',
    'recebimento_completo',
    'recebimento_parcial',
    'recebido_com_atraso',
    'marcacao_manual_divergente',
    'entrega_prevista_futura',
    'entrega_atrasada',
    'afeta_estoque_oficial',
    'data_referencia_fonte',
    'janela_historico_meses',
    'fonte_sistema',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'numero_pedido_compra',
      'fornecedor',
      'data_prevista',
      'data_entrada_original',
      'data_entrada',
      'data_entrada_corrigida_dia_mes',
      'id_produto',
      'sku',
      'descricao_produto',
      'marca',
      'grupo',
      'quantidade_pedida',
      'quantidade_recebida',
      'quantidade_pendente',
      'numero_nf_entrada',
      'status_logistico'
    ],
    colunasAgente: [
      'id_agendamento_compra',
      'numero_pedido_compra',
      'fornecedor',
      'data_prevista',
      'data_entrada_original',
      'data_entrada',
      'data_entrada_corrigida_dia_mes',
      'dias_atraso_recebimento',
      'id_produto',
      'sku',
      'descricao_produto',
      'id_marca',
      'marca',
      'id_grupo',
      'grupo',
      'codigo_fabrica',
      'relacionamento_produto',
      'quantidade_pedida',
      'quantidade_recebida',
      'quantidade_pendente',
      'custo_unitario',
      'valor_total',
      'numero_nf_entrada',
      'status_logistico',
      'tem_evidencia_recebimento',
      'recebimento_completo',
      'recebimento_parcial',
      'recebido_com_atraso',
      'marcacao_manual_divergente',
      'entrega_prevista_futura',
      'entrega_atrasada',
      'data_referencia_fonte'
    ]
  },

  construirSql(contextosBronze, contextosSilver) {
    const agendamentos = citar(contextosBronze.get('agendamento_compra').viewAtual);
    const produtos = citar(contextosSilver.get('dim_produto').viewAtual);

    return `
      WITH referencia AS (
        SELECT max(dt_extracao) AS data_referencia
        FROM ${agendamentos}
      ), produtos_sku AS (
        SELECT *
        FROM ${produtos}
        WHERE nullif(trim(sku), '') IS NOT NULL
        QUALIFY row_number() OVER (
          PARTITION BY upper(trim(sku))
          ORDER BY id_produto
        ) = 1
      ), tipada AS (
        SELECT
          concat_ws(
            '|',
            coalesce(nullif(trim(a.conexao_origem), ''), 'onedrive'),
            coalesce(nullif(trim(a.item_id_origem), ''), 'item_desconhecido'),
            coalesce(nullif(trim(a.planilha_origem), ''), 'planilha_desconhecida'),
            trim(a.linha_origem)
          ) AS id_agendamento_compra,
          try_cast(a.id_linha_agendamento AS BIGINT) AS id_linha_agendamento_origem,
          nullif(trim(a.numero_pedido_compra), '') AS numero_pedido_compra,
          nullif(trim(a.fornecedor_anotacao), '') AS fornecedor_anotacao,
          regexp_matches(
            upper(coalesce(a.fornecedor_anotacao, '')),
            '/[[:space:]]*N.*RECEB'
          ) AS marcacao_nao_recebido,
          try_cast(a.data_prevista AS TIMESTAMP)::DATE AS data_prevista,
          coalesce(
            try_strptime(nullif(trim(a.data_entrada), ''), '%d/%m/%Y')::DATE,
            try_cast(a.data_entrada AS TIMESTAMP)::DATE
          ) AS data_entrada_original,
          try_cast(a.id_produto_planilha AS BIGINT) AS id_produto_planilha,
          nullif(trim(a.sku_planilha), '') AS sku_planilha,
          nullif(trim(a.descricao_planilha), '') AS descricao_planilha,
          nullif(trim(a.codigo_fabrica), '') AS codigo_fabrica,
          coalesce(try_cast(a.quantidade_pedida AS DECIMAL(18,4)), 0)
            AS quantidade_pedida,
          coalesce(try_cast(a.quantidade_recebida AS DECIMAL(18,4)), 0)
            AS quantidade_recebida,
          try_cast(a.custo_unitario AS DECIMAL(18,4)) AS custo_unitario,
          try_cast(a.valor_total AS DECIMAL(18,2)) AS valor_total,
          nullif(trim(a.numero_nf_entrada), '') AS numero_nf_entrada,
          nullif(trim(a.afericao_quantidade), '') AS afericao_quantidade,
          try_cast(a.total_sysemp AS DECIMAL(18,2)) AS total_sysemp,
          nullif(trim(a.status_entrega_anotacao), '') AS status_entrega_anotacao,
          r.data_referencia AS data_referencia_fonte
        FROM ${agendamentos} a
        CROSS JOIN referencia r
        WHERE try_cast(a.data_prevista AS TIMESTAMP)::DATE
          >= r.data_referencia - INTERVAL 5 MONTH
      ), datas_candidatas AS (
        SELECT
          *,
          try_cast(concat(
            year(data_entrada_original),
            '-',
            lpad(CAST(day(data_entrada_original) AS VARCHAR), 2, '0'),
            '-',
            lpad(CAST(month(data_entrada_original) AS VARCHAR), 2, '0')
          ) AS DATE) AS data_entrada_dia_mes_invertidos
        FROM tipada
      ), datas_normalizadas AS (
        SELECT
          * EXCLUDE (data_entrada_dia_mes_invertidos),
          CASE
            WHEN data_entrada_original > data_referencia_fonte::DATE
              AND data_entrada_dia_mes_invertidos <= data_referencia_fonte::DATE
              THEN data_entrada_dia_mes_invertidos
            ELSE data_entrada_original
          END AS data_entrada,
          (
            data_entrada_original > data_referencia_fonte::DATE
            AND data_entrada_dia_mes_invertidos <= data_referencia_fonte::DATE
          ) AS data_entrada_corrigida_dia_mes
        FROM datas_candidatas
      ), enriquecida AS (
        SELECT
          t.*,
          coalesce(p_id.id_produto, p_sku.id_produto) AS id_produto,
          coalesce(p_id.sku, p_sku.sku, t.sku_planilha) AS sku,
          coalesce(
            p_id.descricao_produto,
            p_sku.descricao_produto,
            t.descricao_planilha
          ) AS descricao_produto,
          coalesce(p_id.id_marca, p_sku.id_marca) AS id_marca,
          coalesce(p_id.marca, p_sku.marca) AS marca,
          coalesce(p_id.id_grupo, p_sku.id_grupo) AS id_grupo,
          coalesce(p_id.grupo, p_sku.grupo) AS grupo,
          CASE
            WHEN p_id.id_produto IS NOT NULL THEN 'ID_PRODUTO'
            WHEN p_sku.id_produto IS NOT NULL THEN 'SKU'
            ELSE 'NAO_ENCONTRADO'
          END AS relacionamento_produto,
          (
            t.numero_nf_entrada IS NOT NULL
            AND t.data_entrada IS NOT NULL
            AND t.quantidade_recebida > 0
          ) AS tem_evidencia_recebimento
        FROM datas_normalizadas t
        LEFT JOIN ${produtos} p_id
          ON p_id.id_produto = t.id_produto_planilha
        LEFT JOIN produtos_sku p_sku
          ON p_id.id_produto IS NULL
          AND t.sku_planilha NOT IN ('0', '#N/D')
          AND upper(trim(p_sku.sku)) = upper(trim(t.sku_planilha))
      ), classificada AS (
        SELECT
          *,
          tem_evidencia_recebimento
            AND quantidade_recebida >= quantidade_pedida
            AND quantidade_pedida > 0 AS recebimento_completo,
          tem_evidencia_recebimento
            AND quantidade_recebida < quantidade_pedida
            AS recebimento_parcial
        FROM enriquecida
      )
      SELECT
        id_agendamento_compra,
        id_linha_agendamento_origem,
        numero_pedido_compra,
        nullif(trim(regexp_replace(
          fornecedor_anotacao,
          '[[:space:]]*/[[:space:]]*N.*RECEB.*$',
          '',
          'i'
        )), '') AS fornecedor,
        fornecedor_anotacao,
        marcacao_nao_recebido,
        data_prevista,
        data_entrada_original,
        data_entrada,
        data_entrada_corrigida_dia_mes,
        CASE
          WHEN tem_evidencia_recebimento AND data_entrada > data_prevista
            THEN date_diff('day', data_prevista, data_entrada)
          ELSE 0
        END AS dias_atraso_recebimento,
        id_produto_planilha,
        id_produto,
        sku,
        descricao_produto,
        id_marca,
        marca,
        id_grupo,
        grupo,
        codigo_fabrica,
        relacionamento_produto,
        quantidade_pedida,
        quantidade_recebida,
        CAST(greatest(quantidade_pedida - quantidade_recebida, 0) AS DECIMAL(18,4))
          AS quantidade_pendente,
        custo_unitario,
        valor_total,
        numero_nf_entrada,
        afericao_quantidade,
        total_sysemp,
        status_entrega_anotacao,
        CASE
          WHEN recebimento_completo THEN 'RECEBIDO'
          WHEN recebimento_parcial THEN 'RECEBIDO_PARCIAL'
          WHEN marcacao_nao_recebido THEN 'NAO_RECEBIDO'
          WHEN data_prevista < data_referencia_fonte THEN 'ATRASADO'
          ELSE 'PREVISTO'
        END AS status_logistico,
        tem_evidencia_recebimento,
        recebimento_completo,
        recebimento_parcial,
        tem_evidencia_recebimento AND data_entrada > data_prevista
          AS recebido_com_atraso,
        marcacao_nao_recebido AND tem_evidencia_recebimento
          AS marcacao_manual_divergente,
        NOT tem_evidencia_recebimento AND data_prevista >= data_referencia_fonte
          AS entrega_prevista_futura,
        NOT tem_evidencia_recebimento AND data_prevista < data_referencia_fonte
          AS entrega_atrasada,
        false AS afeta_estoque_oficial,
        data_referencia_fonte,
        5 AS janela_historico_meses,
        'onedrive.BASE_AGENDAMENTO.xlsx/BASE' AS fonte_sistema,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM classificada
    `;
  },

  construirMetricasRelacionamentosSql(contextosBronze, contextosSilver) {
    const agendamentos = citar(contextosBronze.get('agendamento_compra').viewAtual);
    const produtos = citar(contextosSilver.get('dim_produto').viewAtual);
    return `
      WITH referencia AS (
        SELECT max(dt_extracao) AS data_referencia FROM ${agendamentos}
      ), recentes AS (
        SELECT *
        FROM ${agendamentos} a
        CROSS JOIN referencia r
        WHERE try_cast(a.data_prevista AS TIMESTAMP)::DATE
          >= r.data_referencia - INTERVAL 5 MONTH
      )
      SELECT
        count(*) AS linhas_recentes,
        count(*) FILTER (
          WHERE try_cast(a.id_produto_planilha AS BIGINT) IS NOT NULL
            AND p.id_produto IS NULL
        ) AS ids_produto_sem_correspondencia,
        count(*) FILTER (
          WHERE nullif(trim(a.numero_nf_entrada), '') IS NOT NULL
            AND nullif(trim(a.data_entrada), '') IS NOT NULL
            AND coalesce(try_cast(a.quantidade_recebida AS DECIMAL(18,4)), 0) > 0
        ) AS linhas_com_evidencia_recebimento
      FROM recentes a
      LEFT JOIN ${produtos} p
        ON p.id_produto = try_cast(a.id_produto_planilha AS BIGINT)
    `;
  }
};
