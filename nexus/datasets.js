const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { criarConexaoDuckDB, fecharConexaoDuckDB, runDuckDB, allDuckDB } = require('../duckdb/connections');
const { detectarMelhorTabela } = require('./spreadsheet_table_detection');

const MAX_CHAVES = 50_000;
const MAX_LINHAS = 50_000;
const TTL_HORAS = 24;

function inteiroEnv(nome, padrao, maximo = 500_000) {
  const valor = Number(process.env[nome] || padrao);
  if (!Number.isInteger(valor) || valor < 1 || valor > maximo) throw new Error(`${nome} inválido.`);
  return valor;
}

class ErroDataset extends Error {
  constructor(codigo, mensagem, status = 400, detalhes = null) {
    super(mensagem); this.name = 'ErroDataset'; this.codigo = codigo; this.status = status;
    this.detalhes = detalhes;
  }
}

function resolverModoDatasets(valor = process.env.NEXUS_DATASETS_MODE || 'off') {
  const modo = String(valor).toLowerCase();
  if (!['off', 'shadow', 'v1'].includes(modo)) throw new Error(`NEXUS_DATASETS_MODE inválido: ${modo}.`);
  return modo;
}

function normalizarTexto(valor) {
  return String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function nomeColunaSeguro(valor, indice, usados) {
  const base = normalizarTexto(valor).replace(/\s+/g, '_').replace(/^\d+/, '') || `coluna_${indice}`;
  let nome = base; let sufixo = 2;
  while (usados.has(nome) || nome.startsWith('__nexus_')) nome = `${base}_${sufixo++}`;
  usados.add(nome); return nome;
}

function valorPrimitivo(valor) {
  if (valor == null) return null;
  if (typeof valor !== 'object') return valor;
  if (Object.hasOwn(valor, 'valorCalculado')) return valor.valorCalculado;
  if (Object.hasOwn(valor, 'valor')) return valor.valor;
  return String(valor);
}

function normalizarChave(valor) {
  if (valor == null) return null;
  const texto = String(valor).trim().replace(/\.0+$/, '');
  return texto ? texto.toLocaleUpperCase('pt-BR') : null;
}

function tipoCabecalho(rotulo) {
  const texto = normalizarTexto(rotulo);
  if (/\b(ean|gtin|codigo de barras|cod barra)\b/.test(texto)) return { tipo: 'ean', pontos: 12 };
  if (/\b(sku|codigo auxiliar|cod auxiliar)\b/.test(texto)) return { tipo: 'sku', pontos: 12 };
  if (/\b(id produto|produto id|codigo interno|cod interno)\b/.test(texto) || texto === 'id_produto') {
    return { tipo: 'id_produto', pontos: 12 };
  }
  return null;
}

function pontuarValores(tipo, valores) {
  const preenchidos = valores.map(normalizarChave).filter(Boolean).slice(0, 200);
  if (!preenchidos.length) return 0;
  const proporcao = (predicado) => preenchidos.filter(predicado).length / preenchidos.length;
  if (tipo === 'ean') return proporcao((x) => /^\d{8}$|^\d{12,14}$/.test(x)) * 5;
  if (tipo === 'id_produto') return proporcao((x) => /^\d{1,10}$/.test(x)) * 3;
  return proporcao((x) => x.length <= 80 && /[A-Z]/.test(x) && /\d/.test(x)) * 3;
}

function prepararTabelaXlsx(extraido, pergunta = '') {
  const tabelaDetectada = detectarMelhorTabela(extraido?.abas || []);
  if (!tabelaDetectada) throw new ErroDataset('DATASET_XLSX_VAZIO',
    'A planilha não possui uma tabela com cabeçalho e dados identificáveis.');
  const indices = tabelaDetectada.colunas.map((item) => item.indice);
  const usados = new Set();
  const colunas = tabelaDetectada.colunas.map(({ indice, rotulo }, posicao) => {
    return { indice, rotulo, nome: nomeColunaSeguro(rotulo, posicao + 1, usados) };
  });
  const dadosOriginais = tabelaDetectada.linhas;
  const preferencia = /\b(?:use|usar|pelo|pela)\s+(?:o\s+|a\s+)?ean\b|codigo de barras/i.test(pergunta) ? 'ean'
    : /\b(?:use|usar|pelo|pela)\s+(?:o\s+|a\s+)?sku\b|codigo auxiliar/i.test(pergunta) ? 'sku'
      : /\b(?:use|usar|pelo|pela)\s+(?:o\s+|a\s+)?(?:id|codigo interno)\b/i.test(pergunta) ? 'id_produto' : null;
  const candidatos = colunas.map((coluna) => {
    const cabecalhoTipo = tipoCabecalho(coluna.rotulo);
    if (!cabecalhoTipo) return null;
    const valores = dadosOriginais.map((linha) => valorPrimitivo(linha.valores?.[coluna.indice]));
    return { ...coluna, tipo: cabecalhoTipo.tipo,
      pontos: cabecalhoTipo.pontos + pontuarValores(cabecalhoTipo.tipo, valores) };
  }).filter(Boolean).sort((a, b) => b.pontos - a.pontos);
  const candidatosPreferidos = preferencia ? candidatos.filter((x) => x.tipo === preferencia) : candidatos;
  if (!candidatosPreferidos.length) {
    throw new ErroDataset('DATASET_CHAVE_NAO_IDENTIFICADA',
      'Não encontrei uma coluna identificável como SKU, EAN ou código interno do produto.');
  }
  if (!preferencia && candidatos.length > 1 && candidatos[1].pontos >= 12) {
    throw new ErroDataset('DATASET_CHAVE_AMBIGUA',
      `Encontrei mais de uma possível chave: ${candidatos.slice(0, 3).map((x) => `${x.rotulo} (${x.tipo})`).join(', ')}. Informe qual coluna devo usar.`,
      409, { candidatos: candidatos.slice(0, 3).map(({ rotulo, tipo }) => ({ rotulo, tipo })) });
  }
  const chave = candidatosPreferidos[0];
  const maxLinhas = inteiroEnv('NEXUS_DATASET_MAX_ROWS', MAX_LINHAS, MAX_LINHAS);
  if (dadosOriginais.length > maxLinhas) throw new ErroDataset('DATASET_LINHAS_LIMITE',
    `A tabela excede o limite de ${maxLinhas.toLocaleString('pt-BR')} linhas para cruzamento.`);
  const linhas = dadosOriginais.map((linha) => {
    const saida = { __nexus_row_number: Number(linha.numero) };
    for (const coluna of colunas) saida[coluna.nome] = valorPrimitivo(linha.valores?.[coluna.indice]);
    saida.__nexus_key = normalizarChave(linha.valores?.[chave.indice]);
    return saida;
  });
  const chaves = new Set(linhas.map((x) => x.__nexus_key).filter(Boolean));
  const maxChaves = inteiroEnv('NEXUS_DATASET_MAX_KEYS', MAX_CHAVES, MAX_CHAVES);
  if (chaves.size > maxChaves) throw new ErroDataset('DATASET_CHAVES_LIMITE',
    `A planilha excede o limite de ${maxChaves.toLocaleString('pt-BR')} chaves distintas.`);
  return { aba: tabelaDetectada.aba, linhas, colunas, quantidadeChaves: chaves.size,
    cabecalhoLinha: tabelaDetectada.headerRow, intervalo: tabelaDetectada.intervalo,
    deteccaoTabela: tabelaDetectada.metodo,
    chave: { tipo: chave.tipo, coluna: chave.nome, rotulo: chave.rotulo, datasetColumn: '__nexus_key' } };
}

function escaparSql(valor) { return String(valor).replace(/'/g, "''").replace(/\\/g, '/'); }

async function escreverParquet(storage, linhas) {
  if (!linhas.length) throw new ErroDataset('DATASET_SEM_LINHAS', 'O conjunto não possui linhas para armazenar.');
  const reserva = await storage.reservar();
  const temporarioJson = path.join(os.tmpdir(), `nexus-dataset-${crypto.randomUUID()}.ndjson`);
  const con = criarConexaoDuckDB();
  try {
    const arquivo = await fs.open(temporarioJson, 'wx', 0o600);
    try {
      for (let inicio = 0; inicio < linhas.length; inicio += 500) {
        const bloco = linhas.slice(inicio, inicio + 500).map((item) => `${JSON.stringify(item)}\n`).join('');
        await arquivo.write(bloco);
      }
    } finally { await arquivo.close(); }
    await runDuckDB(con, `COPY (SELECT * FROM read_json_auto('${escaparSql(temporarioJson)}', format='newline_delimited', union_by_name=true)) TO '${escaparSql(reserva.temporario)}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
    return await storage.confirmar(reserva);
  } catch (erro) {
    await storage.descartarReserva(reserva).catch(() => null); throw erro;
  } finally {
    await fecharConexaoDuckDB(con); await fs.unlink(temporarioJson).catch(() => null);
  }
}

function descriptor(linha) {
  if (!linha) return null;
  const expirado = linha.status === 'expired'
    || (linha.expires_at && new Date(linha.expires_at).getTime() <= Date.now());
  return {
    id: linha.id, tipo: linha.kind, status: expirado ? 'expired' : linha.status,
    colunas: linha.schema_columns || [], quantidadeLinhas: Number(linha.row_count || 0),
    chaveSelecionada: linha.key_mapping || null, classificacao: linha.classification,
    expiraEm: linha.expires_at, origem: linha.lineage || {},
    atualizacaoCorporativa: linha.corporate_updated_at || null
  };
}

function colunasDasLinhas(linhas) {
  const nomes = [];
  const vistos = new Set();
  for (const linha of linhas.slice(0, 100)) for (const nome of Object.keys(linha || {})) {
    if (!vistos.has(nome)) { vistos.add(nome); nomes.push(nome); }
  }
  return nomes;
}

function extrairTabelaResultado(resultadosTools = []) {
  for (const item of [...resultadosTools].reverse()) {
    const resultado = item?.resultado;
    if (!resultado || typeof resultado !== 'object') continue;
    for (const chave of ['dados', 'pedidos', 'resultados', 'itens']) {
      const linhas = resultado[chave];
      if (Array.isArray(linhas) && linhas.length && linhas.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
        return { ferramenta: item.nome, argumentos: item.argumentos || {}, nomeTabela: chave,
          linhas: linhas.slice(0, MAX_LINHAS) };
      }
    }
  }
  return null;
}

function detectarChaveResultado(linhas) {
  const colunas = colunasDasLinhas(linhas);
  for (const [tipo, nomes] of [['ean', ['ean', 'cod_barras', 'codigo_barras']],
    ['sku', ['sku', 'codigo_auxiliar']], ['id_produto', ['id_produto']]]) {
    const coluna = nomes.find((nome) => colunas.includes(nome));
    if (coluna) return { tipo, coluna, rotulo: coluna, datasetColumn: '__nexus_key' };
  }
  return null;
}

function criarServicoDatasets({ pool, storage, principalId, departmentId = null, modo } = {}) {
  if (!pool || !storage || !principalId) throw new Error('Pool, storage e principal são obrigatórios para datasets.');
  const modoEfetivo = resolverModoDatasets(modo);
  async function conversaAutorizada(conversationId) {
    const linha = (await pool.query(`SELECT id,department_id FROM nexus.conversations
      WHERE id=$1 AND principal_id=$2 AND arquivada_em IS NULL`, [conversationId, principalId])).rows[0];
    if (!linha) throw new ErroDataset('DATASET_CONVERSA_NEGADA', 'Conversa não encontrada.', 404);
    if (departmentId && linha.department_id && String(linha.department_id) !== String(departmentId)) {
      throw new ErroDataset('DATASET_SETOR_NEGADO', 'O conjunto não pertence ao setor ativo.', 403);
    }
    return linha;
  }
  async function buscarAssinatura(conversationId, assinatura) {
    return (await pool.query(`SELECT * FROM nexus.conversation_datasets
      WHERE conversation_id=$1 AND principal_id=$2 AND signature=$3 AND status='ready'
        AND expires_at>now() ORDER BY criado_em DESC LIMIT 1`,
    [conversationId, principalId, assinatura])).rows[0] || null;
  }
  async function expirarVencidos(conversationId) {
    const vencidos = (await pool.query(`WITH vencidos AS (
        SELECT id,storage_key FROM nexus.conversation_datasets
        WHERE conversation_id=$1 AND principal_id=$2 AND status='ready' AND expires_at<=now()
        FOR UPDATE
      ) UPDATE nexus.conversation_datasets d
      SET status='expired',storage_key=NULL,atualizado_em=now()
      FROM vencidos v WHERE d.id=v.id RETURNING v.id,v.storage_key`,
    [conversationId, principalId])).rows;
    for (const item of vencidos) {
      if (!item.storage_key) continue;
      try { await storage.excluir(item.storage_key); }
      catch (erro) {
        await pool.query(`INSERT INTO nexus.dataset_cleanup_jobs(dataset_id,storage_key,last_error_code)
          VALUES ($1,$2,$3)`, [item.id, item.storage_key,
          erro.code || erro.name || 'STORAGE_DELETE_ERROR']);
      }
    }
  }
  async function persistir(conversationId, turnId, entrada) {
    await conversaAutorizada(conversationId);
    await expirarVencidos(conversationId);
    const existente = await buscarAssinatura(conversationId, entrada.assinatura);
    if (existente) return { ...descriptor(existente), cacheHit: true };
    if (modoEfetivo !== 'v1') return { shadow: modoEfetivo === 'shadow', status: 'inativo' };
    const salvo = await escreverParquet(storage, entrada.linhas);
    try {
      const linha = (await pool.query(`INSERT INTO nexus.conversation_datasets
        (conversation_id,principal_id,department_id,turn_id,attachment_id,parent_dataset_id,
         kind,status,storage_key,signature,schema_columns,row_count,unique_key_count,key_mapping,
         query_manifest,lineage,classification,corporate_updated_at,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'ready',$8,$9,$10::jsonb,$11,$12,$13::jsonb,
          $14::jsonb,$15::jsonb,$16,$17,now()+make_interval(hours=>$18)) RETURNING *`,
      [conversationId, principalId, departmentId, turnId || null, entrada.attachmentId || null,
        entrada.parentDatasetId || null, entrada.kind, salvo.chave, entrada.assinatura,
        JSON.stringify(entrada.colunas), entrada.linhas.length, entrada.quantidadeChaves || null,
        JSON.stringify(entrada.chave || null), JSON.stringify(entrada.queryManifest || {}),
        JSON.stringify(entrada.lineage || {}), entrada.classification || 'conversa_privada',
        entrada.corporateUpdatedAt || null,
        inteiroEnv('NEXUS_DATASET_TTL_HOURS', TTL_HORAS, 168)])).rows[0];
      return { ...descriptor(linha), cacheHit: false };
    } catch (erro) {
      await storage.excluir(salvo.chave).catch(() => null);
      if (erro.code === '23505') {
        const concorrente = await buscarAssinatura(conversationId, entrada.assinatura);
        if (concorrente) return { ...descriptor(concorrente), cacheHit: true };
      }
      throw erro;
    }
  }
  async function criarDeAnexo(conversationId, turnId, anexo, pergunta) {
    if (!['xls', 'xlsx'].includes(anexo?.item?.format) || anexo?.extraido?.tipo !== 'xlsx') {
      throw new ErroDataset('DATASET_FORMATO_NAO_SUPORTADO', 'Nesta versão, somente XLS ou XLSX pode ser cruzado com dados corporativos.');
    }
    const tabela = prepararTabelaXlsx(anexo.extraido, pergunta);
    const assinatura = crypto.createHash('sha256').update(JSON.stringify({
      attachment: anexo.item.sha256 || anexo.item.id, aba: tabela.aba,
      chave: tabela.chave.tipo, coluna: tabela.chave.coluna
    })).digest('hex');
    return persistir(conversationId, turnId, {
      kind: 'dataset_ref', attachmentId: anexo.item.id, assinatura,
      linhas: tabela.linhas, colunas: tabela.colunas.map(({ nome, rotulo }) => ({ nome, rotulo })),
      quantidadeChaves: tabela.quantidadeChaves, chave: tabela.chave,
      lineage: { attachmentId: anexo.item.id, arquivo: anexo.item.file_name, aba: tabela.aba },
      queryManifest: { tipo: 'attachment', attachmentId: anexo.item.id, chave: tabela.chave },
      classification: anexo.item.classification || 'conversa_privada'
    });
  }
  async function criarDeLinhas(conversationId, turnId, linhasEntrada, opcoes = {}) {
    const linhas = linhasEntrada.slice(0, MAX_LINHAS).map((linha, indice) => ({
      __nexus_row_number: Number(linha.__nexus_row_number || indice + 1), ...linha
    }));
    let chave = opcoes.chave || detectarChaveResultado(linhas);
    if (chave) for (const linha of linhas) linha.__nexus_key = normalizarChave(linha[chave.coluna]);
    const chaves = new Set(linhas.map((x) => x.__nexus_key).filter(Boolean));
    const assinatura = opcoes.assinatura || crypto.createHash('sha256')
      .update(JSON.stringify({ parent: opcoes.parentDatasetId, manifest: opcoes.queryManifest, linhas }))
      .digest('hex');
    return persistir(conversationId, turnId, {
      kind: 'result_ref', assinatura, linhas,
      colunas: colunasDasLinhas(linhas).filter((x) => !x.startsWith('__nexus_')).map((nome) => ({ nome, rotulo: nome })),
      quantidadeChaves: chaves.size, chave, parentDatasetId: opcoes.parentDatasetId,
      queryManifest: opcoes.queryManifest || {}, lineage: opcoes.lineage || {},
      corporateUpdatedAt: opcoes.corporateUpdatedAt || null,
      classification: opcoes.classification || 'dados_nexus'
    });
  }
  async function criarDeResultadoCorporativo(conversationId, turnId, resultadosTools) {
    const tabela = extrairTabelaResultado(resultadosTools);
    if (!tabela || modoEfetivo !== 'v1') return null;
    return criarDeLinhas(conversationId, turnId, tabela.linhas, {
      queryManifest: { tipo: 'corporate_tool', ferramenta: tabela.ferramenta,
        argumentos: tabela.argumentos, tabela: tabela.nomeTabela },
      lineage: { ferramenta: tabela.ferramenta, tabela: tabela.nomeTabela },
      corporateUpdatedAt: resultadosTools.find((x) => x.nome === tabela.ferramenta)?.resultado?.atualizado_em || null
    });
  }
  async function obter(conversationId, datasetId, { aceitarExpirado = false } = {}) {
    await conversaAutorizada(conversationId);
    const linha = (await pool.query(`SELECT * FROM nexus.conversation_datasets
      WHERE id=$1 AND conversation_id=$2 AND principal_id=$3`,
    [datasetId, conversationId, principalId])).rows[0];
    if (!linha) throw new ErroDataset('DATASET_NAO_ENCONTRADO', 'Referência de dados não encontrada.', 404);
    const expirado = linha.status === 'expired' || new Date(linha.expires_at).getTime() <= Date.now();
    if (expirado && !aceitarExpirado) throw new ErroDataset('DATASET_EXPIRADO', 'A referência de dados expirou.', 410,
      { queryManifest: linha.query_manifest, lineage: linha.lineage });
    return { item: linha, descriptor: descriptor({ ...linha, status: expirado ? 'expired' : linha.status }) };
  }
  async function abrirCaminho(conversationId, datasetId) {
    const { item, descriptor: desc } = await obter(conversationId, datasetId);
    return { item, descriptor: desc, caminho: await storage.abrirCaminho(item.storage_key) };
  }
  async function listarRecentes(conversationId, limite = 5) {
    await conversaAutorizada(conversationId);
    const linhas = (await pool.query(`SELECT * FROM nexus.conversation_datasets
      WHERE conversation_id=$1 AND principal_id=$2 ORDER BY criado_em DESC LIMIT $3`,
    [conversationId, principalId, Math.min(20, Math.max(1, limite))])).rows;
    return linhas.map(descriptor);
  }
  async function lerLinhas(conversationId, datasetId, limite = MAX_LINHAS) {
    const { caminho, descriptor: desc } = await abrirCaminho(conversationId, datasetId);
    const con = criarConexaoDuckDB();
    try {
      const linhas = await allDuckDB(con, `SELECT * FROM read_parquet('${escaparSql(caminho)}') ORDER BY __nexus_row_number LIMIT ${Math.min(MAX_LINHAS, Math.max(1, Number(limite)))}`);
      return { descriptor: desc, linhas };
    } finally { await fecharConexaoDuckDB(con); }
  }
  async function chavesDaConversa(conversationId) {
    await conversaAutorizada(conversationId);
    return (await pool.query(`SELECT storage_key FROM nexus.conversation_datasets
      WHERE conversation_id=$1 AND principal_id=$2 AND storage_key IS NOT NULL`,
    [conversationId, principalId])).rows.map((x) => x.storage_key);
  }
  async function excluirChaves(chaves = []) {
    for (const chave of chaves) {
      try { await storage.excluir(chave); }
      catch (erro) { await pool.query(`INSERT INTO nexus.dataset_cleanup_jobs(storage_key,last_error_code)
        VALUES ($1,$2)`, [chave, erro.code || erro.name || 'STORAGE_DELETE_ERROR']); }
    }
  }
  return { abrirCaminho, chavesDaConversa, criarDeAnexo, criarDeLinhas,
    criarDeResultadoCorporativo, excluirChaves, lerLinhas, listarRecentes, modo: modoEfetivo, obter };
}

async function processarFilaLimpezaDatasets({ pool, storage, limite = 20 }) {
  const expirados = (await pool.query(`SELECT id,storage_key FROM nexus.conversation_datasets
    WHERE status='ready' AND expires_at<=now() ORDER BY expires_at LIMIT $1`,
  [Math.min(100, Math.max(1, Number(limite)))])).rows;
  for (const item of expirados) {
    try {
      await storage.excluir(item.storage_key);
      await pool.query(`UPDATE nexus.conversation_datasets SET status='expired',storage_key=NULL,
        atualizado_em=now() WHERE id=$1`, [item.id]);
    } catch (erro) {
      await pool.query(`INSERT INTO nexus.dataset_cleanup_jobs(dataset_id,storage_key,last_error_code)
        VALUES ($1,$2,$3)`, [item.id, item.storage_key, erro.code || erro.name || 'STORAGE_DELETE_ERROR']);
      await pool.query(`UPDATE nexus.conversation_datasets SET status='expired',
        atualizado_em=now() WHERE id=$1`, [item.id]);
    }
  }
  const jobs = (await pool.query(`SELECT id,dataset_id,storage_key,attempts FROM nexus.dataset_cleanup_jobs
    WHERE concluida_em IS NULL AND proxima_tentativa_em<=now() ORDER BY criado_em LIMIT $1`,
  [Math.min(100, Math.max(1, Number(limite)))])).rows;
  for (const job of jobs) {
    try {
      await storage.excluir(job.storage_key);
      await pool.query('UPDATE nexus.dataset_cleanup_jobs SET concluida_em=now() WHERE id=$1', [job.id]);
      if (job.dataset_id) await pool.query(`UPDATE nexus.conversation_datasets SET status='expired',
        storage_key=NULL,atualizado_em=now() WHERE id=$1`, [job.dataset_id]);
    } catch (erro) {
      const tentativas = Number(job.attempts || 0) + 1;
      await pool.query(`UPDATE nexus.dataset_cleanup_jobs SET attempts=$2,last_error_code=$3,
        proxima_tentativa_em=now()+make_interval(secs=>LEAST(3600,POWER(2,$2)::int*30)) WHERE id=$1`,
      [job.id, tentativas, erro.code || erro.name || 'STORAGE_DELETE_ERROR']);
    }
  }
  return { expirados: expirados.length, jobs: jobs.length };
}

module.exports = { ErroDataset, MAX_CHAVES, MAX_LINHAS, criarServicoDatasets,
  descriptor, detectarChaveResultado, escreverParquet, extrairTabelaResultado, normalizarChave,
  prepararTabelaXlsx, processarFilaLimpezaDatasets, resolverModoDatasets };
