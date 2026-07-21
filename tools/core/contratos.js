const OPERADORES_FILTRO = Object.freeze([
  'igual',
  'diferente',
  'contem',
  'comeca_com',
  'termina_com',
  'maior_que',
  'maior_ou_igual',
  'menor_que',
  'menor_ou_igual',
  'entre',
  'em',
  'nao_em',
  'esta_vazio',
  'nao_esta_vazio'
]);

const OPERACOES_CALCULO = Object.freeze(['contar', 'somar', 'media', 'minimo', 'maximo']);
const GRANULARIDADES = Object.freeze(['valor', 'dia', 'mes', 'ano']);
const OPERADORES_FILTRO_SIMPLES = Object.freeze(['igual', 'diferente', 'contem']);

function criarSchemaFiltros(opcoes = {}) {
  const campos = opcoes.campos;
  const properties = {
    campo: campos ? { type: 'string', enum: campos } : { type: 'string' },
    operador: { type: 'string', enum: opcoes.operadores || OPERADORES_FILTRO },
    valor: { type: ['string', 'null'] }
  };
  if (!opcoes.simples) {
    properties.valor_final = { type: ['string', 'null'] };
    properties.valores = {
      anyOf: [
        { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string' } },
        { type: 'null' }
      ]
    };
  }
  return {
    anyOf: [
      {
        type: 'array',
        maxItems: opcoes.maxItems || 10,
        items: {
          type: 'object',
          properties,
          required: Object.keys(properties),
          additionalProperties: false
        }
      },
      { type: 'null' }
    ]
  };
}

module.exports = {
  GRANULARIDADES,
  OPERACOES_CALCULO,
  OPERADORES_FILTRO,
  OPERADORES_FILTRO_SIMPLES,
  criarSchemaFiltros
};
