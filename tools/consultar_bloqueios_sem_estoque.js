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
        enum: ['resumir', 'listar', 'listar_itens', 'detalhar_pedido']
      },
      marketplace_pedido: { type: ['string', 'null'] },
      marketplace_pedidos: {
        anyOf: [
          { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50 },
          { type: 'null' }
        ]
      },
      id_nota_saida: { type: ['integer', 'null'] },
      ids_notas_saida: {
        anyOf: [
          { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 50 },
          { type: 'null' }
        ]
      },
      limite: {
        description: 'Limite seguro de linhas expostas ao modelo. Use no máximo 50.',
        type: 'integer', minimum: 1, maximum: 50
      }
    },
    required: [
      'operacao', 'marketplace_pedido', 'marketplace_pedidos',
      'id_nota_saida', 'ids_notas_saida', 'limite'
    ],
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
  const pedidos = [...new Set([
    ...(pedido ? [pedido] : []),
    ...(argumentos.marketplace_pedidos || []).map(textoOpcional).filter(Boolean)
  ])];
  if (pedidos.length === 1) {
    filtros.marketplace_pedido = { operador: 'igual', valor: pedidos[0] };
  } else if (pedidos.length > 1) {
    filtros.marketplace_pedido = { operador: 'em', valores: pedidos };
  }
  const idNota = argumentos.id_nota_saida == null ? null : Number(argumentos.id_nota_saida);
  if (idNota != null && (!Number.isInteger(idNota) || idNota <= 0)) {
    throw new Error('id_nota_saida deve ser um inteiro positivo.');
  }
  const idsNotas = [...new Set([
    ...(idNota == null ? [] : [idNota]),
    ...(argumentos.ids_notas_saida || []).map(Number)
  ])];
  if (idsNotas.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error('ids_notas_saida deve conter apenas inteiros positivos.');
  }
  if (idsNotas.length === 1) {
    filtros.id_nota_saida = { operador: 'igual', valor: idsNotas[0] };
  } else if (idsNotas.length > 1) {
    filtros.id_nota_saida = { operador: 'em', valores: idsNotas };
  }
  return filtros;
}

function montarWhereResumo(filtros, citar) {
  const condicoes = [];
  const parametros = [];
  for (const campo of ['marketplace_pedido', 'id_nota_saida']) {
    const filtro = filtros[campo];
    if (!filtro) continue;
    if (filtro.operador === 'igual') {
      condicoes.push(`${citar(campo)} = ?`);
      parametros.push(filtro.valor);
    } else if (filtro.operador === 'em') {
      const valores = filtro.valores || [];
      condicoes.push(`${citar(campo)} IN (${valores.map(() => '?').join(', ')})`);
      parametros.push(...valores);
    }
  }
  return {
    where: condicoes.length ? ` WHERE ${condicoes.join(' AND ')}` : '',
    parametros
  };
}

function coberturaDoSnapshot(atualizadoEm, dependencias = {}) {
  const agora = dependencias.agora instanceof Date
    ? dependencias.agora
    : new Date(dependencias.agora || Date.now());
  const instante = new Date(atualizadoEm);
  const limiteMinutosConfigurado = Number(
    dependencias.maxAgeMinutes ?? process.env.NEXUS_BLOCKING_DATA_MAX_AGE_MINUTES ?? 180
  );
  const limiteMinutos = Number.isFinite(limiteMinutosConfigurado) && limiteMinutosConfigurado > 0
    ? limiteMinutosConfigurado : 180;
  const idadeMinutos = Number.isNaN(instante.getTime()) || Number.isNaN(agora.getTime())
    ? null
    : Math.max(0, Math.floor((agora.getTime() - instante.getTime()) / 60000));
  const possivelmenteDesatualizado = idadeMinutos == null || idadeMinutos > limiteMinutos;
  return {
    conclusao: possivelmenteDesatualizado
      ? 'snapshot_possivelmente_desatualizado'
      : 'snapshot_observado',
    comprova_integridade_da_carga: false,
    consulta_em_tempo_real: false,
    atualizado_em: atualizadoEm || null,
    idade_minutos: idadeMinutos,
    limite_recencia_minutos: limiteMinutos,
    possivelmente_desatualizado: possivelmenteDesatualizado,
    aviso: possivelmenteDesatualizado
      ? 'O resultado reflete um snapshot antigo e pode nao conter alteracoes posteriores.'
      : 'O resultado reflete o snapshot indicado e nao comprova, isoladamente, a integridade da carga.'
  };
}

function comCobertura(resultado, atualizadoEm, dependencias) {
  return {
    ...resultado,
    atualizado_em: atualizadoEm || null,
    cobertura_fontes: coberturaDoSnapshot(atualizadoEm, dependencias)
  };
}

