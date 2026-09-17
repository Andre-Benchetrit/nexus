const { criarLeitorGold } = require('../duckdb/gold');
const {
  normalizarFiltros,
  serializar,
  validarLista,
  validarObjeto
} = require('./core/validacao');
const {
  criarSchemaFiltros,
  OPERADORES_FILTRO_SIMPLES
} = require('./core/contratos');

const DIMENSOES = Object.freeze({
  produto: 'descricao_produto',
  marca: 'marca',
  grupo: 'grupo',
  subgrupo: 'subgrupo',
  categoria: 'categoria',
  plataforma: 'plataforma'
});

const ATRIBUTOS_PRODUTO = Object.freeze({
  ean: 'ean',
  peso_liquido: 'peso_liquido',
  altura: 'altura',
  largura: 'largura',
  comprimento: 'comprimento'
});

const ATRIBUTOS_PRODUTO_NUMERICOS = new Set([
  'peso_liquido',
  'altura',
  'largura',
  'comprimento'
]);

const METRICAS = Object.freeze({
  quantidade: {
    componentes: { valor: 'quantidade_faturada' },
    calcular: ({ valor }) => valor,
    saida: 'quantidade_faturada'
  },
  faturamento: {
    componentes: { valor: 'faturamento_emitido' },
    calcular: ({ valor }) => valor,
    saida: 'faturamento_emitido'
  },
  custo_produtos: {
    componentes: { valor: 'custo_produtos' },
    calcular: ({ valor }) => valor,
    saida: 'custo_produtos'
  },
  margem_bruta: {
    componentes: { valor: 'margem_bruta_produtos' },
    calcular: ({ valor }) => valor,
    saida: 'margem_bruta_produtos'
  },
  margem_bruta_pct: {
    componentes: {
      margem: 'margem_bruta_produtos',
      faturamento: 'faturamento_emitido'
    },
    calcular: ({ margem, faturamento }) => (
      faturamento ? Number((100 * margem / faturamento).toFixed(4)) : null
    ),
    saida: 'margem_bruta_pct'
  },
  comissao_marketplace: {
    componentes: { valor: 'comissao_marketplace' },
    calcular: ({ valor }) => valor,
    saida: 'comissao_marketplace'
  },
  notas_fiscais: {
    componentes: { valor: 'notas_fiscais' },
    calcular: ({ valor }) => valor,
    saida: 'notas_fiscais'
  },
  pedidos_comerciais: {
    componentes: { valor: 'pedidos_comerciais' },
    calcular: ({ valor }) => valor,
    saida: 'pedidos_comerciais_aproximados'
  }
});

const definicaoAnalisarDesempenho = {
  type: 'function',
  name: 'analisar_desempenho',
  description:
    'Gold faturado por produto, marca, grupo, categoria ou plataforma; inclui custo e margem bruta. ' +
    'Quando agrupar_por for produto, atributos físicos e EAN podem ser solicitados em atributos_produto somente quando necessários.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      operacao: {
        type: 'string',
        enum: ['resumir', 'ranquear']
      },

      agrupar_por: {
        type: ['string', 'null'],
        enum: [...Object.keys(DIMENSOES), null]
      },

      atributos_produto: {
        type: ['array', 'null'],
        description:
          'Atributos adicionais do produto. Use somente quando agrupar_por=produto e a pergunta exigir explicitamente essas informações.',
        maxItems: Object.keys(ATRIBUTOS_PRODUTO).length,
        items: {
          type: 'string',
          enum: Object.keys(ATRIBUTOS_PRODUTO)
        }
      },

      metricas: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'string',
          enum: Object.keys(METRICAS)
        }
      },

      ordenar_por: {
        type: ['string', 'null'],
        enum: [...Object.keys(METRICAS), null]
      },

      filtros: {
        ...criarSchemaFiltros({
          campos: Object.keys(DIMENSOES),
          operadores: OPERADORES_FILTRO_SIMPLES,
          maxItems: 3,
          simples: true
        }),
        type: ['array', 'null']
      },

      data_inicial: {
        type: 'string'
      },

      data_final: {
        type: ['string', 'null']
      },

      id_empresa: {
        type: ['integer', 'null'],
        minimum: 1,
        description:
          'Somente quando o usuario informar a empresa; caso contrario null.'
      },

      limite: {
        type: 'integer',
        minimum: 1,
        maximum: 20
      }
    },

    required: [
      'operacao',
      'agrupar_por',
      'atributos_produto',
      'metricas',
      'ordenar_por',
      'filtros',
      'data_inicial',
      'data_final',
      'id_empresa',
      'limite'
    ],

    additionalProperties: false
  }
};

