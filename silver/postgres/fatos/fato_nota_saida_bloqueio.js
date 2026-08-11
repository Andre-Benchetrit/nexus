const { citar } = require('../core/util');

module.exports = {
  nome: 'fato_nota_saida_bloqueio',
  tipo: 'fato',

  descricao:
    'Uma linha por nota de saida e tipo de bloqueio, consolidando as ocorrencias e produtos afetados.',

  versaoContrato: 1,
  preservaTotalEntrada: false,

  chavePrimaria: [
    'id_nota_saida',
    'id_bloqueio'
  ],

  fontePrincipal:
    'fato_nota_saida_bloqueio_item',

  fontesBronze: [],

  fontesSilver: [
    'fato_nota_saida_bloqueio_item'
  ],

  colunas: [
    'id_nota_saida',
    'id_bloqueio',
    'descricao_bloqueio',

    'quantidade_ocorrencias',
    'quantidade_produtos_cadastrados',
    'quantidade_produtos_nao_cadastrados',

    'bloqueio_ativo',
    'primeiro_bloqueio_em',
    'ultima_liberacao_em',
    'ultima_atualizacao_em',

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
      'quantidade_ocorrencias',
      'quantidade_produtos_cadastrados',
      'quantidade_produtos_nao_cadastrados',
      'bloqueio_ativo',
      'primeiro_bloqueio_em'
    ],

    colunasAgente: [
      'id_nota_saida',
      'id_bloqueio',
      'descricao_bloqueio',
      'quantidade_ocorrencias',
      'quantidade_produtos_cadastrados',
      'quantidade_produtos_nao_cadastrados',
      'bloqueio_ativo',
      'primeiro_bloqueio_em',
      'ultima_liberacao_em',
      'ultima_atualizacao_em',
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

  construirSql(_contextosBronze, contextosSilver) {
    const detalhe = citar(
      contextosSilver.get(
        'fato_nota_saida_bloqueio_item'
      ).viewAtual
    );

    return `
      SELECT
        id_nota_saida,
        id_bloqueio,

        max(descricao_bloqueio)
          AS descricao_bloqueio,

        count(*)
          AS quantidade_ocorrencias,

        count(
          DISTINCT id_produto
        ) FILTER (
          WHERE id_produto > 0
        ) AS quantidade_produtos_cadastrados,

        count(*) FILTER (
          WHERE id_produto = 0
        ) AS quantidade_produtos_nao_cadastrados,

        bool_or(
          coalesce(bloqueio_ativo, false)
        ) AS bloqueio_ativo,

        min(dthr_bloqueio)
          AS primeiro_bloqueio_em,

        max(dthr_liberacao)
          AS ultima_liberacao_em,

        max(dthr_atualizacao)
          AS ultima_atualizacao_em,

        max(id_nr_nf)
          AS id_nr_nf,

        max(id_pedido_vda_importado)
          AS id_pedido_vda_importado,

        max(marketplace_pedido)
          AS marketplace_pedido,

        max(data_pedido)
          AS data_pedido,

        max(data_emissao)
          AS data_emissao,

        max(cliente)
          AS cliente,

        max(plataforma)
          AS plataforma,

        max(canal_venda)
          AS canal_venda,

        max(dt_limite_expedicao)
          AS dt_limite_expedicao,

        max(id_tp_pedido)
          AS id_tp_pedido,

        bool_or(coalesce(pedido_bloqueado, false))
          AS pedido_bloqueado,

        max(valor_total_venda)
          AS valor_total_venda,

        bool_or(
          coalesce(faturamento_valido, false)
        ) AS faturamento_valido

      FROM ${detalhe}

      GROUP BY
        id_nota_saida,
        id_bloqueio
    `;
  },

  construirMetricasRelacionamentosSql(
    _contextosBronze,
    contextosSilver
  ) {
    const detalhe = citar(
      contextosSilver.get(
        'fato_nota_saida_bloqueio_item'
      ).viewAtual
    );

    return `
      WITH consolidado AS (
        SELECT
          id_nota_saida,
          id_bloqueio,
          count(*) AS quantidade_ocorrencias
        FROM ${detalhe}
        GROUP BY id_nota_saida, id_bloqueio
      )
      SELECT
        count(*) FILTER (
          WHERE descricao_bloqueio IS NULL
        ) AS ocorrencias_sem_descricao,

        count(*) FILTER (
          WHERE id_produto = 0
        ) AS ocorrencias_sem_produto_cadastrado,

        count(*) FILTER (
          WHERE id_pedido_vda_importado IS NULL
        ) AS ocorrencias_sem_id_pedido_importado,

        count(*) FILTER (
          WHERE dthr_bloqueio IS NULL
        ) AS ocorrencias_sem_data_bloqueio,

        (SELECT count(*) FROM ${detalhe})
          AS total_ocorrencias_detalhe,

        (SELECT coalesce(sum(quantidade_ocorrencias), 0) FROM consolidado)
          AS total_ocorrencias_consolidado

      FROM ${detalhe}
    `;
  },

  validarMetricasRelacionamentos(metricas) {
    if (
      Number(metricas.total_ocorrencias_detalhe) !==
      Number(metricas.total_ocorrencias_consolidado)
    ) {
      throw new Error(
        'Consolidacao de bloqueios perdeu ocorrencias entre detalhe e resumo.'
      );
    }
  }
};
