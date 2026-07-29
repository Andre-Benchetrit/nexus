const { criarLeitorSilver } = require('../duckdb/silver');
const {
  serializar,
  validarLimite,
  validarObjeto
} = require('./core/validacao');

const STATUS_LOGISTICOS = Object.freeze([
  'PREVISTO',
  'ATRASADO',
  'NAO_RECEBIDO',
  'RECEBIDO_PARCIAL',
  'RECEBIDO'
]);

const CAMPOS_QUANTIDADE = Object.freeze({
  pedida: 'quantidade_pedida',
  recebida: 'quantidade_recebida',
  pendente: 'quantidade_pendente'
});

const definicaoAnalisarReposicoes = {
  type: 'function',
  name: 'analisar_reposicoes',
  description:
    'Consulta parcelas de compras agendadas do OneDrive. Lista parcelas sem soma-las; soma quantidades somente quando operacao=somar_quantidade. Nunca altera nem representa o estoque oficial do Sysemp.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      operacao: {
        type: 'string',
        enum: [
          'listar',
          'somar_quantidade',
          'resumir_status',
          'ultimo_recebimento'
        ]
      },
      metrica_quantidade: {
        type: ['string', 'null'],
        enum: ['pedida', 'recebida', 'pendente', null]
      },
      data_inicial: { type: ['string', 'null'] },
      data_final: { type: ['string', 'null'] },
      status_logistico: {
        type: ['string', 'null'],
        enum: [...STATUS_LOGISTICOS, null]
      },
      produto: { type: ['string', 'null'] },
      sku: { type: ['string', 'null'] },
      fornecedor: { type: ['string', 'null'] },
      marca: { type: ['string', 'null'] },
      recebido_com_atraso: { type: ['boolean', 'null'] },
      marcacao_manual_divergente: { type: ['boolean', 'null'] },
      limite: { type: 'integer', minimum: 1, maximum: 30 }
    },
    required: [
      'operacao',
      'metrica_quantidade',
      'data_inicial',
      'data_final',
      'status_logistico',
      'produto',
      'sku',
      'fornecedor',
      'marca',
      'recebido_com_atraso',
      'marcacao_manual_divergente',
      'limite'
    ],
    additionalProperties: false
  }
};

function textoOpcional(valor) {
  if (valor == null) return null;
  const texto = String(valor).trim();
  return texto || null;
}

function dataFiltro(valor) {
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  const texto = textoOpcional(valor);
  return texto ? texto.slice(0, 10) : null;
}

function normalizarArgumentos(argumentos) {
  validarObjeto(argumentos);
  const aliasesMetrica = {
    pedida: 'pedida',
    quantidade_pedida: 'pedida',
    quantidade_pedido: 'pedida',
    recebida: 'recebida',
    quantidade_recebida: 'recebida',
    pendente: 'pendente',
    quantidade: 'pendente',
    quantidade_prevista: 'pendente',
    quantidade_pendente: 'pendente',
    quantidade_a_receber: 'pendente'
  };
  const metricaOriginal = textoOpcional(argumentos.metrica_quantidade);
  const metricaNormalizada = metricaOriginal
    ? aliasesMetrica[metricaOriginal.toLowerCase()] || metricaOriginal
    : null;
  const operacaoNormalizada = argumentos.operacao === 'listar' &&
    ['quantidade', 'quantidade_prevista', 'quantidade_pedido'].includes(
      metricaOriginal?.toLowerCase()
    )
    ? 'somar_quantidade'
    : argumentos.operacao;
  const dataInicialOriginal = textoOpcional(argumentos.data_inicial);
  const dataFinalOriginal = textoOpcional(argumentos.data_final);
  return {
    operacao: operacaoNormalizada,
    metrica_quantidade: metricaNormalizada,
    data_inicial: dataInicialOriginal || dataFinalOriginal,
    data_final: dataInicialOriginal && dataFinalOriginal ? dataFinalOriginal : null,
    status_logistico: argumentos.status_logistico ?? null,
    produto: argumentos.produto ?? null,
    sku: argumentos.sku ?? null,
    fornecedor: argumentos.fornecedor ?? null,
    marca: argumentos.marca ?? null,
    recebido_com_atraso: argumentos.recebido_com_atraso ?? null,
    marcacao_manual_divergente: argumentos.marcacao_manual_divergente ?? null,
    limite: argumentos.limite
  };
}

