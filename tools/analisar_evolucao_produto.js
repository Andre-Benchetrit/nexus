const { serializar, validarObjeto } = require('./core/validacao');
const { METRICAS, seletorSchema, analisarEvolucao } = require('./core/inteligencia_produto');

const definicaoAnalisarEvolucaoProduto = {
  type: 'function',
  name: 'analisar_evolucao_produto',
  description: 'Acompanha uma coorte fixa de produtos nos dados do Sysemp por dia, semana ou mês, mantendo pedidos e faturamento separados.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      selecao: seletorSchema(),
      data_inicial: { type: ['string', 'null'] },
      data_final: { type: ['string', 'null'] },
      granularidade: { type: 'string', enum: ['dia', 'semana', 'mes'] },
      metricas: { type: ['array', 'null'], maxItems: METRICAS.length,
        items: { type: 'string', enum: METRICAS } },
      comparar_periodo_anterior: { type: 'boolean' }
    },
    required: ['selecao', 'data_inicial', 'data_final', 'granularidade', 'metricas',
      'comparar_periodo_anterior'],
    additionalProperties: false
  }
};

async function executarAnalisarEvolucaoProduto(argumentos, dependencias = {}) {
  validarObjeto(argumentos);
  return serializar(await analisarEvolucao(argumentos, dependencias));
}

module.exports = { definicaoAnalisarEvolucaoProduto, executarAnalisarEvolucaoProduto };
