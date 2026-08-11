const { citar } = require('../core/util');

module.exports = {
  nome: 'dim_bloqueio',
  tipo: 'dimensao',

  descricao:
    'Catalogo dos tipos e motivos de bloqueio associados as notas de saida.',

  versaoContrato: 1,
  preservaTotalEntrada: false,

  chavePrimaria: 'id_bloqueio',

  fontePrincipal: 'bloqueios',

  fontesBronze: [
    'bloqueios'
  ],

  fontesSilver: [],

  colunas: [
    'id_bloqueio',
    'descricao_bloqueio'
  ],

  consulta: {
    habilitadaParaAgente: true,

    colunasPadrao: [
      'id_bloqueio',
      'descricao_bloqueio'
    ],

    colunasAgente: [
      'id_bloqueio',
      'descricao_bloqueio'
    ]
  },

  construirSql(contextosBronze) {
    const bloqueios = citar(
      contextosBronze.get('bloqueios').viewAtual
    );

    return `
      SELECT
        try_cast(id_bloqueio AS BIGINT) AS id_bloqueio,

        nullif(
          trim(cast(descricao AS VARCHAR)),
          ''
        ) AS descricao_bloqueio

      FROM ${bloqueios}

      WHERE try_cast(id_bloqueio AS BIGINT) IS NOT NULL
    `;
  },

  construirMetricasRelacionamentosSql(contextosBronze) {
    const bloqueios = citar(
      contextosBronze.get('bloqueios').viewAtual
    );

    return `
      WITH origem AS (
        SELECT
          try_cast(id_bloqueio AS BIGINT) AS id_bloqueio,

          nullif(
            trim(cast(descricao AS VARCHAR)),
            ''
          ) AS descricao_bloqueio

        FROM ${bloqueios}
      )

      SELECT
        count(*) FILTER (
          WHERE id_bloqueio IS NULL
        ) AS bloqueios_sem_id,

        count(*) FILTER (
          WHERE descricao_bloqueio IS NULL
        ) AS bloqueios_sem_descricao,

        count(*) - count(
          DISTINCT id_bloqueio
        ) AS ids_bloqueio_duplicados

      FROM origem
    `;
  }
};