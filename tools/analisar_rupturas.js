const { criarLeitorGold } = require('../duckdb/gold');
const {
  serializar,
  validarLimite,
  validarLista,
  validarObjeto
} = require('./core/validacao');

const CLASSIFICACOES = Object.freeze([
  'RUPTURA_ATUAL',
  'CRITICO',
  'ALTO',
  'MEDIO',
  'SAUDAVEL',
  'SEM_ESTOQUE_SEM_GIRO',
  'SEM_GIRO'
]);
const ALERTAS_PADRAO = Object.freeze(['RUPTURA_ATUAL', 'CRITICO', 'ALTO', 'MEDIO']);

const definicaoAnalisarRupturas = {
  type: 'function',
  name: 'analisar_rupturas',
  description: 'Consulta risco de ruptura da empresa 10. Cobertura usa estoque disponivel e saidas de venda dos ultimos 90 dias, sem reposicoes futuras.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      operacao: {
        type: 'string',
        description: 'resumir para quantidades; listar somente quando pedir nomes de produtos; ranquear para marcas/grupos/categorias.',
        enum: [
          'resumir', 'listar', 'ranquear_marcas',
          'ranquear_grupos', 'ranquear_categorias'
        ]
      },
      classificacoes: {
        type: ['array', 'null'],
        maxItems: CLASSIFICACOES.length,
        items: { type: 'string', enum: CLASSIFICACOES }
      },
      marca: { type: ['string', 'null'] },
      produto: { type: ['string', 'null'] },
      limite: { type: 'integer', minimum: 1, maximum: 20 }
    },
    required: ['operacao', 'classificacoes', 'marca', 'produto', 'limite'],
    additionalProperties: false
  }
};

function normalizarClassificacoes(valor, operacao) {
  if (valor == null || valor.length === 0) {
    return operacao === 'resumir' ? [...CLASSIFICACOES] : [...ALERTAS_PADRAO];
  }
  validarLista(valor, 'classificacoes', 1, CLASSIFICACOES.length);
  const unicas = [...new Set(valor)];
  for (const classificacao of unicas) {
    if (!CLASSIFICACOES.includes(classificacao)) {
      throw new Error(`Classificacao de ruptura invalida: ${classificacao}`);
    }
  }
  return unicas;
}

function montarFiltros(argumentos, classificacoes) {
  const filtros = {
    classificacao_risco: {
      operador: 'em',
      valor: null,
      valores: classificacoes
    }
  };
  if (argumentos.marca) {
    filtros.marca = { operador: 'contem', valor: String(argumentos.marca).trim() };
  }
  if (argumentos.produto) {
    filtros.descricao_produto = {
      operador: 'contem',
      valor: String(argumentos.produto).trim()
    };
  }
  return filtros;
}

function numero(valor) {
  return valor == null ? null : Number(valor);
}

function ordenarRiscos(linhas) {
  return [...linhas].sort((a, b) => (
    numero(a.prioridade_risco) - numero(b.prioridade_risco) ||
    numero(b.saida_venda_30d) - numero(a.saida_venda_30d) ||
    (numero(a.dias_cobertura) ?? Number.POSITIVE_INFINITY) -
      (numero(b.dias_cobertura) ?? Number.POSITIVE_INFINITY) ||
    numero(a.id_produto) - numero(b.id_produto)
  ));
}

async function executarAnalisarRupturas(argumentos, dependencias = {}) {
  validarObjeto(argumentos);
  const operacoes = [
    'resumir', 'listar', 'ranquear_marcas',
    'ranquear_grupos', 'ranquear_categorias'
  ];
  if (!operacoes.includes(argumentos.operacao)) {
    throw new Error(`Operacao de rupturas invalida: ${argumentos.operacao}`);
  }
  const limite = validarLimite(argumentos.limite, 10, 20);
  const classificacoes = normalizarClassificacoes(
    argumentos.classificacoes,
    argumentos.operacao
  );
  const leitor = (dependencias.criarLeitor || criarLeitorGold)();
  try {
    if (argumentos.operacao === 'resumir') {
      const resultado = await leitor.agregar('risco_ruptura_produto', {
        agrupamentos: [{ campo: 'classificacao_risco', granularidade: 'valor' }],
        calculos: [{ operacao: 'contar', campo: null }],
        filtros: montarFiltros(argumentos, classificacoes),
        ordenacao: { tipo: 'calculo', indice: 0, direcao: 'desc' },
        limite: CLASSIFICACOES.length
      });
      return serializar({
        empresa: 10,
        janela_demanda_dias: 90,
        considera_reposicoes_futuras: false,
        classificacoes: resultado.dados.map((linha) => ({
          classificacao: linha.grupo_1,
          quantidade_produtos: linha.calculo_1
        })),
        atualizado_em: resultado.ultimaConstrucao
      });
    }

    if (argumentos.operacao.startsWith('ranquear_')) {
      const dimensoes = {
        ranquear_marcas: ['marca', 'marcas'],
        ranquear_grupos: ['grupo', 'grupos'],
        ranquear_categorias: ['categoria', 'categorias']
      };
      const [campoDimensao, campoSaida] = dimensoes[argumentos.operacao];
      const resultado = await leitor.agregar('risco_ruptura_produto', {
        agrupamentos: [{ campo: campoDimensao, granularidade: 'valor' }],
        calculos: [
          { operacao: 'contar', campo: null },
          { operacao: 'somar', campo: 'saida_venda_30d' },
          { operacao: 'somar', campo: 'valor_estoque_custo' }
        ],
        filtros: montarFiltros(argumentos, classificacoes),
        ordenacao: { tipo: 'calculo', indice: 0, direcao: 'desc' },
        limite
      });
      return serializar({
        empresa: 10,
        janela_demanda_dias: 90,
        considera_reposicoes_futuras: false,
        classificacoes_consideradas: classificacoes,
        [campoSaida]: resultado.dados.map((linha) => ({
          [campoDimensao]: linha.grupo_1 || `SEM ${campoDimensao.toUpperCase()}`,
          produtos_em_alerta: linha.calculo_1,
          saida_venda_30d: linha.calculo_2,
          valor_estoque_custo: linha.calculo_3
        })),
        atualizado_em: resultado.ultimaConstrucao
      });
    }

    const resultado = await leitor.consultar('risco_ruptura_produto', {
      filtros: montarFiltros(argumentos, classificacoes),
      colunas: [
        'id_produto',
        'descricao_produto',
        'sku',
        'marca',
        'grupo',
        'estoque_disponivel',
        'quantidade_reservada',
        'custo_produto_atual',
        'valor_estoque_custo',
        'saida_venda_30d',
        'saida_venda_90d',
        'media_diaria_saida_90d',
        'dias_cobertura',
        'data_estimada_ruptura',
        'classificacao_risco',
        'prioridade_risco',
        'premissa_sem_reposicao'
      ],
      limite: 500
    });
    return serializar({
      empresa: 10,
      janela_demanda_dias: 90,
      considera_reposicoes_futuras: false,
      dados: ordenarRiscos(resultado.dados).slice(0, limite),
      atualizado_em: resultado.ultimaConstrucao
    });
  } finally {
    await leitor.fechar();
  }
}

module.exports = {
  ALERTAS_PADRAO,
  CLASSIFICACOES,
  definicaoAnalisarRupturas,
  executarAnalisarRupturas
};
