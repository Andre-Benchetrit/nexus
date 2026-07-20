const { citar, flagBooleano, texto } = require('./util');

function obterViews(contextosBronze, contextosSilver) {
  return {
    plataformas: citar(contextosBronze.get('plataforma_ecommerce').viewAtual),
    regrasTransporte: citar(contextosSilver.get('dim_transporte_regra').viewAtual)
  };
}

module.exports = {
  nome: 'dim_plataforma_ecommerce',
  tipo: 'dimensao',
  descricao: 'Plataformas de e-commerce com regras de transporte associadas, sem credenciais da origem.',
  versaoContrato: 1,
  chavePrimaria: 'id_plataforma',
  fontePrincipal: 'plataforma_ecommerce',
  fontesBronze: ['plataforma_ecommerce'],
  fontesSilver: ['dim_transporte_regra'],
  colunas: [
    'id_plataforma',
    'codigo_plataforma',
    'plataforma',
    'plataforma_descricao',
    'plataforma_apelido',
    'plataforma_ativa',
    'plataforma_principal',
    'id_empresa',
    'id_transportadora_padrao',
    'transporte_regras_padrao',
    'quantidade_regras_transporte_padrao',
    'data_ultimo_pedido',
    'data_ultimo_produto',
    'data_ultimo_estoque',
    'data_ultimo_preco',
    'data_ultimo_status',
    'fonte_sistema',
    'processado_em'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_plataforma', 'plataforma', 'plataforma_ativa', 'transporte_regras_padrao'
    ],
    colunasAgente: [
      'id_plataforma', 'codigo_plataforma', 'plataforma', 'plataforma_descricao',
      'plataforma_apelido', 'plataforma_ativa', 'plataforma_principal',
      'id_empresa', 'id_transportadora_padrao', 'transporte_regras_padrao',
      'quantidade_regras_transporte_padrao',
      'data_ultimo_pedido', 'data_ultimo_produto', 'data_ultimo_estoque',
      'data_ultimo_preco', 'data_ultimo_status'
    ]
  },

  construirSql(contextosBronze, contextosSilver) {
    const views = obterViews(contextosBronze, contextosSilver);
    return `
      WITH regras_por_transportadora AS (
        SELECT
          id_transportadora,
          string_agg(DISTINCT transporte_regra, ' | ' ORDER BY transporte_regra)
            AS transporte_regras,
          count(*) AS quantidade_regras
        FROM ${views.regrasTransporte}
        WHERE id_transportadora > 0
        GROUP BY id_transportadora
      )
      SELECT
        p.id AS id_plataforma,
        p.plataforma AS codigo_plataforma,
        coalesce(${texto('p.apelido')}, ${texto('p.descricao')}) AS plataforma,
        ${texto('p.descricao')} AS plataforma_descricao,
        ${texto('p.apelido')} AS plataforma_apelido,
        ${flagBooleano('p.ativo')} AS plataforma_ativa,
        (coalesce(p.plataforma_principal, 0) <> 0) AS plataforma_principal,
        p.id_empresa,
        p.id_transportadora AS id_transportadora_padrao,
        tr.transporte_regras AS transporte_regras_padrao,
        tr.quantidade_regras AS quantidade_regras_transporte_padrao,
        p.data_ultimo_pedido,
        p.data_ultimo_produto,
        p.data_ultimo_estoque,
        p.data_ultimo_preco,
        p.data_ultimo_status,
        'postgres.sysemp.plataforma_ecommerce' AS fonte_sistema,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM ${views.plataformas} p
      LEFT JOIN regras_por_transportadora tr
        ON tr.id_transportadora = p.id_transportadora
    `;
  },

  construirMetricasRelacionamentosSql(contextosBronze, contextosSilver) {
    const views = obterViews(contextosBronze, contextosSilver);
    return `
      WITH regras_por_transportadora AS (
        SELECT DISTINCT id_transportadora
        FROM ${views.regrasTransporte}
        WHERE id_transportadora > 0
      )
      SELECT count(*) FILTER (
        WHERE p.id_transportadora > 0 AND tr.id_transportadora IS NULL
      ) AS plataformas_sem_regra_transporte_correspondente
      FROM ${views.plataformas} p
      LEFT JOIN regras_por_transportadora tr
        ON tr.id_transportadora = p.id_transportadora
    `;
  }
};
