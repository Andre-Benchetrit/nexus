const { citar } = require('../core/util');

module.exports = {
  nome: 'fato_estoque_atual',
  tipo: 'fato',
  descricao: 'Saldo atual de estoque por produto e empresa, enriquecido com o cadastro do produto.',
  versaoContrato: 2,
  chavePrimaria: 'id_sequencia',
  fontePrincipal: 'produto_inventario',
  fontesBronze: ['produto_inventario'],
  fontesSilver: ['dim_produto'],
  colunas: [
    'id_sequencia',
    'id_empresa',
    'id_produto',
    'descricao_produto',
    'sku',
    'ean',
    'composicao_estoque',
    'id_grupo',
    'grupo',
    'id_subgrupo',
    'subgrupo',
    'id_marca',
    'marca',
    'id_categoria',
    'categoria',
    'custo_produto_atual',
    'valor_estoque_custo',
    'produto_ativo',
    'disponivel',
    'envia_site',
    'catalogo_site_ativo',
    'lote_serie',
    'localizacao',
    'estoque_disponivel',
    'quantidade_reservada',
    'estoque_minimo',
    'estoque_maximo',
    'estoque_seguranca',
    'estoque_assistencia',
    'estoque_avaliacao',
    'estoque_deposito',
    'estoque_perda',
    'estoque_terceiro',
    'estoque_fifo',
    'sem_estoque_disponivel',
    'estoque_negativo',
    'tem_reserva',
    'dthr_atualizacao_estoque',
    'empresa_analisada',
    'fonte_sistema',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: false,
    colunasPadrao: [
      'id_produto',
      'descricao_produto',
      'marca',
      'estoque_disponivel',
      'quantidade_reservada',
      'sem_estoque_disponivel'
    ],
    colunasAgente: []
  },

  construirSql(contextosBronze, contextosSilver) {
    const inventario = citar(contextosBronze.get('produto_inventario').viewAtual);
    const produtos = citar(contextosSilver.get('dim_produto').viewAtual);
    return `
      SELECT
        i.id_sequencia,
        i.id_empresa,
        i.id_produto,
        p.descricao_produto,
        p.sku,
        p.ean,
        p.composicao_estoque,
        p.id_grupo,
        p.grupo,
        p.id_subgrupo,
        p.subgrupo,
        p.id_marca,
        p.marca,
        p.id_categoria,
        p.categoria,
        p.custo_produto_atual,
        CAST(
          coalesce(i.estoque, 0) * coalesce(p.custo_produto_atual, 0)
          AS DECIMAL(18,2)
        ) AS valor_estoque_custo,
        p.produto_ativo,
        p.disponivel,
        p.envia_site,
        p.catalogo_site_ativo,
        nullif(trim(i.lote_serie), '') AS lote_serie,
        nullif(trim(i.localizacao), '') AS localizacao,
        CAST(coalesce(i.estoque, 0) AS DECIMAL(18,4)) AS estoque_disponivel,
        CAST(coalesce(i.qtde_reserva, 0) AS DECIMAL(18,4)) AS quantidade_reservada,
        CAST(coalesce(i.estoque_minimo, 0) AS DECIMAL(18,4)) AS estoque_minimo,
        CAST(coalesce(i.estoque_maximo, 0) AS DECIMAL(18,4)) AS estoque_maximo,
        CAST(coalesce(i.estoque_seguranca, 0) AS DECIMAL(18,4)) AS estoque_seguranca,
        CAST(coalesce(i.estoque_assistencia, 0) AS DECIMAL(18,4)) AS estoque_assistencia,
        CAST(coalesce(i.estoque_avaliacao, 0) AS DECIMAL(18,4)) AS estoque_avaliacao,
        CAST(coalesce(i.estoque_deposito, 0) AS DECIMAL(18,4)) AS estoque_deposito,
        CAST(coalesce(i.estoque_perda, 0) AS DECIMAL(18,4)) AS estoque_perda,
        CAST(coalesce(i.estoque_terceiro, 0) AS DECIMAL(18,4)) AS estoque_terceiro,
        CAST(coalesce(i.estoque_fifo, 0) AS DECIMAL(18,4)) AS estoque_fifo,
        coalesce(i.estoque, 0) <= 0 AS sem_estoque_disponivel,
        coalesce(i.estoque, 0) < 0 AS estoque_negativo,
        coalesce(i.qtde_reserva, 0) > 0 AS tem_reserva,
        i.dthr_atualizacao AS dthr_atualizacao_estoque,
        i.id_empresa = 10 AS empresa_analisada,
        'postgres.sysemp.produto_inventario' AS fonte_sistema,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM ${inventario} i
      LEFT JOIN ${produtos} p ON p.id_produto = i.id_produto
    `;
  },

  construirMetricasRelacionamentosSql(contextosBronze, contextosSilver) {
    const inventario = citar(contextosBronze.get('produto_inventario').viewAtual);
    const produtos = citar(contextosSilver.get('dim_produto').viewAtual);
    return `
      SELECT
        count(*) FILTER (WHERE p.id_produto IS NULL) AS saldos_sem_produto_correspondente,
        count(*) FILTER (WHERE i.id_empresa = 10) AS saldos_empresa_10,
        count(*) FILTER (
          WHERE i.id_empresa = 10 AND coalesce(i.estoque, 0) <= 0
        ) AS saldos_sem_disponibilidade_empresa_10,
        min(i.dthr_atualizacao) AS cobertura_inicio,
        max(i.dthr_atualizacao) AS cobertura_fim
      FROM ${inventario} i
      LEFT JOIN ${produtos} p ON p.id_produto = i.id_produto
    `;
  }
};