function montarFiltros(argumentos) {
  const filtros = {};
  const dataInicial = textoOpcional(argumentos.data_inicial);
  const dataFinal = textoOpcional(argumentos.data_final);
  if (dataInicial) {
    filtros.data_prevista = dataFinal
      ? { operador: 'entre', valor: dataInicial, valorFinal: dataFinal }
      : { operador: 'igual', valor: dataInicial };
  }
  if (argumentos.status_logistico) {
    if (!STATUS_LOGISTICOS.includes(argumentos.status_logistico)) {
      throw new Error(`Status logistico invalido: ${argumentos.status_logistico}.`);
    }
    filtros.status_logistico = {
      operador: 'igual',
      valor: argumentos.status_logistico
    };
  }
  for (const [argumento, campo] of [
    ['produto', 'descricao_produto'],
    ['sku', 'sku'],
    ['fornecedor', 'fornecedor'],
    ['marca', 'marca']
  ]) {
    const valor = textoOpcional(argumentos[argumento]);
    if (valor) filtros[campo] = { operador: 'contem', valor };
  }
  for (const campo of ['recebido_com_atraso', 'marcacao_manual_divergente']) {
    if (argumentos[campo] != null) {
      filtros[campo] = {
        operador: 'igual',
        valor: argumentos[campo] ? 'true' : 'false'
      };
    }
  }
  return filtros;
}

