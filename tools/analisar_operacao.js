const { criarLeitorGold } = require('../duckdb/gold');
const { serializar, validarLista, validarObjeto } = require('./core/validacao');

const METRICAS = Object.freeze({
  pedidos_recebidos: 'pedidos_recebidos',
  pedidos_validos: 'pedidos_validos',
  pedidos_cancelados: 'pedidos_cancelados',
  pedidos_pendentes: 'pedidos_pendentes',
  pedidos_faturados: 'pedidos_faturados',
  pedidos_devolvidos: 'pedidos_devolvidos',
  conflitos_status: 'pedidos_status_conflitante',
  valor_pedidos: 'valor_pedidos_validos'
});

const definicaoAnalisarOperacao = {
  type: 'function',
  name: 'analisar_operacao',
  description: 'Gold do funil de pedidos; resume ou compara plataformas sem duplicar pedido e NF.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      operacao: { type: 'string', enum: ['resumir', 'ranquear_plataformas'] },
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
        description: 'Nome ou trecho da plataforma quando o usuario limitar a consulta.'
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
      'operacao', 'metricas', 'ordenar_por', 'plataforma', 'data_inicial', 'data_final',
      'id_empresa', 'limite'
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

async function executarAnalisarOperacao(argumentos, dependencias = {}) {
  validarObjeto(argumentos);
  if (!['resumir', 'ranquear_plataformas'].includes(argumentos.operacao)) {
    throw new Error(`Operacao comercial invalida: ${argumentos.operacao}.`);
  }
  validarLista(argumentos.metricas, 'metricas', 1, 4);
  const metricas = [...new Set(argumentos.metricas)];
  for (const nome of metricas) {
    if (!METRICAS[nome]) throw new Error(`Metrica operacional invalida: ${nome}.`);
  }
  const agrupar = argumentos.operacao === 'ranquear_plataformas';
  const ordenarPor = agrupar ? argumentos.ordenar_por : null;
  if (agrupar && !metricas.includes(ordenarPor)) {
    throw new Error('ordenar_por deve ser uma das metricas solicitadas.');
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
  if (argumentos.plataforma) {
    filtros.plataforma = {
      operador: 'contem',
      valor: String(argumentos.plataforma).trim()
    };
  }
  const leitor = (dependencias.criarLeitor || criarLeitorGold)();
  try {
    const resultado = await leitor.agregar('kpi_plataforma_diario', {
      agrupamentos: agrupar
        ? [{ campo: 'plataforma', granularidade: 'valor' }]
        : [],
      calculos: metricas.map((nome) => ({
        operacao: 'somar',
        campo: METRICAS[nome]
      })),
      filtros,
      ordenacao: {
        tipo: 'calculo',
        indice: agrupar ? metricas.indexOf(ordenarPor) : 0,
        direcao: 'desc'
      },
      limite: agrupar ? argumentos.limite : 1
    });
    return serializar({
      operacao: argumentos.operacao,
      periodo: { inicio, fim },
      id_empresa: argumentos.id_empresa,
      ordenado_por: ordenarPor,
      dados: resultado.dados.map((linha) => ({
        ...(agrupar ? { plataforma: linha.grupo_1 || 'NAO INFORMADO' } : {}),
        ...Object.fromEntries(metricas.map((nome, indice) => [
          nome,
          linha[`calculo_${indice + 1}`]
        ]))
      })),
      alerta_status: 'FATURADO_COM_STATUS_CANCELADO permanece separado ate validacao da regra de negocio.',
      atualizado_em: resultado.ultimaConstrucao
    });
  } finally {
    await leitor.fechar();
  }
}

module.exports = {
  definicaoAnalisarOperacao,
  executarAnalisarOperacao,
  METRICAS
};
