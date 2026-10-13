const crypto = require('node:crypto');
const { criarLeitorGold } = require('../../duckdb/gold');
const {
  criarConexaoDuckDB,
  fecharConexaoDuckDB
} = require('../../duckdb/connections');

const OBJETO = 'inteligencia_produto_canal_diaria';
const MAX_PRODUTOS = 20;
const METRICAS = Object.freeze([
  'pedidos', 'itens_pedidos', 'quantidade_pedida', 'valor_pedidos',
  'notas_fiscais', 'itens_faturados', 'quantidade_faturada',
  'faturamento_emitido', 'custo_produtos', 'margem_bruta_produtos',
  'comissao_marketplace', 'contribuicao_apos_comissao'
]);
const DEFINICOES_METRICAS = Object.freeze({
  pedidos: { grupo: 'pedidos', rotulo: 'Pedidos distintos', campo_temporal: 'data do pedido',
    descricao: 'Quantidade de pedidos distintos que contêm o produto.' },
  itens_pedidos: { grupo: 'pedidos', rotulo: 'Linhas de item pedidas', campo_temporal: 'data do pedido',
    descricao: 'Quantidade de linhas de item de pedido, independentemente das unidades em cada linha.' },
  quantidade_pedida: { grupo: 'pedidos', rotulo: 'Unidades pedidas', campo_temporal: 'data do pedido',
    descricao: 'Soma das unidades do produto registradas nos pedidos.' },
  valor_pedidos: { grupo: 'pedidos', rotulo: 'Valor dos pedidos', campo_temporal: 'data do pedido',
    descricao: 'Soma do valor dos itens dos pedidos.' },
  notas_fiscais: { grupo: 'faturamento', rotulo: 'Notas fiscais distintas', campo_temporal: 'data de emissão',
    descricao: 'Quantidade de notas fiscais distintas que contêm o produto.' },
  itens_faturados: { grupo: 'faturamento', rotulo: 'Linhas de item faturadas', campo_temporal: 'data de emissão',
    descricao: 'Quantidade de linhas de item nas notas fiscais, independentemente das unidades em cada linha.' },
  quantidade_faturada: { grupo: 'faturamento', rotulo: 'Unidades faturadas', campo_temporal: 'data de emissão',
    descricao: 'Soma das unidades faturadas do produto.' },
  faturamento_emitido: { grupo: 'faturamento', rotulo: 'Faturamento emitido', campo_temporal: 'data de emissão',
    descricao: 'Soma do valor dos itens nas notas fiscais emitidas.' },
  custo_produtos: { grupo: 'faturamento', rotulo: 'Custo dos produtos faturados', campo_temporal: 'data de emissão',
    descricao: 'Soma do custo dos produtos nas notas fiscais emitidas.' },
  margem_bruta_produtos: { grupo: 'faturamento', rotulo: 'Margem bruta dos produtos', campo_temporal: 'data de emissão',
    descricao: 'Faturamento emitido menos custo dos produtos; não é lucro líquido.' },
  comissao_marketplace: { grupo: 'faturamento', rotulo: 'Comissão de marketplace', campo_temporal: 'data de emissão',
    descricao: 'Soma da comissão de marketplace associada aos itens faturados.' },
  contribuicao_apos_comissao: { grupo: 'faturamento', rotulo: 'Contribuição após comissão', campo_temporal: 'data de emissão',
    descricao: 'Faturamento menos custo dos produtos e comissão; não é lucro líquido.' }
});
const SINAIS_COBERTURA = Object.freeze({
  pedidos: '(coalesce(pedidos,0) <> 0 OR coalesce(itens_pedidos,0) <> 0 OR ' +
    'coalesce(quantidade_pedida,0) <> 0 OR coalesce(valor_pedidos,0) <> 0)',
  faturamento: '(coalesce(notas_fiscais,0) <> 0 OR coalesce(itens_faturados,0) <> 0 OR ' +
    'coalesce(quantidade_faturada,0) <> 0 OR coalesce(faturamento_emitido,0) <> 0 OR ' +
    'coalesce(custo_produtos,0) <> 0 OR coalesce(margem_bruta_produtos,0) <> 0 OR ' +
    'coalesce(comissao_marketplace,0) <> 0 OR coalesce(contribuicao_apos_comissao,0) <> 0)'
});
const REGRAS_EXCECAO = Object.freeze([
  'queda_quantidade', 'queda_faturamento', 'contribuicao_negativa',
  'concentracao_canal', 'estoque_sem_giro', 'ruptura',
  'reposicao_atrasada', 'diferenca_periodo'
]);

function erro(codigo, mensagem) {
  const falha = new Error(mensagem); falha.codigo = codigo; return falha;
}

function resolverModo(valor = process.env.NEXUS_PRODUCT_INTELLIGENCE_MODE || 'off') {
  const modo = String(valor).toLowerCase();
  if (!['off', 'shadow', 'v1'].includes(modo)) {
    throw erro('PRODUCT_INTELLIGENCE_MODE_INVALID', 'NEXUS_PRODUCT_INTELLIGENCE_MODE inválido.');
  }
  if (modo === 'off') throw erro('PRODUCT_INTELLIGENCE_DISABLED',
    'A inteligência de produtos ainda não está habilitada neste ambiente.');
  return modo;
}

function query(conexao, sql, parametros = []) {
  return new Promise((resolve, reject) => conexao.all(sql, ...parametros,
    (falha, linhas) => falha ? reject(falha) : resolve(linhas)));
}

function normalizar(linha) {
  return Object.fromEntries(Object.entries(linha || {}).map(([chave, valor]) => [chave,
    typeof valor === 'bigint' ? Number(valor) : valor instanceof Date
      ? valor.toISOString().slice(0, 10) : valor]));
}

