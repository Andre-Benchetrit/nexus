const { citar } = require('../core/util');

module.exports = {
  nome: 'fato_movimento_estoque',
  tipo: 'fato',
  descricao: 'Movimentacoes de estoque normalizadas e enriquecidas com o cadastro do produto.',
  versaoContrato: 1,
  chavePrimaria: 'id_sequencia',
  fontePrincipal: 'log_estoque',
  fontesBronze: ['log_estoque'],
  fontesSilver: ['dim_produto'],
  colunas: [
    'id_sequencia',
    'data_movimento',
    'data_referencia',
    'id_empresa',
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
    'descricao_movimento',
    'debito_credito',
    'tipo_movimento',
    'origem',
    'id_origem',
    'quantidade_movimentada',
    'quantidade_entrada',
    'quantidade_saida',
    'estoque_apos_movimento',
    'id_parceiro',
    'id_estoque',
    'custo',
    'custo_medio',
    'serie',
    'numero_nota_fiscal',
    'lote_serie',
    'localizacao',
    'movimento_venda',
    'movimento_devolucao',
    'empresa_analisada',
    'fonte_sistema',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: false,
    colunasPadrao: [
      'data_movimento',
      'id_produto',
      'descricao_produto',
      'tipo_movimento',
      'origem',
      'quantidade_movimentada'
    ],
    colunasAgente: []
  },

  construirSql(contextosBronze, contextosSilver) {
    const movimentos = citar(contextosBronze.get('log_estoque').viewAtual);
    const produtos = citar(contextosSilver.get('dim_produto').viewAtual);
    return `
      SELECT
        m.id_sequencia,
        m.data_hora AS data_movimento,
        CAST(m.data_hora AS DATE) AS data_referencia,
        m.id_empresa,
        m.id_produto,
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
        nullif(trim(m.descricao), '') AS descricao_movimento,
        upper(trim(m.dc)) AS debito_credito,
        CASE upper(trim(m.dc))
          WHEN 'D' THEN 'SAIDA'
          WHEN 'C' THEN 'ENTRADA'
          WHEN 'N' THEN 'NEUTRO'
          ELSE 'DESCONHECIDO'
        END AS tipo_movimento,
        upper(trim(m.origem)) AS origem,
        m.id_origem,
        CAST(coalesce(m.qtde, 0) AS DECIMAL(18,4)) AS quantidade_movimentada,
        CAST(
          CASE WHEN upper(trim(m.dc)) = 'C' OR coalesce(m.qtde, 0) > 0
            THEN abs(coalesce(m.qtde, 0)) ELSE 0 END
          AS DECIMAL(18,4)
        ) AS quantidade_entrada,
        CAST(
          CASE WHEN upper(trim(m.dc)) = 'D' OR coalesce(m.qtde, 0) < 0
            THEN abs(coalesce(m.qtde, 0)) ELSE 0 END
          AS DECIMAL(18,4)
        ) AS quantidade_saida,
        CAST(coalesce(m.estoque, 0) AS DECIMAL(18,4)) AS estoque_apos_movimento,
        m.id_parceiro,
        m.id_estoque,
        CAST(m.custo AS DECIMAL(18,4)) AS custo,
        CAST(m.custo_medio AS DECIMAL(18,4)) AS custo_medio,
        nullif(trim(m.serie), '') AS serie,
        m.nr_nf AS numero_nota_fiscal,
        nullif(trim(m.lote_serie), '') AS lote_serie,
        nullif(trim(m.localizacao), '') AS localizacao,
        upper(trim(m.origem)) = 'NF' AND upper(trim(m.dc)) = 'D' AS movimento_venda,
        upper(trim(m.origem)) = 'DV' AS movimento_devolucao,
        m.id_empresa = 10 AS empresa_analisada,
        'postgres.sysemp.log_estoque' AS fonte_sistema,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM ${movimentos} m
      LEFT JOIN ${produtos} p ON p.id_produto = m.id_produto
    `;
  },

  construirMetricasRelacionamentosSql(contextosBronze, contextosSilver) {
    const movimentos = citar(contextosBronze.get('log_estoque').viewAtual);
    const produtos = citar(contextosSilver.get('dim_produto').viewAtual);
    return `
      SELECT
        count(*) FILTER (WHERE p.id_produto IS NULL) AS movimentos_sem_produto_correspondente,
        count(*) FILTER (WHERE m.id_empresa = 10) AS movimentos_empresa_10,
        count(*) FILTER (
          WHERE m.id_empresa = 10
            AND upper(trim(m.origem)) = 'NF'
            AND upper(trim(m.dc)) = 'D'
        ) AS saidas_venda_empresa_10,
        min(m.data_hora) AS cobertura_inicio,
        max(m.data_hora) AS cobertura_fim
      FROM ${movimentos} m
      LEFT JOIN ${produtos} p ON p.id_produto = m.id_produto
    `;
  }
};
