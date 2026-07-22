const { citar, flagBooleano, texto } = require('../core/util');

function obterViews(contextosBronze, contextosSilver) {
  return {
    produto: citar(contextosBronze.get('produto').viewAtual),
    grupo: citar(contextosSilver.get('dim_grupo').viewAtual),
    subgrupo: citar(contextosSilver.get('dim_subgrupo').viewAtual),
    marca: citar(contextosSilver.get('dim_marca').viewAtual),
    categoria: citar(contextosSilver.get('dim_categoria').viewAtual)
  };
}

// Modelo Silver derivado da fonte PostgreSQL.
module.exports = {
  nome: 'dim_produto',
  tipo: 'dimensao',
  descricao: 'Cadastro atual de produtos enriquecido com suas classificacoes.',
  versaoContrato: 1,
  chavePrimaria: 'id_produto',
  fontePrincipal: 'produto',
  fontesBronze: ['produto'],
  fontesSilver: ['dim_grupo', 'dim_subgrupo', 'dim_marca', 'dim_categoria'],
  colunas: [
    'id_produto',
    'descricao_produto',
    'sku',
    'ean',
    'codigo_fabricante',
    'id_grupo',
    'grupo',
    'id_subgrupo',
    'subgrupo',
    'id_marca',
    'marca',
    'id_categoria',
    'categoria',
    'estoque',
    'produto_inativo',
    'produto_ativo',
    'disponivel',
    'envia_site',
    'catalogo_site_ativo',
    'dt_cadastro',
    'dt_alteracao',
    'fonte_sistema',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_produto',
      'descricao_produto',
      'sku',
      'ean',
      'grupo',
      'subgrupo',
      'marca',
      'categoria',
      'produto_ativo',
      'catalogo_site_ativo'
    ],
    colunasAgente: [
      'id_produto',
      'descricao_produto',
      'sku',
      'ean',
      'codigo_fabricante',
      'id_grupo',
      'grupo',
      'id_subgrupo',
      'subgrupo',
      'id_marca',
      'marca',
      'id_categoria',
      'categoria',
      'estoque',
      'produto_inativo',
      'produto_ativo',
      'disponivel',
      'envia_site',
      'catalogo_site_ativo',
      'dt_cadastro',
      'dt_alteracao'
    ]
  },

  construirSql(contextosBronze, contextosSilver) {
    const views = obterViews(contextosBronze, contextosSilver);
    const inativo = flagBooleano('p.inativo');
    const disponivel = flagBooleano('p.disponivel');
    const enviaSite = flagBooleano('p.envia_site');

    return `
      SELECT
        p.id_produto,
        ${texto('p.descricao')} AS descricao_produto,
        ${texto('p.codigo_auxiliar')} AS sku,
        ${texto('p.cod_barra')} AS ean,
        ${texto('p.cod_fabrica')} AS codigo_fabricante,
        p.id_grupo,
        g.grupo,
        p.id_subgrupo,
        sg.subgrupo,
        p.id_marca,
        m.marca,
        p.id_categoria,
        c.categoria,
        p.estoque,
        ${inativo} AS produto_inativo,
        CASE WHEN ${inativo} IS NULL THEN NULL ELSE NOT (${inativo}) END AS produto_ativo,
        ${disponivel} AS disponivel,
        ${enviaSite} AS envia_site,
        (${inativo} = false AND ${disponivel} = true AND ${enviaSite} = true)
          AS catalogo_site_ativo,
        p.dt_cadastro,
        p.dt_alteracao,
        'postgres.sysemp.produto' AS fonte_sistema,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM ${views.produto} p
      LEFT JOIN ${views.grupo} g ON g.id_grupo = p.id_grupo
      LEFT JOIN ${views.subgrupo} sg ON sg.id_subgrupo = p.id_subgrupo
      LEFT JOIN ${views.marca} m ON m.id_marca = p.id_marca
      LEFT JOIN ${views.categoria} c ON c.id_categoria = p.id_categoria
    `;
  },

  construirMetricasRelacionamentosSql(contextosBronze, contextosSilver) {
    const views = obterViews(contextosBronze, contextosSilver);
    return `
      SELECT
        count(*) FILTER (WHERE p.id_grupo IS NOT NULL AND g.id_grupo IS NULL) AS produtos_sem_grupo_correspondente,
        count(*) FILTER (WHERE p.id_subgrupo IS NOT NULL AND sg.id_subgrupo IS NULL) AS produtos_sem_subgrupo_correspondente,
        count(*) FILTER (WHERE p.id_marca IS NOT NULL AND m.id_marca IS NULL) AS produtos_sem_marca_correspondente,
        count(*) FILTER (WHERE p.id_categoria IS NOT NULL AND c.id_categoria IS NULL) AS produtos_sem_categoria_correspondente
      FROM ${views.produto} p
      LEFT JOIN ${views.grupo} g ON g.id_grupo = p.id_grupo
      LEFT JOIN ${views.subgrupo} sg ON sg.id_subgrupo = p.id_subgrupo
      LEFT JOIN ${views.marca} m ON m.id_marca = p.id_marca
      LEFT JOIN ${views.categoria} c ON c.id_categoria = p.id_categoria
    `;
  }
};