function dataIso(valor, rotulo, permitirNulo = false) {
  if (valor == null && permitirNulo) return null;
  const texto = String(valor || '');
  const data = new Date(`${texto}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto) || Number.isNaN(data.getTime()) ||
      data.toISOString().slice(0, 10) !== texto) {
    throw erro('PRODUCT_DATE_INVALID', `${rotulo} deve usar uma data válida em AAAA-MM-DD.`);
  }
  return texto;
}

function deslocarDias(valor, dias) {
  const data = new Date(`${valor}T00:00:00.000Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

function fimMes(valor) {
  const data = new Date(`${valor}T00:00:00.000Z`);
  return new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth() + 1, 0))
    .toISOString().slice(0, 10);
}

function inicioMes(valor) { return `${valor.slice(0, 7)}-01`; }

function periodoAnterior(inicio, fim) {
  const dias = Math.round((new Date(`${fim}T00:00:00Z`) -
    new Date(`${inicio}T00:00:00Z`)) / 86400000) + 1;
  return { inicio: deslocarDias(inicio, -dias), fim: deslocarDias(inicio, -1) };
}

async function cobertura(conexao, view) {
  const linha = (await query(conexao, `SELECT min(data_referencia) AS inicio,
    max(data_referencia) AS fim,
    min(CASE WHEN ${SINAIS_COBERTURA.pedidos} THEN data_referencia END) AS pedidos_inicio,
    max(CASE WHEN ${SINAIS_COBERTURA.pedidos} THEN data_referencia END) AS pedidos_fim,
    min(CASE WHEN ${SINAIS_COBERTURA.faturamento} THEN data_referencia END) AS faturamento_inicio,
    max(CASE WHEN ${SINAIS_COBERTURA.faturamento} THEN data_referencia END) AS faturamento_fim
    FROM "${view}"`))[0] || {};
  if (!linha.fim) throw erro('PRODUCT_INTELLIGENCE_EMPTY',
    'A base de inteligência de produtos ainda não possui dados.');
  return normalizar(linha);
}

function diasInclusivos(inicio, fim) {
  return Math.round((new Date(`${fim}T00:00:00Z`) -
    new Date(`${inicio}T00:00:00Z`)) / 86400000) + 1;
}

function gruposDasMetricas(metricas) {
  return [...new Set(metricas.map((metrica) => DEFINICOES_METRICAS[metrica]?.grupo).filter(Boolean))];
}

async function medirCoberturaPeriodo(conexao, view, periodo, coberturaDados, metricas) {
  const grupos = gruposDasMetricas(metricas);
  const linha = normalizar((await query(conexao, `SELECT
      count(DISTINCT CASE WHEN ${SINAIS_COBERTURA.pedidos} THEN data_referencia END) AS dias_pedidos,
      count(DISTINCT CASE WHEN ${SINAIS_COBERTURA.faturamento} THEN data_referencia END) AS dias_faturamento
    FROM "${view}" WHERE data_referencia BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)`,
  [periodo.inicio, periodo.fim]))[0] || {});
  const diasCalendario = diasInclusivos(periodo.inicio, periodo.fim);
  const fontes = {};
  for (const grupo of grupos) {
    const inicioObservado = coberturaDados[`${grupo}_inicio`] || null;
    const fimObservado = coberturaDados[`${grupo}_fim`] || null;
    fontes[grupo] = {
      campo_temporal: grupo === 'pedidos' ? 'data do pedido' : 'data de emissão',
      inicio_observado: inicioObservado,
      fim_observado: fimObservado,
      intervalo_dentro_da_cobertura_observada: Boolean(inicioObservado && fimObservado &&
        periodo.inicio >= inicioObservado && periodo.fim <= fimObservado),
      dias_com_registro_no_periodo: Number(linha[`dias_${grupo}`] || 0),
      dias_calendario_no_periodo: diasCalendario
    };
  }
  const dentroDaCobertura = grupos.length > 0 && grupos.every((grupo) =>
    fontes[grupo].intervalo_dentro_da_cobertura_observada);
  return {
    fontes,
    conclusao: dentroDaCobertura
      ? 'intervalo_dentro_da_cobertura_observada'
      : 'intervalo_fora_da_cobertura_observada',
    comprova_integridade_da_carga: false,
    aviso: 'As datas e os dias com registro demonstram cobertura observada, não comprovam a integridade da carga. Dias sem registro podem significar ausência de movimento ou ausência de dados.'
  };
}

function definicoesMetricas(metricas) {
  return Object.fromEntries(metricas.map((metrica) => [metrica, DEFINICOES_METRICAS[metrica]]));
}

function periodoPadrao(coberturaDados, finalidade = 'evolucao') {
  const ultimo = coberturaDados.fim;
  const fimCompleto = ultimo === fimMes(ultimo)
    ? ultimo
    : deslocarDias(inicioMes(ultimo), -1);
  if (finalidade === 'evolucao') {
    const fim = new Date(`${fimCompleto}T00:00:00Z`);
    const inicio = new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth() - 2, 1));
    return { inicio: inicio.toISOString().slice(0, 10), fim: fimCompleto };
  }
  if (finalidade === 'mes') return { inicio: inicioMes(fimCompleto), fim: fimCompleto };
  return { inicio: deslocarDias(ultimo, -29), fim: ultimo };
}

function resolverPeriodo(argumentos, coberturaDados, finalidade) {
  const padrao = periodoPadrao(coberturaDados, finalidade);
  const inicio = dataIso(argumentos.data_inicial, 'data_inicial', true) || padrao.inicio;
  const fim = dataIso(argumentos.data_final, 'data_final', true) || padrao.fim;
  if (inicio > fim) throw erro('PRODUCT_PERIOD_INVALID',
    'data_inicial não pode ser posterior a data_final.');
  const fimExplicito = argumentos.data_final != null;
  return { inicio, fim, parcial: fim > coberturaDados.fim || Boolean(fimExplicito &&
    fim.slice(0, 7) === coberturaDados.fim.slice(0, 7) && coberturaDados.fim !== fimMes(coberturaDados.fim)) };
}

function validarGranularidade(valor) {
  const granularidade = valor || 'mes';
  if (!['dia', 'semana', 'mes'].includes(granularidade)) {
    throw erro('PRODUCT_GRAIN_INVALID', `Granularidade inválida: ${granularidade}.`);
  }
  return granularidade;
}

