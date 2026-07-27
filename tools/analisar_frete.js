const { criarLeitorGold } = require('../duckdb/gold');
const { serializar, validarLista, validarObjeto } = require('./core/validacao');

const DIMENSOES = Object.freeze({
  plataforma: 'plataforma',
  transporte_regra: 'transporte_regra'
});
const METRICAS = Object.freeze({
  pedidos: { campo: 'pedidos_validos', saida: 'pedidos_validos' },
  frete_cobrado: { campo: 'frete_cobrado', saida: 'frete_cobrado' },
  frete_custo: { campo: 'frete_custo', saida: 'frete_custo' },
  frete_site: { campo: 'frete_site', saida: 'frete_site' },
  resultado_frete: { campo: 'resultado_frete', saida: 'resultado_frete' },
  cobertura_custo: {
    campo: 'pedidos_com_custo_frete',
    saida: 'pedidos_com_custo_frete'
  },
  pedidos_sem_custo: {
    campo: 'pedidos_sem_custo_frete',
    saida: 'pedidos_sem_custo_frete'
  }
});

const definicaoAnalisarFrete = {
  type: 'function',
  name: 'analisar_frete',
  description: 'Gold de frete por data do pedido, plataforma ou regra de transporte.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      operacao: { type: 'string', enum: ['resumir', 'ranquear'] },
      agrupar_por: {
        type: ['string', 'null'],
        enum: [...Object.keys(DIMENSOES), null]
      },
      metricas: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: { type: 'string', enum: Object.keys(METRICAS) }
      },
      ordenar_por: {
        type: ['string', 'null'],
        enum: [...Object.keys(METRICAS), null]
      },
      plataforma: {
        type: ['string', 'null'],
        description: 'Nome ou trecho da plataforma quando informado.'
      },
      transporte_regra: {
        type: ['string', 'null'],
        description: 'Nome ou trecho da regra de transporte quando informado.'
      },
      data_inicial: { type: 'string' },
      data_final: { type: ['string', 'null'] },
      id_empresa: {
        type: ['integer', 'null'],
        minimum: 1,
        description: 'Somente quando o usuario informar a empresa; caso contrario null.'
      },
      limite: { type: 'integer', minimum: 1, maximum: 20 }
    },
    required: [
      'operacao', 'agrupar_por', 'metricas', 'ordenar_por',
      'plataforma', 'transporte_regra', 'data_inicial',
      'data_final', 'id_empresa', 'limite'
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
  ) throw new Error(`${rotulo} deve usar AAAA-MM-DD.`);
  return texto;
}

async function executarAnalisarFrete(argumentos, dependencias = {}) {
  validarObjeto(argumentos);
  if (!['resumir', 'ranquear'].includes(argumentos.operacao)) {
    throw new Error(`Operacao de frete invalida: ${argumentos.operacao}.`);
  }
  const dimensao = argumentos.operacao === 'ranquear'
    ? argumentos.agrupar_por
    : null;
  if (argumentos.operacao === 'ranquear' && !DIMENSOES[dimensao]) {
    throw new Error('ranquear exige agrupar_por valido.');
  }
  validarLista(argumentos.metricas, 'metricas', 1, 4);
  const metricas = [...new Set(argumentos.metricas)];
  for (const nome of metricas) {
    if (!METRICAS[nome]) throw new Error(`Metrica de frete invalida: ${nome}.`);
  }
  const ordenarPor = argumentos.operacao === 'ranquear'
    ? argumentos.ordenar_por
    : null;
  if (argumentos.operacao === 'ranquear' && !metricas.includes(ordenarPor)) {
    throw new Error('ordenar_por deve ser uma das metricas solicitadas.');
  }
  const exigeCusto = metricas.some((nome) => (
    nome === 'frete_custo' || nome === 'resultado_frete'
  ));
  const metricasConsulta = [...metricas];
  if (exigeCusto && !metricasConsulta.includes('pedidos_sem_custo')) {
    metricasConsulta.push('pedidos_sem_custo');
  }
  const inicio = dataIso(argumentos.data_inicial, 'data_inicial');
  const fim = argumentos.data_final
    ? dataIso(argumentos.data_final, 'data_final')
    : inicio;
  if (inicio > fim) throw new Error('data_inicial nao pode ser posterior a data_final.');
  const filtros = {
    data_referencia: inicio === fim
      ? { operador: 'igual', valor: inicio }
      : { operador: 'entre', valor: inicio, valorFinal: fim }
  };
  if (argumentos.id_empresa != null) {
    if (!Number.isInteger(argumentos.id_empresa) || argumentos.id_empresa < 1) {
      throw new Error('id_empresa deve ser inteiro positivo ou null.');
    }
    filtros.id_empresa = { operador: 'igual', valor: argumentos.id_empresa };
  }
  for (const campo of ['plataforma', 'transporte_regra']) {
    if (argumentos[campo]) {
      filtros[campo] = {
        operador: 'contem',
        valor: String(argumentos[campo]).trim()
      };
    }
  }
  const leitor = (dependencias.criarLeitor || criarLeitorGold)();
  try {
    const resultado = await leitor.agregar('kpi_frete_diario', {
      agrupamentos: dimensao
        ? [{ campo: DIMENSOES[dimensao], granularidade: 'valor' }]
        : [],
      calculos: metricasConsulta.map((nome) => ({
        operacao: 'somar',
        campo: METRICAS[nome].campo
      })),
      filtros,
      ordenacao: {
        tipo: 'calculo',
        indice: dimensao ? metricasConsulta.indexOf(ordenarPor) : 0,
        direcao: 'desc'
      },
      limite: dimensao ? argumentos.limite : 1
    });
    const indiceSemCusto = metricasConsulta.indexOf('pedidos_sem_custo');
    const dados = resultado.dados.map((linha) => {
      const pedidosSemCusto = indiceSemCusto >= 0
        ? Number(linha[`calculo_${indiceSemCusto + 1}`] || 0)
        : null;
      const coberturaCompleta = !exigeCusto || pedidosSemCusto === 0;
      const metricasSaida = Object.fromEntries(metricas.map((nome) => {
        const indice = metricasConsulta.indexOf(nome);
        const saida = METRICAS[nome].saida;
        const valor = nome === 'resultado_frete' && !coberturaCompleta
          ? null
          : linha[`calculo_${indice + 1}`];
        return [saida, valor];
      }));
      return {
        ...(dimensao ? { [dimensao]: linha.grupo_1 || 'NAO INFORMADO' } : {}),
        ...metricasSaida,
        ...(exigeCusto ? {
          pedidos_sem_custo_frete: pedidosSemCusto,
          cobertura_custo_completa: coberturaCompleta
        } : {})
      };
    });
    const custoDisponivel = !exigeCusto || dados.every(
      ({ cobertura_custo_completa: completa }) => completa
    );
    return serializar({
      operacao: argumentos.operacao,
      periodo: { inicio, fim },
      id_empresa: argumentos.id_empresa,
      agrupado_por: dimensao,
      ordenado_por: ordenarPor,
      dados,
      custo_frete_disponivel: custoDisponivel,
      aviso_custo: custoDisponivel
        ? null
        : 'O custo de frete nao cobre todos os pedidos; o resultado de frete incompleto foi omitido.',
      conceito_resultado_frete: 'frete cobrado menos custo, somente quando o custo cobre todos os pedidos do grupo',
      atualizado_em: resultado.ultimaConstrucao
    });
  } finally {
    await leitor.fechar();
  }
}

module.exports = {
  definicaoAnalisarFrete,
  executarAnalisarFrete,
  DIMENSOES,
  METRICAS
};
