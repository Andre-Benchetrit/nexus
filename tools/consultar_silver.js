const { criarLeitorSilver } = require('../duckdb/silver');
const { obterObjeto, listarObjetosAgente } = require('../silver/catalogo');
const {
  OPERADORES_FILTRO,
  serializar,
  normalizarFiltros
} = require('./consultar_bronze');

const OBJETOS_PERMITIDOS_AGENTE = Object.freeze(listarObjetosAgente());
const OPERACOES = ['listar_objetos', 'descrever_objeto', 'contar', 'consultar'];

const definicaoConsultarSilver = {
  type: 'function',
  name: 'consultar_silver',
  description: 'Consulta objetos Silver enriquecidos e aprovados para perguntas de negocio no Nexus.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      operacao: { type: 'string', enum: OPERACOES },
      objeto: { type: ['string', 'null'], enum: [...OBJETOS_PERMITIDOS_AGENTE, null] },
      visao: { type: ['string', 'null'], enum: ['atual', 'historico', null] },
      id: { type: ['string', 'null'] },
      colunas: {
        anyOf: [
          { type: 'array', items: { type: 'string' } },
          { type: 'null' }
        ]
      },
      filtros: {
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
      },
      combinacao_filtros: { type: ['string', 'null'], enum: ['todos', 'qualquer', null] },
      ordenacao: {
        anyOf: [
          {
            type: 'object',
            properties: {
              campo: { type: 'string' },
              direcao: { type: 'string', enum: ['asc', 'desc'] }
            },
            required: ['campo', 'direcao'],
            additionalProperties: false
          },
          { type: 'null' }
        ]
      },
      deslocamento: { type: ['integer', 'null'], minimum: 0, maximum: 10000 },
      limite: { type: ['integer', 'null'], minimum: 1, maximum: 100 }
    },
    required: [
      'operacao', 'objeto', 'visao', 'id', 'colunas', 'filtros',
      'combinacao_filtros', 'ordenacao', 'deslocamento', 'limite'
    ],
    additionalProperties: false
  }
};

function obterPoliticaSilver(nome) {
  const objeto = obterObjeto(nome);
  if (objeto.consulta?.habilitadaParaAgente !== true) {
    throw new Error(`Objeto Silver nao permitido para o agente: ${nome}`);
  }
  const colunas = objeto.consulta.colunasAgente || objeto.consulta.colunasPadrao || [];
  return { objeto, permitidas: new Set(colunas) };
}

function normalizarOrdenacao(ordenacao, permitidas) {
  if (ordenacao == null) return null;
  if (!permitidas.has(ordenacao.campo)) {
    throw new Error(`Campo de ordenacao Silver nao permitido: ${ordenacao.campo}`);
  }
  if (!['asc', 'desc'].includes(ordenacao.direcao)) throw new Error('direcao deve ser asc ou desc.');
  return { campo: ordenacao.campo, direcao: ordenacao.direcao };
}

async function executarConsultarSilver(argumentos, dependencias = {}) {
  if (!argumentos || typeof argumentos !== 'object' || Array.isArray(argumentos)) {
    throw new Error('Argumentos da tool devem ser um objeto.');
  }
  if (!OPERACOES.includes(argumentos.operacao)) throw new Error(`Operacao invalida: ${argumentos.operacao}`);
  if (argumentos.limite != null && (!Number.isInteger(argumentos.limite) || argumentos.limite < 1 || argumentos.limite > 100)) {
    throw new Error('limite da tool deve estar entre 1 e 100.');
  }
  const leitor = (dependencias.criarLeitor || criarLeitorSilver)();
  try {
    if (argumentos.operacao === 'listar_objetos') {
      const objetos = await leitor.listarObjetos();
      return serializar(objetos.filter((item) => OBJETOS_PERMITIDOS_AGENTE.includes(item.objeto)));
    }
    if (!argumentos.objeto) throw new Error('objeto e obrigatorio para esta operacao.');
    const { objeto, permitidas } = obterPoliticaSilver(argumentos.objeto);
    const filtros = normalizarFiltros(argumentos.filtros, permitidas);
    const ordenacao = normalizarOrdenacao(argumentos.ordenacao, permitidas);
    const visao = argumentos.visao || 'atual';
    const combinacaoFiltros = argumentos.combinacao_filtros || 'todos';

    if (argumentos.operacao === 'descrever_objeto') {
      const schema = await leitor.descreverObjeto(argumentos.objeto);
      return serializar({
        objeto: argumentos.objeto,
        colunas: schema.filter((coluna) => permitidas.has(coluna.nome))
      });
    }
    if (argumentos.operacao === 'contar') {
      return serializar(await leitor.contar(argumentos.objeto, { visao, filtros, combinacaoFiltros }));
    }
    const colunas = argumentos.colunas || [...permitidas];
    for (const coluna of colunas) {
      if (!permitidas.has(coluna)) throw new Error(`Coluna Silver nao permitida: ${coluna}`);
    }
    const opcoes = {
      visao,
      filtros,
      combinacaoFiltros,
      ordenacao,
      colunas,
      deslocamento: argumentos.deslocamento || 0,
      limite: argumentos.limite || 50
    };
    const resultado = argumentos.id == null
      ? await leitor.consultar(argumentos.objeto, opcoes)
      : await leitor.buscarPorId(argumentos.objeto, argumentos.id, opcoes);
    return serializar({ ...resultado, chavePrimaria: objeto.chavePrimaria });
  } finally {
    await leitor.fechar();
  }
}

module.exports = {
  definicaoConsultarSilver,
  executarConsultarSilver,
  obterPoliticaSilver,
  OBJETOS_PERMITIDOS_AGENTE
};
