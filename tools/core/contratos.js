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
    campo: {
      type: 'string',
      ...(campos ? { enum: campos } : {}),
      description: 'Campo. marketplace_pedido e o pedido externo; id_tipo_pedido e codigo interno.'
    },

    operador: {
      type: 'string',
      enum: opcoes.operadores || OPERADORES_FILTRO,
      description: 'Operador utilizado na comparação do filtro.'
    },

    valor: {
      type: ['string', 'null'],
      description: 'Valor como texto; null quando o operador nao usa valor unico.'
    }
  };

  if (!opcoes.simples) {
    properties.valor_final = {
      type: ['string', 'null'],
      description: 'Fim do intervalo ou null.'
    };

    properties.valores = {
      type: ['array', 'null'],
      description: 'Valores para em ou nao_em.',
      items: {
        type: 'string'
      },
      minItems: 1,
      maxItems: 50
    };
  }

  return {
    type: 'array',

    description: 'Array de filtros; use [] quando vazio.',

    maxItems: opcoes.maxItems || 10,

    items: {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false
    }
  };
}

module.exports = {
  GRANULARIDADES,
  OPERACOES_CALCULO,
  OPERADORES_FILTRO,
  OPERADORES_FILTRO_SIMPLES,
  criarSchemaFiltros
};