function expressaoPeriodo(granularidade) {
  if (granularidade === 'semana') return `CAST(date_trunc('week', data_referencia) AS DATE)`;
  if (granularidade === 'mes') return `CAST(date_trunc('month', data_referencia) AS DATE)`;
  return 'CAST(data_referencia AS DATE)';
}

function listaPeriodos(inicio, fim, granularidade) {
  const saida = [];
  let atual = new Date(`${inicio}T00:00:00Z`);
  const limite = new Date(`${fim}T00:00:00Z`);
  if (granularidade === 'mes') atual = new Date(Date.UTC(atual.getUTCFullYear(), atual.getUTCMonth(), 1));
  if (granularidade === 'semana') {
    const dia = atual.getUTCDay() || 7;
    atual.setUTCDate(atual.getUTCDate() - dia + 1);
  }
  while (atual <= limite && saida.length < 1200) {
    saida.push(atual.toISOString().slice(0, 10));
    if (granularidade === 'mes') atual.setUTCMonth(atual.getUTCMonth() + 1);
    else atual.setUTCDate(atual.getUTCDate() + (granularidade === 'semana' ? 7 : 1));
  }
  return saida;
}

function validarMetricas(entrada, padrao) {
  const metricas = entrada?.length ? [...new Set(entrada)] : padrao;
  if (!metricas.length || metricas.length > METRICAS.length || metricas.some((x) => !METRICAS.includes(x))) {
    throw erro('PRODUCT_METRICS_INVALID', 'As métricas de produto informadas são inválidas.');
  }
  return metricas;
}

function seletorSchema() {
  return {
    type: 'object',
    properties: {
      modo: { type: 'string', enum: ['produtos', 'top_periodo'] },
      produtos: {
        type: ['array', 'null'], maxItems: MAX_PRODUTOS,
        items: {
          type: 'object',
          properties: {
            tipo: { type: 'string', enum: ['id_produto', 'sku', 'ean', 'descricao'] },
            valor: { type: 'string' }
          },
          required: ['tipo', 'valor'], additionalProperties: false
        }
      },
      top_n: { type: ['integer', 'null'], minimum: 1, maximum: MAX_PRODUTOS },
      metrica_ranking: {
        type: ['string', 'null'],
        enum: ['quantidade_pedida', 'valor_pedidos', 'quantidade_faturada', 'faturamento_emitido', null]
      },
      data_referencia_inicial: { type: ['string', 'null'] },
      data_referencia_final: { type: ['string', 'null'] }
    },
    required: ['modo', 'produtos', 'top_n', 'metrica_ranking',
      'data_referencia_inicial', 'data_referencia_final'],
    additionalProperties: false
  };
}

async function resolverSelecao(conexao, view, selecao, periodo) {
  if (!selecao || !['produtos', 'top_periodo'].includes(selecao.modo)) {
    throw erro('PRODUCT_SELECTION_INVALID', 'Informe como os produtos devem ser selecionados.');
  }
  if (selecao.modo === 'top_periodo') {
    const metrica = selecao.metrica_ranking || 'faturamento_emitido';
    if (!['quantidade_pedida', 'valor_pedidos', 'quantidade_faturada', 'faturamento_emitido'].includes(metrica)) {
      throw erro('PRODUCT_RANKING_INVALID', 'Métrica de ranking inválida.');
    }
    const inicio = dataIso(selecao.data_referencia_inicial, 'data_referencia_inicial', true) || periodo.inicio;
    const fim = dataIso(selecao.data_referencia_final, 'data_referencia_final', true) || periodo.fim;
    const limite = Math.min(MAX_PRODUTOS, Math.max(1, Number(selecao.top_n || 10)));
    const linhas = await query(conexao, `SELECT id_produto,
        any_value(descricao_produto) AS descricao_produto, any_value(sku) AS sku,
        any_value(ean) AS ean, sum(coalesce("${metrica}",0)) AS valor_ranking
      FROM "${view}" WHERE data_referencia BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
        AND id_produto<>0 GROUP BY id_produto
      ORDER BY valor_ranking DESC, id_produto LIMIT ?`, [inicio, fim, limite]);
    return { produtos: linhas.map(normalizar), criterio: { modo: 'top_periodo', metrica, inicio, fim, limite } };
  }
  if (!Array.isArray(selecao.produtos) || !selecao.produtos.length || selecao.produtos.length > MAX_PRODUTOS) {
    throw erro('PRODUCT_SELECTION_INVALID', `Informe de 1 a ${MAX_PRODUTOS} produtos.`);
  }
  const encontrados = [];
  for (const item of selecao.produtos) {
    const valor = String(item?.valor || '').trim();
    if (!valor) throw erro('PRODUCT_SELECTION_INVALID', 'O identificador do produto está vazio.');
    const regras = {
      id_produto: ['id_produto = CAST(? AS BIGINT)', valor],
      sku: ['upper(trim(CAST(sku AS VARCHAR))) = upper(trim(?))', valor],
      ean: ['upper(trim(CAST(ean AS VARCHAR))) = upper(trim(?))', valor],
      descricao: ['descricao_produto ILIKE ?', `%${valor}%`]
    };
    const regra = regras[item.tipo];
    if (!regra) throw erro('PRODUCT_SELECTION_INVALID', `Tipo de produto inválido: ${item.tipo}.`);
    const linhas = await query(conexao, `SELECT id_produto,
        any_value(descricao_produto) AS descricao_produto, any_value(sku) AS sku,
        any_value(ean) AS ean FROM "${view}" WHERE ${regra[0]} AND id_produto<>0
      GROUP BY id_produto ORDER BY id_produto LIMIT 3`, [regra[1]]);
    if (!linhas.length) throw erro('PRODUCT_NOT_FOUND', `Produto não encontrado: ${valor}.`);
    if (linhas.length > 1) throw erro('PRODUCT_AMBIGUOUS',
      `A descrição “${valor}” corresponde a mais de um produto. Informe SKU, EAN ou ID.`);
    encontrados.push(normalizar(linhas[0]));
  }
  return { produtos: [...new Map(encontrados.map((x) => [x.id_produto, x])).values()],
    criterio: { modo: 'produtos' } };
}

