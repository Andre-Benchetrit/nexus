const { criarLeitorGold } = require('../duckdb/gold');
const { criarClienteThorpe } = require('../integracoes/thorpe/cliente');
const { FUSO_NEGOCIO } = require('./core/tempo');
const { executarAnalisarReposicoes } = require('./analisar_reposicoes');
const {
  obterBloqueiosSemEstoque
} = require('./consultar_bloqueios_sem_estoque');
const { serializar, validarObjeto } = require('./core/validacao');

const DIAS_REPOSICAO_PROXIMA = 7;

const definicaoDiagnosticarBloqueioSemEstoque = {
  type: 'function',
  name: 'diagnosticar_bloqueio_sem_estoque',
  description:
    'Diagnostica deterministicamente um pedido com bloqueio 58 cruzando quantidade pedida, estoque oficial da empresa 10, saldo do CD no Thorpe e reposicoes.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      marketplace_pedido: { type: ['string', 'null'] },
      id_nota_saida: { type: ['integer', 'null'] }
    },
    required: ['marketplace_pedido', 'id_nota_saida'],
    additionalProperties: false
  }
};

function dataNegocio(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_NEGOCIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(agora);
  const valores = Object.fromEntries(partes.map(({ type, value }) => [type, value]));
  return `${valores.year}-${valores.month}-${valores.day}`;
}

function diferencaDias(inicio, fim) {
  return Math.round(
    (Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) /
    86400000
  );
}

function classificarProduto({
  estoqueEncontrado,
  estoqueDisponivel,
  quantidadePedida,
  reposicao,
  thorpeEncontrado,
  estoqueThorpe
}) {
  if (!estoqueEncontrado || quantidadePedida == null) return 'diagnostico_parcial';
  if (!thorpeEncontrado || estoqueThorpe == null) return 'diagnostico_parcial';
  const erpCobre = estoqueDisponivel >= quantidadePedida;
  const thorpeCobre = estoqueThorpe >= quantidadePedida;
  if (erpCobre !== thorpeCobre) return 'divergencia_erp_cd';
  if (erpCobre) {
    return 'estoque_suficiente_bloqueio_possivelmente_desatualizado';
  }
  if (!reposicao) return 'falta_confirmada_sem_reposicao_prevista';
  return reposicao.dias_ate_chegada <= DIAS_REPOSICAO_PROXIMA
    ? 'falta_confirmada_com_reposicao_proxima'
    : 'falta_confirmada_com_reposicao_distante';
}

function consolidarProdutos(detalhes) {
  const candidatos = [
    ...detalhes.ocorrencias
      .filter((linha) => Number(linha.id_produto || 0) > 0)
      .map((linha) => ({ ...linha, produto_inferido: false })),
    ...detalhes.candidatos_produto_inferidos
  ];
  const produtos = new Map();
  for (const item of candidatos) {
    const id = Number(item.id_produto || 0);
    if (id <= 0) continue;
    const atual = produtos.get(id);
    if (!atual || (atual.produto_inferido && !item.produto_inferido)) {
      produtos.set(id, item);
    } else if (atual) {
      atual.quantidade_pedida = Math.max(
        Number(atual.quantidade_pedida || 0),
        Number(item.quantidade_pedida || 0)
      );
    }
  }
  return [...produtos.values()];
}

