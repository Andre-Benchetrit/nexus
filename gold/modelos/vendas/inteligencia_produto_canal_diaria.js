module.exports = {
  nome: 'inteligencia_produto_canal_diaria',
  tipo: 'indicador_dimensional',
  descricao: 'Pedidos e faturamento diarios, mantidos separados, por produto e plataforma.',
  versaoContrato: 1,
  chavePrimaria: [
    'data_referencia', 'id_empresa', 'id_produto', 'id_plataforma'
  ],
  fontesSilver: ['fato_pedido_item', 'fato_nota_fiscal_item'],
  fontesGold: [],
  colunas: [
    'data_referencia', 'id_empresa', 'id_produto', 'descricao_produto',
    'sku', 'ean', 'id_marca', 'marca', 'id_grupo', 'grupo',
    'id_subgrupo', 'subgrupo', 'id_categoria', 'categoria',
    'id_plataforma', 'plataforma',
    'pedidos', 'itens_pedidos', 'quantidade_pedida', 'valor_pedidos',
    'notas_fiscais', 'itens_faturados', 'quantidade_faturada',
    'faturamento_emitido', 'custo_produtos', 'margem_bruta_produtos',
    'margem_bruta_pct', 'comissao_marketplace', 'contribuicao_apos_comissao',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'data_referencia', 'id_produto', 'descricao_produto', 'sku', 'plataforma',
      'quantidade_pedida', 'valor_pedidos', 'quantidade_faturada',
      'faturamento_emitido', 'margem_bruta_produtos', 'contribuicao_apos_comissao'
    ],
    colunasAgente: [
      'data_referencia', 'id_empresa', 'id_produto', 'descricao_produto',
      'sku', 'ean', 'id_marca', 'marca', 'id_grupo', 'grupo',
      'id_subgrupo', 'subgrupo', 'id_categoria', 'categoria',
      'id_plataforma', 'plataforma', 'pedidos', 'itens_pedidos',
      'quantidade_pedida', 'valor_pedidos', 'notas_fiscais',
      'itens_faturados', 'quantidade_faturada', 'faturamento_emitido',
      'custo_produtos', 'margem_bruta_produtos', 'margem_bruta_pct',
      'comissao_marketplace', 'contribuicao_apos_comissao'
    ]
  },

  construirSql(contextosSilver) {
    const pedidos = `"${contextosSilver.get('fato_pedido_item').viewAtual}"`;
    const notas = `"${contextosSilver.get('fato_nota_fiscal_item').viewAtual}"`;
    return `
      WITH pedidos_base AS (
        SELECT
          CAST(data_pedido AS DATE) AS data_referencia,
          coalesce(id_empresa, 0) AS id_empresa,
          coalesce(id_produto, 0) AS id_produto,
          coalesce(id_plataforma, 0) AS id_plataforma,
          descricao_produto, sku, ean,
          id_marca, marca, id_grupo, grupo, id_subgrupo, subgrupo,
          id_categoria, categoria, CAST(plataforma AS VARCHAR) AS plataforma,
          id_pedido_vda_importado,
          coalesce(quantidade, 0) AS quantidade,
          coalesce(valor_pedido_pago_item, 0) AS valor
        FROM ${pedidos}
        WHERE data_pedido IS NOT NULL AND pedido_valido = true
      ), pedidos_agregados AS (
        SELECT
          data_referencia, id_empresa, id_produto, id_plataforma,
          any_value(descricao_produto) AS descricao_produto,
          any_value(sku) AS sku, any_value(ean) AS ean,
          any_value(id_marca) AS id_marca, any_value(marca) AS marca,
          any_value(id_grupo) AS id_grupo, any_value(grupo) AS grupo,
          any_value(id_subgrupo) AS id_subgrupo, any_value(subgrupo) AS subgrupo,
          any_value(id_categoria) AS id_categoria, any_value(categoria) AS categoria,
          any_value(plataforma) AS plataforma,
          count(DISTINCT id_pedido_vda_importado) AS pedidos,
          count(*) AS itens_pedidos,
          CAST(sum(quantidade) AS DECIMAL(18,4)) AS quantidade_pedida,
          CAST(sum(valor) AS DECIMAL(18,2)) AS valor_pedidos
        FROM pedidos_base
        GROUP BY data_referencia, id_empresa, id_produto, id_plataforma
      ), faturamento_base AS (
        SELECT
          CAST(data_emissao AS DATE) AS data_referencia,
          coalesce(id_empresa, 0) AS id_empresa,
          coalesce(id_produto, 0) AS id_produto,
          coalesce(id_plataforma, 0) AS id_plataforma,
          descricao_produto, sku, ean,
          id_marca, marca, id_grupo, grupo, id_subgrupo, subgrupo,
          id_categoria, categoria, CAST(plataforma AS VARCHAR) AS plataforma,
          id_nota_saida,
          coalesce(nullif(quantidade_faturada, 0), quantidade, 0) AS quantidade,
          coalesce(valor_total_item, 0) AS faturamento,
          coalesce(custo_total_item, 0) AS custo,
          coalesce(comissao_marketplace_item, comissao_item, 0) AS comissao
        FROM ${notas}
        WHERE data_emissao IS NOT NULL
      ), faturamento_agregado AS (
        SELECT
          data_referencia, id_empresa, id_produto, id_plataforma,
          any_value(descricao_produto) AS descricao_produto,
          any_value(sku) AS sku, any_value(ean) AS ean,
          any_value(id_marca) AS id_marca, any_value(marca) AS marca,
          any_value(id_grupo) AS id_grupo, any_value(grupo) AS grupo,
          any_value(id_subgrupo) AS id_subgrupo, any_value(subgrupo) AS subgrupo,
          any_value(id_categoria) AS id_categoria, any_value(categoria) AS categoria,
          any_value(plataforma) AS plataforma,
          count(DISTINCT id_nota_saida) AS notas_fiscais,
          count(*) AS itens_faturados,
          CAST(sum(quantidade) AS DECIMAL(18,4)) AS quantidade_faturada,
          CAST(sum(faturamento) AS DECIMAL(18,2)) AS faturamento_emitido,
          CAST(sum(custo) AS DECIMAL(18,2)) AS custo_produtos,
          CAST(sum(faturamento - custo) AS DECIMAL(18,2)) AS margem_bruta_produtos,
          CAST(100.0 * sum(faturamento - custo) / nullif(sum(faturamento), 0)
            AS DECIMAL(12,4)) AS margem_bruta_pct,
          CAST(sum(comissao) AS DECIMAL(18,2)) AS comissao_marketplace,
          CAST(sum(faturamento - custo - comissao) AS DECIMAL(18,2))
            AS contribuicao_apos_comissao
        FROM faturamento_base
        GROUP BY data_referencia, id_empresa, id_produto, id_plataforma
      )
      SELECT
        coalesce(p.data_referencia, f.data_referencia) AS data_referencia,
        coalesce(p.id_empresa, f.id_empresa) AS id_empresa,
        coalesce(p.id_produto, f.id_produto) AS id_produto,
        coalesce(f.descricao_produto, p.descricao_produto) AS descricao_produto,
        coalesce(f.sku, p.sku) AS sku,
        coalesce(f.ean, p.ean) AS ean,
        coalesce(f.id_marca, p.id_marca) AS id_marca,
        coalesce(f.marca, p.marca) AS marca,
        coalesce(f.id_grupo, p.id_grupo) AS id_grupo,
        coalesce(f.grupo, p.grupo) AS grupo,
        coalesce(f.id_subgrupo, p.id_subgrupo) AS id_subgrupo,
        coalesce(f.subgrupo, p.subgrupo) AS subgrupo,
        coalesce(f.id_categoria, p.id_categoria) AS id_categoria,
        coalesce(f.categoria, p.categoria) AS categoria,
        coalesce(p.id_plataforma, f.id_plataforma) AS id_plataforma,
        coalesce(f.plataforma, p.plataforma, 'Canal não identificado') AS plataforma,
        coalesce(p.pedidos, 0) AS pedidos,
        coalesce(p.itens_pedidos, 0) AS itens_pedidos,
        coalesce(p.quantidade_pedida, 0) AS quantidade_pedida,
        coalesce(p.valor_pedidos, 0) AS valor_pedidos,
        coalesce(f.notas_fiscais, 0) AS notas_fiscais,
        coalesce(f.itens_faturados, 0) AS itens_faturados,
        coalesce(f.quantidade_faturada, 0) AS quantidade_faturada,
        coalesce(f.faturamento_emitido, 0) AS faturamento_emitido,
        coalesce(f.custo_produtos, 0) AS custo_produtos,
        coalesce(f.margem_bruta_produtos, 0) AS margem_bruta_produtos,
        f.margem_bruta_pct,
        coalesce(f.comissao_marketplace, 0) AS comissao_marketplace,
        coalesce(f.contribuicao_apos_comissao, 0) AS contribuicao_apos_comissao,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM pedidos_agregados p
      FULL OUTER JOIN faturamento_agregado f
        ON f.data_referencia = p.data_referencia
        AND f.id_empresa = p.id_empresa
        AND f.id_produto = p.id_produto
        AND f.id_plataforma = p.id_plataforma
      ORDER BY data_referencia, id_empresa, id_produto, id_plataforma
    `;
  },

  construirMetricasQualidadeSql(contextosSilver) {
    const pedidos = `"${contextosSilver.get('fato_pedido_item').viewAtual}"`;
    const notas = `"${contextosSilver.get('fato_nota_fiscal_item').viewAtual}"`;
    return `
      SELECT
        (SELECT count(*) FROM ${pedidos} WHERE data_pedido IS NOT NULL AND pedido_valido=true)
          AS itens_pedidos_validos,
        (SELECT count(*) FROM ${notas} WHERE data_emissao IS NOT NULL)
          AS itens_faturados_validos,
        (SELECT count(*) FROM ${pedidos} WHERE pedido_valido=true AND id_produto IS NULL)
          AS itens_pedidos_sem_produto,
        (SELECT count(*) FROM ${notas} WHERE id_produto IS NULL)
          AS itens_faturados_sem_produto,
        least(
          (SELECT min(data_pedido) FROM ${pedidos} WHERE pedido_valido=true),
          (SELECT min(data_emissao) FROM ${notas})
        ) AS cobertura_inicio,
        greatest(
          (SELECT max(data_pedido) FROM ${pedidos} WHERE pedido_valido=true),
          (SELECT max(data_emissao) FROM ${notas})
        ) AS cobertura_fim
    `;
  }
};
