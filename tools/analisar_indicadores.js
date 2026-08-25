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
  pedidos_faturados: {
    objeto: 'kpi_vendas_diario',
    componentes: { valor: 'pedidos_faturados' },
    calcular: ({ valor }) => valor
  },
  pedidos_devolvidos: {
    objeto: 'kpi_vendas_diario',
    componentes: { valor: 'pedidos_devolvidos' },
    calcular: ({ valor }) => valor
  },
  pedidos_status_conflitante: {
    objeto: 'kpi_vendas_diario',
    componentes: { valor: 'pedidos_status_conflitante' },
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
  description:
    'KPIs Gold: painel diario completo ou focado; resumir; comparar periodos; tendencia diaria. Datas explicitas nunca sao substituidas por outra data.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      operacao: { type: 'string', enum: ['painel', 'resumir', 'comparar', 'tendencia'] },
      metricas: {
        description:
          'No painel, use null para o resumo administrativo completo ou informe ate 4 metricas para uma resposta focada.',
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
      data_inicial: {
        description: 'Data literal em AAAA-MM-DD. Painel mais recente: null.',
        type: ['string', 'null']
      },
      data_final: {
        type: ['string', 'null']
      },
      data_inicial_anterior: {
        description: 'Inicio opcional do periodo de comparacao em AAAA-MM-DD.',
        type: ['string', 'null']
      },
      data_final_anterior: {
        description: 'Fim opcional do periodo de comparacao em AAAA-MM-DD.',
        type: ['string', 'null']
      },
      recencia: {
        description: 'Use mais_recente_completo para excluir o ultimo dia parcial.',
        type: ['string', 'null'],
        enum: ['mais_recente', 'mais_recente_completo', null]
      },
      limite: { type: 'integer', minimum: 1, maximum: 31 }
    },
    required: [
      'operacao', 'metricas', 'data_inicial', 'data_final',
      'recencia', 'limite'
    ],
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
  const [primeiro, ultimo, ultimoCompleto] = await Promise.all([
    leitor.consultar('painel_executivo_diario', {
      colunas: ['data_referencia'],
      ordenacao: { campo: 'data_referencia', direcao: 'asc' },
      limite: 1
    }),
    leitor.consultar('painel_executivo_diario', {
      colunas: ['data_referencia', 'dados_parciais'],
      ordenacao: { campo: 'data_referencia', direcao: 'desc' },
      limite: 1
    }),
    leitor.consultar('painel_executivo_diario', {
      filtros: {
        dados_parciais: { operador: 'igual', valor: false }
      },
      colunas: ['data_referencia'],
      ordenacao: { campo: 'data_referencia', direcao: 'desc' },
      limite: 1
    })
  ]);
  const inicio = primeiro.dados[0]?.data_referencia?.toISOString?.().slice(0, 10)
    || String(primeiro.dados[0]?.data_referencia || '').slice(0, 10);
  const fim = ultimo.dados[0]?.data_referencia?.toISOString?.().slice(0, 10)
    || String(ultimo.dados[0]?.data_referencia || '').slice(0, 10);
  const fimCompleto = ultimoCompleto.dados[0]?.data_referencia?.toISOString?.().slice(0, 10)
    || String(ultimoCompleto.dados[0]?.data_referencia || '').slice(0, 10);
  return {
    inicio,
    fim,
    ultimo_dia_completo: fimCompleto || null,
    ultima_data_parcial: Boolean(ultimo.dados[0]?.dados_parciais),
    atualizado_em: ultimo.ultimaConstrucao
  };
}

