const { criarLeitorSilver } = require('../duckdb/silver');
const { criarSchemaFiltros, OPERADORES_FILTRO_SIMPLES } = require('./core/contratos');
const {
  normalizarFiltros,
  serializar,
  validarLimite,
  validarLista,
  validarObjeto
} = require('./core/validacao');

const DIMENSOES = Object.freeze({
  grupo: 'grupo',
  subgrupo: 'subgrupo',
  marca: 'marca',
  categoria: 'categoria'
});
const CAMPOS_FILTRO = Object.freeze({
  produto: 'descricao_produto',
  grupo: 'grupo',
  subgrupo: 'subgrupo',
  marca: 'marca',
  categoria: 'categoria'
});

const definicaoAnalisarCatalogo = {
  type: 'function',
  name: 'analisar_catalogo',
  description: 'Analisa o cadastro de produtos atual por grupo, subgrupo, marca ou categoria.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      operacao: { type: 'string', enum: ['resumir', 'ranquear', 'listar'] },
      agrupar_por: { type: ['string', 'null'], enum: [...Object.keys(DIMENSOES), null] },
      status: { type: 'string', enum: ['ativos', 'site', 'todos'] },
      filtros: criarSchemaFiltros({
        campos: Object.keys(CAMPOS_FILTRO),
        operadores: OPERADORES_FILTRO_SIMPLES,
        maxItems: 5,
        simples: true
      }),
      incluir_estoque: { type: 'boolean' },
      limite: { type: 'integer', minimum: 1, maximum: 20 }
    },
    required: ['operacao', 'agrupar_por', 'status', 'filtros', 'incluir_estoque', 'limite'],
    additionalProperties: false
  }
};

function montarFiltros(argumentos) {
  const filtros = {};
  if (argumentos.status === 'ativos') {
    filtros.produto_ativo = { operador: 'igual', valor: 'true' };
  } else if (argumentos.status === 'site') {
    filtros.catalogo_site_ativo = { operador: 'igual', valor: 'true' };
  }
  const filtrosEntrada = argumentos.filtros ?? [];
  validarLista(filtrosEntrada, 'filtros', 0, 5);
  const normalizados = normalizarFiltros(
    filtrosEntrada,
    new Set(Object.keys(CAMPOS_FILTRO)),
    OPERADORES_FILTRO_SIMPLES
  );
  for (const [nome, filtro] of Object.entries(normalizados)) {
    filtros[CAMPOS_FILTRO[nome]] = filtro;
  }
  return filtros;
}

async function executarAnalisarCatalogo(argumentos, dependencias = {}) {
  validarObjeto(argumentos);
  if (!['resumir', 'ranquear', 'listar'].includes(argumentos.operacao)) {
    throw new Error(`Operacao de catalogo invalida: ${argumentos.operacao}`);
  }
  if (!['ativos', 'site', 'todos'].includes(argumentos.status)) {
    throw new Error(`Status de catalogo invalido: ${argumentos.status}`);
  }
  if (typeof argumentos.incluir_estoque !== 'boolean') {
    throw new Error('incluir_estoque deve ser booleano.');
  }
  const filtros = montarFiltros(argumentos);
  const limite = validarLimite(argumentos.limite, 10, 20);
  const dimensao = argumentos.operacao === 'resumir' ? null : argumentos.agrupar_por;
  if (argumentos.operacao === 'ranquear' && !dimensao) {
    throw new Error('ranquear exige agrupar_por.');
  }
  if (dimensao && !DIMENSOES[dimensao]) {
    throw new Error(`Dimensao de catalogo invalida: ${dimensao}`);
  }
  const calculos = [{ operacao: 'contar', campo: null }];
  if (argumentos.incluir_estoque) calculos.push({ operacao: 'somar', campo: 'estoque' });
  const leitor = (dependencias.criarLeitor || criarLeitorSilver)();
  try {
    if (argumentos.operacao === 'listar') {
      const resultado = await leitor.consultar('dim_produto', {
        filtros,
        colunas: [
          'id_produto', 'descricao_produto', 'sku', 'ean', 'grupo',
          'subgrupo', 'marca', 'categoria', 'estoque', 'produto_ativo'
        ],
        ordenacao: { campo: 'descricao_produto', direcao: 'asc' },
        limite
      });
      return serializar({
        status: argumentos.status,
        dados: resultado.dados,
        atualizado_em: resultado.ultimaConstrucao
      });
    }

    const resultado = await leitor.agregar('dim_produto', {
      agrupamentos: dimensao
        ? [{ campo: DIMENSOES[dimensao], granularidade: 'valor' }]
        : [],
      calculos,
      filtros,
      limite: argumentos.operacao === 'resumir' ? 1 : limite
    });
    const dados = resultado.dados.map((linha) => ({
      ...(dimensao ? { [dimensao]: linha.grupo_1 } : {}),
      quantidade_produtos: linha.calculo_1,
      ...(argumentos.incluir_estoque ? { estoque_total: linha.calculo_2 } : {})
    }));
    return serializar({
      status: argumentos.status,
      agrupado_por: dimensao || null,
      dados,
      atualizado_em: resultado.ultimaConstrucao
    });
  } finally {
    await leitor.fechar();
  }
}

module.exports = {
  definicaoAnalisarCatalogo,
  executarAnalisarCatalogo,
  CAMPOS_FILTRO,
  DIMENSOES
};