async function executarAnalisarReposicoes(argumentos, dependencias = {}) {
  const normalizados = normalizarArgumentos(argumentos);
  if (![
    'listar',
    'somar_quantidade',
    'resumir_status',
    'ultimo_recebimento'
  ].includes(normalizados.operacao)) {
    throw new Error(`Operacao de reposicoes invalida: ${normalizados.operacao}.`);
  }
  const limite = validarLimite(normalizados.limite, 10, 30);
  const filtros = montarFiltros(normalizados);
  const leitor = (dependencias.criarLeitor || criarLeitorSilver)();
  try {
    if (normalizados.operacao === 'ultimo_recebimento') {
      if (!textoOpcional(normalizados.produto) && !textoOpcional(normalizados.sku)) {
        throw new Error('produto ou sku e obrigatorio para consultar o ultimo recebimento.');
      }
      delete filtros.data_prevista;
      filtros.tem_evidencia_recebimento = {
        operador: 'igual',
        valor: 'true'
      };
      const ultimo = await leitor.consultar('fato_agendamento_compra', {
        filtros,
        colunas: ['data_entrada'],
        ordenacao: { campo: 'data_entrada', direcao: 'desc' },
        limite: 1
      });
      const dataUltimoRecebimento = dataFiltro(
        ultimo.dados[0]?.data_entrada
      );
      if (!dataUltimoRecebimento) {
        return serializar({
          operacao: 'ultimo_recebimento',
          produto: textoOpcional(normalizados.produto),
          sku: textoOpcional(normalizados.sku),
          encontrado: false,
          estoque_oficial_alterado: false,
          atualizado_em: ultimo.ultimaConstrucao
        });
      }
      const parcelas = await leitor.consultar('fato_agendamento_compra', {
        filtros: {
          ...filtros,
          data_entrada: {
            operador: 'igual',
            valor: dataUltimoRecebimento
          }
        },
        colunas: [
          'numero_pedido_compra',
          'fornecedor',
          'data_prevista',
          'data_entrada_original',
          'data_entrada',
          'data_entrada_corrigida_dia_mes',
          'id_produto',
          'sku',
          'descricao_produto',
          'quantidade_pedida',
          'quantidade_recebida',
          'quantidade_pendente',
          'numero_nf_entrada',
          'status_logistico',
          'recebido_com_atraso',
          'dias_atraso_recebimento'
        ],
        ordenacao: { campo: 'numero_pedido_compra', direcao: 'asc' },
        limite: 500
      });
      const somar = (campo) => parcelas.dados.reduce(
        (total, linha) => total + Number(linha[campo] ?? 0),
        0
      );
      const distintos = (campo) => [...new Set(
        parcelas.dados
          .map((linha) => textoOpcional(linha[campo]))
          .filter(Boolean)
      )];
      const pedidosCompra = distintos('numero_pedido_compra');
      const notasEntrada = distintos('numero_nf_entrada');
      return serializar({
        operacao: 'ultimo_recebimento',
        encontrado: true,
        agrupado_por: 'data_entrada',
        data_ultimo_recebimento: dataUltimoRecebimento,
        produto: parcelas.dados[0]?.descricao_produto ??
          textoOpcional(normalizados.produto),
        sku: parcelas.dados[0]?.sku ?? textoOpcional(normalizados.sku),
        quantidade_pedida_total: somar('quantidade_pedida'),
        quantidade_recebida_total: somar('quantidade_recebida'),
        quantidade_pendente_total: somar('quantidade_pendente'),
        parcelas_total: parcelas.dados.length,
        pedidos_compra: pedidosCompra,
        notas_fiscais_entrada: notasEntrada,
        notas_coincidem_com_pedidos:
          JSON.stringify(notasEntrada) === JSON.stringify(pedidosCompra),
        recebido_com_atraso: parcelas.dados.some(
          (linha) => linha.recebido_com_atraso === true ||
            String(linha.recebido_com_atraso).toLowerCase() === 'true'
        ),
        datas_entrada_corrigidas: parcelas.dados.filter(
          (linha) => linha.data_entrada_corrigida_dia_mes === true ||
            String(linha.data_entrada_corrigida_dia_mes).toLowerCase() === 'true'
        ).length,
        parcelas: parcelas.dados,
        estoque_oficial_alterado: false,
        atualizado_em: parcelas.ultimaConstrucao
      });
    }

    if (normalizados.operacao === 'listar') {
      const resultado = await leitor.consultar('fato_agendamento_compra', {
        filtros,
        colunas: [
          'id_agendamento_compra',
          'numero_pedido_compra',
          'fornecedor',
          'data_prevista',
          'data_entrada_original',
          'data_entrada',
          'data_entrada_corrigida_dia_mes',
          'id_produto',
          'sku',
          'descricao_produto',
          'marca',
          'quantidade_pedida',
          'quantidade_recebida',
          'quantidade_pendente',
          'numero_nf_entrada',
          'status_logistico',
          'recebido_com_atraso',
          'dias_atraso_recebimento'
        ],
        ordenacao: { campo: 'data_prevista', direcao: 'asc' },
        limite
      });
      return serializar({
        operacao: 'listar',
        parcelas_somadas: false,
        estoque_oficial_alterado: false,
        total_retornado: resultado.dados.length,
        dados: resultado.dados,
        atualizado_em: resultado.ultimaConstrucao
      });
    }

    if (normalizados.operacao === 'resumir_status') {
      const resultado = await leitor.agregar('fato_agendamento_compra', {
        agrupamentos: [{ campo: 'status_logistico', granularidade: 'valor' }],
        calculos: [
          { operacao: 'contar', campo: null },
          { operacao: 'somar', campo: 'quantidade_pendente' }
        ],
        filtros,
        ordenacao: { tipo: 'calculo', indice: 0, direcao: 'desc' },
        limite: STATUS_LOGISTICOS.length
      });
      return serializar({
        operacao: 'resumir_status',
        estoque_oficial_alterado: false,
        status: resultado.dados.map((linha) => ({
          status_logistico: linha.grupo_1,
          parcelas: linha.calculo_1,
          quantidade_pendente: linha.calculo_2
        })),
        atualizado_em: resultado.ultimaConstrucao
      });
    }

    const metrica = normalizados.metrica_quantidade || 'pendente';
    const campoQuantidade = CAMPOS_QUANTIDADE[metrica];
    if (!campoQuantidade) throw new Error(`Metrica de quantidade invalida: ${metrica}.`);
    const agruparPorProduto = !textoOpcional(normalizados.produto) &&
      !textoOpcional(normalizados.sku);
    const agrupamentos = agruparPorProduto
      ? [
        { campo: 'id_produto', granularidade: 'valor' },
        { campo: 'descricao_produto', granularidade: 'valor' },
        { campo: 'sku', granularidade: 'valor' }
      ]
      : [];
    const filtrosIdentificados = agruparPorProduto
      ? {
        ...filtros,
        relacionamento_produto: {
          operador: 'diferente',
          valor: 'NAO_ENCONTRADO'
        }
      }
      : filtros;
    const resultado = await leitor.agregar('fato_agendamento_compra', {
      agrupamentos,
      calculos: [
        { operacao: 'somar', campo: campoQuantidade },
        { operacao: 'contar', campo: null }
      ],
      filtros: filtrosIdentificados,
      ordenacao: { tipo: 'calculo', indice: 0, direcao: 'desc' },
      limite: agruparPorProduto ? 500 : 1
    });
    const totalGeral = await leitor.agregar('fato_agendamento_compra', {
      agrupamentos: [],
      calculos: [
        { operacao: 'somar', campo: campoQuantidade },
        { operacao: 'contar', campo: null }
      ],
      filtros,
      ordenacao: { tipo: 'calculo', indice: 0, direcao: 'desc' },
      limite: 1
    });
    const semIdentificacao = agruparPorProduto
      ? await leitor.agregar('fato_agendamento_compra', {
        agrupamentos: [],
        calculos: [
          { operacao: 'somar', campo: campoQuantidade },
          { operacao: 'contar', campo: null }
        ],
        filtros: {
          ...filtros,
          relacionamento_produto: {
            operador: 'igual',
            valor: 'NAO_ENCONTRADO'
          }
        },
        ordenacao: { tipo: 'calculo', indice: 0, direcao: 'desc' },
        limite: 1
      })
      : { dados: [] };
    const grupos = resultado.dados.slice(0, limite);
    const quantidadeTotal = totalGeral.dados[0]?.calculo_1 ?? 0;
    const parcelasTotal = totalGeral.dados[0]?.calculo_2 ?? 0;
    const quantidadeSemIdentificacao = semIdentificacao.dados[0]?.calculo_1 ?? 0;
    const parcelasSemIdentificacao = semIdentificacao.dados[0]?.calculo_2 ?? 0;
    const quantidadeProdutosIdentificados =
      Number(quantidadeTotal) - Number(quantidadeSemIdentificacao);
    return serializar({
      operacao: 'somar_quantidade',
      metrica_quantidade: metrica,
      parcelas_somadas: true,
      estoque_oficial_alterado: false,
      quantidade_total: quantidadeTotal,
      quantidade_total_inclui_sem_produto_identificado: true,
      quantidade_produtos_identificados: quantidadeProdutosIdentificados,
      parcelas_total: parcelasTotal,
      quantidade_sem_produto_identificado: quantidadeSemIdentificacao,
      parcelas_sem_produto_identificado: parcelasSemIdentificacao,
      produtos_total: agruparPorProduto ? resultado.dados.length : null,
      produtos_retornados: agruparPorProduto ? grupos.length : null,
      resultado_truncado: agruparPorProduto ? resultado.dados.length > grupos.length : false,
      totais: grupos.map((linha) => ({
        ...(agruparPorProduto ? {
          id_produto: linha.grupo_1,
          produto: linha.grupo_2,
          sku: linha.grupo_3
        } : {}),
        quantidade: linha.calculo_1,
        parcelas: linha.calculo_2
      })),
      atualizado_em: resultado.ultimaConstrucao
    });
  } finally {
    await leitor.fechar();
  }
}

module.exports = {
  CAMPOS_QUANTIDADE,
  dataFiltro,
  definicaoAnalisarReposicoes,
  executarAnalisarReposicoes,
  montarFiltros,
  normalizarArgumentos,
  STATUS_LOGISTICOS
};
