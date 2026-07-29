const { criarLeitorSilver } = require('../duckdb/silver');
const {
  serializar,
  validarLimite,
  validarObjeto
} = require('./core/validacao');

const PESSOAS = Object.freeze({
  funcionarios: {
    objeto: 'dim_funcionario',
    id: 'id_funcionario',
    nome: 'funcionario',
    ativo: 'funcionario_ativo',
    colunas: [
      'id_funcionario', 'funcionario', 'id_empresa', 'id_funcao',
      'funcionario_ativo'
    ]
  },
  transportadoras: {
    objeto: 'dim_transportadora',
    id: 'id_transportadora',
    nome: 'transportadora',
    ativo: 'transportadora_ativa',
    colunas: [
      'id_transportadora', 'transportadora', 'id_empresa',
      'transportadora_cidade', 'transportadora_ativa'
    ]
  }
});

const definicaoAnalisarPessoas = {
  type: 'function',
  name: 'analisar_pessoas',
  description: 'Conta ou lista funcionarios e transportadoras cadastrados em todas as empresas.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      cadastro: {
        type: 'string',
        enum: Object.keys(PESSOAS)
      },
      operacao: {
        type: 'string',
        enum: ['resumir', 'listar']
      },
      status: {
        type: 'string',
        enum: ['ativos', 'inativos', 'todos']
      },
      id_empresa: {
        type: ['integer', 'null'],
        minimum: 1
      },
      busca: {
        type: ['string', 'null']
      },
      limite: {
        type: 'integer',
        minimum: 1,
        maximum: 30
      }
    },
    required: ['cadastro', 'operacao', 'status', 'id_empresa', 'busca', 'limite'],
    additionalProperties: false
  }
};

function montarFiltros(configuracao, argumentos) {
  const filtros = {};
  if (argumentos.status !== 'todos') {
    filtros[configuracao.ativo] = {
      operador: 'igual',
      valor: argumentos.status === 'ativos' ? 'true' : 'false'
    };
  }
  if (argumentos.id_empresa != null) {
    if (!Number.isInteger(argumentos.id_empresa) || argumentos.id_empresa < 1) {
      throw new Error('id_empresa deve ser um inteiro positivo ou null.');
    }
    filtros.id_empresa = {
      operador: 'igual',
      valor: String(argumentos.id_empresa)
    };
  }
  if (argumentos.busca != null && String(argumentos.busca).trim()) {
    filtros[configuracao.nome] = {
      operador: 'contem',
      valor: String(argumentos.busca).trim()
    };
  }
  return filtros;
}

async function executarAnalisarPessoas(argumentos, dependencias = {}) {
  validarObjeto(argumentos);
  const configuracao = PESSOAS[argumentos.cadastro];
  if (!configuracao) throw new Error(`Cadastro de pessoas invalido: ${argumentos.cadastro}.`);
  if (!['resumir', 'listar'].includes(argumentos.operacao)) {
    throw new Error(`Operacao de pessoas invalida: ${argumentos.operacao}.`);
  }
  if (!['ativos', 'inativos', 'todos'].includes(argumentos.status)) {
    throw new Error(`Status de pessoas invalido: ${argumentos.status}.`);
  }
  const limite = validarLimite(argumentos.limite, 20, 30);
  const filtros = montarFiltros(configuracao, argumentos);
  const leitor = (dependencias.criarLeitor || criarLeitorSilver)();
  try {
    const contagem = await leitor.contar(configuracao.objeto, { filtros });
    const total = contagem.total;
    if (argumentos.operacao === 'resumir') {
      return serializar({
        cadastro: argumentos.cadastro,
        status: argumentos.status,
        id_empresa: argumentos.id_empresa,
        busca: argumentos.busca,
        total,
        atualizado_em: contagem.ultimaConstrucao || null
      });
    }

    const resultado = await leitor.consultar(configuracao.objeto, {
      filtros,
      colunas: configuracao.colunas,
      ordenacao: { campo: configuracao.nome, direcao: 'asc' },
      limite
    });
    return serializar({
      cadastro: argumentos.cadastro,
      status: argumentos.status,
      id_empresa: argumentos.id_empresa,
      busca: argumentos.busca,
      total,
      total_retornado: resultado.dados.length,
      resultado_truncado: BigInt(resultado.dados.length) < BigInt(total),
      dados: resultado.dados,
      atualizado_em: resultado.ultimaConstrucao || contagem.ultimaConstrucao || null
    });
  } finally {
    await leitor.fechar();
  }
}

module.exports = {
  definicaoAnalisarPessoas,
  executarAnalisarPessoas,
  montarFiltros,
  PESSOAS
};