async function obterEstoqueAtual(leitor) {
  const resultado = await leitor.consultar('kpi_estoque_diario', {
    colunas: [
      'data_referencia',
      'produtos_elegiveis_estoque',
      'produtos_ruptura_atual',
      'produtos_risco_critico',
      'produtos_risco_alto',
      'produtos_risco_medio',
      'produtos_alerta_30d',
      'marca_mais_alertas',
      'produtos_alerta_marca_lider',
      'saida_30d_marca_lider',
      'estoque_atualizado_em'
    ],
    ordenacao: { campo: 'data_referencia', direcao: 'desc' },
    limite: 1
  });
  return resultado.dados[0] || null;
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
  const temDataExplicita = Boolean(argumentos.data_inicial || argumentos.data_final);
  const dataPadrao = (
    argumentos.operacao === 'painel' &&
    !argumentos.data_inicial &&
    argumentos.recencia !== 'mais_recente'
  ) ? (cobertura.ultimo_dia_completo || cobertura.fim) : cobertura.fim;
  const fimSolicitado = argumentos.data_final
    ? dataIso(argumentos.data_final, 'data_final')
    : argumentos.data_inicial
      ? dataIso(argumentos.data_inicial, 'data_inicial')
      : dataPadrao;
  let fim = fimSolicitado;
  let inicio = argumentos.data_inicial
    ? dataIso(argumentos.data_inicial, 'data_inicial')
    : fim;
  let ajusteCobertura = null;
  if (
    !temDataExplicita &&
    argumentos.recencia === 'mais_recente_completo' &&
    cobertura.ultimo_dia_completo &&
    inicio <= cobertura.ultimo_dia_completo &&
    fim > cobertura.ultimo_dia_completo
  ) {
    fim = cobertura.ultimo_dia_completo;
    ajusteCobertura = {
      data_solicitada: fimSolicitado,
      data_utilizada: fim,
      motivo: 'ultimo dia parcial excluido da totalizacao'
    };
  }
  if (argumentos.operacao === 'tendencia' && !argumentos.data_inicial) {
    inicio = deslocarData(fim, -(argumentos.limite - 1));
  }
  if (inicio > fim) throw new Error('data_inicial nao pode ser posterior a data_final.');
  if (
    argumentos.operacao === 'painel' &&
    temDataExplicita &&
    (inicio < cobertura.inicio || fim > cobertura.fim)
  ) {
    return {
      inicio,
      fim,
      data_solicitada: fimSolicitado,
      indisponivel: true,
      ajuste_cobertura: null
    };
  }
  if (inicio < cobertura.inicio || fim > cobertura.fim) {
    throw new Error(`Periodo fora da cobertura Gold: ${cobertura.inicio} a ${cobertura.fim}.`);
  }
  return {
    inicio,
    fim,
    data_solicitada: temDataExplicita ? fimSolicitado : null,
    indisponivel: false,
    ajuste_cobertura: ajusteCobertura
  };
}