function dataIso(valor, rotulo) {
  const texto = String(valor || '');
  const data = new Date(`${texto}T00:00:00.000Z`);

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(texto) ||
    Number.isNaN(data.getTime()) ||
    data.toISOString().slice(0, 10) !== texto
  ) {
    throw new Error(
      `${rotulo} deve usar uma data valida em AAAA-MM-DD.`
    );
  }

  return texto;
}

function prepararMetricas(nomes) {
  validarLista(nomes, 'metricas', 1, 4);

  const solicitadas = [...new Set(nomes)];

  for (const nome of solicitadas) {
    if (!METRICAS[nome]) {
      throw new Error(
        `Metrica de desempenho invalida: ${nome}.`
      );
    }
  }

  const componentes = [];

  for (const nome of solicitadas) {
    for (const campo of Object.values(METRICAS[nome].componentes)) {
      if (!componentes.includes(campo)) {
        componentes.push(campo);
      }
    }
  }

  if (componentes.length > 5) {
    throw new Error(
      'A combinacao de metricas exige mais componentes do que o limite seguro.'
    );
  }

  return {
    solicitadas,
    componentes
  };
}

function prepararAtributosProduto(atributos, dimensao) {
  if (atributos == null) {
    return [];
  }

  validarLista(
    atributos,
    'atributos_produto',
    0,
    Object.keys(ATRIBUTOS_PRODUTO).length
  );

  const solicitados = [...new Set(atributos)];

  for (const atributo of solicitados) {
    if (!ATRIBUTOS_PRODUTO[atributo]) {
      throw new Error(
        `Atributo de produto invalido: ${atributo}.`
      );
    }
  }

  if (solicitados.length && dimensao !== 'produto') {
    throw new Error(
      'atributos_produto somente pode ser usado quando agrupar_por for produto.'
    );
  }

  return solicitados;
}

function normalizarValorAtributoProduto(atributo, valor) {
  if (valor == null) {
    return null;
  }

  if (ATRIBUTOS_PRODUTO_NUMERICOS.has(atributo)) {
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : null;
  }

  return valor;
}

