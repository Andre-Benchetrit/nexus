const { consultarConjunto } = require('../nexus/dataset_query_engine');

const definicaoConsultarConjuntoNexus = Object.freeze({
  type: 'function', name: 'consultar_conjunto_nexus', strict: true,
  description: 'Cruza em lote um dataset_ref autorizado com catálogo, estoque ou vendas. Nunca envie os identificadores individualmente.',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      dataset_ref: { type: 'string', description: 'UUID opaco fornecido pelo Nexus.' },
      dominio: { type: 'string', enum: ['catalogo', 'estoque', 'vendas'] },
      operacao: { type: 'string', enum: ['enriquecer', 'filtrar', 'ranquear', 'comparar'] },
      periodo: { type: ['object', 'null'], additionalProperties: false,
        properties: { inicio: { type: ['string', 'null'] }, fim: { type: ['string', 'null'] } },
        required: ['inicio', 'fim'] }
    },
    required: ['dataset_ref', 'dominio', 'operacao', 'periodo']
  }
});

async function executarConsultarConjuntoNexus(argumentos, dependencias = {}) {
  return consultarConjunto(argumentos, dependencias);
}

module.exports = { definicaoConsultarConjuntoNexus, executarConsultarConjuntoNexus };
