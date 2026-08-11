const { criarLeitorGold } = require('../duckdb/gold');
const { criarLeitorSilver } = require('../duckdb/silver');
const {
  serializar,
  validarLimite,
  validarObjeto
} = require('./core/validacao');

const definicaoConsultarBloqueiosSemEstoque = {
  type: 'function',
  name: 'consultar_bloqueios_sem_estoque',
  description:
    'Consulta deterministica dos pedidos ativos com bloqueio 58 (falta de estoque), incluindo a regra do canal MELI COLETA EXT.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      operacao: {
        type: 'string',
        enum: ['resumir', 'listar', 'detalhar_pedido']
      },
      marketplace_pedido: { type: ['string', 'null'] },
      id_nota_saida: { type: ['integer', 'null'] },
      limite: { type: 'integer', minimum: 1, maximum: 50 }
    },
    required: ['operacao', 'marketplace_pedido', 'id_nota_saida', 'limite'],
    additionalProperties: false
  }
};

function textoOpcional(valor) {
  if (valor == null) return null;
  const texto = String(valor).trim();
  return texto || null;
}

function montarFiltros(argumentos) {
  const filtros = {};
  const pedido = textoOpcional(argumentos.marketplace_pedido);
  if (pedido) filtros.marketplace_pedido = { operador: 'igual', valor: pedido };
  if (argumentos.id_nota_saida != null) {
    const id = Number(argumentos.id_nota_saida);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('id_nota_saida deve ser um inteiro positivo.');
    }
    filtros.id_nota_saida = { operador: 'igual', valor: id };
  }
  return filtros;
}

async function obterBloqueiosSemEstoque(argumentos, dependencias = {}) {
  validarObjeto(argumentos);
  if (!['resumir', 'listar', 'detalhar_pedido'].includes(argumentos.operacao)) {
    throw new Error(`Operacao de bloqueios invalida: ${argumentos.operacao}.`);
  }
  const limite = validarLimite(argumentos.limite, 10, 50);
  const filtros = montarFiltros(argumentos);
  const leitorGold = (dependencias.criarLeitorGold || criarLeitorGold)();

  try {
    if (argumentos.operacao === 'resumir') {
      const [pedidos, totais] = await Promise.all([
        leitorGold.contar('bloqueio_sem_estoque_pedido', { filtros }),
        leitorGold.agregar('bloqueio_sem_estoque_pedido', {
          agrupamentos: [],
          calculos: [
            { operacao: 'somar', campo: 'quantidade_ocorrencias' },
            { operacao: 'somar', campo: 'quantidade_produtos_identificados' },
            { operacao: 'somar', campo: 'quantidade_ocorrencias_sem_produto' }
          ],
          filtros,
          limite: 1
        })
      ]);
      const total = totais.dados[0] || {};
      return {
        operacao: 'resumir',
        id_bloqueio: 58,
        descricao_bloqueio: 'PRODUTOS SEM ESTOQUE',
        quantidade_pedidos: pedidos.total,
        quantidade_notas: pedidos.total,
        quantidade_ocorrencias: total.calculo_1 ?? 0,
        quantidade_produtos_identificados: total.calculo_2 ?? 0,
        quantidade_ocorrencias_sem_produto: total.calculo_3 ?? 0,
        regra_meli_coleta_ext:
          'ignorado, exceto quando dt_limite_expedicao e hoje em America/Sao_Paulo',
        atualizado_em: pedidos.ultimaConstrucao
      };
    }

    if (argumentos.operacao === 'listar') {
      const resultado = await leitorGold.consultar('bloqueio_sem_estoque_pedido', {
        filtros,
        colunas: [
          'id_nota_saida', 'marketplace_pedido', 'descricao_bloqueio',
          'quantidade_ocorrencias', 'quantidade_produtos_identificados',
          'quantidade_ocorrencias_sem_produto', 'produtos_identificados',
          'canal_venda', 'dt_limite_expedicao', 'primeiro_bloqueio_em',
          'meli_incluido_por_limite_hoje'
        ],
        ordenacao: { campo: 'primeiro_bloqueio_em', direcao: 'desc' },
        limite
      });
      return {
        operacao: 'listar',
        id_bloqueio: 58,
        quantidade_retornada: resultado.dados.length,
        dados: resultado.dados,
        atualizado_em: resultado.ultimaConstrucao
      };
    }

    if (!Object.keys(filtros).length) {
      throw new Error(
        'marketplace_pedido ou id_nota_saida e obrigatorio para detalhar_pedido.'
      );
    }
    const resultado = await leitorGold.consultar('bloqueio_sem_estoque_item', {
      filtros,
      colunas: [
        'id_nota_saida', 'marketplace_pedido', 'id_produto',
        'produto_identificado', 'sku', 'ean', 'descricao_produto',
        'quantidade_pedida', 'canal_venda', 'dt_limite_expedicao',
        'dthr_bloqueio', 'descricao_bloqueio', 'bloqueio_ativo',
        'meli_incluido_por_limite_hoje'
      ],
      ordenacao: { campo: 'dthr_bloqueio', direcao: 'desc' },
      limite: 500
    });
    const semProduto = resultado.dados.filter(
      (linha) => Number(linha.id_produto || 0) === 0
    );
    let candidatosInferidos = [];
    if (semProduto.length) {
      const leitorSilver = (dependencias.criarLeitorSilver || criarLeitorSilver)();
      try {
        const idsNotas = [...new Set(semProduto.map((linha) => linha.id_nota_saida))];
        for (const idNota of idsNotas) {
          const itens = await leitorSilver.consultar('fato_venda_item', {
            filtros: { id_nota_saida: { operador: 'igual', valor: idNota } },
            colunas: [
              'id_nota_saida', 'item', 'id_produto', 'sku', 'ean',
              'descricao_produto', 'quantidade'
            ],
            ordenacao: { campo: 'item', direcao: 'asc' },
            limite: 500
          });
          candidatosInferidos.push(...itens.dados.map((item) => ({
            ...item,
            quantidade_pedida: item.quantidade,
            produto_inferido: true,
            origem_inferencia: 'itens_da_nota',
            aviso: 'Candidato inferido; o bloqueio nao informou diretamente o produto.'
          })));
        }
      } finally {
        await leitorSilver.fechar();
      }
    }
    return {
      operacao: 'detalhar_pedido',
      id_bloqueio: 58,
      encontrado: resultado.dados.length > 0,
      ocorrencias: resultado.dados.map((linha) => ({
        ...linha,
        produto_inferido: false
      })),
      candidatos_produto_inferidos: candidatosInferidos,
      possui_inferencia: candidatosInferidos.length > 0,
      atualizado_em: resultado.ultimaConstrucao
    };
  } finally {
    await leitorGold.fechar();
  }
}

async function executarConsultarBloqueiosSemEstoque(argumentos, dependencias = {}) {
  return serializar(await obterBloqueiosSemEstoque(argumentos, dependencias));
}

module.exports = {
  definicaoConsultarBloqueiosSemEstoque,
  executarConsultarBloqueiosSemEstoque,
  montarFiltros,
  obterBloqueiosSemEstoque
};
