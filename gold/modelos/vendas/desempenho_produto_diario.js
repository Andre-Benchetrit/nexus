module.exports = {
  nome: 'desempenho_produto_diario',
  tipo: 'indicador_dimensional',
  descricao: 'Desempenho faturado diario por produto e plataforma.',
  versaoContrato: 1,
  chavePrimaria: [
    'data_referencia', 'id_empresa', 'id_produto', 'id_plataforma'
  ],
  fontesSilver: ['fato_nota_fiscal_item'],
  fontesGold: [],
  colunas: [
    'data_referencia',
    'id_empresa',
    'id_produto',
    'descricao_produto',
    'sku',
    'ean',
    'peso_liquido',
    'altura',
    'largura',
    'comprimento',
    'id_marca',
    'marca',
    'id_grupo',
    'grupo',
    'id_subgrupo',
    'subgrupo',
    'id_categoria',
    'categoria',
    'id_plataforma',
    'plataforma',
    'notas_fiscais',
    'pedidos_comerciais',
    'itens_faturados',
    'quantidade_faturada',
    'faturamento_emitido',
    'custo_produtos',
    'margem_bruta_produtos',
    'margem_bruta_pct',
    'comissao_marketplace',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'data_referencia', 'descricao_produto', 'marca', 'plataforma',
      'quantidade_faturada', 'faturamento_emitido',
      'margem_bruta_produtos', 'margem_bruta_pct'
    ],
    colunasAgente: [
      'data_referencia', 'id_empresa', 'id_produto', 'descricao_produto',
      'sku', 'ean', 'comprimento', 'altura', 'largura', 'peso_liquido',
      'id_marca', 'marca', 'id_grupo', 'grupo',
      'id_subgrupo', 'subgrupo', 'id_categoria', 'categoria',
      'id_plataforma', 'plataforma', 'notas_fiscais',
      'pedidos_comerciais', 'itens_faturados', 'quantidade_faturada',
      'faturamento_emitido', 'custo_produtos', 'margem_bruta_produtos',
      'margem_bruta_pct', 'comissao_marketplace'
    ]
  },

  construirSql(contextosSilver) {
    const itens = `"${contextosSilver.get('fato_nota_fiscal_item').viewAtual}"`;
    return `
      WITH base AS (
        SELECT
          CAST(data_emissao AS DATE) AS data_referencia,
          coalesce(id_empresa, 0) AS id_empresa,
          coalesce(id_produto, 0) AS id_produto,
          descricao_produto,
          sku,
          ean,
          peso_liquido,
          altura,
          largura,
          comprimento,
          id_marca,
          marca,
          id_grupo,
          grupo,
          id_subgrupo,
          subgrupo,
          id_categoria,
          categoria,
          coalesce(id_plataforma, 0) AS id_plataforma,
          plataforma,
          id_nota_saida,
          id_pedido_vda_importado,
          coalesce(nullif(quantidade_faturada, 0), quantidade, 0)
            AS quantidade_considerada,
          coalesce(valor_total_item, 0) AS receita,
          coalesce(custo_total_item, 0) AS custo,
          coalesce(comissao_marketplace_item, comissao_item, 0) AS comissao
        FROM ${itens}
        WHERE data_emissao IS NOT NULL
      ), agregada AS (
        SELECT
          data_referencia,
          id_empresa,
          id_produto,
          any_value(descricao_produto) AS descricao_produto,
          any_value(sku) AS sku,
          any_value(ean) AS ean,
          any_value(peso_liquido) AS peso_liquido,
          any_value(altura) AS altura,
          any_value(largura) AS largura,
          any_value(comprimento) AS comprimento,
          any_value(id_marca) AS id_marca,
          any_value(marca) AS marca,
          any_value(id_grupo) AS id_grupo,
          any_value(grupo) AS grupo,
          any_value(id_subgrupo) AS id_subgrupo,
          any_value(subgrupo) AS subgrupo,
          any_value(id_categoria) AS id_categoria,
          any_value(categoria) AS categoria,
          id_plataforma,
          any_value(plataforma) AS plataforma,
          count(DISTINCT id_nota_saida) AS notas_fiscais,
          count(DISTINCT id_pedido_vda_importado) AS pedidos_comerciais,
          count(*) AS itens_faturados,
          sum(quantidade_considerada) AS quantidade_faturada,
          CAST(sum(receita) AS DECIMAL(18,2)) AS faturamento_emitido,
          CAST(sum(custo) AS DECIMAL(18,2)) AS custo_produtos,
          CAST(sum(receita - custo) AS DECIMAL(18,2)) AS margem_bruta_produtos,
          CAST(
            100.0 * sum(receita - custo) / nullif(sum(receita), 0)
            AS DECIMAL(12,4)
          ) AS margem_bruta_pct,
          CAST(sum(comissao) AS DECIMAL(18,2)) AS comissao_marketplace
        FROM base
        GROUP BY data_referencia, id_empresa, id_produto, id_plataforma
      )
      SELECT
        *,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM agregada
      ORDER BY data_referencia, id_empresa, id_produto, id_plataforma
    `;
  },

  construirMetricasQualidadeSql(contextosSilver) {
    const itens = `"${contextosSilver.get('fato_nota_fiscal_item').viewAtual}"`;
    return `
      SELECT
        count(*) AS itens_faturados_fonte,
        count(*) FILTER (WHERE data_emissao IS NULL) AS itens_sem_data_emissao,
        count(*) FILTER (WHERE id_produto IS NULL) AS itens_sem_produto,
        count(*) FILTER (WHERE custo_total_item IS NULL) AS itens_sem_custo,
        min(data_emissao) AS cobertura_inicio,
        max(data_emissao) AS cobertura_fim
      FROM ${itens}
    `;
  }
};
