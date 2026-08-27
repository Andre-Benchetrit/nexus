module.exports = {
  nome: 'kpi_pedidos_pagos_diario_por_empresa',
  tipo: 'indicador_dimensional',
  descricao: 'Pedidos pagos por data do pedido, separados por empresa.',
  versaoContrato: 1,
  chavePrimaria: ['data_referencia', 'id_empresa'],
  fontesSilver: ['fato_pedido_item'],
  fontesGold: [],
  colunas: ['data_referencia', 'id_empresa', 'pedidos_pagos', 'valor_pedidos_pagos', 'dados_parciais', 'processado_em'],
  consulta: {
    habilitadaParaAgente: true,
    colunasPadrao: ['data_referencia', 'id_empresa', 'pedidos_pagos', 'valor_pedidos_pagos'],
    colunasAgente: ['data_referencia', 'id_empresa', 'pedidos_pagos', 'valor_pedidos_pagos', 'dados_parciais']
  },
  construirSql(contextosSilver) {
    const itens = `"${contextosSilver.get('fato_pedido_item').viewAtual}"`;
    return `
      WITH base AS (
        SELECT * FROM ${itens}
        WHERE pedido_pago = true AND data_pedido IS NOT NULL AND id_empresa IS NOT NULL
      ), limite AS (SELECT max(data_pedido) AS ultima_data FROM base)
      SELECT
        CAST(data_pedido AS DATE) AS data_referencia,
        id_empresa,
        count(DISTINCT id_pedido_vda_importado) AS pedidos_pagos,
        CAST(coalesce(sum(valor_pedido_pago_item), 0) AS DECIMAL(18,2)) AS valor_pedidos_pagos,
        bool_or(data_pedido = limite.ultima_data) AS dados_parciais,
        CAST(current_timestamp AS TIMESTAMP) AS processado_em
      FROM base CROSS JOIN limite
      GROUP BY data_pedido, id_empresa
      ORDER BY data_pedido, id_empresa
    `;
  }
};
