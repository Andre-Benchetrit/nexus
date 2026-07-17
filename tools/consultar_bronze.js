const { criarLeitorBronze } = require('../duckdb/bronze');
const { obterEntidade, listarEntidadesAgente } = require('../exportadores/catalogo');

const ENTIDADES_PERMITIDAS_AGENTE = Object.freeze(listarEntidadesAgente());

const OPERACOES = [
  'listar_entidades',
  'descrever_entidade',
  'contar',
  'consultar'
];

const OPERADORES_FILTRO = [
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
        enum: [...ENTIDADES_PERMITIDAS_AGENTE, null],
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
                  enum: OPERADORES_FILTRO,
                  description: 'Use contem para texto parcial e operadores maior/menor para números ou datas.'
                },
                valor: { type: ['string', 'null'] },
                valor_final: {
                  type: ['string', 'null'],
                  description: 'Fim do intervalo para operador entre; null nos demais operadores.'
                },
                valores: {
                  anyOf: [
                    { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string' } },
                    { type: 'null' }
                  ],
                  description: 'Lista para os operadores em e nao_em; null nos demais.'
                }
              },
              required: ['campo', 'operador', 'valor', 'valor_final', 'valores'],
              additionalProperties: false
            }
          },
          { type: 'null' }
        ],
        description: 'Filtros seguros de igualdade, diferença, comparação e busca textual parcial.'
      },
      combinacao_filtros: {
        type: ['string', 'null'],
        enum: ['todos', 'qualquer', null],
        description: 'todos combina filtros com E; qualquer combina com OU; use qualquer ao buscar um nome em fantasia ou razsocial.'
      },
      ordenacao: {
        anyOf: [
          {
            type: 'object',
            properties: {
              campo: { type: 'string' },
              direcao: {
                type: 'string',
                enum: ['asc', 'desc']
              }
            },
            required: ['campo', 'direcao'],
            additionalProperties: false
          },
          { type: 'null' }
        ],
        description: 'Ordenação segura. Para últimos registros, use a data de negócio com direcao desc.'
      },
      deslocamento: {
        type: ['integer', 'null'],
        minimum: 0,
        maximum: 10000,
        description: 'Quantidade de linhas a pular para paginação; use null ou 0 na primeira página.'
      },
      limite: {
        type: ['integer', 'null'],
        minimum: 1,
        maximum: 100,
        description: 'Máximo de linhas retornadas, entre 1 e 100, ou null para 50.'
      }
    },
    required: ['operacao', 'entidade', 'visao', 'id', 'colunas', 'filtros', 'combinacao_filtros', 'ordenacao', 'deslocamento', 'limite'],
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
  if (argumentos.deslocamento !== null && argumentos.deslocamento !== undefined) {
    if (!Number.isInteger(argumentos.deslocamento) || argumentos.deslocamento < 0 || argumentos.deslocamento > 10000) {
      throw new Error('deslocamento deve ser um inteiro entre 0 e 10000.');
    }
  }
}

function obterPolitica(entidadeNome) {
  const entidade = obterEntidade(entidadeNome);
  if (entidade.consulta?.habilitadaParaAgente !== true) {
    throw new Error(`Entidade não permitida para o agente: ${entidadeNome}`);
  }
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
    if (!OPERADORES_FILTRO.includes(operador)) {
      throw new Error(`Operador de filtro inválido: ${operador}`);
    }
    if (['contem', 'comeca_com', 'termina_com'].includes(operador) && typeof filtro.valor !== 'string') {
      throw new Error(`O operador ${operador} exige um valor de texto.`);
    }
    if (operador === 'entre' && (filtro.valor === null || filtro.valor === undefined || filtro.valor_final === null || filtro.valor_final === undefined)) {
      throw new Error('O operador entre exige valor e valor_final.');
    }
    if (['em', 'nao_em'].includes(operador) && (!Array.isArray(filtro.valores) || filtro.valores.length < 1 || filtro.valores.length > 50)) {
      throw new Error(`O operador ${operador} exige entre 1 e 50 valores.`);
    }
    const normalizado = {
      operador,
      valor: filtro.valor
    };
    if (filtro.valor_final !== undefined) normalizado.valorFinal = filtro.valor_final;
    if (filtro.valores !== undefined) normalizado.valores = filtro.valores;
    resultado[filtro.campo] = normalizado;
  }
  return resultado;
}

function normalizarOrdenacao(ordenacao, permitidas) {
  if (ordenacao === null || ordenacao === undefined) return null;
  if (!ordenacao || typeof ordenacao !== 'object' || Array.isArray(ordenacao)) {
    throw new Error('ordenacao deve ser um objeto ou null.');
  }
  if (!permitidas.has(ordenacao.campo)) {
    throw new Error(`Campo de ordenação não permitido para o agente: ${ordenacao.campo}`);
  }
  if (!['asc', 'desc'].includes(ordenacao.direcao)) {
    throw new Error('direcao da ordenação deve ser asc ou desc.');
  }
  return { campo: ordenacao.campo, direcao: ordenacao.direcao };
}

async function executarConsultarBronze(argumentos, dependencias = {}) {
  validarEstrutura(argumentos);
  const criarLeitor = dependencias.criarLeitor || criarLeitorBronze;
  const leitor = criarLeitor();

  try {
    if (argumentos.operacao === 'listar_entidades') {
      const entidades = await leitor.listarEntidades();
      return serializar(
        entidades.filter((item) => ENTIDADES_PERMITIDAS_AGENTE.includes(item.entidade))
      );
    }
    if (!argumentos.entidade) throw new Error('entidade é obrigatória para esta operação.');

    const { entidade, permitidas } = obterPolitica(argumentos.entidade);
    const filtros = normalizarFiltros(argumentos.filtros, permitidas);
    const ordenacao = normalizarOrdenacao(argumentos.ordenacao, permitidas);
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
      ordenacao,
      colunas,
      deslocamento: argumentos.deslocamento || 0,
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
  executarConsultarBronze,
  OPERADORES_FILTRO,
  serializar,
  obterPolitica,
  normalizarFiltros,
  ENTIDADES_PERMITIDAS_AGENTE
};
