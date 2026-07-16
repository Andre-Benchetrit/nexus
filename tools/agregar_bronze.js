const { criarLeitorBronze } = require('../duckdb/bronze');
const {
  OPERADORES_FILTRO,
  serializar,
  obterPolitica,
  normalizarFiltros
} = require('./consultar_bronze');

const OPERACOES_CALCULO = ['contar', 'somar', 'media', 'minimo', 'maximo'];
const GRANULARIDADES = ['valor', 'dia', 'mes', 'ano'];

const schemaFiltros = {
  anyOf: [
    {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          campo: { type: 'string' },
          operador: { type: 'string', enum: OPERADORES_FILTRO },
          valor: { type: ['string', 'null'] },
          valor_final: { type: ['string', 'null'] },
          valores: {
            anyOf: [
              { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string' } },
              { type: 'null' }
            ]
          }
        },
        required: ['campo', 'operador', 'valor', 'valor_final', 'valores'],
        additionalProperties: false
      }
    },
    { type: 'null' }
  ]
};

const definicaoAgregarBronze = {
  type: 'function',
  name: 'agregar_bronze',
  description: 'Calcula contagens, somas, médias, mínimos e máximos agrupados sobre entidades aprovadas do bronze.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      entidade: {
        type: 'string',
        enum: ['cliente', 'nota_saida']
      },
      visao: {
        type: ['string', 'null'],
        enum: ['atual', 'historico', null]
      },
      agrupamentos: {
        anyOf: [
          {
            type: 'array',
            maxItems: 3,
            items: {
              type: 'object',
              properties: {
                campo: { type: 'string' },
                granularidade: {
                  type: 'string',
                  enum: GRANULARIDADES,
                  description: 'Use valor normalmente; dia, mes ou ano somente para datas.'
                }
              },
              required: ['campo', 'granularidade'],
              additionalProperties: false
            }
          },
          { type: 'null' }
        ],
        description: 'Até três dimensões. null produz um cálculo global.'
      },
      calculos: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            operacao: { type: 'string', enum: OPERACOES_CALCULO },
            campo: {
              type: ['string', 'null'],
              description: 'Use null somente para contar todos os registros.'
            }
          },
          required: ['operacao', 'campo'],
          additionalProperties: false
        }
      },
      filtros: schemaFiltros,
      combinacao_filtros: {
        type: ['string', 'null'],
        enum: ['todos', 'qualquer', null]
      },
      ordenacao: {
        anyOf: [
          {
            type: 'object',
            properties: {
              tipo: { type: 'string', enum: ['agrupamento', 'calculo'] },
              indice: { type: 'integer', minimum: 0, maximum: 4 },
              direcao: { type: 'string', enum: ['asc', 'desc'] }
            },
            required: ['tipo', 'indice', 'direcao'],
            additionalProperties: false
          },
          { type: 'null' }
        ],
        description: 'Ordena pelo índice do agrupamento ou cálculo; null ordena pelo primeiro cálculo desc.'
      },
      limite: {
        type: ['integer', 'null'],
        minimum: 1,
        maximum: 100
      }
    },
    required: [
      'entidade',
      'visao',
      'agrupamentos',
      'calculos',
      'filtros',
      'combinacao_filtros',
      'ordenacao',
      'limite'
    ],
    additionalProperties: false
  }
};

function validarLista(valor, nome, minimo, maximo) {
  if (!Array.isArray(valor) || valor.length < minimo || valor.length > maximo) {
    throw new Error(`${nome} deve ter entre ${minimo} e ${maximo} itens.`);
  }
}

async function executarAgregarBronze(argumentos, dependencias = {}) {
  if (!argumentos || typeof argumentos !== 'object' || Array.isArray(argumentos)) {
    throw new Error('Argumentos da tool devem ser um objeto.');
  }
  if (!argumentos.entidade) throw new Error('entidade é obrigatória.');

  const { permitidas } = obterPolitica(argumentos.entidade);
  const agrupamentos = argumentos.agrupamentos || [];
  validarLista(agrupamentos, 'agrupamentos', 0, 3);
  validarLista(argumentos.calculos, 'calculos', 1, 5);

  for (const grupo of agrupamentos) {
    if (!grupo || !permitidas.has(grupo.campo)) {
      throw new Error(`Campo de agrupamento não permitido para o agente: ${grupo?.campo}`);
    }
    if (!GRANULARIDADES.includes(grupo.granularidade)) {
      throw new Error(`Granularidade inválida: ${grupo.granularidade}`);
    }
  }

  for (const calculo of argumentos.calculos) {
    if (!calculo || !OPERACOES_CALCULO.includes(calculo.operacao)) {
      throw new Error(`Operação de cálculo inválida: ${calculo?.operacao}`);
    }
    if (calculo.campo !== null && calculo.campo !== undefined && !permitidas.has(calculo.campo)) {
      throw new Error(`Campo de cálculo não permitido para o agente: ${calculo.campo}`);
    }
    if (calculo.operacao !== 'contar' && !calculo.campo) {
      throw new Error(`A operação ${calculo.operacao} exige um campo.`);
    }
  }

  const filtros = normalizarFiltros(argumentos.filtros, permitidas);
  const criarLeitor = dependencias.criarLeitor || criarLeitorBronze;
  const leitor = criarLeitor();
  try {
    return serializar(await leitor.agregar(argumentos.entidade, {
      visao: argumentos.visao || 'atual',
      agrupamentos,
      calculos: argumentos.calculos,
      filtros,
      combinacaoFiltros: argumentos.combinacao_filtros || 'todos',
      ordenacao: argumentos.ordenacao || undefined,
      limite: argumentos.limite || 50
    }));
  } finally {
    await leitor.fechar();
  }
}

module.exports = {
  definicaoAgregarBronze,
  executarAgregarBronze,
  OPERACOES_CALCULO,
  GRANULARIDADES
};
