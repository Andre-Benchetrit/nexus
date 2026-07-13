const { criarLeitorBronze } = require('../duckdb/bronze');
const { obterEntidade } = require('../exportadores/catalogo');

const OPERACOES = [
  'listar_entidades',
  'descrever_entidade',
  'contar',
  'consultar'
];

const definicaoConsultarBronze = {
  type: 'function',
  name: 'consultar_bronze',
  description: 'Consulta de forma somente leitura as entidades aprovadas da camada bronze do Nexus.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      operacao: {
        type: 'string',
        enum: OPERACOES,
        description: 'A operação que deve ser executada.'
      },
      entidade: {
        type: ['string', 'null'],
        enum: ['cliente', 'nota_saida', null],
        description: 'Entidade do bronze; use null somente ao listar entidades.'
      },
      visao: {
        type: ['string', 'null'],
        enum: ['atual', 'historico', null],
        description: 'Use atual por padrão; histórico inclui versões anteriores.'
      },
      id: {
        type: ['string', 'null'],
        description: 'Chave primária para busca direta, ou null.'
      },
      colunas: {
        anyOf: [
          { type: 'array', items: { type: 'string' } },
          { type: 'null' }
        ],
        description: 'Colunas aprovadas a retornar, ou null para as colunas padrão.'
      },
      filtros: {
        anyOf: [
          {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                campo: { type: 'string' },
                operador: {
                  type: 'string',
                  enum: ['igual', 'contem'],
                  description: 'Use contem para busca textual parcial, como nomes de clientes.'
                },
                valor: { type: ['string', 'null'] }
              },
              required: ['campo', 'operador', 'valor'],
              additionalProperties: false
            }
          },
          { type: 'null' }
        ],
        description: 'Filtros seguros. contem ignora maiúsculas/minúsculas e busca o texto em qualquer posição.'
      },
      combinacao_filtros: {
        type: ['string', 'null'],
        enum: ['todos', 'qualquer', null],
        description: 'todos combina filtros com E; qualquer combina com OU; use qualquer ao buscar um nome em fantasia ou razsocial.'
      },
      limite: {
        type: ['integer', 'null'],
        minimum: 1,
        maximum: 100,
        description: 'Máximo de linhas retornadas, entre 1 e 100, ou null para 50.'
      }
    },
    required: ['operacao', 'entidade', 'visao', 'id', 'colunas', 'filtros', 'combinacao_filtros', 'limite'],
    additionalProperties: false
  }
};

function serializar(valor) {
  return JSON.stringify(valor, (_, item) => (
    typeof item === 'bigint' ? item.toString() : item
  ));
}

function validarEstrutura(argumentos) {
  if (!argumentos || typeof argumentos !== 'object' || Array.isArray(argumentos)) {
    throw new Error('Argumentos da tool devem ser um objeto.');
  }
  if (!OPERACOES.includes(argumentos.operacao)) {
    throw new Error(`Operação inválida: ${argumentos.operacao}`);
  }
  if (argumentos.limite !== null && argumentos.limite !== undefined) {
    if (!Number.isInteger(argumentos.limite) || argumentos.limite < 1 || argumentos.limite > 100) {
      throw new Error('limite da tool deve ser um inteiro entre 1 e 100.');
    }
  }
  if (argumentos.filtros !== null && argumentos.filtros !== undefined && !Array.isArray(argumentos.filtros)) {
    throw new Error('filtros deve ser uma lista ou null.');
  }
}

function obterPolitica(entidadeNome) {
  const entidade = obterEntidade(entidadeNome);
  const permitidas = entidade.consulta?.colunasAgente || entidade.consulta?.colunasPadrao || [];
  return { entidade, permitidas: new Set(permitidas) };
}

function normalizarFiltros(filtros, permitidas) {
  const resultado = {};
  for (const filtro of filtros || []) {
    if (!filtro || typeof filtro.campo !== 'string') {
      throw new Error('Cada filtro precisa de campo e valor.');
    }
    if (!permitidas.has(filtro.campo)) {
      throw new Error(`Campo não permitido para o agente: ${filtro.campo}`);
    }
    if (Object.hasOwn(resultado, filtro.campo)) {
      throw new Error(`Filtro duplicado: ${filtro.campo}`);
    }
    const operador = filtro.operador || 'igual';
    if (!['igual', 'contem'].includes(operador)) {
      throw new Error(`Operador de filtro inválido: ${operador}`);
    }
    if (operador === 'contem' && typeof filtro.valor !== 'string') {
      throw new Error('O operador contem exige um valor de texto.');
    }
    resultado[filtro.campo] = { operador, valor: filtro.valor };
  }
  return resultado;
}

async function executarConsultarBronze(argumentos, dependencias = {}) {
  validarEstrutura(argumentos);
  const criarLeitor = dependencias.criarLeitor || criarLeitorBronze;
  const leitor = criarLeitor();

  try {
    if (argumentos.operacao === 'listar_entidades') {
      return serializar(await leitor.listarEntidades());
    }
    if (!argumentos.entidade) throw new Error('entidade é obrigatória para esta operação.');

    const { entidade, permitidas } = obterPolitica(argumentos.entidade);
    const filtros = normalizarFiltros(argumentos.filtros, permitidas);
    const visao = argumentos.visao || 'atual';
    const combinacaoFiltros = argumentos.combinacao_filtros || 'todos';

    if (argumentos.operacao === 'descrever_entidade') {
      const schema = await leitor.descreverEntidade(argumentos.entidade);
      return serializar({
        entidade: argumentos.entidade,
        colunas: schema.filter((coluna) => permitidas.has(coluna.nome))
      });
    }

    if (argumentos.operacao === 'contar') {
      return serializar(await leitor.contar(argumentos.entidade, {
        visao,
        filtros,
        combinacaoFiltros
      }));
    }

    const colunas = argumentos.colunas || [...permitidas];
    for (const coluna of colunas) {
      if (!permitidas.has(coluna)) {
        throw new Error(`Coluna não permitida para o agente: ${coluna}`);
      }
    }
    const opcoes = {
      visao,
      filtros,
      combinacaoFiltros,
      colunas,
      limite: argumentos.limite || 50
    };
    const resultado = argumentos.id === null || argumentos.id === undefined
      ? await leitor.consultar(argumentos.entidade, opcoes)
      : await leitor.buscarPorId(argumentos.entidade, argumentos.id, opcoes);

    return serializar({
      ...resultado,
      chavePrimaria: entidade.extracao.chavePrimaria
    });
  } finally {
    await leitor.fechar();
  }
}

module.exports = {
  definicaoConsultarBronze,
  executarConsultarBronze
};
