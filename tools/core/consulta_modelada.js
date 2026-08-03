const { GRANULARIDADES, OPERACOES_CALCULO, criarSchemaFiltros } = require('./contratos');
const { normalizarFiltros, serializar, validarObjeto } = require('./validacao');

const OPERACOES_CONSULTA = Object.freeze([
  'listar_objetos', 'descrever_objeto', 'contar', 'consultar'
]);

function criarCamadaModelada({
  camada,
  descricao,
  criarLeitor,
  obterObjeto,
  listarObjetosAgente
}) {
  const rotulo = camada.charAt(0).toUpperCase() + camada.slice(1);
  const objetosPermitidos = Object.freeze(listarObjetosAgente());

  function obterPolitica(nome) {
    const objeto = obterObjeto(nome);
    if (objeto.consulta?.habilitadaParaAgente !== true) {
      throw new Error(`Objeto ${rotulo} nao permitido para o agente: ${nome}`);
    }
    const colunas = objeto.consulta.colunasAgente || objeto.consulta.colunasPadrao || [];
    return { objeto, permitidas: new Set(colunas) };
  }

  function normalizarOrdenacao(ordenacao, permitidas) {
    if (ordenacao == null) return null;
    if (!permitidas.has(ordenacao.campo)) {
      throw new Error(`Campo de ordenacao ${rotulo} nao permitido: ${ordenacao.campo}`);
    }
    if (!['asc', 'desc'].includes(ordenacao.direcao)) {
      throw new Error('direcao deve ser asc ou desc.');
    }
    return { campo: ordenacao.campo, direcao: ordenacao.direcao };
  }

  const definicaoConsultar = {
    type: 'function',
    name: `consultar_${camada}`,
    description: `Consulta objetos ${rotulo} ${descricao}, somente leitura e sem SQL livre.`,
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        operacao: { type: 'string', enum: OPERACOES_CONSULTA },
        objeto: { type: ['string', 'null'], enum: [...objetosPermitidos, null] },
        visao: { type: ['string', 'null'], enum: ['atual', 'historico', null] },
        id: { type: ['string', 'null'] },
        colunas: {
          anyOf: [
            { type: 'array', items: { type: 'string' } },
            { type: 'null' }
          ]
        },
        filtros: criarSchemaFiltros(),
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

  async function executarConsultar(argumentos, dependencias = {}) {
    validarObjeto(argumentos);
    if (!OPERACOES_CONSULTA.includes(argumentos.operacao)) {
      throw new Error(`Operacao invalida: ${argumentos.operacao}`);
    }
    if (argumentos.limite != null && (
      !Number.isInteger(argumentos.limite) || argumentos.limite < 1 || argumentos.limite > 100
    )) throw new Error('limite da tool deve estar entre 1 e 100.');

    const leitor = (dependencias.criarLeitor || criarLeitor)();
    try {
      if (argumentos.operacao === 'listar_objetos') {
        const objetos = await leitor.listarObjetos();
        return serializar(objetos.filter((item) => objetosPermitidos.includes(item.objeto)));
      }
      if (!argumentos.objeto) throw new Error('objeto e obrigatorio para esta operacao.');
      const { objeto, permitidas } = obterPolitica(argumentos.objeto);
      const filtros = normalizarFiltros(argumentos.filtros, permitidas);
      const ordenacao = normalizarOrdenacao(argumentos.ordenacao, permitidas);
      const visao = argumentos.visao || 'atual';
      const combinacaoFiltros = argumentos.combinacao_filtros || 'todos';

      if (argumentos.operacao === 'descrever_objeto') {
        const schema = await leitor.descreverObjeto(argumentos.objeto);
        return serializar({
          objeto: argumentos.objeto,
          descricao: objeto.descricao || null,
          colunas: schema.filter((coluna) => permitidas.has(coluna.nome))
        });
      }
      if (argumentos.operacao === 'contar') {
        return serializar(await leitor.contar(argumentos.objeto, {
          visao, filtros, combinacaoFiltros
        }));
      }
      const colunas = argumentos.colunas || [...permitidas];
      for (const coluna of colunas) {
        if (!permitidas.has(coluna)) {
          throw new Error(`Coluna ${rotulo} nao permitida: ${coluna}`);
        }
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

  const definicaoAgregar = {
    type: 'function',
    name: `agregar_${camada}`,
    description: `Agrupa e calcula objetos ${rotulo} ${descricao}, sem SQL livre.`,
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        objeto: { type: 'string', enum: objetosPermitidos },
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
          type: 'array', minItems: 1, maxItems: 5,
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

  async function executarAgregar(argumentos, dependencias = {}) {
    validarObjeto(argumentos);
    if (!argumentos.objeto) throw new Error('objeto e obrigatorio.');
    const { permitidas } = obterPolitica(argumentos.objeto);
    const agrupamentos = argumentos.agrupamentos || [];
    const calculos = argumentos.calculos;
    if (!Array.isArray(agrupamentos) || agrupamentos.length > 3) {
      throw new Error('agrupamentos deve ter no maximo 3 itens.');
    }
    if (!Array.isArray(calculos) || calculos.length < 1 || calculos.length > 5) {
      throw new Error('calculos deve ter entre 1 e 5 itens.');
    }
    for (const grupo of agrupamentos) {
      if (!permitidas.has(grupo?.campo)) {
        throw new Error(`Campo ${rotulo} de agrupamento nao permitido: ${grupo?.campo}`);
      }
      if (!GRANULARIDADES.includes(grupo.granularidade)) {
        throw new Error(`Granularidade invalida: ${grupo.granularidade}`);
      }
    }
    for (const calculo of calculos) {
      if (!OPERACOES_CALCULO.includes(calculo?.operacao)) {
        throw new Error(`Operacao invalida: ${calculo?.operacao}`);
      }
      if (calculo.campo != null && !permitidas.has(calculo.campo)) {
        throw new Error(`Campo ${rotulo} de calculo nao permitido: ${calculo.campo}`);
      }
      if (calculo.operacao !== 'contar' && !calculo.campo) {
        throw new Error(`A operacao ${calculo.operacao} exige um campo.`);
      }
    }
    const filtros = normalizarFiltros(argumentos.filtros, permitidas);
    const leitor = (dependencias.criarLeitor || criarLeitor)();
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

  return {
    definicaoConsultar,
    definicaoAgregar,
    executarConsultar,
    executarAgregar,
    obterPolitica,
    objetosPermitidos
  };
}

module.exports = { criarCamadaModelada, OPERACOES_CONSULTA };
