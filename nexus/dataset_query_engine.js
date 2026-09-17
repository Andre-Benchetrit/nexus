const crypto = require('node:crypto');
const { criarLeitorSilver } = require('../duckdb/silver');
const { criarLeitorGold } = require('../duckdb/gold');

const ADAPTADORES = Object.freeze({
  catalogo: Object.freeze({
    camada: 'silver', objeto: 'dim_produto',
    fonte: 'silver.dim_produto', chaves: ['sku', 'ean', 'id_produto'],
    operacoes: ['enriquecer', 'filtrar', 'ranquear', 'comparar'],
    campos: ['id_produto', 'descricao_produto', 'sku', 'ean', 'marca', 'categoria',
      'produto_ativo', 'catalogo_site_ativo']
  }),
  estoque: Object.freeze({
    camada: 'silver', objeto: 'fato_estoque_atual',
    fonte: 'silver.fato_estoque_atual', chaves: ['sku', 'ean', 'id_produto'],
    operacoes: ['enriquecer', 'filtrar', 'ranquear', 'comparar'],
    campos: ['id_produto', 'descricao_produto', 'sku', 'ean', 'marca',
      'estoque_disponivel', 'quantidade_reservada', 'sem_estoque_disponivel']
  }),
  vendas: Object.freeze({
    camada: 'gold', objeto: 'desempenho_produto_diario',
    fonte: 'gold.desempenho_produto_diario', chaves: ['sku', 'ean', 'id_produto'],
    operacoes: ['enriquecer', 'filtrar', 'ranquear', 'comparar'],
    campos: ['id_produto', 'descricao_produto', 'sku', 'ean', 'marca',
      'quantidade_faturada', 'faturamento_emitido', 'margem_bruta_produtos']
  })
});

const MAX_LINHAS_RESULTADO = 50_000;

function inteiroEnv(nome, padrao, maximo) {
  const valor = Number(process.env[nome] || padrao);
  if (!Number.isInteger(valor) || valor < 1 || valor > maximo) throw new Error(`${nome} inválido.`);
  return valor;
}

async function consultarComTimeout(consultarSql, conexao, sql, parametros) {
  const timeoutMs = inteiroEnv('NEXUS_DATASET_QUERY_TIMEOUT_MS', 30_000, 300_000);
  let timer;
  try {
    return await Promise.race([
      consultarSql(sql, parametros),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          conexao?.__nexusDatabase?.interrupt?.();
          const erro = new Error(`A consulta do conjunto excedeu ${timeoutMs} ms.`);
          erro.codigo = 'DATASET_QUERY_TIMEOUT';
          reject(erro);
        }, timeoutMs);
        timer.unref?.();
      })
    ]);
  } finally { clearTimeout(timer); }
}

function citar(nome) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(nome || '')) throw new Error(`Identificador inválido: ${nome}`);
  return `"${nome}"`;
}

