const { citar, texto } = require('../core/util');
const { devolucaoFaturamento, faturamentoValido } = require('../core/regras_venda');

function obterViews(contextosBronze, contextosSilver) {
  return {
    notas: citar(contextosBronze.get('nota_saida').viewAtual),
    clientes: citar(contextosSilver.get('dim_cliente').viewAtual),
    tiposPedido: citar(contextosSilver.get('dim_tipo_pedido').viewAtual),
    regrasTransporte: citar(contextosSilver.get('dim_transporte_regra').viewAtual),
    plataformas: citar(contextosSilver.get('dim_plataforma_ecommerce').viewAtual)
  };
}

module.exports = {
  nome: 'fato_venda',
  tipo: 'fato',
  descricao: 'Pedidos e notas de saida no nivel do cabecalho, enriquecidos com cadastros.',
  versaoContrato: 1,
  chavePrimaria: 'id_nota_saida',
  fontePrincipal: 'nota_saida',
  fontesBronze: ['nota_saida'],
  fontesSilver: [
    'dim_cliente',
    'dim_tipo_pedido',
    'dim_transporte_regra',
    'dim_plataforma_ecommerce'
  ],
  colunas: [
    'id_nota_saida',
    'id_pedido_vda_importado',
    'id_nota_saida_original',
    'id_nr_nf',
    'serie',
    'id_empresa',
    'id_cliente',
    'cliente',
    'cliente_razao_social',
    'cliente_fantasia',
    'cliente_cidade',
    'cliente_ativo',
    'id_tp_pedido',
    'id_nat_operacao',
    'tipo_documento',
    'tipo_pedido',
    'codigo_tipo_pedido',
    'permite_faturamento',
    'tipo_pedido_bloqueado',
    'id_transportadora',
    'id_regra_transporte',
    'transporte_regra',
    'transporte_regras',
    'ids_transporte_regras',
    'quantidade_regras_transporte',
    'id_plataforma',
    'plataforma',
    'plataforma_descricao',
    'canal_venda',
    'plataforma_ativa',
    'data_pedido',
    'data_emissao',
    'situacao',
    'marketplace_pedido',
    'entrega_uf',
    'entrega_data',
    'dt_limite_expedicao',
    'pedido_bloqueado',
    'valor_total_venda',
    'valor_total_liquido_venda',
    'valor_frete_cobrado',
    'valor_frete_custo',
    'valor_frete_site',
    'nota_emitida',
    'nota_cancelada',
    'nfe_cstat',
    'faturamento_valido',
    'devolucao_faturamento',
    'dt_cadastro',
    'dt_alteracao',
    'fonte_sistema',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_nota_saida', 'data_pedido', 'cliente', 'tipo_pedido',
      'plataforma', 'transporte_regras', 'valor_total_venda'
    ],
    colunasAgente: [
      'id_nota_saida', 'id_pedido_vda_importado', 'id_nr_nf', 'serie',
      'id_nota_saida_original',
      'id_empresa', 'id_cliente',
      'cliente', 'cliente_razao_social', 'cliente_fantasia', 'cliente_cidade',
      'cliente_ativo', 'id_tp_pedido', 'id_nat_operacao', 'tipo_documento',
      'tipo_pedido', 'codigo_tipo_pedido',
      'permite_faturamento', 'tipo_pedido_bloqueado', 'id_transportadora',
      'id_regra_transporte', 'transporte_regra',
      'transporte_regras', 'ids_transporte_regras', 'quantidade_regras_transporte',
      'id_plataforma', 'plataforma', 'plataforma_descricao', 'plataforma_ativa',
      'data_pedido', 'data_emissao', 'situacao', 'marketplace_pedido',
      'entrega_uf', 'entrega_data', 'dt_limite_expedicao', 'pedido_bloqueado',
      'canal_venda', 'valor_total_venda',
      'valor_total_liquido_venda',
      'valor_frete_cobrado', 'valor_frete_custo', 'valor_frete_site',
      'nota_emitida', 'nota_cancelada',
      'nfe_cstat', 'faturamento_valido', 'devolucao_faturamento', 'dt_cadastro',
      'dt_alteracao'
    ]
  },

  construirSql(contextosBronze, contextosSilver) {
    const views = obterViews(contextosBronze, contextosSilver);
    return `
      WITH regras_por_transportadora AS (
        SELECT
          id_transportadora,
          string_agg(DISTINCT transporte_regra, ' | ' ORDER BY transporte_regra)
            AS transporte_regras,
          string_agg(CAST(id_transporte AS VARCHAR), ',' ORDER BY id_transporte)
            AS ids_transporte_regras,
          count(*) AS quantidade_regras
        FROM ${views.regrasTransporte}
        WHERE id_transportadora > 0
        GROUP BY id_transportadora
      )
      SELECT
        n.id_nota_saida,
        n.id_pedido_vda_importado,
        n.id_nota_saida_original,
        n.id_nr_nf,
        ${texto('n.serie')} AS serie,
        n.id_empresa,
        n.id_cliente,
        c.cliente,
        c.cliente_razao_social,
        c.cliente_fantasia,
        c.cliente_cidade,
        c.cliente_ativo,
        n.id_tp_pedido,
        n.id_nat_operacao,
        ${texto('n.tipo_documento')} AS tipo_documento,
        tp.tipo_pedido,
        tp.codigo_tipo_pedido,
        tp.permite_faturamento,
        tp.tipo_pedido_bloqueado,
        n.id_transportadora,
        n.id_regra_transporte,
        trd.transporte_regra,
        tr.transporte_regras,
        tr.ids_transporte_regras,
        tr.quantidade_regras AS quantidade_regras_transporte,
        n.id_plataforma,
        p.plataforma,
        p.plataforma_descricao,
        coalesce(p.plataforma_descricao, p.plataforma) AS canal_venda,
        p.plataforma_ativa,
        n.data_pedido,
        n.data_emissao,
        ${texto('n.situacao')} AS situacao,
        ${texto('n.marketplace_pedido')} AS marketplace_pedido,
        ${texto('n.entrega_uf')} AS entrega_uf,
        n.entrega_data,
        n.entrega_limite AS dt_limite_expedicao,
        upper(trim(coalesce(n.bloqueada, 'F'))) = 'T' AS pedido_bloqueado,
        CAST(n.total_nota_fiscal AS DECIMAL(18,2)) AS valor_total_venda,
        CAST(
          coalesce(n.total_nota_fiscal_liq, n.total_nota_fiscal, 0)
          AS DECIMAL(18,2)
        ) AS valor_total_liquido_venda,
        CAST(coalesce(n.valor_frete, 0) AS DECIMAL(18,2)) AS valor_frete_cobrado,
        CAST(coalesce(n.valor_frete_custo, 0) AS DECIMAL(18,2)) AS valor_frete_custo,
        CAST(coalesce(n.valor_frete_site, 0) AS DECIMAL(18,2)) AS valor_frete_site,
        (coalesce(n.id_nr_nf, 0) > 0 AND n.data_emissao IS NOT NULL) AS nota_emitida,
        (
          upper(trim(coalesce(n.nf_cancelada, 'F'))) = 'T'
          OR trim(coalesce(n.nfe_cstat, '')) = '101'
        ) AS nota_cancelada,
        ${texto('n.nfe_cstat')} AS nfe_cstat,
        ${faturamentoValido('n', 'tp')} AS faturamento_valido,
        ${devolucaoFaturamento('n')} AS devolucao_faturamento,
        n.dt_cadastro,
        n.dt_alteracao,
        'postgres.sysemp.nota_saida' AS fonte_sistema,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM ${views.notas} n
      LEFT JOIN ${views.clientes} c ON c.id_cliente = n.id_cliente
      LEFT JOIN ${views.tiposPedido} tp ON tp.id_tp_pedido = n.id_tp_pedido
      LEFT JOIN regras_por_transportadora tr
        ON tr.id_transportadora = n.id_transportadora
      LEFT JOIN ${views.regrasTransporte} trd
        ON trd.id_transporte = n.id_regra_transporte
      LEFT JOIN ${views.plataformas} p ON p.id_plataforma = n.id_plataforma
    `;
  },

  construirMetricasRelacionamentosSql(contextosBronze, contextosSilver) {
    const views = obterViews(contextosBronze, contextosSilver);
    return `
      WITH regras_por_transportadora AS (
        SELECT DISTINCT id_transportadora
        FROM ${views.regrasTransporte}
        WHERE id_transportadora > 0
      )
      SELECT
        count(*) FILTER (
          WHERE n.id_cliente > 0 AND c.id_cliente IS NULL
        ) AS vendas_sem_cliente_correspondente,
        count(*) FILTER (
          WHERE coalesce(n.id_cliente, 0) <= 0
        ) AS vendas_sem_cliente_informado,
        count(*) FILTER (
          WHERE n.id_tp_pedido > 0 AND tp.id_tp_pedido IS NULL
        ) AS vendas_sem_tipo_pedido_correspondente,
        count(*) FILTER (
          WHERE coalesce(n.id_tp_pedido, 0) <= 0
        ) AS vendas_sem_tipo_pedido_informado,
        count(*) FILTER (
          WHERE n.id_transportadora > 0 AND tr.id_transportadora IS NULL
        ) AS vendas_sem_regra_transporte_correspondente,
        count(*) FILTER (
          WHERE coalesce(n.id_transportadora, 0) <= 0
        ) AS vendas_sem_transportadora_informada,
        count(*) FILTER (
          WHERE n.id_plataforma > 0 AND p.id_plataforma IS NULL
        ) AS vendas_sem_plataforma_correspondente,
        count(*) FILTER (
          WHERE coalesce(n.id_plataforma, 0) <= 0
        ) AS vendas_sem_plataforma_informada
      FROM ${views.notas} n
      LEFT JOIN ${views.clientes} c ON c.id_cliente = n.id_cliente
      LEFT JOIN ${views.tiposPedido} tp ON tp.id_tp_pedido = n.id_tp_pedido
      LEFT JOIN regras_por_transportadora tr
        ON tr.id_transportadora = n.id_transportadora
      LEFT JOIN ${views.plataformas} p ON p.id_plataforma = n.id_plataforma
    `;
  }
};