async function executarDiagnosticarBloqueioSemEstoque(argumentos, dependencias = {}) {
  validarObjeto(argumentos);
  if (argumentos.marketplace_pedido == null && argumentos.id_nota_saida == null) {
    throw new Error('marketplace_pedido ou id_nota_saida e obrigatorio.');
  }
  const detalhes = await obterBloqueiosSemEstoque({
    operacao: 'detalhar_pedido',
    marketplace_pedido: argumentos.marketplace_pedido ?? null,
    id_nota_saida: argumentos.id_nota_saida ?? null,
    limite: 50
  }, dependencias);
  if (!detalhes.encontrado) {
    return serializar({
      encontrado: false,
      classificacao: 'diagnostico_parcial',
      motivo: 'Pedido nao encontrado entre os bloqueios 58 ativos e elegiveis.'
    });
  }

  const produtos = consolidarProdutos(detalhes);
  if (!produtos.length) {
    return serializar({
      encontrado: true,
      classificacao: 'produto_nao_identificado',
      detalhes_bloqueio: detalhes,
      thorpe: {
        consultado: false,
        motivo: 'O bloqueio nao identificou produto ou SKU consultavel.'
      }
    });
  }

  const hoje = dataNegocio(dependencias.agora || new Date());
  const leitorGold = (dependencias.criarLeitorGold || criarLeitorGold)();
  let clienteThorpe = dependencias.clienteThorpe || null;
  let erroConfiguracaoThorpe = null;
  if (!clienteThorpe) {
    try {
      clienteThorpe = (dependencias.criarClienteThorpe || criarClienteThorpe)();
    } catch (erro) {
      erroConfiguracaoThorpe = erro.message;
    }
  }
  const diagnosticos = [];
  try {
    for (const produto of produtos) {
      const estoque = await leitorGold.consultar('risco_ruptura_produto', {
        filtros: {
          id_produto: { operador: 'igual', valor: produto.id_produto }
        },
        colunas: [
          'id_produto', 'sku', 'descricao_produto', 'estoque_disponivel',
          'quantidade_reservada', 'classificacao_risco'
        ],
        limite: 1
      });
      const registroEstoque = estoque.dados[0] || null;
      let reposicao = null;
      if (produto.sku) {
        const respostaReposicao = JSON.parse(await (
          dependencias.executarAnalisarReposicoes || executarAnalisarReposicoes
        )({
          operacao: 'listar',
          metrica_quantidade: null,
          data_inicial: hoje,
          data_final: null,
          status_logistico: null,
          produto: null,
          sku: produto.sku,
          fornecedor: null,
          marca: null,
          recebido_com_atraso: null,
          marcacao_manual_divergente: null,
          limite: 30
        }));
        const chegada = respostaReposicao.dados?.find(
          (linha) => Number(linha.quantidade_pendente || 0) > 0 && linha.data_prevista
        );
        if (chegada) {
          const dataPrevista = String(chegada.data_prevista).slice(0, 10);
          reposicao = {
            data_prevista: dataPrevista,
            quantidade_prevista: Number(chegada.quantidade_pendente || 0),
            dias_ate_chegada: diferencaDias(hoje, dataPrevista),
            status_logistico: chegada.status_logistico,
            fornecedor: chegada.fornecedor || null,
            numero_pedido_compra: chegada.numero_pedido_compra || null
          };
        }
      }
      const quantidadePedida = produto.quantidade_pedida == null
        ? null
        : Number(produto.quantidade_pedida);
      const estoqueDisponivel = registroEstoque
        ? Number(registroEstoque.estoque_disponivel || 0)
        : null;
      let estoqueThorpe = null;
      let erroThorpe = erroConfiguracaoThorpe;
      if (clienteThorpe && produto.sku) {
        try {
          estoqueThorpe = await clienteThorpe.consultarEstoque(produto.sku);
        } catch (erro) {
          erroThorpe = erro.message;
        }
      } else if (!produto.sku && !erroThorpe) {
        erroThorpe = 'Produto sem SKU (codigo_auxiliar) para consulta.';
      }
      const estoqueThorpeTotal = estoqueThorpe?.total_utilizavel == null
        ? null
        : Number(estoqueThorpe.total_utilizavel);
      diagnosticos.push({
        id_produto: Number(produto.id_produto),
        sku: produto.sku || registroEstoque?.sku || null,
        descricao_produto:
          produto.descricao_produto || registroEstoque?.descricao_produto || null,
        produto_inferido: produto.produto_inferido === true,
        quantidade_pedida: quantidadePedida,
        estoque_disponivel_empresa_10: estoqueDisponivel,
        estoque_cobre_quantidade:
          estoqueDisponivel == null || quantidadePedida == null
            ? null
            : estoqueDisponivel >= quantidadePedida,
        estoque_cd_thorpe: {
          consultado: Boolean(estoqueThorpe),
          sku_codigo_auxiliar: produto.sku || null,
          disponivel: estoqueThorpe?.disponivel ?? null,
          pulmao: estoqueThorpe?.pulmao ?? null,
          total_utilizavel: estoqueThorpeTotal,
          cobre_quantidade:
            estoqueThorpeTotal == null || quantidadePedida == null
              ? null
              : estoqueThorpeTotal >= quantidadePedida,
          lotes_considerados: estoqueThorpe?.lotes_considerados ?? null,
          erro: erroThorpe
        },
        reposicao,
        classificacao: classificarProduto({
          estoqueEncontrado: Boolean(registroEstoque),
          estoqueDisponivel,
          quantidadePedida,
          reposicao,
          thorpeEncontrado: Boolean(estoqueThorpe),
          estoqueThorpe: estoqueThorpeTotal
        })
      });
    }
  } finally {
    await leitorGold.fechar();
  }

  const prioridade = [
    'divergencia_erp_cd',
    'falta_confirmada_sem_reposicao_prevista',
    'falta_confirmada_com_reposicao_distante',
    'falta_confirmada_com_reposicao_proxima',
    'diagnostico_parcial',
    'estoque_suficiente_bloqueio_possivelmente_desatualizado'
  ];
  const classificacao = [...diagnosticos]
    .sort((a, b) => prioridade.indexOf(a.classificacao) - prioridade.indexOf(b.classificacao))[0]
    ?.classificacao || 'diagnostico_parcial';
  return serializar({
    encontrado: true,
    classificacao,
    corte_reposicao_proxima_dias: DIAS_REPOSICAO_PROXIMA,
    produtos: diagnosticos,
    detalhes_bloqueio: detalhes,
    thorpe: {
      integrado: true,
      endpoint: '/v2/estoque/{sku}/lote',
      campos_utilizados: ['disponivel', 'pulmao']
    }
  });
}

module.exports = {
  classificarProduto,
  consolidarProdutos,
  DIAS_REPOSICAO_PROXIMA,
  definicaoDiagnosticarBloqueioSemEstoque,
  executarDiagnosticarBloqueioSemEstoque
};
