const { criarLeitorGold } = require('../duckdb/gold');
const { serializar, validarLista, validarObjeto } = require('./core/validacao');

const METRICAS = Object.freeze({
  pedidos_validos: {
    objeto: 'kpi_vendas_diario',
    componentes: { valor: 'pedidos_validos' },
    calcular: ({ valor }) => valor
  },
  pedidos_cancelados: {
    objeto: 'kpi_vendas_diario',
    componentes: { valor: 'pedidos_cancelados' },
    calcular: ({ valor }) => valor
  },
  pedidos_pendentes: {
    objeto: 'kpi_vendas_diario',
    componentes: { valor: 'pedidos_pendentes' },
    calcular: ({ valor }) => valor
  },
  valor_pedidos_validos: {
    objeto: 'kpi_vendas_diario',
    componentes: { valor: 'valor_pedidos_validos' },
    calcular: ({ valor }) => valor
  },
  valor_pedidos_pagos: {
    objeto: 'kpi_pedidos_pagos_diario',
    componentes: { valor: 'valor_pedidos_pagos' },
    calcular: ({ valor }) => valor
  },
  pedidos_pagos: {
    objeto: 'kpi_pedidos_pagos_diario',
    componentes: { valor: 'pedidos_pagos' },
    calcular: ({ valor }) => valor
  },
  ticket_medio_pedido: {
    objeto: 'kpi_vendas_diario',
    componentes: { valor: 'valor_pedidos_validos', quantidade: 'pedidos_validos' },
    calcular: ({ valor, quantidade }) => dividir(valor, quantidade)
  },
  taxa_cancelamento_pct: {
    objeto: 'kpi_vendas_diario',
    componentes: { cancelados: 'pedidos_cancelados', recebidos: 'pedidos_recebidos' },
    calcular: ({ cancelados, recebidos }) => dividir(cancelados * 100, recebidos, 4)
  },
  taxa_emissao_pct: {
    objeto: 'kpi_vendas_diario',
    componentes: { emitidos: 'pedidos_com_nota_emitida', validos: 'pedidos_validos' },
    calcular: ({ emitidos, validos }) => dividir(emitidos * 100, validos, 4)
  },
  notas_emitidas: {
    objeto: 'kpi_faturamento_diario',
    componentes: { valor: 'notas_emitidas' },
    calcular: ({ valor }) => valor
  },
  faturamento_emitido: {
    objeto: 'kpi_faturamento_diario',
    componentes: { valor: 'faturamento_emitido' },
    calcular: ({ valor }) => valor
  },
  ticket_medio_faturado: {
    objeto: 'kpi_faturamento_diario',
    componentes: { valor: 'faturamento_emitido', quantidade: 'notas_emitidas' },
    calcular: ({ valor, quantidade }) => dividir(valor, quantidade)
  },
  prazo_medio_emissao_dias: {
    objeto: 'kpi_faturamento_diario',
    componentes: {
      prazo: 'soma_prazo_emissao_dias',
      quantidade: 'notas_com_prazo_calculavel'
    },
    calcular: ({ prazo, quantidade }) => dividir(prazo, quantidade)
  }
});

const METRICAS_PADRAO = Object.freeze([
  'pedidos_validos',
  'valor_pedidos_validos',
  'notas_emitidas',
  'faturamento_emitido'
]);

const definicaoAnalisarIndicadores = {
  type: 'function',
  name: 'analisar_indicadores',
  description: 'Consulta KPIs Gold oficiais. resumir totaliza intervalos; painel mostra somente um dia; comparar compara periodos; tendencia mostra dias.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      operacao: { type: 'string', enum: ['painel', 'resumir', 'comparar', 'tendencia'] },
      metricas: {
        anyOf: [
          {
            type: 'array',
            minItems: 1,
            maxItems: 4,
            items: { type: 'string', enum: Object.keys(METRICAS) }
          },
          { type: 'null' }
        ]
      },
      data_inicial: { type: ['string', 'null'] },
      data_final: { type: ['string', 'null'] },
      limite: { type: 'integer', minimum: 1, maximum: 31 }
    },
    required: ['operacao', 'metricas', 'data_inicial', 'data_final', 'limite'],
    additionalProperties: false
  }
};

function dividir(numerador, denominador, casas = 2) {
  if (!denominador) return null;
  return Number((numerador / denominador).toFixed(casas));
}

