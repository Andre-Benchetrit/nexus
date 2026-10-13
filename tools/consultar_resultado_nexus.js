const { consultarResultadoRef } = require('../nexus/result_ref_query_engine');

const definicaoConsultarResultadoNexus = Object.freeze({
  type: 'function',
  name: 'consultar_resultado_nexus',
  strict: true,
  description: 'Consulta e transforma localmente um result_ref autorizado da conversa. Use para listar, filtrar, ordenar, agrupar, recontar ou resumir dados já consultados, sem reconstruir números pela memória textual.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      result_ref: { type: 'string', description: 'UUID opaco do resultado autorizado informado pelo Nexus.' },
      operacao: { type: 'string', enum: ['consultar', 'agrupar', 'resumir'] },
      colunas: {
        type: 'array', maxItems: 30,
        items: { type: 'string' }
      },
      agrupar_por: {
        type: 'array', maxItems: 8,
        items: { type: 'string' }
      },
      metricas: {
        type: 'array', maxItems: 8,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            operacao: {
              type: 'string',
              enum: ['contar_linhas', 'contar_distintos', 'somar', 'media', 'minimo', 'maximo']
            },
            campo: { type: ['string', 'null'] }
          },
          required: ['operacao', 'campo']
        }
      },
      filtros: {
        type: 'array', maxItems: 12,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            campo: { type: 'string' },
            operador: {
              type: 'string',
              enum: [
                'igual', 'diferente', 'contem', 'comeca_com',
                'maior', 'maior_ou_igual', 'menor', 'menor_ou_igual',
                'em', 'nulo', 'nao_nulo'
              ]
            },
            valor: { type: ['string', 'number', 'boolean', 'null'] },
            valores: {
              type: 'array', maxItems: 100,
              items: { type: ['string', 'number', 'boolean'] }
            }
          },
          required: ['campo', 'operador', 'valor', 'valores']
        }
      },
      ordenar_por: { type: ['string', 'null'] },
      direcao: { type: 'string', enum: ['asc', 'desc'] },
      limite: { type: 'integer', minimum: 1, maximum: 5000 }
    },
    required: [
      'result_ref', 'operacao', 'colunas', 'agrupar_por', 'metricas',
      'filtros', 'ordenar_por', 'direcao', 'limite'
    ]
  }
});

async function executarConsultarResultadoNexus(argumentos, dependencias = {}) {
  return consultarResultadoRef(argumentos, dependencias);
}

module.exports = { definicaoConsultarResultadoNexus, executarConsultarResultadoNexus };