function placeholders(valores) { return valores.map(() => '?').join(','); }

async function persistirResultado(dependencias, nome, argumentos, linhas, atualizadoEm) {
  if (!linhas.length || !dependencias.servicoDatasets?.criarDeLinhas ||
      !dependencias.conversationId || !dependencias.turnoIA?.id) return null;
  const assinatura = crypto.createHash('sha256').update(JSON.stringify({ nome, argumentos })).digest('hex');
  const ref = await dependencias.servicoDatasets.criarDeLinhas(
    dependencias.conversationId, dependencias.turnoIA.id, linhas, {
      assinatura,
      queryManifest: { tipo: 'product_intelligence', ferramenta: nome, argumentos },
      lineage: { ferramenta: nome, fonte: `gold.${OBJETO}` },
      corporateUpdatedAt: atualizadoEm,
      classification: 'dados_nexus'
    });
  return ref?.id || null;
}

async function abrirContexto(dependencias, finalidade) {
  const modo = resolverModo(dependencias.productIntelligenceMode);
  const conexao = (dependencias.criarConexao || criarConexaoDuckDB)();
  const leitor = (dependencias.criarLeitor || criarLeitorGold)({ conexao });
  try {
    const inteligencia = await leitor.prepararObjeto(OBJETO);
    const coberturaDados = await cobertura(conexao, inteligencia.viewAtual);
    return { modo, conexao, leitor, inteligencia, coberturaDados, finalidade };
  } catch (falha) {
    await leitor.fechar().catch(() => null);
    await (dependencias.fecharConexao || fecharConexaoDuckDB)(conexao).catch(() => null);
    if (/nao encontrado|manifest|execu/i.test(falha.message || '')) {
      throw erro('PRODUCT_INTELLIGENCE_NOT_READY',
        'A base de inteligência de produtos ainda não foi construída pelo Worker.');
    }
    throw falha;
  }
}

async function fecharContexto(contexto, dependencias) {
  await contexto.leitor.fechar();
  await (dependencias.fecharConexao || fecharConexaoDuckDB)(contexto.conexao);
}

async function analisarEvolucao(argumentos, dependencias = {}) {
  const contexto = await abrirContexto(dependencias, 'evolucao');
  try {
    const periodo = resolverPeriodo(argumentos, contexto.coberturaDados, 'evolucao');
    const granularidade = validarGranularidade(argumentos.granularidade);
    const metricas = validarMetricas(argumentos.metricas,
      ['quantidade_pedida', 'valor_pedidos', 'quantidade_faturada', 'faturamento_emitido']);
    const coberturaFontes = await medirCoberturaPeriodo(contexto.conexao,
      contexto.inteligencia.viewAtual, periodo, contexto.coberturaDados, metricas);
    periodo.parcial = periodo.parcial ||
      coberturaFontes.conclusao === 'intervalo_fora_da_cobertura_observada';
    const selecao = await resolverSelecao(contexto.conexao, contexto.inteligencia.viewAtual,
      argumentos.selecao, periodo);
    const ids = selecao.produtos.map((x) => Number(x.id_produto));
    if (!ids.length) return { dados: [], produtos: [], periodo, granularidade };
    const expr = expressaoPeriodo(granularidade);
    const linhas = (await query(contexto.conexao, `SELECT ${expr} AS periodo, id_produto,
        any_value(descricao_produto) AS descricao_produto, any_value(sku) AS sku,
        ${metricas.map((x) => `sum(coalesce("${x}",0)) AS "${x}"`).join(',')}
      FROM "${contexto.inteligencia.viewAtual}"
      WHERE data_referencia BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
        AND id_produto IN (${placeholders(ids)})
      GROUP BY periodo,id_produto ORDER BY periodo,id_produto`, [periodo.inicio, periodo.fim, ...ids]))
      .map(normalizar);
    const indice = new Map(linhas.map((x) => [`${x.periodo}:${x.id_produto}`, x]));
    const series = [];
    for (const data of listaPeriodos(periodo.inicio, periodo.fim, granularidade)) {
      for (const produto of selecao.produtos) {
        const existente = indice.get(`${data}:${produto.id_produto}`) || {};
        series.push({ periodo: data, id_produto: produto.id_produto,
          descricao_produto: produto.descricao_produto, sku: produto.sku,
          ...Object.fromEntries(metricas.map((x) => [x, Number(existente[x] || 0)])) });
      }
    }
    const completo = [...series];
    let comparacao = null;
    if (argumentos.comparar_periodo_anterior === true) {
      const anterior = periodoAnterior(periodo.inicio, periodo.fim);
      const totais = await query(contexto.conexao, `SELECT id_produto,
          ${metricas.map((x) => `sum(coalesce("${x}",0)) AS "${x}"`).join(',')}
        FROM "${contexto.inteligencia.viewAtual}"
        WHERE data_referencia BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
          AND id_produto IN (${placeholders(ids)}) GROUP BY id_produto`,
      [anterior.inicio, anterior.fim, ...ids]);
      comparacao = { periodo: anterior, dados: totais.map(normalizar) };
      completo.push(...comparacao.dados.map((x) => ({ tipo_linha: 'comparacao_anterior', ...x })));
    }
    const atualizadoEm = contexto.inteligencia.execucoes.at(-1)?.manifesto?.fim || null;
    const resultRef = contexto.modo === 'v1'
      ? await persistirResultado(dependencias, 'analisar_evolucao_produto', argumentos, completo, atualizadoEm)
      : null;
    return { fonte: 'Dados do Sysemp', periodo, granularidade, metricas,
      definicoes_metricas: definicoesMetricas(metricas), cobertura_fontes: coberturaFontes,
      selecao: selecao.criterio, produtos: selecao.produtos, dados: series.slice(0, 200),
      comparacao_periodo_anterior: comparacao, result_ref: resultRef,
      resultado_truncado_no_prompt: series.length > 200,
      conceito: 'Pedidos, linhas de item e unidades são métricas distintas. Pedidos usam a data do pedido; faturamento usa a data de emissão. Os conceitos não são somados nem tratados como correções uns dos outros.',
      atualizado_em: atualizadoEm, shadow: contexto.modo === 'shadow' };
  } finally { await fecharContexto(contexto, dependencias); }
}

