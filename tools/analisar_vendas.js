const { criarLeitorSilver } = require('../duckdb/silver');
const { criarSchemaFiltros, OPERADORES_FILTRO_SIMPLES } = require('./core/contratos');
const {
  normalizarFiltros,
  serializar,
  validarLimite,
  validarLista,
  validarObjeto
} = require('./core/validacao');

const NIVEIS = Object.freeze(['pedido', 'item']);
const METRICAS = Object.freeze(['pedidos', 'itens', 'quantidade', 'valor']);
const ORDENACOES = Object.freeze([...METRICAS, 'data', 'data_pedido', 'data_emissao']);
const OPERADORES_FILTRO_VENDAS = Object.freeze([
  ...OPERADORES_FILTRO_SIMPLES,
  'esta_vazio',
  'nao_esta_vazio'
]);
const DIMENSOES = Object.freeze({
  produto: { campo: 'descricao_produto', nivel: 'item' },
  marca: { campo: 'marca', nivel: 'item' },
  grupo: { campo: 'grupo', nivel: 'item' },
  subgrupo: { campo: 'subgrupo', nivel: 'item' },
  categoria: { campo: 'categoria', nivel: 'item' },
  cliente: { campo: 'cliente' },
  tipo_pedido: { campo: 'tipo_pedido' },
  plataforma: { campo: 'plataforma' },
  transportadora: { campos: ['id_transportadora', 'transporte_regras'] },
  transporte_regra: { campo: 'transporte_regras' },
  uf_entrega: { campo: 'entrega_uf' }
});
const CAMPOS_FILTRO = Object.freeze({
  produto: { campo: 'descricao_produto', nivel: 'item' },
  marca: { campo: 'marca', nivel: 'item' },
  grupo: { campo: 'grupo', nivel: 'item' },
  subgrupo: { campo: 'subgrupo', nivel: 'item' },
  categoria: { campo: 'categoria', nivel: 'item' },
  cliente: { campo: 'cliente' },
  tipo_pedido: { campo: 'tipo_pedido' },
  id_tipo_pedido: { campo: 'id_tp_pedido' },
  plataforma: { campo: 'plataforma' },
  transportadora: { campo: 'transporte_regras' },
  transporte_regra: { campo: 'transporte_regras' },
  uf_entrega: { campo: 'entrega_uf' },
  situacao: { campo: 'situacao' },
  nota_emitida: { campo: 'nota_emitida' }
});
const CONFIGURACAO_NIVEL = Object.freeze({
  pedido: {
    objeto: 'fato_venda',
    dataPadrao: 'data_pedido',
    colunasLista: [
      'id_nota_saida', 'id_nr_nf', 'data_pedido', 'data_emissao', 'cliente',
      'tipo_pedido', 'plataforma', 'transporte_regras', 'marketplace_pedido',
      'valor_total_venda', 'nota_emitida'
    ],
    metricas: {
      pedidos: { operacao: 'contar', campo: null, saida: 'quantidade_pedidos' },
      valor: { operacao: 'somar', campo: 'valor_total_venda', saida: 'valor_total_vendas' }
    }
  },
  item: {
    objeto: 'fato_venda_item',
    dataPadrao: 'data_pedido',
    colunasLista: [
      'id_nota_saida', 'item', 'data_pedido', 'descricao_produto', 'marca',
      'cliente', 'plataforma', 'transporte_regras', 'marketplace_pedido',
      'quantidade', 'valor_total_item'
    ],
    metricas: {
      itens: { operacao: 'contar', campo: null, saida: 'quantidade_itens' },
      quantidade: { operacao: 'somar', campo: 'quantidade', saida: 'quantidade_vendida' },
      valor: { operacao: 'somar', campo: 'valor_total_item', saida: 'valor_total_vendido' }
    }
  }
});