function escaparSql(valor) { return String(valor).replace(/'/g, "''").replace(/\\/g, '/'); }

function chaveCorporativa(tipo) {
  if (!['sku', 'ean', 'id_produto'].includes(tipo)) throw new Error(`Chave de conjunto inválida: ${tipo}`);
  return tipo;
}

function normalizarLinha(linha) {
  return Object.fromEntries(Object.entries(linha).map(([chave, valor]) => [chave,
    typeof valor === 'bigint' ? valor.toString() : valor]));
}

function montarPrevia(linhas, maxLinhas = 20, maxBytes = 32 * 1024) {
  const previa = [];
  for (const linha of linhas.slice(0, maxLinhas)) {
    const segura = Object.fromEntries(Object.entries(linha)
      .filter(([nome]) => !nome.startsWith('__nexus_'))
      .map(([nome, valor]) => [nome, typeof valor === 'string' ? valor.slice(0, 2_000) : valor]));
    if (Buffer.byteLength(JSON.stringify([...previa, segura]), 'utf8') > maxBytes) break;
    previa.push(segura);
  }
  return previa;
}

function sqlCatalogo({ view, dataset, chave, colunasDataset }) {
  const campos = ADAPTADORES.catalogo.campos;
  const fonte = `SELECT ${campos.map(citar).join(', ')}, row_number() OVER (PARTITION BY upper(trim(CAST(${citar(chave)} AS VARCHAR))) ORDER BY ${citar('id_produto')}) AS __rn, count(DISTINCT ${citar('id_produto')}) OVER (PARTITION BY upper(trim(CAST(${citar(chave)} AS VARCHAR)))) > 1 AS nexus_associacao_ambigua FROM ${citar(view)}`;
  return `WITH fonte AS (${fonte}), corp AS (SELECT * EXCLUDE (__rn) FROM fonte WHERE __rn=1)
    SELECT ${colunasDataset.map((x) => `d.${citar(x)}`).join(', ')},
      ${campos.map((x) => `c.${citar(x)} AS ${citar(`nexus_${x}`)}`).join(', ')},
      c.nexus_associacao_ambigua,
      (c.${citar('id_produto')} IS NOT NULL) AS nexus_encontrado
    FROM read_parquet('${escaparSql(dataset)}') d LEFT JOIN corp c
      ON upper(trim(CAST(c.${citar(chave)} AS VARCHAR)))=d.${citar('__nexus_key')}
    ORDER BY d.${citar('__nexus_row_number')}`;
}

function sqlEstoque({ view, dataset, chave, colunasDataset, operacao }) {
  const whereFinal = operacao === 'filtrar' ? 'WHERE c.nexus_encontrado AND c.nexus_sem_estoque_disponivel' : '';
  return `WITH corp AS (
      SELECT upper(trim(CAST(${citar(chave)} AS VARCHAR))) AS __key,
        any_value(${citar('id_produto')}) AS nexus_id_produto,
        any_value(${citar('descricao_produto')}) AS nexus_descricao_produto,
        any_value(${citar('sku')}) AS nexus_sku, any_value(${citar('ean')}) AS nexus_ean,
        any_value(${citar('marca')}) AS nexus_marca,
        sum(coalesce(${citar('estoque_disponivel')},0)) AS nexus_estoque_disponivel,
        sum(coalesce(${citar('quantidade_reservada')},0)) AS nexus_quantidade_reservada,
        sum(coalesce(${citar('estoque_disponivel')},0)) <= 0 AS nexus_sem_estoque_disponivel,
        count(DISTINCT ${citar('id_produto')}) > 1 AS nexus_associacao_ambigua,
        true AS nexus_encontrado
      FROM ${citar(view)} WHERE ${citar('empresa_analisada')}=true
      GROUP BY 1
    ), combinado AS (
      SELECT ${colunasDataset.map((x) => `d.${citar(x)}`).join(', ')}, c.* EXCLUDE (__key)
      FROM read_parquet('${escaparSql(dataset)}') d LEFT JOIN corp c ON c.__key=d.${citar('__nexus_key')}
    ) SELECT * FROM combinado c ${whereFinal}
    ORDER BY ${citar('__nexus_row_number')}`;
}

function sqlVendas({ view, dataset, chave, colunasDataset, operacao, periodo, parametros }) {
  const condicoes = [];
  if (periodo?.inicio) { condicoes.push(`${citar('data_referencia')}>=?`); parametros.push(periodo.inicio); }
  if (periodo?.fim) { condicoes.push(`${citar('data_referencia')}<=?`); parametros.push(periodo.fim); }
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const ordem = operacao === 'ranquear'
    ? 'ORDER BY coalesce(c.nexus_quantidade_faturada,0) DESC, d.__nexus_row_number'
    : 'ORDER BY d.__nexus_row_number';
  return `WITH corp AS (
      SELECT upper(trim(CAST(${citar(chave)} AS VARCHAR))) AS __key,
        any_value(${citar('id_produto')}) AS nexus_id_produto,
        any_value(${citar('descricao_produto')}) AS nexus_descricao_produto,
        any_value(${citar('sku')}) AS nexus_sku, any_value(${citar('ean')}) AS nexus_ean,
        any_value(${citar('marca')}) AS nexus_marca,
        sum(coalesce(${citar('quantidade_faturada')},0)) AS nexus_quantidade_faturada,
        sum(coalesce(${citar('faturamento_emitido')},0)) AS nexus_faturamento_emitido,
        sum(coalesce(${citar('margem_bruta_produtos')},0)) AS nexus_margem_bruta_produtos,
        count(DISTINCT ${citar('id_produto')}) > 1 AS nexus_associacao_ambigua,
        true AS nexus_encontrado
      FROM ${citar(view)} ${where} GROUP BY 1
    ) SELECT ${colunasDataset.map((x) => `d.${citar(x)}`).join(', ')}, c.* EXCLUDE (__key)
      FROM read_parquet('${escaparSql(dataset)}') d LEFT JOIN corp c ON c.__key=d.${citar('__nexus_key')}
      ${ordem}`;
}

async function consultarConjunto(argumentos, dependencias = {}) {
  const dominio = String(argumentos.dominio || '').toLowerCase();
  const operacao = String(argumentos.operacao || 'enriquecer').toLowerCase();
  if (!ADAPTADORES[dominio]) throw new Error(`Domínio de conjunto não suportado: ${dominio}.`);
  if (!['enriquecer', 'filtrar', 'ranquear', 'comparar'].includes(operacao)) throw new Error(`Operação inválida: ${operacao}.`);
  const datasets = dependencias.servicoDatasets;
  if (!datasets || !dependencias.conversationId || !dependencias.turnoIA?.id) {
    const erro = new Error('O serviço de conjuntos não está disponível neste turno.');
    erro.codigo = 'DATASET_SERVICE_UNAVAILABLE'; throw erro;
  }
  const aberto = await datasets.abrirCaminho(dependencias.conversationId, argumentos.dataset_ref);
  const chave = chaveCorporativa(aberto.descriptor.chaveSelecionada?.tipo);
  const colunasDataset = ['__nexus_row_number', '__nexus_key',
    ...(aberto.descriptor.colunas || []).map((x) => x.nome)].filter((x, i, lista) => lista.indexOf(x) === i);
  const adaptador = ADAPTADORES[dominio];
  if (!adaptador.chaves.includes(chave)) throw new Error(`A chave ${chave} não é aceita pelo domínio ${dominio}.`);
  if (!adaptador.operacoes.includes(operacao)) throw new Error(`A operação ${operacao} não é aceita pelo domínio ${dominio}.`);
  const leitor = adaptador.camada === 'gold'
    ? (dependencias.criarLeitorGold || criarLeitorGold)()
    : (dependencias.criarLeitorSilver || criarLeitorSilver)();
  const parametros = [];
  try {
    const consulta = await leitor.comObjeto(adaptador.objeto,
      async ({ contexto, consultarSql, conexao }) => {
      const base = { view: contexto.viewAtual, dataset: aberto.caminho, chave, colunasDataset,
        operacao, periodo: argumentos.periodo || null, parametros };
      const sql = dominio === 'catalogo' ? sqlCatalogo(base)
        : dominio === 'estoque' ? sqlEstoque(base) : sqlVendas(base);
      const linhas = await consultarComTimeout(consultarSql, conexao, sql, parametros);
      return { linhas, atualizacaoCorporativa: contexto.execucoes.at(-1)?.manifesto?.fim || null };
    });
    const maxLinhas = inteiroEnv('NEXUS_DATASET_MAX_ROWS', MAX_LINHAS_RESULTADO,
      MAX_LINHAS_RESULTADO);
    const normalizadas = consulta.linhas.slice(0, maxLinhas).map(normalizarLinha);
    const encontrados = normalizadas.filter((x) => x.nexus_encontrado === true).length;
    const assinatura = crypto.createHash('sha256').update(JSON.stringify({
      parent: argumentos.dataset_ref, dominio, operacao, periodo: argumentos.periodo || null
    })).digest('hex');
    const ref = await datasets.criarDeLinhas(dependencias.conversationId, dependencias.turnoIA.id,
      normalizadas, {
        parentDatasetId: argumentos.dataset_ref,
        chave: aberto.descriptor.chaveSelecionada,
        assinatura,
        queryManifest: { tipo: 'dataset_query', dominio, operacao,
          periodo: argumentos.periodo || null, parentDatasetId: argumentos.dataset_ref },
        lineage: { parentDatasetId: argumentos.dataset_ref, dominio, operacao },
        corporateUpdatedAt: consulta.atualizacaoCorporativa || new Date().toISOString(),
        classification: 'dados_nexus'
      });
    const previa = montarPrevia(normalizadas);
    return {
      status: 'sucesso', dominio, operacao, result_ref: ref,
      quantidade_linhas: normalizadas.length, encontrados,
      nao_encontrados: normalizadas.length - encontrados,
      previa,
      payload_previa_bytes: Buffer.byteLength(JSON.stringify(previa), 'utf8'),
      resultado_truncado_no_prompt: normalizadas.length > previa.length,
      regra: 'O conjunto completo permanece no result_ref; somente a prévia foi enviada ao modelo.'
    };
  } finally { await leitor.fechar(); }
}

module.exports = { ADAPTADORES, consultarConjunto, montarPrevia };