async function compararCanais(argumentos, dependencias = {}) {
  const contexto = await abrirContexto(dependencias, 'canais');
  try {
    const periodo = resolverPeriodo(argumentos, contexto.coberturaDados, 'mes');
    const metricas = validarMetricas(argumentos.metricas,
      ['quantidade_pedida', 'valor_pedidos', 'quantidade_faturada', 'faturamento_emitido',
        'margem_bruta_produtos', 'comissao_marketplace', 'contribuicao_apos_comissao']);
    const coberturaFontes = await medirCoberturaPeriodo(contexto.conexao,
      contexto.inteligencia.viewAtual, periodo, contexto.coberturaDados, metricas);
    periodo.parcial = periodo.parcial ||
      coberturaFontes.conclusao === 'intervalo_fora_da_cobertura_observada';
    const selecao = await resolverSelecao(contexto.conexao, contexto.inteligencia.viewAtual,
      argumentos.selecao, periodo);
    const ids = selecao.produtos.map((x) => Number(x.id_produto));
    const limite = Math.min(30, Math.max(1, Number(argumentos.limite_canais || 10)));
    const consultarPeriodo = async (faixa) => (await query(contexto.conexao, `SELECT id_produto,
        any_value(descricao_produto) AS descricao_produto, any_value(sku) AS sku,
        coalesce(nullif(any_value(plataforma),''),'Canal não identificado') AS canal,
        sum(coalesce(faturamento_emitido,0)) AS _ordem_faturamento,
        ${metricas.map((x) => `sum(coalesce("${x}",0)) AS "${x}"`).join(',')}
      FROM "${contexto.inteligencia.viewAtual}"
      WHERE data_referencia BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
        AND id_produto IN (${placeholders(ids)})
      GROUP BY id_produto,id_plataforma
      QUALIFY row_number() OVER (PARTITION BY id_produto
        ORDER BY sum(coalesce(faturamento_emitido,0)) DESC,id_plataforma) <= ?
      ORDER BY id_produto,_ordem_faturamento DESC`,
    [faixa.inicio, faixa.fim, ...ids, limite])).map(normalizar);
    const atual = ids.length ? await consultarPeriodo(periodo) : [];
    const totais = new Map();
    for (const linha of atual) totais.set(linha.id_produto,
      (totais.get(linha.id_produto) || 0) + Number(linha._ordem_faturamento || 0));
    for (const linha of atual) linha.participacao_faturamento_pct = totais.get(linha.id_produto)
      ? Number((100 * Number(linha._ordem_faturamento || 0) / totais.get(linha.id_produto)).toFixed(4)) : null;
    const periodoComparacao = argumentos.periodo_comparacao?.data_inicial &&
      argumentos.periodo_comparacao?.data_final
      ? { inicio: dataIso(argumentos.periodo_comparacao.data_inicial, 'periodo_comparacao.data_inicial'),
        fim: dataIso(argumentos.periodo_comparacao.data_final, 'periodo_comparacao.data_final') }
      : periodoAnterior(periodo.inicio, periodo.fim);
    const anterior = ids.length ? await consultarPeriodo(periodoComparacao) : [];
    const anteriorIndice = new Map(anterior.map((x) => [`${x.id_produto}:${x.canal}`, x]));
    const linhas = atual.map((linha) => ({ ...Object.fromEntries(
      Object.entries(linha).filter(([chave]) => chave !== '_ordem_faturamento')
    ),
      comparacao: Object.fromEntries(metricas.map((metrica) => {
        const valorAtual = Number(linha[metrica] || 0);
        const valorAnterior = Number(anteriorIndice.get(`${linha.id_produto}:${linha.canal}`)?.[metrica] || 0);
        return [metrica, { atual: valorAtual, anterior: valorAnterior,
          variacao_pct: valorAnterior ? Number((100 * (valorAtual - valorAnterior) / valorAnterior).toFixed(4)) : null }];
      })) }));
    const atualizadoEm = contexto.inteligencia.execucoes.at(-1)?.manifesto?.fim || null;
    const resultRef = contexto.modo === 'v1'
      ? await persistirResultado(dependencias, 'comparar_canais_produto', argumentos, linhas, atualizadoEm)
      : null;
    return { fonte: 'Dados do Sysemp', periodo, periodo_comparacao: periodoComparacao,
      selecao: selecao.criterio, produtos: selecao.produtos, metricas,
      definicoes_metricas: definicoesMetricas(metricas), cobertura_fontes: coberturaFontes,
      dados: linhas.slice(0, 200), result_ref: resultRef,
      resultado_truncado_no_prompt: linhas.length > 200,
      conceito_canal: 'Canal corresponde à plataforma cadastrada no Sysemp.',
      conceito_contribuicao: 'Faturamento menos custo dos produtos e comissão; não é lucro líquido.',
      atualizado_em: atualizadoEm, shadow: contexto.modo === 'shadow' };
  } finally { await fecharContexto(contexto, dependencias); }
}