async function executarAnalisarDesempenho(argumentos, dependencias = {}) {
  validarObjeto(argumentos);

  if (!['resumir', 'ranquear'].includes(argumentos.operacao)) {
    throw new Error(
      `Operacao de desempenho invalida: ${argumentos.operacao}.`
    );
  }

  if (
    argumentos.operacao === 'ranquear' &&
    !DIMENSOES[argumentos.agrupar_por]
  ) {
    throw new Error(
      'ranquear exige agrupar_por valido.'
    );
  }

  const inicio = dataIso(
    argumentos.data_inicial,
    'data_inicial'
  );

  const fim = argumentos.data_final
    ? dataIso(argumentos.data_final, 'data_final')
    : inicio;

  if (inicio > fim) {
    throw new Error(
      'data_inicial nao pode ser posterior a data_final.'
    );
  }

  const {
    solicitadas,
    componentes
  } = prepararMetricas(argumentos.metricas);

  const ordenarPor = argumentos.operacao === 'ranquear'
    ? argumentos.ordenar_por
    : null;

  if (
    argumentos.operacao === 'ranquear' &&
    !solicitadas.includes(ordenarPor)
  ) {
    throw new Error(
      'ordenar_por deve ser uma das metricas solicitadas.'
    );
  }

  const campoOrdenacao = ordenarPor
    ? Object.values(METRICAS[ordenarPor].componentes)[0]
    : componentes[0];

  const indiceOrdenacao = componentes.indexOf(campoOrdenacao);

  const filtros = {
    data_referencia: inicio === fim
      ? {
          operador: 'igual',
          valor: inicio
        }
      : {
          operador: 'entre',
          valor: inicio,
          valorFinal: fim
        }
  };

  const filtrosEntrada = argumentos.filtros ?? [];

  validarLista(
    filtrosEntrada,
    'filtros',
    0,
    3
  );

  const filtrosNormalizados = normalizarFiltros(
    filtrosEntrada,
    new Set(Object.keys(DIMENSOES)),
    OPERADORES_FILTRO_SIMPLES
  );

  for (const [nome, filtro] of Object.entries(filtrosNormalizados)) {
    filtros[DIMENSOES[nome]] = filtro;
  }

  if (argumentos.id_empresa != null) {
    if (
      !Number.isInteger(argumentos.id_empresa) ||
      argumentos.id_empresa < 1
    ) {
      throw new Error(
        'id_empresa deve ser inteiro positivo ou null.'
      );
    }

    filtros.id_empresa = {
      operador: 'igual',
      valor: argumentos.id_empresa
    };
  }

  const dimensao = argumentos.operacao === 'ranquear'
    ? argumentos.agrupar_por
    : null;

  const atributosProduto = prepararAtributosProduto(
    argumentos.atributos_produto,
    dimensao
  );

  const leitor = (
    dependencias.criarLeitor ||
    criarLeitorGold
  )();

  try {
    const camposAgrupamento = dimensao === 'produto'
      ? [
          'id_produto',
          'descricao_produto',
          'sku',
          ...atributosProduto.map(
            (atributo) => ATRIBUTOS_PRODUTO[atributo]
          )
        ]
      : dimensao
        ? [DIMENSOES[dimensao]]
        : [];

    const resultado = await leitor.agregar(
      'desempenho_produto_diario',
      {
        agrupamentos: camposAgrupamento.map((campo) => ({
          campo,
          granularidade: 'valor'
        })),

        calculos: componentes.map((campo) => ({
          operacao: 'somar',
          campo
        })),

        filtros,

        ordenacao: {
          tipo: 'calculo',
          indice: indiceOrdenacao,
          direcao: 'desc'
        },

        limite: dimensao
          ? argumentos.limite
          : 1
      }
    );

    const dados = resultado.dados.map((linha) => {
      const valores = Object.fromEntries(
        componentes.map(
          (campo, indice) => [
            campo,
            Number(
              linha[`calculo_${indice + 1}`] || 0
            )
          ]
        )
      );

      let dadosDimensao = {};

      if (dimensao === 'produto') {
        dadosDimensao = {
          id_produto: linha.grupo_1,
          produto:
            linha.grupo_2 ||
            'NAO INFORMADO',
          descricao_produto:
            linha.grupo_2 ||
            'NAO INFORMADO',
          sku:
            linha.grupo_3 ||
            null
        };

        atributosProduto.forEach(
          (atributo, indice) => {
            const valor = linha[`grupo_${indice + 4}`];

            dadosDimensao[atributo] =
              normalizarValorAtributoProduto(
                atributo,
                valor
              );
          }
        );
      } else if (dimensao) {
        dadosDimensao = {
          [dimensao]:
            linha.grupo_1 ||
            'NAO INFORMADO'
        };
      }

      const dadosMetricas = Object.fromEntries(
        solicitadas.map((nome) => {
          const regra = METRICAS[nome];

          const argumentosCalculo = Object.fromEntries(
            Object.entries(regra.componentes).map(
              ([apelido, campo]) => [
                apelido,
                valores[campo]
              ]
            )
          );

          return [
            regra.saida,
            regra.calcular(argumentosCalculo)
          ];
        })
      );

      return {
        ...dadosDimensao,
        ...dadosMetricas
      };
    });

    return serializar({
      operacao: argumentos.operacao,
      periodo: {
        inicio,
        fim
      },
      id_empresa: argumentos.id_empresa,
      agrupado_por: dimensao,
      atributos_produto:
        atributosProduto.length
          ? atributosProduto
          : null,
      ordenado_por: ordenarPor,
      conceito_valor:
        'faturamento emitido por data de emissao',
      conceito_margem:
        'margem bruta de produtos = faturamento - custo dos produtos; nao e lucro liquido',
      dados,
      atualizado_em: resultado.ultimaConstrucao
    });
  } finally {
    await leitor.fechar();
  }
}

module.exports = {
  definicaoAnalisarDesempenho,
  executarAnalisarDesempenho,
  DIMENSOES,
  ATRIBUTOS_PRODUTO,
  METRICAS
};