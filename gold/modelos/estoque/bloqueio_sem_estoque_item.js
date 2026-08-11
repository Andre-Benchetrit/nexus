function citar(nome) {
  return `"${nome.replace(/"/g, '""')}"`;
}

module.exports = {
  nome: 'bloqueio_sem_estoque_item',
  tipo: 'fato_gold',
  descricao:
    'Ocorrencias ativas do bloqueio 58 elegiveis para acompanhamento operacional.',
  versaoContrato: 1,
  permiteVazio: true,
  chavePrimaria: [
    'id_nota_saida',
    'id_bloqueio',
    'id_empresa',
    'sequencia_ocorrencia'
  ],
  fontesSilver: ['fato_nota_saida_bloqueio_item'],
  fontesGold: [],
  colunas: [
    'id_nota_saida',
    'id_bloqueio',
    'id_empresa',
    'sequencia_ocorrencia',
    'marketplace_pedido',
    'id_produto',
    'produto_identificado',
    'sku',
    'ean',
    'descricao_produto',
    'quantidade_pedida',
    'canal_venda',
    'dt_limite_expedicao',
    'dthr_bloqueio',
    'descricao_bloqueio',
    'bloqueio_ativo',
    'canal_meli_coleta_ext',
    'meli_incluido_por_limite_hoje'
  ],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: [
      'id_nota_saida',
      'marketplace_pedido',
      'id_produto',
      'sku',
      'descricao_produto',
      'quantidade_pedida',
      'canal_venda',
      'dt_limite_expedicao',
      'dthr_bloqueio'
    ],
    colunasAgente: [
      'id_nota_saida', 'id_bloqueio', 'id_empresa', 'sequencia_ocorrencia',
      'marketplace_pedido', 'id_produto', 'produto_identificado', 'sku', 'ean',
      'descricao_produto', 'quantidade_pedida', 'canal_venda',
      'dt_limite_expedicao', 'dthr_bloqueio', 'descricao_bloqueio',
      'bloqueio_ativo', 'canal_meli_coleta_ext', 'meli_incluido_por_limite_hoje'
    ]
  },

  construirSql(contextosSilver) {
    const detalhe = citar(
      contextosSilver.get('fato_nota_saida_bloqueio_item').viewAtual
    );
    return `
      WITH candidatos AS (
        SELECT
          *,
          regexp_replace(
            upper(coalesce(canal_venda, '')),
            '[^A-Z0-9]+',
            '',
            'g'
          ) LIKE 'MELICOLETA%EXT' AS canal_meli_coleta_ext,
          CAST(timezone('America/Sao_Paulo', current_timestamp) AS DATE)
            AS hoje_sao_paulo
        FROM ${detalhe}
        WHERE id_bloqueio = 58
          AND bloqueio_ativo = true
          AND id_tp_pedido = 1
          AND pedido_bloqueado = true
      )
      SELECT
        id_nota_saida,
        id_bloqueio,
        id_empresa,
        sequencia_ocorrencia,
        marketplace_pedido,
        id_produto,
        produto_cadastrado AS produto_identificado,
        sku,
        ean,
        descricao_produto,
        quantidade_pedida,
        canal_venda,
        dt_limite_expedicao,
        dthr_bloqueio,
        descricao_bloqueio,
        bloqueio_ativo,
        canal_meli_coleta_ext,
        canal_meli_coleta_ext
          AND dt_limite_expedicao = hoje_sao_paulo
          AS meli_incluido_por_limite_hoje
      FROM candidatos
      WHERE NOT canal_meli_coleta_ext
         OR dt_limite_expedicao = hoje_sao_paulo
    `;
  }
};