function dataIso(valor, rotulo) {
  const resultado = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor || ''));
  if (!resultado) throw new Error(`${rotulo} deve usar AAAA-MM-DD.`);
  const [, ano, mes, dia] = resultado;
  const data = new Date(`${ano}-${mes}-${dia}T00:00:00.000Z`);
  if (
    data.getUTCFullYear() !== Number(ano) ||
    data.getUTCMonth() + 1 !== Number(mes) ||
    data.getUTCDate() !== Number(dia)
  ) throw new Error(`${rotulo} invalida: ${valor}.`);
  return `${ano}-${mes}-${dia}`;
}

function deslocarData(valor, dias) {
  const data = new Date(`${valor}T00:00:00.000Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

function duracaoPeriodo(inicio, fim) {
  return Math.round(
    (new Date(`${fim}T00:00:00.000Z`) - new Date(`${inicio}T00:00:00.000Z`)) / 86400000
  ) + 1;
}

function filtroPeriodo(inicio, fim) {
  return inicio === fim
    ? { data_referencia: { operador: 'igual', valor: inicio } }
    : { data_referencia: { operador: 'entre', valor: inicio, valorFinal: fim } };
}

async function obterCobertura(leitor) {
  const [primeiro, ultimo] = await Promise.all([
    leitor.consultar('painel_executivo_diario', {
      colunas: ['data_referencia'],
      ordenacao: { campo: 'data_referencia', direcao: 'asc' },
      limite: 1
    }),
    leitor.consultar('painel_executivo_diario', {
      colunas: ['data_referencia', 'dados_parciais'],
      ordenacao: { campo: 'data_referencia', direcao: 'desc' },
      limite: 1
    })
  ]);
  const inicio = primeiro.dados[0]?.data_referencia?.toISOString?.().slice(0, 10)
    || String(primeiro.dados[0]?.data_referencia || '').slice(0, 10);
  const fim = ultimo.dados[0]?.data_referencia?.toISOString?.().slice(0, 10)
    || String(ultimo.dados[0]?.data_referencia || '').slice(0, 10);
  return {
    inicio,
    fim,
    ultima_data_parcial: Boolean(ultimo.dados[0]?.dados_parciais),
    atualizado_em: ultimo.ultimaConstrucao
  };
}

function normalizarMetricas(valor) {
  const metricas = valor == null ? [...METRICAS_PADRAO] : valor;
  validarLista(metricas, 'metricas', 1, 4);
  const unicas = [...new Set(metricas)];
  for (const nome of unicas) {
    if (!METRICAS[nome]) throw new Error(`Metrica Gold invalida: ${nome}.`);
  }
  return unicas;
}

async function resolverPeriodo(argumentos, cobertura) {
  if (argumentos.data_final && !argumentos.data_inicial) {
    throw new Error('data_final exige data_inicial.');
  }
  const fim = argumentos.data_final
    ? dataIso(argumentos.data_final, 'data_final')
    : argumentos.data_inicial
      ? dataIso(argumentos.data_inicial, 'data_inicial')
      : cobertura.fim;
  let inicio = argumentos.data_inicial
    ? dataIso(argumentos.data_inicial, 'data_inicial')
    : fim;
  if (argumentos.operacao === 'tendencia' && !argumentos.data_inicial) {
    inicio = deslocarData(fim, -(argumentos.limite - 1));
  }
  if (inicio > fim) throw new Error('data_inicial nao pode ser posterior a data_final.');
  if (inicio < cobertura.inicio || fim > cobertura.fim) {
    throw new Error(`Periodo fora da cobertura Gold: ${cobertura.inicio} a ${cobertura.fim}.`);
  }
  return { inicio, fim };
}

function dividirEmLotes(valores, tamanho) {
  const lotes = [];
  for (let indice = 0; indice < valores.length; indice += tamanho) {
    lotes.push(valores.slice(indice, indice + tamanho));
  }
  return lotes;
}

async function calcularPeriodo(leitor, periodo, nomesMetricas) {
  const porObjeto = new Map();
  for (const nome of nomesMetricas) {
    const metrica = METRICAS[nome];
    if (!porObjeto.has(metrica.objeto)) porObjeto.set(metrica.objeto, new Set());
    for (const campo of Object.values(metrica.componentes)) porObjeto.get(metrica.objeto).add(campo);
  }

  const componentes = {};
  for (const [objeto, camposSet] of porObjeto) {
    const campos = [...camposSet];
    for (const lote of dividirEmLotes(campos, 5)) {
      const resultado = await leitor.agregar(objeto, {
        calculos: lote.map((campo) => ({ operacao: 'somar', campo })),
        filtros: filtroPeriodo(periodo.inicio, periodo.fim),
        limite: 1
      });
      lote.forEach((campo, indice) => {
        componentes[campo] = Number(resultado.dados[0]?.[`calculo_${indice + 1}`] || 0);
      });
    }
  }

  return Object.fromEntries(nomesMetricas.map((nome) => {
    const metrica = METRICAS[nome];
    const valores = Object.fromEntries(Object.entries(metrica.componentes).map(
      ([apelido, campo]) => [apelido, componentes[campo] || 0]
    ));
    return [nome, metrica.calcular(valores)];
  }));
}

function compararValores(atual, anterior) {
  return Object.fromEntries(Object.keys(atual).map((nome) => {
    const valorAtual = atual[nome];
    const valorAnterior = anterior[nome];
    const diferenca = valorAtual == null || valorAnterior == null
      ? null
      : Number((valorAtual - valorAnterior).toFixed(4));
    return [nome, {
      atual: valorAtual,
      anterior: valorAnterior,
      diferenca,
      variacao_pct: valorAnterior ? dividir(diferenca * 100, valorAnterior, 4) : null
    }];
  }));
}

async function executarAnalisarIndicadores(argumentos, dependencias = {}) {
  validarObjeto(argumentos);
  if (!['painel', 'resumir', 'comparar', 'tendencia'].includes(argumentos.operacao)) {
    throw new Error(`Operacao Gold invalida: ${argumentos.operacao}.`);
  }
  const limite = argumentos.limite ?? 7;
  if (!Number.isInteger(limite) || limite < 1 || limite > 31) {
    throw new Error('limite deve estar entre 1 e 31.');
  }
  const leitor = (dependencias.criarLeitor || criarLeitorGold)();
  try {
    const cobertura = await obterCobertura(leitor);
    const periodo = await resolverPeriodo({ ...argumentos, limite }, cobertura);
    const metricas = normalizarMetricas(argumentos.metricas);

    if (argumentos.operacao === 'painel') {
      if (periodo.inicio !== periodo.fim) {
        throw new Error('painel aceita somente um dia; use resumir para totalizar um intervalo.');
      }
      const resultado = await leitor.consultar('painel_executivo_diario', {
        filtros: filtroPeriodo(periodo.fim, periodo.fim),
        colunas: [
          'data_referencia', 'pedidos_validos', 'pedidos_cancelados',
          'pedidos_pendentes', 'valor_pedidos_validos', 'pedidos_pagos',
          'valor_pedidos_pagos', 'ticket_medio_pedido',
          'taxa_cancelamento_pct', 'taxa_emissao_pct', 'notas_emitidas',
          'faturamento_emitido', 'ticket_medio_faturado',
          'prazo_medio_emissao_dias', 'pedidos_validos_7d',
          'faturamento_emitido_7d', 'pedidos_validos_30d',
          'faturamento_emitido_30d', 'variacao_valor_pedidos_dia_pct',
          'variacao_faturamento_dia_pct', 'dados_parciais'
        ],
        limite: 1
      });
      return serializar({ operacao: 'painel', dados: resultado.dados[0] || null, cobertura });
    }

    if (argumentos.operacao === 'tendencia') {
      const diasTendencia = duracaoPeriodo(periodo.inicio, periodo.fim);
      if (diasTendencia > 31) throw new Error('tendencia aceita no maximo 31 dias.');
      const campos = ['data_referencia', ...metricas, 'dados_parciais'];
      const resultado = await leitor.consultar('painel_executivo_diario', {
        filtros: filtroPeriodo(periodo.inicio, periodo.fim),
        colunas: campos,
        ordenacao: { campo: 'data_referencia', direcao: 'asc' },
        limite: diasTendencia
      });
      return serializar({ operacao: 'tendencia', periodo, dados: resultado.dados, cobertura });
    }

    const atual = await calcularPeriodo(leitor, periodo, metricas);
    if (argumentos.operacao === 'resumir') {
      return serializar({ operacao: 'resumir', periodo, metricas: atual, cobertura });
    }

    const dias = duracaoPeriodo(periodo.inicio, periodo.fim);
    const periodoAnterior = {
      fim: deslocarData(periodo.inicio, -1),
      inicio: deslocarData(periodo.inicio, -dias)
    };
    if (periodoAnterior.inicio < cobertura.inicio) {
      throw new Error(`Periodo anterior fora da cobertura Gold, que inicia em ${cobertura.inicio}.`);
    }
    const anterior = await calcularPeriodo(leitor, periodoAnterior, metricas);
    return serializar({
      operacao: 'comparar',
      periodo_atual: periodo,
      periodo_anterior: periodoAnterior,
      metricas: compararValores(atual, anterior),
      cobertura
    });
  } finally {
    await leitor.fechar();
  }
}

module.exports = {
  definicaoAnalisarIndicadores,
  executarAnalisarIndicadores,
  METRICAS
};
