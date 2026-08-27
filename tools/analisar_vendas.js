const { criarLeitorSilver } = require('../duckdb/silver');
const { OPERADORES_FILTRO_SIMPLES } = require('./core/contratos');
const {
  normalizarFiltros,
  serializar,
  validarLimite,
  validarLista,
  validarObjeto
} = require('./core/validacao');
const { validarIdEmpresa } = require('./core/empresas');

const NIVEIS = Object.freeze(['pedido', 'item']);
const OPERACOES = Object.freeze(['resumir', 'ranquear', 'listar', 'localizar_notas']);
const METRICAS = Object.freeze(['pedidos', 'itens', 'quantidade', 'valor']);
const ORDENACOES = Object.freeze([...METRICAS, 'data', 'data_pedido', 'data_emissao']);
const OPERADORES_FILTRO_VENDAS = Object.freeze([
  ...OPERADORES_FILTRO_SIMPLES,
  'esta_vazio',
  'nao_esta_vazio'
]);
const DIMENSOES = Object.freeze({
  produto: {
    campos: ['id_produto', 'descricao_produto', 'sku'],
    campo: 'descricao_produto',
    nivel: 'item'
  },
  id_produto: { campo: 'id_produto', nivel: 'item' },
  cod_barras: { campo: 'ean', nivel: 'item' },
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
  id_empresa: { campo: 'id_empresa' },
  produto: { campo: 'descricao_produto', nivel: 'item' },
  id_produto: { campo: 'id_produto', nivel: 'item' },
  cod_barras: { campo: 'ean', nivel: 'item' },
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
  nota_emitida: { campo: 'nota_emitida' },
  status_pedido: { campo: 'status_consolidado' },
  marketplace_pedido: { campo: 'marketplace_pedido' },
  id_nr_nf: { campo: 'id_nr_nf' },
  data_pedido: { campo: 'data_pedido' },
  data_emissao: { campo: 'data_emissao' }
});
const CONFIGURACAO_NIVEL = Object.freeze({
  pedido: {
    objeto: 'fato_pedido',
    objetoEmissao: 'fato_nota_fiscal',
    dataPadrao: 'data_pedido',
    colunasLista: [
      'id_nota_saida_pedido', 'id_pedido_vda_importado', 'data_pedido',
      'cliente', 'tipo_pedido', 'plataforma', 'transporte_regra',
      'transporte_regras',
      'marketplace_pedido', 'valor_pedido', 'status_consolidado',
      'numeros_notas_fiscais_validas'
    ],
    colunasListaEmissao: [
      'id_nota_saida', 'id_nr_nf', 'id_pedido_vda_importado',
      'data_pedido', 'data_emissao', 'cliente', 'tipo_pedido',
      'plataforma', 'transporte_regra', 'marketplace_pedido',
      'valor_total_venda'
    ],
    metricas: {
      pedidos: { operacao: 'contar', campo: null, saida: 'quantidade_pedidos' },
      valor: { operacao: 'somar', campo: 'valor_pedido', saida: 'valor_total_pedidos' }
    },
    metricasEmissao: {
      pedidos: { operacao: 'contar', campo: null, saida: 'quantidade_notas_fiscais' },
      valor: { operacao: 'somar', campo: 'valor_total_venda', saida: 'faturamento_emitido' }
    }
  },
  item: {
    objeto: 'fato_pedido_item',
    objetoEmissao: 'fato_nota_fiscal_item',
    dataPadrao: 'data_pedido',
    colunasLista: [
      'id_nota_saida', 'item', 'data_pedido', 'descricao_produto', 'marca',
      'cliente', 'plataforma', 'transporte_regras', 'marketplace_pedido',
      'quantidade', 'valor_pedido_pago_item'
    ],
    colunasListaEmissao: [
      'id_nota_saida', 'item', 'data_pedido', 'data_emissao',
      'descricao_produto', 'marca', 'cliente', 'plataforma',
      'transporte_regra', 'marketplace_pedido', 'quantidade_faturada',
      'valor_total_item'
    ],
    metricas: {
      itens: { operacao: 'contar', campo: null, saida: 'quantidade_itens' },
      quantidade: { operacao: 'somar', campo: 'quantidade', saida: 'quantidade_vendida' },
      valor: {
        operacao: 'somar',
        campo: 'valor_pedido_pago_item',
        saida: 'valor_total_vendido'
      }
    },
    metricasEmissao: {
      itens: { operacao: 'contar', campo: null, saida: 'quantidade_itens_faturados' },
      quantidade: {
        operacao: 'somar',
        campo: 'quantidade',
        saida: 'quantidade_faturada'
      },
      valor: { operacao: 'somar', campo: 'valor_total_item', saida: 'faturamento_emitido' }
    }
  }
});

function resolverConfiguracao(argumentos) {
  const base = CONFIGURACAO_NIVEL[argumentos.nivel];
  if (argumentos.data_campo !== 'emissao') return base;
  return {
    ...base,
    objeto: base.objetoEmissao,
    colunasLista: base.colunasListaEmissao,
    metricas: base.metricasEmissao
  };
}

