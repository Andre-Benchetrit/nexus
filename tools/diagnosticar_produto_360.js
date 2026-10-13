const { serializar, validarObjeto } = require('./core/validacao');
const { diagnosticar360 } = require('./core/inteligencia_produto');

const PRODUTO = {
  type: 'object',
  properties: {
    tipo: { type: 'string', enum: ['id_produto', 'sku', 'ean', 'descricao'] },
    valor: { type: 'string' }
  },
  required: ['tipo', 'valor'],
  additionalProperties: false
};

const definicaoDiagnosticarProduto360 = {
  type: 'function',
  name: 'diagnosticar_produto_360',
  description: 'Diagnóstico 360 de um produto: desempenho, canais, estoque atual, giro, ruptura e reposição. O estoque é uma fotografia atual.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      produto: PRODUTO,
      data_inicial: { type: ['string', 'null'] },
      data_final: { type: ['string', 'null'] },
      comparar_com_periodo_anterior: { type: 'boolean' }
    },
    required: ['produto', 'data_inicial', 'data_final', 'comparar_com_periodo_anterior'],
    additionalProperties: false
  }
};

async function executarDiagnosticarProduto360(argumentos, dependencias = {}) {
  validarObjeto(argumentos);
  return serializar(await diagnosticar360(argumentos, dependencias));
}

module.exports = { definicaoDiagnosticarProduto360, executarDiagnosticarProduto360 };