async function diagnosticar360(argumentos, dependencias = {}) {
  const contexto = await abrirContexto(dependencias, 'diagnostico');
  try {
    const periodo = resolverPeriodo(argumentos, contexto.coberturaDados, 'trinta_dias');
    const selecao = await resolverSelecao(contexto.conexao, contexto.inteligencia.viewAtual,
      { modo: 'produtos', produtos: [argumentos.produto], top_n: null,
        metrica_ranking: null, data_referencia_inicial: null, data_referencia_final: null }, periodo);
    const produto = selecao.produtos[0];
    const id = Number(produto.id_produto);
    const anterior = periodoAnterior(periodo.inicio, periodo.fim);
    const totalizar = async (faixa) => normalizar((await query(contexto.conexao, `SELECT
        sum(pedidos) AS pedidos, sum(quantidade_pedida) AS quantidade_pedida,
        sum(valor_pedidos) AS valor_pedidos, sum(notas_fiscais) AS notas_fiscais,
        sum(quantidade_faturada) AS quantidade_faturada,
        sum(faturamento_emitido) AS faturamento_emitido,
        sum(custo_produtos) AS custo_produtos,
        sum(margem_bruta_produtos) AS margem_bruta_produtos,
        sum(comissao_marketplace) AS comissao_marketplace,
        sum(contribuicao_apos_comissao) AS contribuicao_apos_comissao
      FROM "${contexto.inteligencia.viewAtual}" WHERE id_produto=?
        AND data_referencia BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)`,
    [id, faixa.inicio, faixa.fim]))[0] || {});
    const comparar = argumentos.comparar_com_periodo_anterior === true;
    const [atual, comparacao] = await Promise.all([
      totalizar(periodo), comparar ? totalizar(anterior) : Promise.resolve(null)
    ]);
    const canais = (await query(contexto.conexao, `SELECT
        coalesce(nullif(any_value(plataforma),''),'Canal não identificado') AS canal,
        sum(faturamento_emitido) AS faturamento_emitido,
        sum(quantidade_faturada) AS quantidade_faturada,
        sum(margem_bruta_produtos) AS margem_bruta_produtos,
        sum(contribuicao_apos_comissao) AS contribuicao_apos_comissao
      FROM "${contexto.inteligencia.viewAtual}" WHERE id_produto=?
        AND data_referencia BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
      GROUP BY id_plataforma ORDER BY faturamento_emitido DESC LIMIT 10`,
    [id, periodo.inicio, periodo.fim])).map(normalizar);
    const totalCanais = canais.reduce((soma, item) => soma + Number(item.faturamento_emitido || 0), 0);
    for (const canal of canais) canal.participacao_faturamento_pct = totalCanais
      ? Number((100 * Number(canal.faturamento_emitido || 0) / totalCanais).toFixed(4)) : null;
    const evolucao = (await query(contexto.conexao, `SELECT
        CAST(date_trunc('month',data_referencia) AS DATE) AS periodo,
        sum(quantidade_pedida) AS quantidade_pedida,
        sum(valor_pedidos) AS valor_pedidos,
        sum(quantidade_faturada) AS quantidade_faturada,
        sum(faturamento_emitido) AS faturamento_emitido,
        sum(contribuicao_apos_comissao) AS contribuicao_apos_comissao
      FROM "${contexto.inteligencia.viewAtual}" WHERE id_produto=?
        AND data_referencia BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
      GROUP BY periodo ORDER BY periodo`, [id, periodo.inicio, periodo.fim])).map(normalizar);
    let risco = null;
    let atualizadoRisco = null;
    try {
      const objetoRisco = await contexto.leitor.prepararObjeto('risco_ruptura_produto');
      risco = normalizar((await query(contexto.conexao, `SELECT id_produto,descricao_produto,sku,ean,
          marca,categoria,data_referencia,estoque_disponivel,quantidade_reservada,
          custo_produto_atual,valor_estoque_custo,saida_venda_30d,saida_venda_90d,
          media_diaria_saida_90d,dias_cobertura,data_estimada_ruptura,classificacao_risco,
          tem_reposicao_prevista,proxima_data_prevista,tem_entrega_atrasada,
          data_entrega_atrasada_mais_antiga,dthr_atualizacao_estoque
        FROM "${objetoRisco.viewAtual}" WHERE id_produto=? LIMIT 1`, [id]))[0] || null);
      atualizadoRisco = objetoRisco.execucoes.at(-1)?.manifesto?.fim || null;
    } catch (_) { /* diagnóstico permanece útil mesmo sem o snapshot de estoque */ }
    const excecoes = [];
    const queda = (campo) => Number(comparacao?.[campo] || 0)
      ? 100 * (Number(atual[campo] || 0) - Number(comparacao[campo] || 0)) / Number(comparacao[campo]) : null;
    if (queda('faturamento_emitido') != null && queda('faturamento_emitido') <= -20) {
      excecoes.push({ regra: 'queda_faturamento', valor_pct: Number(queda('faturamento_emitido').toFixed(4)) });
    }
    if (Number(atual.contribuicao_apos_comissao || 0) < 0) excecoes.push({ regra: 'contribuicao_negativa' });
    if (risco?.classificacao_risco && ['RUPTURA_ATUAL', 'CRITICO', 'ALTO'].includes(risco.classificacao_risco)) {
      excecoes.push({ regra: 'ruptura', classificacao: risco.classificacao_risco });
    }
    if (risco?.tem_entrega_atrasada === true) excecoes.push({ regra: 'reposicao_atrasada' });
    const atualizadoEm = contexto.inteligencia.execucoes.at(-1)?.manifesto?.fim || null;
    const identificacao = { ...produto, marca: risco?.marca ?? null, categoria: risco?.categoria ?? null };
    const linhaCompleta = [
      { tipo_linha: 'desempenho', ...identificacao, periodo_inicio: periodo.inicio,
        periodo_fim: periodo.fim, ...atual },
      ...canais.map((item) => ({ tipo_linha: 'canal', id_produto: id, ...item })),
      ...evolucao.map((item) => ({ tipo_linha: 'evolucao', id_produto: id, ...item })),
      ...(risco ? [{ tipo_linha: 'estoque_atual', ...risco }] : []),
      ...excecoes.map((item) => ({ tipo_linha: 'excecao', id_produto: id,
        regra: item.regra, detalhe: JSON.stringify(item) }))
    ];
    const resultRef = contexto.modo === 'v1'
      ? await persistirResultado(dependencias, 'diagnosticar_produto_360', argumentos, linhaCompleta, atualizadoEm)
      : null;
    return { fonte: 'Dados do Sysemp', produto: identificacao, periodo,
      periodo_comparacao: comparar ? anterior : null,
      desempenho: { atual, anterior: comparacao }, evolucao_recente: evolucao,
      canais, estoque_atual: risco,
      excecoes, result_ref: resultRef,
      conceitos: {
        estoque: 'Fotografia atual do estoque; não representa histórico do período.',
        contribuicao: 'Faturamento menos custo dos produtos e comissão; não é lucro líquido.',
        datas: 'Pedidos usam data do pedido e faturamento usa data de emissão.'
      },
      atualizado_em: { desempenho: atualizadoEm, estoque: atualizadoRisco },
      shadow: contexto.modo === 'shadow' };
  } finally { await fecharContexto(contexto, dependencias); }
}

