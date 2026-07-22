const { citar } = require('../core/util');

module.exports = {
  nome: 'fato_venda_item',
  tipo: 'fato',
  descricao: 'Itens de venda enriquecidos com pedido e classificacao do produto.',
  versaoContrato: 1,
  chavePrimaria: ['id_nota_saida', 'item'],
  fontePrincipal: 'nota_saida_itens',
  fontesBronze: ['nota_saida_itens'],
  fontesSilver: ['fato_venda', 'dim_produto'],
  colunas: [
    'id_nota_saida',
    'item',
    'id_produto',
    'descricao_produto',
    'sku',
    'ean',
    'id_grupo',
    'grupo',
    'id_subgrupo',
    'subgrupo',
    'id_marca',
    'marca',
    'id_categoria',
    'categoria',
    'id_cliente',
    'cliente',
    'cliente_razao_social',
    'cliente_fantasia',
    'cliente_cidade',
    'id_empresa',
    'id_tp_pedido',
    'id_nat_operacao',
    'tipo_documento',
    'tipo_pedido',
    'codigo_tipo_pedido',
    'id_plataforma',
    'plataforma',
    'id_transportadora',
    'transporte_regras',
    'ids_transporte_regras',
    'quantidade_regras_transporte',
    'id_nr_nf',
    'serie',
    'data_pedido',
    'data_emissao',
    'situacao',
    'marketplace_pedido',
    'item_marketplace',
    'entrega_uf',
    'quantidade',
    'quantidade_faturada',
    'quantidade_devolvida',
    'valor_bruto_unitario',
    'valor_desconto_unitario',
    'desconto_total_item',
    'desconto_total_rateado_item',
    'valor_liquido_unitario',
    'valor_total_item',
    'frete_item',
    'seguro_item',
    'outros_valores_item',
    'acrescimo_item',
    'valor_financeiro_item',
    'custo_produto_unitario',
    'custo_total_item',
    'comissao_item',
    'comissao_marketplace_item',
    'movimenta_estoque',
    'gera_financeiro',
    'nota_emitida',
    'nota_cancelada',
    'nfe_cstat',
    'faturamento_valido',
    'pedido_pago',
    'valor_pedido_pago_item',
    'dthr_atualizacao_item',
    'fonte_sistema',
    'processado_em'
  ],
  consulta: {
    // Habilitada apos o backfill validar as ligacoes com notas e produtos.
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_nota_saida',
      'item',
      'data_pedido',
      'id_produto',
      'descricao_produto',
      'grupo',
      'quantidade',
      'valor_total_item'
    ],
    colunasAgente: [
      'id_nota_saida',
      'item',
      'id_produto',
      'descricao_produto',
      'sku',
      'ean',
      'id_grupo',
      'grupo',
      'id_subgrupo',
      'subgrupo',
      'id_marca',
      'marca',
      'id_categoria',
      'categoria',
      'id_cliente',
      'cliente',
      'cliente_razao_social',
      'cliente_fantasia',
      'cliente_cidade',
      'id_empresa',
      'id_tp_pedido',
      'id_nat_operacao',
      'tipo_documento',
      'tipo_pedido',
      'codigo_tipo_pedido',
      'id_plataforma',
      'plataforma',
      'id_transportadora',
      'transporte_regras',
      'ids_transporte_regras',
      'quantidade_regras_transporte',
      'id_nr_nf',
      'serie',
      'data_pedido',
      'data_emissao',
      'situacao',
      'marketplace_pedido',
      'item_marketplace',
      'entrega_uf',
      'quantidade',
      'quantidade_faturada',
      'quantidade_devolvida',
      'valor_bruto_unitario',
      'valor_desconto_unitario',
      'desconto_total_item',
      'desconto_total_rateado_item',
      'valor_liquido_unitario',
      'valor_total_item',
      'frete_item',
      'seguro_item',
      'outros_valores_item',
      'acrescimo_item',
      'valor_financeiro_item',
      'nota_emitida', 'nota_cancelada', 'nfe_cstat', 'faturamento_valido',
      'pedido_pago', 'valor_pedido_pago_item'
    ]
  },

  construirSql(contextosBronze, contextosSilver) {
    const itens = citar(contextosBronze.get('nota_saida_itens').viewAtual);
    const vendas = citar(contextosSilver.get('fato_venda').viewAtual);
    const produtos = citar(contextosSilver.get('dim_produto').viewAtual);
    return `
      SELECT
        i.id_nota_saida,
        i.item,
        i.id_produto,
        p.descricao_produto,
        p.sku,
        p.ean,
        p.id_grupo,
        p.grupo,
        p.id_subgrupo,
        p.subgrupo,
        p.id_marca,
        p.marca,
        p.id_categoria,
        p.categoria,
        coalesce(v.id_cliente, i.id_cliente) AS id_cliente,
        v.cliente,
        v.cliente_razao_social,
        v.cliente_fantasia,
        v.cliente_cidade,
        coalesce(v.id_empresa, i.id_empresa) AS id_empresa,
        coalesce(v.id_tp_pedido, i.id_tp_pedido) AS id_tp_pedido,
        v.id_nat_operacao,
        v.tipo_documento,
        v.tipo_pedido,
        v.codigo_tipo_pedido,
        v.id_plataforma,
        v.plataforma,
        v.id_transportadora,
        v.transporte_regras,
        v.ids_transporte_regras,
        v.quantidade_regras_transporte,
        coalesce(v.id_nr_nf, i.id_nr_nf) AS id_nr_nf,
        coalesce(v.serie, nullif(trim(i.serie), '')) AS serie,
        v.data_pedido,
        coalesce(v.data_emissao, i.data_emissao) AS data_emissao,
        v.situacao,
        v.marketplace_pedido,
        i.item_marketplace,
        v.entrega_uf,
        i.qtde AS quantidade,
        i.qtde_faturada AS quantidade_faturada,
        i.qtde_devolvida AS quantidade_devolvida,
        i.valor_bruto AS valor_bruto_unitario,
        i.valor_desconto AS valor_desconto_unitario,
        i.desconto_total_item,
        i.vr_desconto_total AS desconto_total_rateado_item,
        i.valor_liquido AS valor_liquido_unitario,
        CAST(
          coalesce(i.valor_total_liquido, i.valor_liquido * i.qtde)
          AS DECIMAL(18,2)
        ) AS valor_total_item,
        i.vr_frete AS frete_item,
        i.vr_seguro AS seguro_item,
        i.vr_outros AS outros_valores_item,
        i.vr_acrescimo AS acrescimo_item,
        i.vr_financeiro AS valor_financeiro_item,
        i.custo_produto AS custo_produto_unitario,
        CAST(i.custo_produto * i.qtde AS DECIMAL(18,2)) AS custo_total_item,
        i.comissao AS comissao_item,
        i.valor_comissao_ml AS comissao_marketplace_item,
        CASE upper(trim(i.movimenta_estoque))
          WHEN 'T' THEN true WHEN 'F' THEN false ELSE NULL
        END AS movimenta_estoque,
        CASE upper(trim(i.gera_financeiro))
          WHEN 'T' THEN true WHEN 'F' THEN false ELSE NULL
        END AS gera_financeiro,
        coalesce(
          v.nota_emitida,
          coalesce(i.id_nr_nf, 0) > 0 AND i.data_emissao IS NOT NULL
        ) AS nota_emitida,
        v.nota_cancelada,
        v.nfe_cstat,
        v.faturamento_valido,
        (
          upper(trim(coalesce(v.tipo_documento, ''))) = 'PD'
          AND v.id_tp_pedido IN (1, 3)
          AND v.id_nat_operacao IN (1, 2, 3, 19)
          AND NOT starts_with(upper(trim(coalesce(v.tipo_pedido, ''))), 'CANCELADO')
          AND NOT contains(trim(coalesce(v.marketplace_pedido, '')), '_')
        ) AS pedido_pago,
        CAST(
          (i.qtde * i.valor_bruto)
          + coalesce(i.vr_frete, 0)
          + coalesce(i.vr_acrescimo, 0)
          + coalesce(i.vr_outros, 0)
          - coalesce(i.vr_desconto_total, 0)
          - coalesce(i.desconto_total_item, 0)
          AS DECIMAL(18,2)
        ) AS valor_pedido_pago_item,
        i.dthr_atualizacao AS dthr_atualizacao_item,
        'postgres.sysemp.nota_saida_itens' AS fonte_sistema,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM ${itens} i
      LEFT JOIN ${vendas} v ON v.id_nota_saida = i.id_nota_saida
      LEFT JOIN ${produtos} p ON p.id_produto = i.id_produto
    `;
  },

  construirMetricasRelacionamentosSql(contextosBronze, contextosSilver) {
    const itens = citar(contextosBronze.get('nota_saida_itens').viewAtual);
    const vendas = citar(contextosSilver.get('fato_venda').viewAtual);
    const produtos = citar(contextosSilver.get('dim_produto').viewAtual);
    return `
      SELECT
        count(*) FILTER (WHERE v.id_nota_saida IS NULL) AS itens_sem_venda_correspondente,
        count(*) FILTER (WHERE p.id_produto IS NULL) AS itens_sem_produto_correspondente,
        count(*) FILTER (WHERE v.data_pedido IS NULL) AS itens_sem_data_pedido,
        min(i.dthr_atualizacao) AS cobertura_inicio,
        max(i.dthr_atualizacao) AS cobertura_fim
      FROM ${itens} i
      LEFT JOIN ${vendas} v ON v.id_nota_saida = i.id_nota_saida
      LEFT JOIN ${produtos} p ON p.id_produto = i.id_produto
    `;
  }
};