const definicaoAnalisarVendas = {
  type: 'function',
  name: 'analisar_vendas',
  description: 'Vendas Silver. Lote de pedido externo: localizar_notas com pedidos_marketplace; retorna NFs e ausentes.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      operacao: {
        type: 'string',
        enum: OPERACOES,
        description: 'resumir totais; ranquear grupos; listar linhas; localizar_notas busca NFs.'
      },
      nivel: {
        type: 'string',
        enum: NIVEIS
      },
      agrupar_por: {
        type: ['string', 'null'],
        enum: [...Object.keys(DIMENSOES), null]
      },
      data_campo: {
        type: ['string', 'null'],
        enum: ['pedido', 'emissao', 'data_pedido', 'data_emissao', null],
        description: 'Use pedido/data_pedido para pedidos e emissao/data_emissao para faturamento.'
      },
      data_inicial: { type: ['string', 'null'] },
      data_final: { type: ['string', 'null'] },
      filtros: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            campo: { type: 'string', enum: Object.keys(CAMPOS_FILTRO) },
            operador: { type: 'string', enum: OPERADORES_FILTRO_VENDAS },
            valor: { type: ['string', 'null'] }
          },
          required: ['campo', 'operador', 'valor'],
          additionalProperties: false
        }
      },
      metricas: {
        type: ['array', 'null'],
        maxItems: METRICAS.length,
        items: { type: 'string', enum: METRICAS }
      },
      ordenar_por: {
        type: ['string', 'null'],
        enum: [...ORDENACOES, null]
      },
      limite: {
        type: ['integer', 'null'],
        minimum: 1,
        maximum: 20
      },
      pedidos_marketplace: {
        type: ['array', 'null'],
        description: 'IDs marketplace_pedido como texto; use null nas demais operacoes.',
        minItems: 1,
        maxItems: 50,
        items: { type: 'string' }
      }
    },
    required: [
      'operacao', 'nivel', 'agrupar_por', 'data_campo', 'data_inicial',
      'data_final', 'filtros', 'metricas', 'ordenar_por', 'limite',
      'pedidos_marketplace'
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
    let regra = CAMPOS_FILTRO[nome];
    validarNivel(regra, argumentos.nivel, `O filtro ${nome}`);
    if (nome === 'nota_emitida' && argumentos.data_campo !== 'emissao') {
      regra = { ...regra, campo: 'pedido_faturado' };
    }
    if (nome === 'id_nr_nf' && argumentos.data_campo !== 'emissao') {
      throw new Error('O filtro id_nr_nf exige data_campo emissao.');
    }
    if (nome === 'status_pedido' && argumentos.data_campo === 'emissao') {
      throw new Error('O filtro status_pedido exige data_campo pedido.');
    }
    filtros[regra.campo] = filtro;
  }
  if (Object.hasOwn(filtros, 'id_empresa')) {
    if (filtros.id_empresa.operador !== 'igual') {
      throw new Error('O filtro id_empresa aceita somente o operador igual.');
    }
    filtros.id_empresa.valor = String(validarIdEmpresa(filtros.id_empresa.valor));
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
  const statusExplicito = Object.hasOwn(normalizados, 'status_pedido') ||
    Object.hasOwn(normalizados, 'tipo_pedido') ||
    Object.hasOwn(normalizados, 'id_tipo_pedido') ||
    Object.hasOwn(normalizados, 'situacao');
  if (argumentos.data_campo !== 'emissao' && !statusExplicito) {
    filtros.pedido_valido = { operador: 'igual', valor: 'true' };
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
    } else if (dimensao === 'produto') {
      saida.id_produto = linha.grupo_1;
      saida.produto = linha.grupo_2;
      saida.descricao_produto = linha.grupo_2;
      saida.sku = linha.grupo_3;
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
      transporte_regra: regraTransporte,
      ...demais
    } = linha;
    return {
      ...(id_registro_venda !== undefined ? { id_registro_venda } : {}),
      ...(numero_pedido !== undefined ? { numero_pedido } : {}),
      ...(numero_nota_fiscal !== undefined ? { numero_nota_fiscal } : {}),
      ...demais,
      ...(transportadora !== undefined ? { transportadora } : {}),
      ...(regraTransporte !== undefined ? { regra_transporte: regraTransporte } : {})
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

function normalizarPedidosMarketplace(valor) {
  validarLista(valor, 'pedidos_marketplace', 1, 50);
  const contagens = new Map();
  for (const item of valor) {
    if (typeof item !== 'string') {
      throw new Error('Cada pedido em pedidos_marketplace deve ser enviado como texto.');
    }
    const numeroPedido = item.trim();
    if (!numeroPedido) {
      throw new Error('pedidos_marketplace nao pode conter valores vazios.');
    }
    contagens.set(numeroPedido, (contagens.get(numeroPedido) || 0) + 1);
  }
  return {
    unicos: [...contagens.keys()],
    duplicados: [...contagens.entries()]
      .filter(([, ocorrencias]) => ocorrencias > 1)
      .map(([numero_pedido_marketplace, ocorrencias]) => ({
        numero_pedido_marketplace,
        ocorrencias
      }))
  };
}

function normalizarNumeroNota(valor) {
  if (valor == null) return null;
  const texto = String(valor).trim().replace(/\.0+$/, '');
  if (!texto || /^0+$/.test(texto)) return null;
  return texto;
}

function notaFiscalValida(linha) {
  return linha.faturamento_valido === true ||
    String(linha.faturamento_valido).toLowerCase() === 'true';
}

async function localizarNotasPorPedidos(argumentos, dependencias) {
  const { unicos, duplicados } = normalizarPedidosMarketplace(argumentos.pedidos_marketplace);
  const leitor = (dependencias.criarLeitor || criarLeitorSilver)();
  try {
    const resultado = await leitor.consultar('fato_venda', {
      filtros: {
        marketplace_pedido: {
          operador: 'em',
          valor: null,
          valores: unicos
        }
      },
      colunas: [
        'marketplace_pedido',
        'id_nr_nf',
        'faturamento_valido',
        'data_emissao'
      ],
      ordenacao: { campo: 'data_emissao', direcao: 'asc' },
      limite: 500
    });

    const linhasPorPedido = new Map(unicos.map((numero) => [numero, []]));
    for (const linha of resultado.dados) {
      const numeroPedido = String(linha.marketplace_pedido ?? '').trim();
      if (linhasPorPedido.has(numeroPedido)) linhasPorPedido.get(numeroPedido).push(linha);
    }

    const pedidos = unicos.map((numeroPedido) => {
      const linhas = linhasPorPedido.get(numeroPedido);
      const notas = [...new Set(linhas
        .map(({ id_nr_nf }) => normalizarNumeroNota(id_nr_nf))
        .filter(Boolean))];
      const notasValidas = [...new Set(linhas
        .filter(notaFiscalValida)
        .map(({ id_nr_nf }) => normalizarNumeroNota(id_nr_nf))
        .filter(Boolean))];
      return {
        numero_pedido_marketplace: numeroPedido,
        encontrado: linhas.length > 0,
        notas_fiscais: notas,
        notas_fiscais_validas: notasValidas
      };
    });

    return serializar({
      operacao: 'localizar_notas',
      quantidade_pedidos_solicitados: unicos.length,
      quantidade_pedidos_encontrados: pedidos.filter(({ encontrado }) => encontrado).length,
      notas_fiscais_separadas_por_espaco: pedidos
        .flatMap(({ notas_fiscais }) => notas_fiscais)
        .join(' '),
      pedidos,
      pedidos_nao_encontrados: pedidos
        .filter(({ encontrado }) => !encontrado)
        .map(({ numero_pedido_marketplace }) => numero_pedido_marketplace),
      pedidos_encontrados_sem_nota_fiscal: pedidos
        .filter(({ encontrado, notas_fiscais }) => encontrado && !notas_fiscais.length)
        .map(({ numero_pedido_marketplace }) => numero_pedido_marketplace),
      pedidos_duplicados_na_solicitacao: duplicados,
      atualizado_em: resultado.ultimaConstrucao
    });
  } finally {
    await leitor.fechar();
  }
}

async function executarAnalisarVendas(argumentos, dependencias = {}) {
  validarObjeto(argumentos);
  if (!OPERACOES.includes(argumentos.operacao)) {
    throw new Error(`Operacao de vendas invalida: ${argumentos.operacao}`);
  }
  if (argumentos.operacao === 'localizar_notas') {
    return localizarNotasPorPedidos(argumentos, dependencias);
  }
  const aliasData = {
    data_pedido: 'pedido',
    data_emissao: 'emissao'
  };
  const campoDataEmFiltro = (argumentos.filtros || []).find(
    ({ campo }) => campo === 'data_emissao' || campo === 'data_pedido'
  )?.campo;
  const textoDataCampo = String(argumentos.data_campo || '').toLowerCase();
  const dataCampoNormalizado = textoDataCampo.includes('emissao')
    ? 'emissao'
    : textoDataCampo.includes('pedido')
      ? 'pedido'
      : argumentos.data_campo;
  argumentos = {
    ...argumentos,
    data_campo: aliasData[campoDataEmFiltro] ||
      aliasData[dataCampoNormalizado] ||
      dataCampoNormalizado
  };
  if (!NIVEIS.includes(argumentos.nivel)) throw new Error(`Nivel invalido: ${argumentos.nivel}`);
  if (![null, undefined, 'pedido', 'emissao'].includes(argumentos.data_campo)) {
    throw new Error(`Campo de data invalido: ${argumentos.data_campo}`);
  }
  const limite = validarLimite(argumentos.limite, 10, 20);
  const configuracao = resolverConfiguracao(argumentos);
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
      periodo: argumentos.data_inicial ? {
        inicio: argumentos.data_inicial,
        fim: argumentos.data_final || argumentos.data_inicial
      } : null,
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
  DIMENSOES,
  OPERACOES
};