async function detectarExcecoes(argumentos, dependencias = {}) {
  const contexto = await abrirContexto(dependencias, 'excecoes');
  try {
    const periodo = resolverPeriodo(argumentos, contexto.coberturaDados, 'trinta_dias');
    if (periodo.parcial) throw erro('PRODUCT_ALERT_PARTIAL_PERIOD',
      'Alertas não são calculados automaticamente com período incompleto. Informe um período completo.');
    const anterior = periodoAnterior(periodo.inicio, periodo.fim);
    const regras = argumentos.regras?.length ? [...new Set(argumentos.regras)] : [...REGRAS_EXCECAO];
    if (regras.some((x) => !REGRAS_EXCECAO.includes(x))) throw erro('PRODUCT_ALERT_RULE_INVALID',
      'Uma das regras de exceção informadas é inválida.');
    const limites = {
      queda_pct: Number(argumentos.limites?.queda_pct ?? 20),
      concentracao_canal_pct: Number(argumentos.limites?.concentracao_canal_pct ?? 80),
      diferenca_periodo_pct: Number(argumentos.limites?.diferenca_periodo_pct ?? 20)
    };
    const filtros = [];
    const paramsFiltro = [];
    for (const [entrada, campo] of [['marca', 'marca'], ['categoria', 'categoria'], ['produto', 'descricao_produto']]) {
      const valor = argumentos.filtros?.[entrada];
      if (valor) { filtros.push(`${campo} ILIKE ?`); paramsFiltro.push(`%${String(valor).trim()}%`); }
    }
    const agregado = async (faixa) => (await query(contexto.conexao, `SELECT id_produto,
        any_value(descricao_produto) AS descricao_produto, any_value(sku) AS sku,
        any_value(marca) AS marca, any_value(categoria) AS categoria,
        sum(quantidade_pedida) AS quantidade_pedida, sum(valor_pedidos) AS valor_pedidos,
        sum(quantidade_faturada) AS quantidade_faturada,
        sum(faturamento_emitido) AS faturamento_emitido,
        sum(contribuicao_apos_comissao) AS contribuicao_apos_comissao
      FROM "${contexto.inteligencia.viewAtual}" WHERE data_referencia BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
        ${filtros.length ? `AND ${filtros.join(' AND ')}` : ''}
      GROUP BY id_produto`, [faixa.inicio, faixa.fim, ...paramsFiltro])).map(normalizar);
    const [atuais, anteriores] = await Promise.all([agregado(periodo), agregado(anterior)]);
    const indiceAnterior = new Map(anteriores.map((x) => [x.id_produto, x]));
    const canais = (await query(contexto.conexao, `SELECT id_produto,id_plataforma,
        sum(faturamento_emitido) AS faturamento FROM "${contexto.inteligencia.viewAtual}"
      WHERE data_referencia BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
        ${filtros.length ? `AND ${filtros.join(' AND ')}` : ''}
      GROUP BY id_produto,id_plataforma`, [periodo.inicio, periodo.fim, ...paramsFiltro])).map(normalizar);
    const canaisPorProduto = new Map();
    for (const item of canais) {
      const lista = canaisPorProduto.get(item.id_produto) || [];
      lista.push(Number(item.faturamento || 0)); canaisPorProduto.set(item.id_produto, lista);
    }
    let riscos = [];
    let atualizadoRisco = null;
    try {
      const objetoRisco = await contexto.leitor.prepararObjeto('risco_ruptura_produto');
      riscos = (await query(contexto.conexao, `SELECT id_produto,descricao_produto,sku,ean,marca,categoria,
        estoque_disponivel,
        classificacao_risco,tem_entrega_atrasada,data_entrega_atrasada_mais_antiga,
        valor_estoque_custo FROM "${objetoRisco.viewAtual}"`)).map(normalizar);
      atualizadoRisco = objetoRisco.execucoes.at(-1)?.manifesto?.fim || null;
    } catch (_) { /* regras de vendas continuam disponíveis */ }
    const riscoPorId = new Map(riscos.map((x) => [x.id_produto, x]));
    const atuaisPorId = new Map(atuais.map((x) => [x.id_produto, x]));
    const correspondeFiltros = (item) => [['marca', 'marca'], ['categoria', 'categoria'],
      ['produto', 'descricao_produto']].every(([entrada, campo]) => {
      const filtro = String(argumentos.filtros?.[entrada] || '').trim().toLocaleLowerCase('pt-BR');
      return !filtro || String(item[campo] || '').toLocaleLowerCase('pt-BR').includes(filtro);
    });
    const periodoSemGiro = { inicio: deslocarDias(contexto.coberturaDados.fim, -29),
      fim: contexto.coberturaDados.fim };
    const vendas30 = regras.includes('estoque_sem_giro') ? (await query(contexto.conexao,
      `SELECT id_produto,sum(quantidade_faturada) AS quantidade_faturada
       FROM "${contexto.inteligencia.viewAtual}"
       WHERE data_referencia BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
       GROUP BY id_produto`, [periodoSemGiro.inicio, periodoSemGiro.fim])).map(normalizar) : [];
    const vendas30PorId = new Map(vendas30.map((x) => [x.id_produto, Number(x.quantidade_faturada || 0)]));
    const exigeSnapshot = regras.some((regra) =>
      ['estoque_sem_giro', 'ruptura', 'reposicao_atrasada'].includes(regra));
    if (exigeSnapshot) {
      for (const risco of riscos) {
        if (atuaisPorId.has(risco.id_produto) || !correspondeFiltros(risco)) continue;
        atuaisPorId.set(risco.id_produto, {
          id_produto: risco.id_produto,
          descricao_produto: risco.descricao_produto,
          sku: risco.sku,
          marca: risco.marca,
          categoria: risco.categoria,
          quantidade_pedida: 0,
          valor_pedidos: 0,
          quantidade_faturada: 0,
          faturamento_emitido: 0,
          contribuicao_apos_comissao: 0
        });
      }
    }
    const saida = [];
    for (const atual of atuaisPorId.values()) {
      const previo = indiceAnterior.get(atual.id_produto) || {};
      const risco = riscoPorId.get(atual.id_produto) || {};
      const alertas = [];
      const variacao = (campo) => Number(previo[campo] || 0)
        ? 100 * (Number(atual[campo] || 0) - Number(previo[campo] || 0)) / Number(previo[campo]) : null;
      if (regras.includes('queda_quantidade') && variacao('quantidade_faturada') != null &&
          variacao('quantidade_faturada') <= -limites.queda_pct) alertas.push({ regra: 'queda_quantidade',
        valor_pct: Number(variacao('quantidade_faturada').toFixed(4)), criterio_pct: limites.queda_pct });
      if (regras.includes('queda_faturamento') && variacao('faturamento_emitido') != null &&
          variacao('faturamento_emitido') <= -limites.queda_pct) alertas.push({ regra: 'queda_faturamento',
        valor_pct: Number(variacao('faturamento_emitido').toFixed(4)), criterio_pct: limites.queda_pct });
      if (regras.includes('contribuicao_negativa') && Number(atual.contribuicao_apos_comissao || 0) < 0) {
        alertas.push({ regra: 'contribuicao_negativa', valor: Number(atual.contribuicao_apos_comissao) });
      }
      const valoresCanal = canaisPorProduto.get(atual.id_produto) || [];
      const totalCanal = valoresCanal.reduce((soma, valor) => soma + valor, 0);
      const concentracao = totalCanal ? 100 * Math.max(...valoresCanal) / totalCanal : 0;
      if (regras.includes('concentracao_canal') && concentracao >= limites.concentracao_canal_pct) {
        alertas.push({ regra: 'concentracao_canal', valor_pct: Number(concentracao.toFixed(4)),
          criterio_pct: limites.concentracao_canal_pct });
      }
      if (regras.includes('estoque_sem_giro') && Number(risco.estoque_disponivel || 0) > 0 &&
          Number(vendas30PorId.get(atual.id_produto) || 0) === 0) alertas.push({ regra: 'estoque_sem_giro',
        estoque_disponivel: Number(risco.estoque_disponivel), periodo_sem_venda: periodoSemGiro });
      if (regras.includes('ruptura') && ['RUPTURA_ATUAL', 'CRITICO', 'ALTO'].includes(risco.classificacao_risco)) {
        alertas.push({ regra: 'ruptura', classificacao: risco.classificacao_risco });
      }
      if (regras.includes('reposicao_atrasada') && risco.tem_entrega_atrasada === true) {
        alertas.push({ regra: 'reposicao_atrasada', data: risco.data_entrega_atrasada_mais_antiga });
      }
      const valorPedidos = Number(atual.valor_pedidos || 0);
      const gap = valorPedidos ? 100 * Math.abs(valorPedidos - Number(atual.faturamento_emitido || 0)) / valorPedidos : 0;
      if (regras.includes('diferenca_periodo') && gap >= limites.diferenca_periodo_pct) alertas.push({
        regra: 'diferenca_periodo', valor_pct: Number(gap.toFixed(4)),
        criterio_pct: limites.diferenca_periodo_pct,
        aviso: 'Diferença do período; não comprova backlog.'
      });
      if (alertas.length) saida.push({ ...atual, estoque_disponivel: risco.estoque_disponivel ?? null,
        valor_estoque_custo: risco.valor_estoque_custo ?? null, alertas });
    }
    saida.sort((a, b) => b.alertas.length - a.alertas.length ||
      Math.abs(Number(b.faturamento_emitido || 0) - Number(indiceAnterior.get(b.id_produto)?.faturamento_emitido || 0)) -
      Math.abs(Number(a.faturamento_emitido || 0) - Number(indiceAnterior.get(a.id_produto)?.faturamento_emitido || 0)));
    const limite = Math.min(50, Math.max(1, Number(argumentos.limite_resultados || 20)));
    const completo = saida.slice(0, limite);
    const atualizadoEm = contexto.inteligencia.execucoes.at(-1)?.manifesto?.fim || null;
    const resultRef = contexto.modo === 'v1'
      ? await persistirResultado(dependencias, 'detectar_excecoes_produto', argumentos,
        completo.map((x) => ({ ...x, alertas: JSON.stringify(x.alertas) })), atualizadoEm)
      : null;
    return { fonte: 'Dados do Sysemp', periodo, periodo_comparacao: anterior,
      regras, limites, dados: completo, result_ref: resultRef,
      alertas_sob_demanda: true,
      conceito_diferenca_periodo: 'Compara pedidos e faturamento no intervalo; não comprova backlog.',
      conceito_contribuicao: 'Não é lucro líquido e não inclui frete, impostos ou despesas.',
      atualizado_em: { desempenho: atualizadoEm, estoque: atualizadoRisco },
      shadow: contexto.modo === 'shadow' };
  } finally { await fecharContexto(contexto, dependencias); }
}

module.exports = {
  MAX_PRODUTOS,
  METRICAS,
  DEFINICOES_METRICAS,
  REGRAS_EXCECAO,
  seletorSchema,
  resolverModo,
  analisarEvolucao,
  compararCanais,
  diagnosticar360,
  detectarExcecoes,
  dataIso,
  periodoAnterior
};
