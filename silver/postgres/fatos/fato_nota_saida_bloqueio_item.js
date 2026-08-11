const { citar } = require('../core/util');

module.exports = {
  nome: 'fato_nota_saida_bloqueio_item',
  tipo: 'fato',

  descricao:
    'Uma linha por ocorrencia de bloqueio em um produto ou item de uma nota de saida.',

  versaoContrato: 1,
  preservaTotalEntrada: true,

  chavePrimaria: [
    'id_nota_saida',
    'id_bloqueio',
    'id_empresa',
    'sequencia_ocorrencia'
  ],

  fontePrincipal: 'nota_saida_bloqueada',

  fontesBronze: [
    'nota_saida_bloqueada'
  ],

  fontesSilver: [
    'dim_bloqueio',
    'fato_venda',
    'fato_venda_item'
  ],

  colunas: [
    'id_nota_saida',
    'id_bloqueio',
    'id_produto',
    'sequencia_ocorrencia',

    'descricao_bloqueio',
    'produto_cadastrado',
    'sku',
    'ean',
    'descricao_produto',
    'quantidade_pedida',

    'id_empresa',
    'liberado',
    'bloqueio_ativo',

    'data_bloqueio',
    'hora_bloqueio',
    'dthr_bloqueio',

    'data_liberacao',
    'hora_liberacao',
    'dthr_liberacao',

    'dthr_atualizacao',

    'id_nr_nf',
    'id_pedido_vda_importado',
    'marketplace_pedido',
    'data_pedido',
    'data_emissao',
    'cliente',
    'plataforma',
    'canal_venda',
    'dt_limite_expedicao',
    'id_tp_pedido',
    'pedido_bloqueado',
    'valor_total_venda',
    'faturamento_valido'
  ],

  consulta: {
    habilitadaParaAgente: true,

    colunasPadrao: [
      'id_nota_saida',
      'id_nr_nf',
      'marketplace_pedido',
      'id_bloqueio',
      'descricao_bloqueio',
      'id_produto',
      'produto_cadastrado',
      'sku',
      'ean',
      'descricao_produto',
      'quantidade_pedida',
      'bloqueio_ativo',
      'dthr_bloqueio'
    ],

    colunasAgente: [
      'id_nota_saida',
      'id_bloqueio',
      'id_produto',
      'sequencia_ocorrencia',
      'descricao_bloqueio',
      'produto_cadastrado',
      'sku',
      'ean',
      'descricao_produto',
      'quantidade_pedida',
      'id_empresa',
      'liberado',
      'bloqueio_ativo',
      'data_bloqueio',
      'hora_bloqueio',
      'dthr_bloqueio',
      'data_liberacao',
      'hora_liberacao',
      'dthr_liberacao',
      'dthr_atualizacao',
      'id_nr_nf',
      'id_pedido_vda_importado',
      'marketplace_pedido',
      'data_pedido',
      'data_emissao',
      'cliente',
      'plataforma',
      'canal_venda',
      'dt_limite_expedicao',
      'id_tp_pedido',
      'pedido_bloqueado',
      'valor_total_venda',
      'faturamento_valido'
    ]
  },

  construirSql(contextosBronze, contextosSilver) {
    const bloqueiosNota = citar(
      contextosBronze.get('nota_saida_bloqueada').viewAtual
    );

    const dimensaoBloqueio = citar(
      contextosSilver.get('dim_bloqueio').viewAtual
    );

    const vendas = citar(
      contextosSilver.get('fato_venda').viewAtual
    );
    const itensVenda = citar(
      contextosSilver.get('fato_venda_item').viewAtual
    );

    return `
      WITH origem_tipificada AS (
        SELECT
          try_cast(id_nota_saida AS BIGINT)
            AS id_nota_saida,

          try_cast(id_bloqueio AS BIGINT)
            AS id_bloqueio,

          coalesce(
            try_cast(id_produto AS BIGINT),
            0
          ) AS id_produto,

          try_cast(id_sequencia AS BIGINT)
            AS sequencia_ocorrencia,

          try_cast(id_empresa AS BIGINT)
            AS id_empresa,

          CASE
            WHEN lower(
              trim(cast(liberado AS VARCHAR))
            ) IN (
              '1',
              'true',
              't',
              's',
              'sim',
              'y',
              'yes'
            ) THEN true

            WHEN lower(
              trim(cast(liberado AS VARCHAR))
            ) IN (
              '0',
              'false',
              'f',
              'n',
              'nao',
              'não',
              'no'
            ) THEN false

            ELSE NULL
          END AS liberado,

          try_cast(data AS DATE)
            AS data_bloqueio,

          try_cast(hora_bloqueio AS TIME)
            AS hora_bloqueio,

          try_cast(data_lib AS DATE)
            AS data_liberacao,

          try_cast(hora_lib AS TIME)
            AS hora_liberacao,

          try_cast(
            dthr_atualizacao AS TIMESTAMP
          ) AS dthr_atualizacao

        FROM ${bloqueiosNota}

        WHERE try_cast(id_nota_saida AS BIGINT) IS NOT NULL
          AND try_cast(id_bloqueio AS BIGINT) IS NOT NULL
      ),

      origem_com_datas AS (
        SELECT
          *,

          CASE
            WHEN data_bloqueio IS NOT NULL
            THEN
              data_bloqueio
              + coalesce(
                  hora_bloqueio,
                  TIME '00:00:00'
                )
            ELSE NULL
          END AS dthr_bloqueio,

          CASE
            WHEN data_liberacao IS NOT NULL
            THEN
              data_liberacao
              + coalesce(
                  hora_liberacao,
                  TIME '00:00:00'
                )
            ELSE NULL
          END AS dthr_liberacao

        FROM origem_tipificada
      ),

      origem_final AS (
        SELECT
          *,

          id_produto > 0
            AS produto_cadastrado,

          CASE
            WHEN liberado = true
              THEN false

            WHEN dthr_liberacao IS NOT NULL
              THEN false

            ELSE true
          END AS bloqueio_ativo

        FROM origem_com_datas
      ),

      itens_por_produto AS (
        SELECT
          id_nota_saida,
          id_produto,
          max(sku) AS sku,
          max(ean) AS ean,
          max(descricao_produto) AS descricao_produto,
          sum(coalesce(quantidade, 0)) AS quantidade_pedida
        FROM ${itensVenda}
        GROUP BY id_nota_saida, id_produto
      )

      SELECT
        bloqueio.id_nota_saida,
        bloqueio.id_bloqueio,
        bloqueio.id_produto,
        bloqueio.sequencia_ocorrencia,

        dimensao.descricao_bloqueio,
        bloqueio.produto_cadastrado,
        item.sku,
        item.ean,
        item.descricao_produto,
        item.quantidade_pedida,

        bloqueio.id_empresa,
        bloqueio.liberado,
        bloqueio.bloqueio_ativo,

        bloqueio.data_bloqueio,
        bloqueio.hora_bloqueio,
        bloqueio.dthr_bloqueio,

        bloqueio.data_liberacao,
        bloqueio.hora_liberacao,
        bloqueio.dthr_liberacao,

        bloqueio.dthr_atualizacao,

        venda.id_nr_nf,
        venda.id_pedido_vda_importado,
        venda.marketplace_pedido,
        venda.data_pedido,
        venda.data_emissao,
        venda.cliente,
        venda.plataforma,
        venda.canal_venda,
        venda.dt_limite_expedicao,
        venda.id_tp_pedido,
        venda.pedido_bloqueado,
        venda.valor_total_venda,
        venda.faturamento_valido

      FROM origem_final bloqueio

      LEFT JOIN ${dimensaoBloqueio} dimensao
        ON dimensao.id_bloqueio =
           bloqueio.id_bloqueio

      LEFT JOIN ${vendas} venda
        ON venda.id_nota_saida =
           bloqueio.id_nota_saida

      LEFT JOIN itens_por_produto item
        ON item.id_nota_saida = bloqueio.id_nota_saida
       AND item.id_produto = bloqueio.id_produto
    `;
  },

  construirMetricasRelacionamentosSql(
    contextosBronze,
    contextosSilver
  ) {
    const bloqueiosNota = citar(
      contextosBronze.get('nota_saida_bloqueada').viewAtual
    );

    const dimensaoBloqueio = citar(
      contextosSilver.get('dim_bloqueio').viewAtual
    );

    const vendas = citar(
      contextosSilver.get('fato_venda').viewAtual
    );

    return `
      WITH origem AS (
        SELECT
          try_cast(id_nota_saida AS BIGINT)
            AS id_nota_saida,

          try_cast(id_bloqueio AS BIGINT)
            AS id_bloqueio,

          coalesce(
            try_cast(id_produto AS BIGINT),
            0
          ) AS id_produto,

          try_cast(id_empresa AS BIGINT)
            AS id_empresa,

          try_cast(id_sequencia AS BIGINT)
            AS sequencia_ocorrencia

        FROM ${bloqueiosNota}
      ),

      duplicidades AS (
        SELECT
          id_nota_saida,
          id_bloqueio,
          id_empresa,
          sequencia_ocorrencia,
          count(*) AS quantidade

        FROM origem

        WHERE id_nota_saida IS NOT NULL
          AND id_bloqueio IS NOT NULL

        GROUP BY
          id_nota_saida,
          id_bloqueio,
          id_empresa,
          sequencia_ocorrencia
      ),

      grupos_produto_zero AS (
        SELECT
          id_nota_saida,
          id_bloqueio
        FROM origem
        WHERE id_produto = 0
        GROUP BY id_nota_saida, id_bloqueio
        HAVING count(*) > 1
      )

      SELECT
        (
          SELECT count(*)
          FROM origem
          WHERE id_nota_saida IS NULL
        ) AS bloqueios_sem_id_nota_saida,

        (
          SELECT count(*)
          FROM origem
          WHERE id_bloqueio IS NULL
        ) AS bloqueios_sem_id_bloqueio,

        (
          SELECT count(*)
          FROM origem
          WHERE id_produto = 0
        ) AS ocorrencias_sem_produto_cadastrado,

        (
          SELECT coalesce(
            sum(quantidade - 1),
            0
          )
          FROM duplicidades
          WHERE quantidade > 1
        ) AS chaves_origem_duplicadas,

        (
          SELECT count(*)
          FROM grupos_produto_zero
        ) AS grupos_repetidos_produto_zero,

        (
          SELECT count(*)
          FROM origem
          LEFT JOIN ${dimensaoBloqueio} dimensao
            ON dimensao.id_bloqueio =
               origem.id_bloqueio
          WHERE origem.id_bloqueio IS NOT NULL
            AND dimensao.id_bloqueio IS NULL
        ) AS bloqueios_sem_descricao,

        (
          SELECT count(*)
          FROM origem
          LEFT JOIN ${vendas} venda
            ON venda.id_nota_saida =
               origem.id_nota_saida
          WHERE origem.id_nota_saida IS NOT NULL
            AND venda.id_nota_saida IS NULL
        ) AS bloqueios_sem_nota_saida

    `;
  }
};
