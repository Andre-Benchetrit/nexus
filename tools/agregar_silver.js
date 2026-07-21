const { criarLeitorSilver } = require('../duckdb/silver');
const { obterPoliticaSilver, OBJETOS_PERMITIDOS_AGENTE } = require('./consultar_silver');
const { GRANULARIDADES, OPERACOES_CALCULO, criarSchemaFiltros } = require('./core/contratos');
const { normalizarFiltros, serializar, validarObjeto } = require('./core/validacao');

const definicaoAgregarSilver = {
  type: 'function',
  name: 'agregar_silver',
  description: 'Agrupa e calcula dados de negocio em objetos Silver enriquecidos, sem aceitar SQL livre.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      objeto: { type: 'string', enum: OBJETOS_PERMITIDOS_AGENTE },
      visao: { type: ['string', 'null'], enum: ['atual', 'historico', null] },
      agrupamentos: {
        anyOf: [
          {
            type: 'array',
            maxItems: 3,
            items: {
              type: 'object',
              properties: {
                campo: { type: 'string' },
                granularidade: { type: 'string', enum: GRANULARIDADES }
              },
              required: ['campo', 'granularidade'],
              additionalProperties: false
            }
          },
          { type: 'null' }
        ]
      },
      calculos: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            operacao: { type: 'string', enum: OPERACOES_CALCULO },
            campo: { type: ['string', 'null'] }
          },
          required: ['operacao', 'campo'],
          additionalProperties: false
        }
      },
      filtros: criarSchemaFiltros(),
      combinacao_filtros: { type: ['string', 'null'], enum: ['todos', 'qualquer', null] },
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
        ]
      },
      limite: { type: ['integer', 'null'], minimum: 1, maximum: 100 }
    },
    required: [
      'objeto', 'visao', 'agrupamentos', 'calculos', 'filtros',
      'combinacao_filtros', 'ordenacao', 'limite'
    ],
    additionalProperties: false
  }
};

async function executarAgregarSilver(argumentos, dependencias = {}) {
  validarObjeto(argumentos);
  if (!argumentos.objeto) throw new Error('objeto e obrigatorio.');
  const { permitidas } = obterPoliticaSilver(argumentos.objeto);
  const agrupamentos = argumentos.agrupamentos || [];
  const calculos = argumentos.calculos;
  if (!Array.isArray(agrupamentos) || agrupamentos.length > 3) {
    throw new Error('agrupamentos deve ter no maximo 3 itens.');
  }
  if (!Array.isArray(calculos) || calculos.length < 1 || calculos.length > 5) {
    throw new Error('calculos deve ter entre 1 e 5 itens.');
  }
  for (const grupo of agrupamentos) {
    if (!permitidas.has(grupo?.campo)) throw new Error(`Campo Silver de agrupamento nao permitido: ${grupo?.campo}`);
    if (!GRANULARIDADES.includes(grupo.granularidade)) throw new Error(`Granularidade invalida: ${grupo.granularidade}`);
  }
  for (const calculo of calculos) {
    if (!OPERACOES_CALCULO.includes(calculo?.operacao)) throw new Error(`Operacao invalida: ${calculo?.operacao}`);
    if (calculo.campo != null && !permitidas.has(calculo.campo)) {
      throw new Error(`Campo Silver de calculo nao permitido: ${calculo.campo}`);
    }
    if (calculo.operacao !== 'contar' && !calculo.campo) {
      throw new Error(`A operacao ${calculo.operacao} exige um campo.`);
    }
  }
  const filtros = normalizarFiltros(argumentos.filtros, permitidas);
  const leitor = (dependencias.criarLeitor || criarLeitorSilver)();
  try {
    return serializar(await leitor.agregar(argumentos.objeto, {
      visao: argumentos.visao || 'atual',
      agrupamentos,
      calculos,
      filtros,
      combinacaoFiltros: argumentos.combinacao_filtros || 'todos',
      ordenacao: argumentos.ordenacao || undefined,
      limite: argumentos.limite || 50
    }));
  } finally {
    await leitor.fechar();
  }
}

module.exports = { definicaoAgregarSilver, executarAgregarSilver };