const definicaoAnalisarVendas = {
  type: 'function',
  name: 'analisar_vendas',
  description: 'Consulta vendas no Silver. pedido conta cabecalhos; item analisa produtos. emissao considera somente notas emitidas.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      operacao: { type: 'string', enum: ['resumir', 'ranquear', 'listar'] },
      nivel: { type: 'string', enum: NIVEIS },
      agrupar_por: { type: ['string', 'null'], enum: [...Object.keys(DIMENSOES), null] },
      data_campo: { type: ['string', 'null'], enum: ['pedido', 'emissao', null] },
      data_inicial: { type: ['string', 'null'] },
      data_final: { type: ['string', 'null'] },
      filtros: criarSchemaFiltros({
        campos: Object.keys(CAMPOS_FILTRO),
        operadores: OPERADORES_FILTRO_VENDAS,
        maxItems: 6,
        simples: true
      }),
      metricas: {
        anyOf: [
          {
            type: 'array',
            maxItems: METRICAS.length,
            items: { type: 'string', enum: METRICAS }
          },
          { type: 'null' }
        ]
      },
      ordenar_por: {
        type: ['string', 'null'],
        enum: [...ORDENACOES, null]
      },
      limite: { type: 'integer', minimum: 1, maximum: 20 }
    },
    required: [
      'operacao', 'nivel', 'agrupar_por', 'data_campo', 'data_inicial',
      'data_final', 'filtros', 'metricas', 'ordenar_por', 'limite'
    ],
    additionalProperties: false
  }
};

function validarNivel(regra, nivel, rotulo) {
  if (regra?.nivel && regra.nivel !== nivel) {
    throw new Error(`${rotulo} exige nivel item.`);
  }
}

function montarFiltros(argumentos, configuracao) {
  const filtros = {};
  const filtrosEntrada = argumentos.filtros ?? [];
  validarLista(filtrosEntrada, 'filtros', 0, 6);
  const normalizados = normalizarFiltros(
    filtrosEntrada,
    new Set(Object.keys(CAMPOS_FILTRO)),
    OPERADORES_FILTRO_VENDAS
  );
  for (const [nome, filtro] of Object.entries(normalizados)) {
    const regra = CAMPOS_FILTRO[nome];
    validarNivel(regra, argumentos.nivel, `O filtro ${nome}`);
    filtros[regra.campo] = filtro;
  }

  const dataCampo = argumentos.data_campo === 'emissao'
    ? 'data_emissao'
    : configuracao.dataPadrao;
  if (argumentos.data_final && !argumentos.data_inicial) {
    throw new Error('data_final exige data_inicial.');
  }
  if (argumentos.data_inicial) {
    filtros[dataCampo] = argumentos.data_final
      ? { operador: 'entre', valor: argumentos.data_inicial, valorFinal: argumentos.data_final }
      : { operador: 'igual', valor: argumentos.data_inicial };
  }
  if (argumentos.data_campo === 'emissao') {
    filtros.faturamento_valido = { operador: 'igual', valor: 'true' };
  }
  return { filtros, dataCampo };
}

function montarMetricas(argumentos, configuracao) {
  const metricasEntrada = argumentos.metricas ?? [];
  validarLista(metricasEntrada, 'metricas', 0, METRICAS.length);
  const solicitadas = [...new Set(metricasEntrada)];
  const nomes = solicitadas.length
    ? solicitadas.filter((nome) => configuracao.metricas[nome])
    : Object.keys(configuracao.metricas);
  if (!nomes.length) {
    throw new Error(`Nenhuma metrica informada existe no nivel ${argumentos.nivel}.`);
  }
  return nomes.map((nome) => {
    const metrica = configuracao.metricas[nome];
    if (!metrica) throw new Error(`A metrica ${nome} nao existe no nivel ${argumentos.nivel}.`);
    return { nome, ...metrica };
  });
}

function renomearAgregacao(resultado, dimensao, regraDimensao, metricas) {
  return resultado.dados.map((linha) => {
    const saida = {};
    if (dimensao === 'transportadora') {
      saida.id_transportadora = linha.grupo_1;
      saida.transportadora = linha.grupo_2;
    } else if (dimensao) {
      saida[dimensao] = linha.grupo_1;
    }
    metricas.forEach((metrica, indice) => {
      saida[metrica.saida] = linha[`calculo_${indice + 1}`];
    });
    return saida;
  });
}

