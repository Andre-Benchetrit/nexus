const { serializar, validarObjeto } = require('./core/validacao');
const { REGRAS_EXCECAO, detectarExcecoes } = require('./core/inteligencia_produto');

const definicaoDetectarExcecoesProduto = {
  type: 'function',
  name: 'detectar_excecoes_produto',
  description: 'Detecta localmente alertas e exceções de produtos nos dados do Sysemp. Não agenda nem envia notificações.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      data_inicial: { type: ['string', 'null'] },
      data_final: { type: ['string', 'null'] },
      filtros: {
        type: ['object', 'null'],
        properties: {
          produto: { type: ['string', 'null'] },
          marca: { type: ['string', 'null'] },
          categoria: { type: ['string', 'null'] }
        },
        required: ['produto', 'marca', 'categoria'],
        additionalProperties: false
      },
      regras: { type: ['array', 'null'], maxItems: REGRAS_EXCECAO.length,
        items: { type: 'string', enum: REGRAS_EXCECAO } },
      limites: {
        type: ['object', 'null'],
        properties: {
          queda_pct: { type: ['number', 'null'], minimum: 0, maximum: 100 },
          concentracao_canal_pct: { type: ['number', 'null'], minimum: 0, maximum: 100 },
          diferenca_periodo_pct: { type: ['number', 'null'], minimum: 0, maximum: 1000 }
        },
        required: ['queda_pct', 'concentracao_canal_pct', 'diferenca_periodo_pct'],
        additionalProperties: false
      },
      limite_resultados: { type: 'integer', minimum: 1, maximum: 50 }
    },
    required: ['data_inicial', 'data_final', 'filtros', 'regras', 'limites', 'limite_resultados'],
    additionalProperties: false
  }
};

async function executarDetectarExcecoesProduto(argumentos, dependencias = {}) {
  validarObjeto(argumentos);
  return serializar(await detectarExcecoes(argumentos, dependencias));
}

module.exports = { definicaoDetectarExcecoesProduto, executarDetectarExcecoesProduto };
