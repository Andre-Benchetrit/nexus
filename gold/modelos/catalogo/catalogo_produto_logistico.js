module.exports = {
  nome: 'catalogo_produto_logistico',
  tipo: 'dimensao_logistica',
  descricao: 'Catalogo de produtos com dimensoes do produto e da embalagem, pesos e cubagem em m3.',
  versaoContrato: 1,
  chavePrimaria: 'id_produto',
  fontesSilver: ['dim_produto'],
  fontesGold: [],
  colunas: [
    'id_produto', 'descricao_produto', 'sku', 'ean',
    'peso_liquido', 'peso_bruto',
    'altura', 'largura', 'comprimento',
    'altura_produto_m', 'largura_produto_m', 'comprimento_produto_m',
    'embalagem_altura', 'embalagem_largura', 'embalagem_comprimento',
    'embalagem_altura_m', 'embalagem_largura_m', 'embalagem_comprimento_m',
    'cubagem_m3', 'status_cubagem',
    'produto_ativo', 'catalogo_site_ativo',
    'grupo', 'subgrupo', 'marca', 'categoria',
    'dt_alteracao', 'atualizado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_produto', 'descricao_produto', 'sku', 'ean',
      'embalagem_altura_m', 'embalagem_largura_m', 'embalagem_comprimento_m',
      'cubagem_m3', 'status_cubagem', 'produto_ativo'
    ],
    colunasAgente: [
      'id_produto', 'descricao_produto', 'sku', 'ean',
      'peso_liquido', 'peso_bruto',
      'altura_produto_m', 'largura_produto_m', 'comprimento_produto_m',
      'embalagem_altura_m', 'embalagem_largura_m', 'embalagem_comprimento_m',
      'cubagem_m3', 'status_cubagem', 'produto_ativo', 'catalogo_site_ativo',
      'grupo', 'subgrupo', 'marca', 'categoria', 'dt_alteracao'
    ]
  },

  construirSql(contextosSilver) {
    const produto = `"${contextosSilver.get('dim_produto').viewAtual}"`;
    return `
      WITH origem AS (
        SELECT
          id_produto, descricao_produto, sku, ean,
          peso_liquido, peso_bruto,
          altura, largura, comprimento,
          altura_produto_m, largura_produto_m, comprimento_produto_m,
          embalagem_altura, embalagem_largura, embalagem_comprimento,
          embalagem_altura_m, embalagem_largura_m, embalagem_comprimento_m,
          produto_ativo, catalogo_site_ativo,
          grupo, subgrupo, marca, categoria, dt_alteracao,
          CASE
            WHEN (nullif(trim(embalagem_altura), '') IS NOT NULL
                  AND (embalagem_altura_m IS NULL OR embalagem_altura_m <= 0))
              OR (nullif(trim(embalagem_largura), '') IS NOT NULL
                  AND (embalagem_largura_m IS NULL OR embalagem_largura_m <= 0))
              OR (nullif(trim(embalagem_comprimento), '') IS NOT NULL
                  AND (embalagem_comprimento_m IS NULL OR embalagem_comprimento_m <= 0))
              THEN 'invalida'
            WHEN nullif(trim(embalagem_altura), '') IS NULL
              OR nullif(trim(embalagem_largura), '') IS NULL
              OR nullif(trim(embalagem_comprimento), '') IS NULL
              THEN 'incompleta'
            ELSE 'completa'
          END AS status_cubagem
        FROM ${produto}
      )
      SELECT
        id_produto, descricao_produto, sku, ean,
        peso_liquido, peso_bruto,
        altura, largura, comprimento,
        altura_produto_m, largura_produto_m, comprimento_produto_m,
        embalagem_altura, embalagem_largura, embalagem_comprimento,
        embalagem_altura_m, embalagem_largura_m, embalagem_comprimento_m,
        CASE WHEN status_cubagem = 'completa'
          THEN CAST(embalagem_altura_m * embalagem_largura_m * embalagem_comprimento_m
            AS DECIMAL(18,9))
          ELSE CAST(NULL AS DECIMAL(18,9))
        END AS cubagem_m3,
        status_cubagem,
        produto_ativo, catalogo_site_ativo,
        grupo, subgrupo, marca, categoria, dt_alteracao,
        CAST(current_timestamp AS TIMESTAMP) AS atualizado_em
      FROM origem
      ORDER BY id_produto
    `;
  },

  construirMetricasQualidadeSql(contextosSilver) {
    const produto = `"${contextosSilver.get('dim_produto').viewAtual}"`;
    return `
      SELECT
        count(*) AS produtos,
        count(*) FILTER (WHERE produto_ativo = true) AS produtos_ativos,
        count(*) FILTER (WHERE produto_ativo = true AND embalagem_altura_m IS NOT NULL
          AND embalagem_largura_m IS NOT NULL AND embalagem_comprimento_m IS NOT NULL
          AND embalagem_altura_m > 0 AND embalagem_largura_m > 0
          AND embalagem_comprimento_m > 0) AS cubagens_completas,
        count(*) FILTER (WHERE
          (nullif(trim(embalagem_altura), '') IS NULL
            OR nullif(trim(embalagem_largura), '') IS NULL
            OR nullif(trim(embalagem_comprimento), '') IS NULL)
          AND NOT (
            (nullif(trim(embalagem_altura), '') IS NOT NULL
              AND (embalagem_altura_m IS NULL OR embalagem_altura_m <= 0))
            OR (nullif(trim(embalagem_largura), '') IS NOT NULL
              AND (embalagem_largura_m IS NULL OR embalagem_largura_m <= 0))
            OR (nullif(trim(embalagem_comprimento), '') IS NOT NULL
              AND (embalagem_comprimento_m IS NULL OR embalagem_comprimento_m <= 0))
          )) AS cubagens_incompletas,
        count(*) FILTER (WHERE
          (nullif(trim(embalagem_altura), '') IS NOT NULL
            AND (embalagem_altura_m IS NULL OR embalagem_altura_m <= 0))
          OR (nullif(trim(embalagem_largura), '') IS NOT NULL
            AND (embalagem_largura_m IS NULL OR embalagem_largura_m <= 0))
          OR (nullif(trim(embalagem_comprimento), '') IS NOT NULL
            AND (embalagem_comprimento_m IS NULL OR embalagem_comprimento_m <= 0))
        ) AS cubagens_invalidas
      FROM ${produto}
    `;
  }
};