function respostaPainelIndisponivel(periodo, cobertura, modo) {
  return serializar({
    operacao: 'painel',
    modo,
    data_solicitada: periodo.data_solicitada || periodo.fim,
    data_analisada: null,
    dados_disponiveis: false,
    dados_parciais: null,
    metricas: modo === 'focado' ? null : undefined,
    ultima_data_disponivel: cobertura.fim,
    ultimo_dia_completo: cobertura.ultimo_dia_completo,
    cobertura
  });
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
  if (
    argumentos.operacao === 'resumir' &&
    !argumentos.data_inicial &&
    !argumentos.data_final &&
    argumentos.recencia
  ) {
    argumentos = { ...argumentos, operacao: 'painel' };
  }
  if (!['painel', 'resumir', 'comparar', 'tendencia'].includes(argumentos.operacao)) {
    throw new Error(`Operacao Gold invalida: ${argumentos.operacao}.`);
  }
  if (![null, undefined, 'mais_recente', 'mais_recente_completo'].includes(argumentos.recencia)) {
    throw new Error('recencia invalida.');
  }
  const limite = argumentos.limite ?? 7;
  if (!Number.isInteger(limite) || limite < 1 || limite > 31) {
    throw new Error('limite deve estar entre 1 e 31.');
  }
  if (
    argumentos.operacao === 'painel' &&
    argumentos.metricas != null &&
    !argumentos.data_inicial &&
    !argumentos.data_final &&
    !argumentos.recencia
  ) {
    throw new Error(
      'Painel focado exige uma data explicita ou recencia mais_recente/mais_recente_completo.'
    );
  }
  const leitor = (dependencias.criarLeitor || criarLeitorGold)();
  try {
    const cobertura = await obterCobertura(leitor);
    const periodo = await resolverPeriodo({ ...argumentos, limite }, cobertura);
    const metricas = normalizarMetricas(argumentos.metricas);

    if (argumentos.operacao === 'painel') {
      const modo = argumentos.metricas == null ? 'completo' : 'focado';
      if (periodo.indisponivel) {
        return respostaPainelIndisponivel(periodo, cobertura, modo);
      }
      if (periodo.inicio !== periodo.fim) {
        throw new Error('painel aceita somente um dia; use resumir para totalizar um intervalo.');
      }
      if (modo === 'focado') {
        const resultado = await leitor.consultar('painel_executivo_diario', {
          filtros: filtroPeriodo(periodo.fim, periodo.fim),
          colunas: ['data_referencia', 'dados_parciais', ...metricas],
          limite: 1
        });
        const dados = resultado.dados[0] || null;
        if (!dados) return respostaPainelIndisponivel(periodo, cobertura, modo);
        return serializar({
          operacao: 'painel',
          modo,
          data_solicitada: periodo.data_solicitada,
          data_analisada: dados.data_referencia,
          dados_disponiveis: true,
          dados_parciais: Boolean(dados.dados_parciais),
          metricas: Object.fromEntries(metricas.map((nome) => [nome, dados[nome]])),
          cobertura
        });
      }
      const [resultado, estoqueAtual] = await Promise.all([
        leitor.consultar('painel_executivo_diario', {
          filtros: filtroPeriodo(periodo.fim, periodo.fim),
          colunas: [
            'data_referencia', 'pedidos_validos', 'pedidos_cancelados',
            'pedidos_pendentes', 'pedidos_faturados', 'pedidos_devolvidos',
            'pedidos_status_conflitante', 'valor_pedidos_validos', 'pedidos_pagos',
            'valor_pedidos_pagos', 'ticket_medio_pedido',
            'taxa_cancelamento_pct', 'taxa_emissao_pct', 'notas_emitidas',
            'faturamento_emitido', 'ticket_medio_faturado',
            'prazo_medio_emissao_dias', 'pedidos_validos_7d',
            'faturamento_emitido_7d', 'pedidos_validos_30d',
            'faturamento_emitido_30d', 'variacao_valor_pedidos_dia_pct',
            'variacao_faturamento_dia_pct', 'produtos_elegiveis_estoque',
            'produtos_ruptura_atual', 'produtos_risco_critico',
            'produtos_risco_alto', 'produtos_risco_medio',
            'produtos_alerta_30d', 'marca_mais_alertas',
            'produtos_alerta_marca_lider', 'saida_30d_marca_lider',
            'estoque_atualizado_em', 'dados_parciais'
          ],
          limite: 1
        }),
        obterEstoqueAtual(leitor)
      ]);
      const dados = resultado.dados[0] || null;
      if (!dados) return respostaPainelIndisponivel(periodo, cobertura, modo);
      return serializar({
        operacao: 'painel',
        modo,
        data_solicitada: periodo.data_solicitada,
        data_analisada: dados.data_referencia,
        dados_disponiveis: true,
        dados_parciais: Boolean(dados.dados_parciais),
        dados,
        estoque_atual: estoqueAtual,
        ajuste_cobertura: periodo.ajuste_cobertura || null,
        cobertura
      });
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
      return serializar({
        operacao: 'resumir',
        periodo: { inicio: periodo.inicio, fim: periodo.fim },
        metricas: atual,
        ajuste_cobertura: periodo.ajuste_cobertura || null,
        cobertura
      });
    }

    const recebeuInicioAnterior = argumentos.data_inicial_anterior != null;
    const recebeuFimAnterior = argumentos.data_final_anterior != null;
    if (recebeuInicioAnterior !== recebeuFimAnterior) {
      throw new Error('data_inicial_anterior e data_final_anterior devem ser informadas juntas.');
    }
    const dias = duracaoPeriodo(periodo.inicio, periodo.fim);
    const periodoAnterior = recebeuInicioAnterior ? {
      inicio: dataIso(argumentos.data_inicial_anterior, 'data_inicial_anterior'),
      fim: dataIso(argumentos.data_final_anterior, 'data_final_anterior')
    } : {
      fim: deslocarData(periodo.inicio, -1),
      inicio: deslocarData(periodo.inicio, -dias)
    };
    if (periodoAnterior.inicio > periodoAnterior.fim) {
      throw new Error('data_inicial_anterior nao pode ser posterior a data_final_anterior.');
    }
    if (periodoAnterior.inicio < cobertura.inicio) {
      throw new Error(`Periodo anterior fora da cobertura Gold, que inicia em ${cobertura.inicio}.`);
    }
    const anterior = await calcularPeriodo(leitor, periodoAnterior, metricas);
    return serializar({
      operacao: 'comparar',
      periodo_atual: periodo,
      periodo_anterior: periodoAnterior,
      metricas: compararValores(atual, anterior),
      ajuste_cobertura: periodo.ajuste_cobertura || null,
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