async function obterBloqueiosSemEstoque(argumentos, dependencias = {}) {
  validarObjeto(argumentos);
  if (!['resumir', 'listar', 'listar_itens', 'detalhar_pedido'].includes(argumentos.operacao)) {
    throw new Error(`Operacao de bloqueios invalida: ${argumentos.operacao}.`);
  }
  const limite = validarLimite(
    argumentos.limite,
    argumentos.operacao === 'listar_itens' ? 100 : 10,
    argumentos.operacao === 'listar_itens' ? 500 : 50
  );
  const filtros = montarFiltros(argumentos);
  const leitorGold = (dependencias.criarLeitorGold || criarLeitorGold)();

  try {
    if (argumentos.operacao === 'resumir') {
      const [pedidos, totais] = await Promise.all([
        leitorGold.contar('bloqueio_sem_estoque_pedido', { filtros }),
        leitorGold.comObjeto('bloqueio_sem_estoque_item', async ({
          contexto, consultarSql, citar
        }) => {
          const { where, parametros } = montarWhereResumo(filtros, citar);
          const [linha] = await consultarSql(`
            SELECT
              count(*) AS quantidade_ocorrencias,
              count(*) FILTER (WHERE ${citar('id_produto')} > 0)
                AS quantidade_ocorrencias_produto_identificado,
              count(DISTINCT ${citar('id_produto')}) FILTER (WHERE ${citar('id_produto')} > 0)
                AS quantidade_produtos_unicos_identificados,
              count(*) FILTER (WHERE ${citar('id_produto')} = 0)
                AS quantidade_ocorrencias_sem_produto,
              coalesce(sum(coalesce(${citar('quantidade_pedida')}, 0)), 0)
                AS quantidade_unidades_bloqueadas
            FROM ${citar(contexto.viewAtual)}${where}
          `, parametros);
          return linha || {};
        })
      ]);
      const total = totais || {};
      return comCobertura({
        operacao: 'resumir',
        id_bloqueio: 58,
        descricao_bloqueio: 'PRODUTOS SEM ESTOQUE',
        quantidade_pedidos: pedidos.total,
        quantidade_notas: pedidos.total,
        quantidade_ocorrencias: total.quantidade_ocorrencias ?? 0,
        quantidade_ocorrencias_produto_identificado:
          total.quantidade_ocorrencias_produto_identificado ?? 0,
        quantidade_produtos_unicos_identificados:
          total.quantidade_produtos_unicos_identificados ?? 0,
        quantidade_produtos_identificados:
          total.quantidade_produtos_unicos_identificados ?? 0,
        quantidade_ocorrencias_sem_produto:
          total.quantidade_ocorrencias_sem_produto ?? 0,
        quantidade_unidades_bloqueadas: total.quantidade_unidades_bloqueadas ?? 0,
        definicoes_metricas: {
          quantidade_pedidos: 'pedidos/notas distintos com bloqueio ativo elegível',
          quantidade_ocorrencias: 'linhas de ocorrência do bloqueio 58',
          quantidade_produtos_unicos_identificados: 'produtos distintos em todas as ocorrências',
          quantidade_unidades_bloqueadas: 'soma da quantidade pedida nas ocorrências'
        },
        regra_meli_coleta_ext:
          'ignorado, exceto quando dt_limite_expedicao e hoje em America/Sao_Paulo'
      }, pedidos.ultimaConstrucao, dependencias);
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
      return comCobertura({
        operacao: 'listar',
        id_bloqueio: 58,
        quantidade_retornada: resultado.dados.length,
        dados: resultado.dados
      }, resultado.ultimaConstrucao, dependencias);
    }

    if (argumentos.operacao === 'listar_itens') {
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
        limite
      });
      const dados = resultado.dados.map((linha) => ({
        ...linha,
        produto_inferido: false
      }));
      const semProduto = dados.filter((linha) => Number(linha.id_produto || 0) === 0);
      const candidatosProdutoInferidos = [];
      if (semProduto.length) {
        const leitorSilver = (dependencias.criarLeitorSilver || criarLeitorSilver)();
        try {
          for (const linhaBloqueio of semProduto) {
            const itens = await leitorSilver.consultar('fato_venda_item', {
              filtros: {
                id_nota_saida: { operador: 'igual', valor: linhaBloqueio.id_nota_saida }
              },
              colunas: [
                'id_nota_saida', 'item', 'id_produto', 'sku', 'ean',
                'descricao_produto', 'quantidade'
              ],
              ordenacao: { campo: 'item', direcao: 'asc' },
              limite: 500
            });
            candidatosProdutoInferidos.push(...itens.dados.map((item) => ({
              ...item,
              marketplace_pedido: linhaBloqueio.marketplace_pedido,
              quantidade_pedida: item.quantidade,
              canal_venda: linhaBloqueio.canal_venda,
              produto_inferido: true,
              origem_inferencia: 'itens_da_nota',
              aviso: 'Candidato inferido; o bloqueio nao informou diretamente o produto.'
            })));
          }
        } finally {
          await leitorSilver.fechar();
        }
      }
      return comCobertura({
        operacao: 'listar_itens',
        id_bloqueio: 58,
        quantidade_retornada: dados.length,
        quantidade_ocorrencias: dados.length,
        quantidade_produtos_unicos_identificados: new Set(dados
          .map((linha) => Number(linha.id_produto || 0))
          .filter((id) => id > 0)).size,
        quantidade_unidades_bloqueadas: dados.reduce((total, linha) =>
          total + Number(linha.quantidade_pedida || 0), 0),
        dados,
        candidatos_produto_inferidos: candidatosProdutoInferidos,
        possui_inferencia: candidatosProdutoInferidos.length > 0
      }, resultado.ultimaConstrucao, dependencias);
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
    return comCobertura({
      operacao: 'detalhar_pedido',
      id_bloqueio: 58,
      encontrado: resultado.dados.length > 0,
      ocorrencias: resultado.dados.map((linha) => ({
        ...linha,
        produto_inferido: false
      })),
      candidatos_produto_inferidos: candidatosInferidos,
      possui_inferencia: candidatosInferidos.length > 0
    }, resultado.ultimaConstrucao, dependencias);
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
  coberturaDoSnapshot,
  montarFiltros,
  obterBloqueiosSemEstoque
};
