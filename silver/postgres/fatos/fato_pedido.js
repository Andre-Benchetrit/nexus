const { citar } = require('../core/util');
const { documentoPedido } = require('../core/regras_venda');

module.exports = {
  nome: 'fato_pedido',
  tipo: 'fato',
  descricao: 'Uma linha por pedido comercial PD, ligada aos seus documentos fiscais.',
  versaoContrato: 1,
  preservaTotalEntrada: false,
  chavePrimaria: ['id_empresa', 'id_pedido_vda_importado'],
  fontePrincipal: 'nota_saida',
  fontesBronze: ['nota_saida'],
  fontesSilver: ['fato_venda'],
  colunas: [
    'id_empresa',
    'id_pedido_vda_importado',
    'id_nota_saida_pedido',
    'marketplace_pedido',
    'data_pedido',
    'id_cliente',
    'cliente',
    'cliente_razao_social',
    'cliente_fantasia',
    'cliente_cidade',
    'id_tp_pedido',
    'tipo_pedido',
    'codigo_tipo_pedido',
    'situacao',
    'id_nat_operacao',
    'id_plataforma',
    'plataforma',
    'id_transportadora',
    'id_regra_transporte',
    'transporte_regra',
    'transporte_regras',
    'entrega_uf',
    'entrega_data',
    'valor_pedido',
    'valor_frete_cobrado',
    'valor_frete_custo',
    'valor_frete_site',
    'pedido_recebido',
    'pedido_cancelado',
    'pedido_faturado',
    'pedido_devolvido',
    'pedido_com_nota_cancelada',
    'pedido_pendente',
    'pedido_valido',
    'conflito_status',
    'status_consolidado',
    'quantidade_documentos_fiscais',
    'quantidade_notas_validas',
    'quantidade_devolucoes',
    'numeros_notas_fiscais_validas',
    'primeira_data_emissao',
    'ultima_data_emissao',
    'faturamento_emitido',
    'valor_devolvido',
    'dt_cadastro',
    'dt_alteracao',
    'fonte_sistema',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_pedido_vda_importado', 'marketplace_pedido', 'data_pedido',
      'cliente', 'tipo_pedido', 'plataforma', 'transporte_regra',
      'valor_pedido', 'status_consolidado'
    ],
    colunasAgente: [
      'id_empresa', 'id_pedido_vda_importado', 'id_nota_saida_pedido',
      'marketplace_pedido', 'data_pedido', 'id_cliente', 'cliente',
      'cliente_razao_social', 'cliente_fantasia', 'cliente_cidade',
      'id_tp_pedido', 'tipo_pedido', 'codigo_tipo_pedido', 'id_nat_operacao',
      'situacao',
      'id_plataforma', 'plataforma', 'id_transportadora',
      'id_regra_transporte', 'transporte_regra', 'transporte_regras',
      'entrega_uf', 'entrega_data', 'valor_pedido',
      'valor_frete_cobrado', 'valor_frete_custo', 'valor_frete_site',
      'pedido_recebido', 'pedido_cancelado', 'pedido_faturado',
      'pedido_devolvido', 'pedido_com_nota_cancelada',
      'pedido_pendente', 'pedido_valido', 'conflito_status',
      'status_consolidado', 'quantidade_documentos_fiscais',
      'quantidade_notas_validas', 'quantidade_devolucoes',
      'numeros_notas_fiscais_validas',
      'primeira_data_emissao', 'ultima_data_emissao',
      'faturamento_emitido', 'valor_devolvido', 'dt_cadastro', 'dt_alteracao'
    ]
  },

  construirSql(_contextosBronze, contextosSilver) {
    const documentos = citar(contextosSilver.get('fato_venda').viewAtual);
    return `
      WITH documentos AS (
        SELECT
          *,
          regexp_replace(
            upper(trim(coalesce(marketplace_pedido, ''))),
            '_.*$',
            ''
          ) AS marketplace_pedido_base
        FROM ${documentos}
      ), fiscais AS (
        SELECT
          id_empresa,
          id_pedido_vda_importado,
          count(*) FILTER (
            WHERE upper(trim(coalesce(tipo_documento, ''))) = 'NF'
          ) AS quantidade_documentos_fiscais,
          count(*) FILTER (WHERE faturamento_valido) AS quantidade_notas_validas,
          count(*) FILTER (
            WHERE trim(coalesce(nfe_cstat, '')) = '101' OR nota_cancelada
          ) AS quantidade_notas_canceladas,
          string_agg(
            DISTINCT CAST(id_nr_nf AS VARCHAR),
            ' ' ORDER BY CAST(id_nr_nf AS VARCHAR)
          ) FILTER (
            WHERE faturamento_valido AND coalesce(id_nr_nf, 0) > 0
          ) AS numeros_notas_fiscais_validas,
          min(data_emissao) FILTER (WHERE faturamento_valido) AS primeira_data_emissao,
          max(data_emissao) FILTER (WHERE faturamento_valido) AS ultima_data_emissao,
          CAST(
            coalesce(sum(valor_total_venda) FILTER (WHERE faturamento_valido), 0)
            AS DECIMAL(18,2)
          ) AS faturamento_emitido
        FROM documentos
        WHERE id_pedido_vda_importado IS NOT NULL
        GROUP BY id_empresa, id_pedido_vda_importado
      ), base AS (
        SELECT
          p.*,
          coalesce(f.quantidade_documentos_fiscais, 0) AS quantidade_documentos_fiscais,
          coalesce(f.quantidade_notas_validas, 0) AS quantidade_notas_validas,
          coalesce(d.quantidade_devolucoes, 0) AS quantidade_devolucoes,
          coalesce(f.quantidade_notas_canceladas, 0) AS quantidade_notas_canceladas,
          f.numeros_notas_fiscais_validas,
          f.primeira_data_emissao,
          f.ultima_data_emissao,
          coalesce(f.faturamento_emitido, 0) AS faturamento_emitido,
          coalesce(d.valor_devolvido, 0) AS valor_devolvido,
          starts_with(upper(trim(coalesce(p.tipo_pedido, ''))), 'CANCEL')
            AS pedido_cancelado_origem,
          coalesce(f.quantidade_notas_validas, 0) > 0 AS pedido_faturado_origem
        FROM documentos p
        LEFT JOIN fiscais f
          ON f.id_empresa = p.id_empresa
          AND f.id_pedido_vda_importado = p.id_pedido_vda_importado
        LEFT JOIN LATERAL (
          SELECT
            count(DISTINCT dv.id_nota_saida) AS quantidade_devolucoes,
            CAST(coalesce(sum(dv.valor_total_venda), 0) AS DECIMAL(18,2))
              AS valor_devolvido
          FROM documentos dv
          WHERE dv.id_empresa = p.id_empresa
            AND upper(trim(coalesce(dv.tipo_documento, ''))) = 'DV'
            AND trim(coalesce(dv.nfe_cstat, '')) = '100'
            AND (
              dv.id_pedido_vda_importado = p.id_pedido_vda_importado
              OR (
                p.marketplace_pedido_base <> ''
                AND dv.marketplace_pedido_base = p.marketplace_pedido_base
              )
            )
        ) d ON true
        WHERE ${documentoPedido('p')}
      )
      SELECT
        id_empresa,
        id_pedido_vda_importado,
        id_nota_saida AS id_nota_saida_pedido,
        marketplace_pedido,
        data_pedido,
        id_cliente,
        cliente,
        cliente_razao_social,
        cliente_fantasia,
        cliente_cidade,
        id_tp_pedido,
        tipo_pedido,
        codigo_tipo_pedido,
        situacao,
        id_nat_operacao,
        id_plataforma,
        plataforma,
        id_transportadora,
        id_regra_transporte,
        transporte_regra,
        transporte_regras,
        entrega_uf,
        entrega_data,
        valor_total_venda AS valor_pedido,
        valor_frete_cobrado,
        valor_frete_custo,
        valor_frete_site,
        true AS pedido_recebido,
        pedido_cancelado_origem AS pedido_cancelado,
        pedido_faturado_origem AS pedido_faturado,
        (quantidade_devolucoes > 0) AS pedido_devolvido,
        (quantidade_notas_canceladas > 0) AS pedido_com_nota_cancelada,
        (NOT pedido_faturado_origem AND NOT pedido_cancelado_origem)
          AS pedido_pendente,
        NOT pedido_cancelado_origem AS pedido_valido,
        (
          pedido_faturado_origem
          AND pedido_cancelado_origem
          AND quantidade_devolucoes = 0
          AND quantidade_notas_canceladas = 0
        ) AS conflito_status,
        CASE
          WHEN pedido_faturado_origem AND quantidade_devolucoes > 0
            THEN 'DEVOLVIDO'
          WHEN quantidade_notas_canceladas > 0 AND pedido_cancelado_origem
            THEN 'CANCELADO_FISCAL'
          WHEN pedido_faturado_origem AND pedido_cancelado_origem
            THEN 'FATURADO_COM_STATUS_CANCELADO'
          WHEN pedido_faturado_origem THEN 'FATURADO'
          WHEN pedido_cancelado_origem THEN 'CANCELADO'
          ELSE 'PENDENTE'
        END AS status_consolidado,
        quantidade_documentos_fiscais,
        quantidade_notas_validas,
        quantidade_devolucoes,
        numeros_notas_fiscais_validas,
        primeira_data_emissao,
        ultima_data_emissao,
        faturamento_emitido,
        valor_devolvido,
        dt_cadastro,
        dt_alteracao,
        'silver.fato_venda' AS fonte_sistema,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM base
    `;
  },

  construirMetricasRelacionamentosSql(_contextosBronze, contextosSilver) {
    const documentos = citar(contextosSilver.get('fato_venda').viewAtual);
    return `
      SELECT
        count(*) FILTER (
          WHERE ${documentoPedido('p')} AND p.id_pedido_vda_importado IS NULL
        ) AS pedidos_sem_id_importado,
        count(*) FILTER (
          WHERE ${documentoPedido('p')} AND p.marketplace_pedido IS NULL
        ) AS pedidos_sem_numero_marketplace,
        count(*) FILTER (
          WHERE ${documentoPedido('p')}
            AND starts_with(upper(trim(coalesce(p.tipo_pedido, ''))), 'CANCEL')
            AND EXISTS (
              SELECT 1 FROM ${documentos} f
              WHERE f.id_empresa = p.id_empresa
                AND f.id_pedido_vda_importado = p.id_pedido_vda_importado
                AND f.faturamento_valido
            )
        ) AS pedidos_com_status_cancelado_e_nota_valida
      FROM ${documentos} p
    `;
  }
};