function renomearLinhasLista(linhas) {
  return linhas.map((linha) => {
    const {
      id_nota_saida: id_registro_venda,
      id_nr_nf: numero_nota_fiscal,
      marketplace_pedido: numero_pedido,
      transporte_regras: transportadora,
      ...demais
    } = linha;
    return {
      ...(id_registro_venda !== undefined ? { id_registro_venda } : {}),
      ...(numero_pedido !== undefined ? { numero_pedido } : {}),
      ...(numero_nota_fiscal !== undefined ? { numero_nota_fiscal } : {}),
      ...demais,
      ...(transportadora !== undefined ? { transportadora } : {})
    };
  });
}

function montarPlanoAgregacao(argumentos, configuracao) {
  const dimensao = argumentos.operacao === 'resumir' ? null : argumentos.agrupar_por;
  if (argumentos.operacao === 'ranquear' && !dimensao) {
    throw new Error('ranquear exige agrupar_por.');
  }
  const regraDimensao = dimensao ? DIMENSOES[dimensao] : null;
  if (dimensao && !regraDimensao) throw new Error(`Dimensao de vendas invalida: ${dimensao}`);
  validarNivel(regraDimensao, argumentos.nivel, `A dimensao ${dimensao}`);
  const metricas = montarMetricas(argumentos, configuracao);
  const ordenarPor = argumentos.ordenar_por || metricas[0].nome;
  const indiceOrdenacao = metricas.findIndex(({ nome }) => nome === ordenarPor);
  if (indiceOrdenacao < 0) throw new Error('ordenar_por precisa estar presente em metricas.');
  return { dimensao, regraDimensao, metricas, indiceOrdenacao };
}

async function executarAnalisarVendas(argumentos, dependencias = {}) {
  validarObjeto(argumentos);
  if (!['resumir', 'ranquear', 'listar'].includes(argumentos.operacao)) {
    throw new Error(`Operacao de vendas invalida: ${argumentos.operacao}`);
  }
  if (!NIVEIS.includes(argumentos.nivel)) throw new Error(`Nivel invalido: ${argumentos.nivel}`);
  if (![null, undefined, 'pedido', 'emissao'].includes(argumentos.data_campo)) {
    throw new Error(`Campo de data invalido: ${argumentos.data_campo}`);
  }
  const limite = validarLimite(argumentos.limite, 10, 20);
  const configuracao = CONFIGURACAO_NIVEL[argumentos.nivel];
  const { filtros, dataCampo } = montarFiltros(argumentos, configuracao);
  const plano = argumentos.operacao === 'listar'
    ? null
    : montarPlanoAgregacao(argumentos, configuracao);
  if (plano?.dimensao === 'transportadora') {
    filtros.id_transportadora = { operador: 'maior_que', valor: '0' };
  }
  const leitor = (dependencias.criarLeitor || criarLeitorSilver)();
  try {
    if (argumentos.operacao === 'listar') {
      const resultado = await leitor.consultar(configuracao.objeto, {
        filtros,
        colunas: configuracao.colunasLista,
        ordenacao: { campo: dataCampo, direcao: 'desc' },
        limite
      });
      return serializar({
        nivel: argumentos.nivel,
        data_utilizada: dataCampo,
        dados: renomearLinhasLista(resultado.dados),
        atualizado_em: resultado.ultimaConstrucao
      });
    }

    const { dimensao, regraDimensao, metricas, indiceOrdenacao } = plano;
    const resultado = await leitor.agregar(configuracao.objeto, {
      agrupamentos: regraDimensao
        ? (regraDimensao.campos || [regraDimensao.campo])
          .map((campo) => ({ campo, granularidade: 'valor' }))
        : [],
      calculos: metricas.map(({ operacao, campo }) => ({ operacao, campo })),
      filtros,
      ordenacao: { tipo: 'calculo', indice: indiceOrdenacao, direcao: 'desc' },
      limite: argumentos.operacao === 'resumir' ? 1 : limite
    });
    return serializar({
      nivel: argumentos.nivel,
      data_utilizada: dataCampo,
      agrupado_por: dimensao || null,
      dados: renomearAgregacao(resultado, dimensao, regraDimensao, metricas),
      atualizado_em: resultado.ultimaConstrucao
    });
  } finally {
    await leitor.fechar();
  }
}

module.exports = {
  definicaoAnalisarVendas,
  executarAnalisarVendas,
  CAMPOS_FILTRO,
  CONFIGURACAO_NIVEL,
  DIMENSOES
};
