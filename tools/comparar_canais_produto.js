const { serializar, validarObjeto } = require('./core/validacao');
const { METRICAS, seletorSchema, compararCanais } = require('./core/inteligencia_produto');

const definicaoCompararCanaisProduto = {
  type: 'function',
  name: 'comparar_canais_produto',
  description: 'Compara produtos por plataforma do Sysemp, incluindo pedidos, faturamento e margem estimada sem comissão.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      selecao: seletorSchema(),
      data_inicial: { type: ['string', 'null'] },
      data_final: { type: ['string', 'null'] },
      periodo_comparacao: {
        type: ['object', 'null'],
        properties: {
          data_inicial: { type: 'string' },
          data_final: { type: 'string' }
        },
        required: ['data_inicial', 'data_final'],
        additionalProperties: false
      },
      metricas: { type: ['array', 'null'], maxItems: METRICAS.length,
        items: { type: 'string', enum: METRICAS } },
      limite_canais: { type: 'integer', minimum: 1, maximum: 30 }
    },
    required: ['selecao', 'data_inicial', 'data_final', 'periodo_comparacao',
      'metricas', 'limite_canais'],
    additionalProperties: false
  }
};

async function executarCompararCanaisProduto(argumentos, dependencias = {}) {
  validarObjeto(argumentos);
  return serializar(await compararCanais(argumentos, dependencias));
}

module.exports = { definicaoCompararCanaisProduto, executarCompararCanaisProduto };
