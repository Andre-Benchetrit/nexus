const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const { embeddingHash, serializarVetor } = require('./embeddings');
const { validarAttachmentEvidence, validarAttachmentIr } = require('./attachment_evidence_schema');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const IR_VERSION = 'attachment-ir-v3';
const ANALYZER_VERSION = 'attachment-analysis-v3';
const INTENTS = new Set(['local_file', 'mixed_corporate', 'documentation', 'web', 'artifact']);
const DEPTHS = new Set(['baixo', 'medio', 'alto', 'extra_alto']);
const FORMATS = new Set(['png', 'jpeg', 'webp', 'pdf', 'docx', 'xls', 'xlsx']);
const LOCATOR_TYPES = new Set(['page', 'section', 'table', 'sheet', 'range', 'cell', 'image', 'block', 'defined_name']);
const LOCATOR_TYPES_COM_EMBEDDING = new Set(['page', 'section', 'table', 'sheet', 'image', 'block', 'defined_name']);
const SENSITIVE_METADATA_KEYS = /(?:text|texto|content|conteudo|paragraph|paragrafo|cell|celula|row|linha|formula|prompt|question|pergunta|answer|resposta|excerpt|trecho|ocr)/i;
const INDEX_BATCH_SIZE = 500;
const LOCATOR_STRING_LIMITS = Object.freeze({
  type: 24, section: 256, sheet: 128, range: 64, cell: 32, definedName: 128
});
const LOCATOR_NUMBER_FIELDS = new Set(['page', 'table', 'ordinal', 'row', 'image', 'block']);

class ErroInteligenciaAnexo extends Error {
  constructor(codigo, mensagem, status = 400) {
    super(mensagem);
    this.name = 'ErroInteligenciaAnexo';
    this.codigo = codigo;
    this.status = status;
  }
}

function hashSha256(valor) {
  return crypto.createHash('sha256').update(valor).digest('hex');
}

function normalizarPergunta(pergunta) {
  return String(pergunta || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
}

function valorJsonCanonico(valor, visitados = new Set()) {
  if (valor === null || typeof valor === 'string' || typeof valor === 'boolean') return valor;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new ErroInteligenciaAnexo('JSON_INVALIDO', 'O conteúdo contém número não finito.');
    return valor;
  }
  if (typeof valor === 'bigint') return valor.toString();
  if (valor instanceof Date) return valor.toISOString();
  if (Buffer.isBuffer(valor) || ArrayBuffer.isView(valor)) {
    throw new ErroInteligenciaAnexo('JSON_INVALIDO', 'Binários devem permanecer fora da representação JSON.');
  }
  if (typeof valor !== 'object') {
    throw new ErroInteligenciaAnexo('JSON_INVALIDO', 'A representação contém um valor não serializável.');
  }
  if (visitados.has(valor)) throw new ErroInteligenciaAnexo('JSON_CICLICO', 'A representação contém referência cíclica.');
  visitados.add(valor);
  let saida;
  if (Array.isArray(valor)) {
    saida = valor.map((item) => valorJsonCanonico(item, visitados));
  } else {
    saida = {};
    for (const chave of Object.keys(valor).sort()) {
      if (valor[chave] !== undefined) saida[chave] = valorJsonCanonico(valor[chave], visitados);
    }
  }
  visitados.delete(valor);
  return saida;
}

function serializarJsonCanonico(valor) {
  return JSON.stringify(valorJsonCanonico(valor));
}

function inteiroPositivo(valor, padrao) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? Math.floor(numero) : padrao;
}

async function compactarJson(valor, opcoes = {}) {
  const bruto = Buffer.from(serializarJsonCanonico(valor), 'utf8');
  const maximo = inteiroPositivo(opcoes.maxBytes, 128 * 1024 * 1024);
  if (bruto.length > maximo) {
    throw new ErroInteligenciaAnexo('REPRESENTACAO_MUITO_GRANDE', 'A representação excede o limite local permitido.', 413);
  }
  const buffer = await gzip(bruto, { level: zlib.constants.Z_BEST_COMPRESSION });
  return { buffer, sha256: hashSha256(buffer), originalBytes: bruto.length, bytes: buffer.length, encoding: 'gzip-json' };
}

async function descompactarJson(buffer, opcoes = {}) {
  if (!Buffer.isBuffer(buffer)) throw new ErroInteligenciaAnexo('DERIVADO_INVALIDO', 'O derivado não é binário.');
  const maximo = inteiroPositivo(opcoes.maxBytes, 128 * 1024 * 1024);
  let bruto;
  try { bruto = await gunzip(buffer, { maxOutputLength: maximo }); }
  catch (erro) {
    if (erro.code === 'ERR_BUFFER_TOO_LARGE' || /larg|length|size/i.test(erro.message || '')) {
      throw new ErroInteligenciaAnexo('DERIVADO_EXPANSAO_EXCESSIVA', 'O derivado excede o limite de expansão.', 413);
    }
    throw new ErroInteligenciaAnexo('DERIVADO_INVALIDO', 'O derivado persistido não pôde ser lido.', 500);
  }
  try { return JSON.parse(bruto.toString('utf8')); }
  catch (_) { throw new ErroInteligenciaAnexo('DERIVADO_INVALIDO', 'O derivado persistido contém JSON inválido.', 500); }
}

function sanitizarMetadadosSeguros(valor, profundidade = 0) {
  if (profundidade > 4 || valor == null) return valor == null ? null : undefined;
  if (typeof valor === 'boolean') return valor;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : undefined;
  if (typeof valor === 'string') return valor.slice(0, 256);
  if (Array.isArray(valor)) return valor.slice(0, 32)
    .map((item) => sanitizarMetadadosSeguros(item, profundidade + 1)).filter((item) => item !== undefined);
  if (typeof valor !== 'object' || Buffer.isBuffer(valor)) return undefined;
  const saida = {};
  for (const [chave, item] of Object.entries(valor).slice(0, 64)) {
    if (SENSITIVE_METADATA_KEYS.test(chave)) continue;
    const seguro = sanitizarMetadadosSeguros(item, profundidade + 1);
    if (seguro !== undefined) saida[String(chave).slice(0, 80)] = seguro;
  }
  return saida;
}

function hashesAssetsOrdenados(assetHashes) {
  const hashes = [...new Set((assetHashes || []).map((item) => String(item || '').toLowerCase()))].sort();
  if (!hashes.length || hashes.some((item) => !/^[0-9a-f]{64}$/.test(item))) {
    throw new ErroInteligenciaAnexo('ASSET_HASH_INVALIDO', 'Os hashes dos anexos são inválidos.');
  }
  return hashes;
}

function calcularAssinaturaAnalise(entrada) {
  const principalId = String(entrada?.principalId || '');
  if (!principalId) throw new ErroInteligenciaAnexo('PRINCIPAL_OBRIGATORIO', 'O principal é obrigatório.');
  const intent = String(entrada.intent || 'local_file');
  const depth = String(entrada.depth || entrada.profundidade || 'medio');
  if (!INTENTS.has(intent)) throw new ErroInteligenciaAnexo('INTENCAO_INVALIDA', 'A intenção de análise é inválida.');
  if (!DEPTHS.has(depth)) throw new ErroInteligenciaAnexo('PROFUNDIDADE_INVALIDA', 'A profundidade de análise é inválida.');
  const perguntaNormalizada = normalizarPergunta(entrada.pergunta);
  if (!perguntaNormalizada) throw new ErroInteligenciaAnexo('PERGUNTA_OBRIGATORIA', 'A pergunta é obrigatória.');
  const assetHashes = hashesAssetsOrdenados(entrada.assetHashes);
  const questionHash = hashSha256(perguntaNormalizada);
  const assetSetHash = hashSha256(assetHashes.join(':'));
  const analyzerVersion = String(entrada.analyzerVersion || ANALYZER_VERSION);
  const payload = serializarJsonCanonico({
    principalId,
    departmentId: entrada.departmentId ? String(entrada.departmentId) : null,
    assetHashes,
    questionHash,
    intent,
    depth,
    analyzeVisual: Boolean(entrada.analyzeVisual ?? entrada.analisarVisual),
    analyzerVersion
  });
  return { signature: hashSha256(payload), questionHash, assetSetHash, assetHashes,
    intent, depth, analyzeVisual: Boolean(entrada.analyzeVisual ?? entrada.analisarVisual), analyzerVersion };
}

function termosNormalizados(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .match(/[a-z0-9]{2,}/g) || [];
}

function hashTermosBusca(texto, principalId) {
  const chave = Buffer.from(hashSha256(`attachment-index:${String(principalId || '')}`), 'hex');
  return [...new Set(termosNormalizados(texto))].slice(0, 512).sort()
    .map((termo) => crypto.createHmac('sha256', chave).update(termo).digest('hex'));
}

function embeddingIndiceLocal(texto, locatorType, embedding = null) {
  if (embedding != null) return embedding;
  const conteudo = String(texto || '').trim();
  if (!conteudo || !LOCATOR_TYPES_COM_EMBEDDING.has(locatorType)) return null;
  // O embedding hash e local, deterministico e nao permite que o conteudo
  // indexado acione rede, provider ou tools. O corte limita custo em blocos longos.
  return embeddingHash(conteudo.slice(0, 12_000));
}

function tipoLocalizadorSuportado(valor) {
  return LOCATOR_TYPES.has(String(valor || ''));
}

function normalizarLocator(locator) {
  if (!locator || Array.isArray(locator) || typeof locator !== 'object') {
    throw new ErroInteligenciaAnexo('LOCALIZADOR_INVALIDO', 'O localizador de evidência é inválido.');
  }
  const seguro = {};
  for (const [chave, valor] of Object.entries(locator)) {
    if (Object.hasOwn(LOCATOR_STRING_LIMITS, chave)) {
      if (typeof valor !== 'string') {
        throw new ErroInteligenciaAnexo('LOCALIZADOR_INVALIDO', `O campo ${chave} do localizador é inválido.`);
      }
      const texto = valor.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
        .slice(0, LOCATOR_STRING_LIMITS[chave]);
      if (!texto) throw new ErroInteligenciaAnexo('LOCALIZADOR_INVALIDO', `O campo ${chave} do localizador está vazio.`);
      seguro[chave] = texto;
      continue;
    }
    if (LOCATOR_NUMBER_FIELDS.has(chave)) {
      const numero = Number(valor);
      if (!Number.isSafeInteger(numero) || numero < 0) {
        throw new ErroInteligenciaAnexo('LOCALIZADOR_INVALIDO', `O campo ${chave} do localizador é inválido.`);
      }
      seguro[chave] = numero;
      continue;
    }
    throw new ErroInteligenciaAnexo('LOCALIZADOR_INVALIDO', `O campo ${chave} não é permitido no localizador.`);
  }
  if (!seguro.type) throw new ErroInteligenciaAnexo('LOCALIZADOR_INVALIDO', 'O tipo do localizador é obrigatório.');
  return seguro;
}

function formatoExtensao(formato) {
  const valor = String(formato || '').toLowerCase();
  if (!FORMATS.has(valor)) throw new ErroInteligenciaAnexo('FORMATO_INVALIDO', 'O formato do asset é inválido.');
  return valor === 'jpeg' ? 'jpg' : valor;
}

function classificacaoMaisRestrita(classificacoes = []) {
  const niveis = new Map([
    ['publico', 0], ['conhecimento_geral', 0], ['interna', 1],
    ['conversa_privada', 2], ['dados_nexus', 3],
    ['dados_corporativos', 3], ['confidencial', 4], ['restrito', 5], ['sensivel', 6]
  ]);
  return classificacoes.filter(Boolean).map(String).sort((a, b) =>
    (niveis.get(b) ?? 3) - (niveis.get(a) ?? 3))[0] || 'conversa_privada';
}

async function emTransacao(pool, operacao) {
  if (typeof pool.connect !== 'function') return operacao(pool);
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await operacao(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (erro) {
    await cliente.query('ROLLBACK').catch(() => null);
    throw erro;
  } finally { cliente.release(); }
}

function criarServicoInteligenciaAnexos({ pool, storage, principalId, departmentId = null }) {
  if (!pool || !storage || !principalId) throw new Error('Pool, storage e principal são obrigatórios.');
  const salvarFisico = storage.salvar || storage.salvarSanitizado;
  if (typeof salvarFisico !== 'function' || typeof storage.abrir !== 'function') {
    throw new Error('Storage de inteligência de anexos inválido.');
  }

  async function obterAnexos(conversationId, attachmentIds) {
    const ids = [...new Set((attachmentIds || []).map(String))];
    if (!ids.length) throw new ErroInteligenciaAnexo('ANEXOS_OBRIGATORIOS', 'Informe ao menos um anexo.');
    const linhas = (await pool.query(`
      SELECT a.*,c.department_id AS conversation_department_id,
        aa.id AS resolved_asset_id,aa.sha256 AS asset_sha256,aa.status AS asset_status,
        aa.source_storage_key,aa.ir_storage_key,aa.ir_sha256,aa.ir_version,aa.parquet_storage_key,
        aa.classification AS asset_classification
      FROM nexus.conversation_attachments a
      JOIN nexus.conversations c ON c.id=a.conversation_id
      LEFT JOIN nexus.attachment_assets aa ON aa.id=a.asset_id AND aa.principal_id=a.principal_id
      WHERE a.conversation_id=$1 AND a.principal_id=$2 AND a.id=ANY($3::uuid[])
        AND a.status='ready' AND c.principal_id=$2 AND c.arquivada_em IS NULL
    `, [conversationId, principalId, ids])).rows;
    if (linhas.length !== ids.length) {
      throw new ErroInteligenciaAnexo('ANEXO_NAO_ENCONTRADO', 'Um ou mais anexos não pertencem a esta conversa.', 404);
    }
    const porId = new Map(linhas.map((item) => [String(item.id), item]));
    const ordenadas = ids.map((id) => porId.get(id));
    for (const item of ordenadas) {
      const setor = item.department_id || item.conversation_department_id || null;
      if (departmentId && setor && String(setor) !== String(departmentId)) {
        throw new ErroInteligenciaAnexo('SETOR_DIVERGENTE', 'O anexo pertence a outro setor.', 403);
      }
    }
    return ordenadas;
  }

  async function buscarAssetPorHash(sha256, irVersion = IR_VERSION) {
    const hash = String(sha256 || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) return null;
    const asset = (await pool.query(`SELECT * FROM nexus.attachment_assets
      WHERE principal_id=$1 AND sha256=$2 AND status='ready' AND ir_version=$3`,
    [principalId, hash, irVersion])).rows[0];
    if (!asset?.ir_storage_key) return null;
    const buffer = await storage.abrir(asset.ir_storage_key);
    if (hashSha256(buffer) !== String(asset.ir_sha256 || '')) {
      throw new ErroInteligenciaAnexo('IR_INTEGRIDADE_INVALIDA', 'A integridade da representação não confere.', 500);
    }
    const ir = await descompactarJson(buffer, { maxBytes: process.env.NEXUS_ATTACHMENT_IR_MAX_BYTES });
    return { asset, ir: validarAttachmentIr(ir) };
  }

  async function validarMensagem(conversationId, messageId) {
    const mensagem = (await pool.query(`
      SELECT m.id,m.turn_id FROM nexus.conversation_messages m
      JOIN nexus.conversations c ON c.id=m.conversation_id
      WHERE m.id=$1 AND m.conversation_id=$2 AND m.papel='user'
        AND c.principal_id=$3 AND c.arquivada_em IS NULL
    `, [messageId, conversationId, principalId])).rows[0];
    if (!mensagem) throw new ErroInteligenciaAnexo('MENSAGEM_NAO_ENCONTRADA', 'A mensagem de origem não foi encontrada.', 404);
    return mensagem;
  }

  async function enfileirarLimpeza(chave, erro) {
    if (!chave) return;
    await pool.query(`INSERT INTO nexus.attachment_cleanup_jobs(storage_key,last_error_code)
      VALUES ($1,$2)`, [chave, erro?.code || erro?.name || 'ATTACHMENT_INTELLIGENCE_CLEANUP']).catch(() => null);
  }

  async function excluirFisico(chave) {
    if (!chave || typeof storage.excluir !== 'function') return;
    try { await storage.excluir(chave); }
    catch (erro) { await enfileirarLimpeza(chave, erro); }
  }

  async function registrarAsset({ conversationId, attachmentId, sourceBuffer, safeMetadata = {} }) {
    const [anexo] = await obterAnexos(conversationId, [attachmentId]);
    const hash = String(anexo.sha256 || '').toLowerCase();
    let asset = (await pool.query(`SELECT * FROM nexus.attachment_assets
      WHERE principal_id=$1 AND sha256=$2 AND status<>'deleting'`, [principalId, hash])).rows[0];
    if (asset) {
      await pool.query(`UPDATE nexus.conversation_attachments
        SET asset_id=$2,department_id=COALESCE(department_id,$3),atualizado_em=now()
        WHERE id=$1 AND principal_id=$4`, [anexo.id, asset.id,
        anexo.department_id || anexo.conversation_department_id || departmentId || null, principalId]);
      return { asset, cacheHit: true };
    }
    if (!Buffer.isBuffer(sourceBuffer)) {
      throw new ErroInteligenciaAnexo('FONTE_OBRIGATORIA', 'O binário validado é obrigatório para criar o asset.');
    }
    if (hashSha256(sourceBuffer) !== hash) {
      throw new ErroInteligenciaAnexo('HASH_DIVERGENTE', 'O binário não corresponde ao anexo autorizado.');
    }
    const extensao = formatoExtensao(anexo.format || String(anexo.media_type || '').split('/').pop());
    const salvo = await salvarFisico.call(storage, { buffer: sourceBuffer, extensao });
    try {
      asset = (await pool.query(`
        INSERT INTO nexus.attachment_assets
          (principal_id,sha256,media_type,format,bytes,source_storage_key,classification,
           safe_metadata,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'processing')
        ON CONFLICT (principal_id,sha256) DO NOTHING
        RETURNING *
      `, [principalId, hash, anexo.media_type, anexo.format, anexo.bytes, salvo.chave,
        anexo.classification || 'conversa_privada', JSON.stringify(sanitizarMetadadosSeguros(safeMetadata) || {})])).rows[0];
      if (!asset) {
        await excluirFisico(salvo.chave);
        asset = (await pool.query(`SELECT * FROM nexus.attachment_assets
          WHERE principal_id=$1 AND sha256=$2 AND status<>'deleting'`, [principalId, hash])).rows[0];
      }
      if (!asset) throw new ErroInteligenciaAnexo('ASSET_CONCORRENCIA', 'O asset não pôde ser consolidado.', 409);
      await pool.query(`UPDATE nexus.conversation_attachments
        SET asset_id=$2,department_id=COALESCE(department_id,$3),atualizado_em=now()
        WHERE id=$1 AND principal_id=$4`, [anexo.id, asset.id,
        anexo.department_id || anexo.conversation_department_id || departmentId || null, principalId]);
      return { asset, cacheHit: asset.source_storage_key !== salvo.chave };
    } catch (erro) {
      if (!asset || asset.source_storage_key !== salvo.chave) await excluirFisico(salvo.chave);
      throw erro;
    }
  }

  async function salvarRepresentacao({ conversationId, attachmentId, ir,
    irVersion = IR_VERSION, indexEntries = [], safeMetadata = {} }) {
    const [anexo] = await obterAnexos(conversationId, [attachmentId]);
    if (!anexo.resolved_asset_id) {
      throw new ErroInteligenciaAnexo('ASSET_NAO_REGISTRADO', 'Registre o asset antes da representação canônica.', 409);
    }
    if (anexo.asset_status === 'ready' && anexo.ir_version === irVersion && anexo.ir_storage_key) {
      return { assetId: anexo.resolved_asset_id, irVersion, cacheHit: true };
    }
    validarAttachmentIr(ir);
    const pacote = await compactarJson(ir, {
      maxBytes: process.env.NEXUS_ATTACHMENT_IR_MAX_BYTES || 128 * 1024 * 1024
    });
    const salvo = await salvarFisico.call(storage, { buffer: pacote.buffer, extensao: 'json' });
    let antigo = null;
    try {
      const atualizado = (await pool.query(`
        UPDATE nexus.attachment_assets
        SET ir_storage_key=$2,ir_sha256=$3,ir_version=$4,status='ready',error_code=NULL,
          safe_metadata=safe_metadata || $5::jsonb,atualizado_em=now()
        WHERE id=$1 AND principal_id=$6
        RETURNING *, (SELECT ir_storage_key FROM nexus.attachment_assets WHERE id=$1) AS current_ir_storage_key
      `, [anexo.resolved_asset_id, salvo.chave, pacote.sha256, irVersion,
        JSON.stringify({ ...(sanitizarMetadadosSeguros(safeMetadata) || {}), encoding: pacote.encoding,
          ir_original_bytes: pacote.originalBytes, ir_compressed_bytes: pacote.bytes }), principalId])).rows[0];
      if (!atualizado) throw new ErroInteligenciaAnexo('ASSET_NAO_ENCONTRADO', 'O asset não está mais disponível.', 404);
      antigo = anexo.ir_storage_key && anexo.ir_storage_key !== salvo.chave ? anexo.ir_storage_key : null;
      await registrarIndices(anexo.resolved_asset_id, irVersion, indexEntries);
      if (antigo) await excluirFisico(antigo);
      return { assetId: atualizado.id, irVersion, sha256: pacote.sha256,
        originalBytes: pacote.originalBytes, bytes: pacote.bytes, cacheHit: false };
    } catch (erro) {
      await excluirFisico(salvo.chave);
      throw erro;
    }
  }

  async function registrarIndices(assetId, irVersion, entries = []) {
    const normalizadas = entries.slice(0, 100000).map((entrada, ordinal) => {
      const locatorType = String(entrada.locatorType || entrada.tipo || 'block');
      if (!tipoLocalizadorSuportado(locatorType)) throw new ErroInteligenciaAnexo('LOCALIZADOR_INVALIDO', 'Tipo de localizador inválido.');
      const locator = normalizarLocator(entrada.locator || {});
      const vetor = embeddingIndiceLocal(entrada.text || entrada.texto || '', locatorType,
        entrada.embedding);
      const embedding = vetor == null ? null : serializarVetor(vetor);
      return { ordinal: Number.isInteger(entrada.ordinal) && entrada.ordinal >= 0 ? entrada.ordinal : ordinal,
        locatorType, locator, locatorHash: hashSha256(serializarJsonCanonico(locator)),
        termHashes: hashTermosBusca(entrada.text || entrada.texto || '', principalId), embedding,
        safeMetadata: sanitizarMetadadosSeguros(entrada.safeMetadata || entrada.metadados || {}) || {} };
    });
    await emTransacao(pool, async (cliente) => {
      const permitido = (await cliente.query(`SELECT id FROM nexus.attachment_assets
        WHERE id=$1 AND principal_id=$2 AND status<>'deleting'`, [assetId, principalId])).rows[0];
      if (!permitido) throw new ErroInteligenciaAnexo('ASSET_NAO_ENCONTRADO', 'O asset não foi encontrado.', 404);
      await cliente.query('DELETE FROM nexus.attachment_asset_index WHERE asset_id=$1 AND ir_version=$2', [assetId, irVersion]);
      // Uma planilha pode gerar milhares de localizadores. Inserir cada linha
      // separadamente transforma a indexação em milhares de viagens ao PostgreSQL
      // (especialmente caro quando o banco está no Railway). O JSON recordset mantém
      // os mesmos tipos e validações, mas reduz o caminho a poucos lotes.
      for (let inicio = 0; inicio < normalizadas.length; inicio += INDEX_BATCH_SIZE) {
        const lote = normalizadas.slice(inicio, inicio + INDEX_BATCH_SIZE).map((entrada) => ({
          ordinal: entrada.ordinal,
          locator_type: entrada.locatorType,
          locator: entrada.locator,
          locator_hash: entrada.locatorHash,
          term_hashes: entrada.termHashes,
          embedding: entrada.embedding,
          safe_metadata: entrada.safeMetadata
        }));
        await cliente.query(`INSERT INTO nexus.attachment_asset_index
          (asset_id,ir_version,ordinal,locator_type,locator,locator_hash,term_hashes,embedding,safe_metadata)
          SELECT $1,$2,item.ordinal,item.locator_type,item.locator,item.locator_hash,
            item.term_hashes,CASE WHEN item.embedding IS NULL THEN NULL ELSE item.embedding::vector END,
            item.safe_metadata
          FROM jsonb_to_recordset($3::jsonb) AS item(
            ordinal integer,locator_type text,locator jsonb,locator_hash text,
            term_hashes text[],embedding text,safe_metadata jsonb
          )
          ON CONFLICT (asset_id,ir_version,locator_hash) DO NOTHING`,
        [assetId, irVersion, JSON.stringify(lote)]);
      }
    });
    return { indexed: normalizadas.length };
  }

  async function registrarParquet({ conversationId, attachmentId, storageKey }) {
    const [anexo] = await obterAnexos(conversationId, [attachmentId]);
    if (!anexo.resolved_asset_id || !/^[a-f0-9-]{36}\.parquet$/i.test(String(storageKey || ''))) {
      throw new ErroInteligenciaAnexo('PARQUET_INVALIDO', 'O derivado Parquet do anexo é inválido.');
    }
    const anterior = anexo.parquet_storage_key || null;
    const atualizado = (await pool.query(`UPDATE nexus.attachment_assets
      SET parquet_storage_key=$2,atualizado_em=now() WHERE id=$1 AND principal_id=$3 RETURNING id`,
    [anexo.resolved_asset_id, storageKey, principalId])).rows[0];
    if (!atualizado) throw new ErroInteligenciaAnexo('ASSET_NAO_ENCONTRADO', 'O asset não foi encontrado.', 404);
    if (anterior && anterior !== storageKey) await excluirFisico(anterior);
    return { assetId: atualizado.id, storageKey };
  }

  async function carregarRepresentacao(conversationId, attachmentId) {
    const [anexo] = await obterAnexos(conversationId, [attachmentId]);
    if (!anexo.resolved_asset_id || anexo.asset_status !== 'ready' || !anexo.ir_storage_key) {
      throw new ErroInteligenciaAnexo('IR_NAO_DISPONIVEL', 'A representação do anexo ainda não está pronta.', 409);
    }
    const buffer = await storage.abrir(anexo.ir_storage_key);
    if (hashSha256(buffer) !== String(anexo.ir_sha256 || '')) {
      throw new ErroInteligenciaAnexo('IR_INTEGRIDADE_INVALIDA', 'A integridade da representação não confere.', 500);
    }
    const ir = await descompactarJson(buffer, { maxBytes: process.env.NEXUS_ATTACHMENT_IR_MAX_BYTES });
    return { assetId: anexo.resolved_asset_id, irVersion: anexo.ir_version,
      ir: validarAttachmentIr(ir) };
  }

  async function abrirFonte(conversationId, attachmentId) {
    const [anexo] = await obterAnexos(conversationId, [attachmentId]);
    if (!anexo.resolved_asset_id || anexo.asset_status !== 'ready' || !anexo.source_storage_key) {
      throw new ErroInteligenciaAnexo('FONTE_NAO_DISPONIVEL', 'A fonte validada do anexo ainda não está disponível.', 409);
    }
    const buffer = await storage.abrir(anexo.source_storage_key);
    if (hashSha256(buffer) !== String(anexo.asset_sha256 || '')) {
      throw new ErroInteligenciaAnexo('FONTE_INTEGRIDADE_INVALIDA', 'A integridade da fonte do anexo não confere.', 500);
    }
    return buffer;
  }

  async function contextoAssinatura({ conversationId, messageId, attachmentIds, pergunta,
    intent = 'local_file', profundidade = 'medio', analisarVisual = false,
    analyzerVersion = ANALYZER_VERSION }) {
    const [mensagem, anexos] = await Promise.all([
      validarMensagem(conversationId, messageId), obterAnexos(conversationId, attachmentIds)
    ]);
    if (anexos.some((item) => !item.resolved_asset_id || item.asset_status !== 'ready')) {
      throw new ErroInteligenciaAnexo('ASSET_NAO_PRONTO', 'Um ou mais anexos ainda não possuem representação pronta.', 409);
    }
    const setor = departmentId || anexos[0].department_id || anexos[0].conversation_department_id || null;
    const assinatura = calcularAssinaturaAnalise({ principalId, departmentId: setor,
      assetHashes: anexos.map((item) => item.asset_sha256), pergunta, intent,
      profundidade, analisarVisual, analyzerVersion });
    return { mensagem, anexos, departmentId: setor, ...assinatura };
  }

  async function vincularAnalise(cliente, cache, contexto, opcoes = {}) {
    for (const anexo of contexto.anexos) {
      await cliente.query(`INSERT INTO nexus.conversation_attachment_analyses
        (analysis_cache_id,conversation_id,principal_id,department_id,message_id,turn_id,
         branch_message_id,attachment_id,active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
        ON CONFLICT (analysis_cache_id,conversation_id,message_id,attachment_id,turn_id)
        DO UPDATE SET active=true,branch_message_id=EXCLUDED.branch_message_id`,
      [cache.id, opcoes.conversationId, principalId, contexto.departmentId, opcoes.messageId,
        opcoes.turnId || contexto.mensagem.turn_id || null, opcoes.branchMessageId || null, anexo.id]);
    }
  }

  async function obterAnaliseEmCache(opcoes) {
    const contexto = await contextoAssinatura(opcoes);
    const cache = (await pool.query(`SELECT * FROM nexus.attachment_analysis_cache
      WHERE principal_id=$1 AND signature=$2 AND status='ready'
        AND (expires_at IS NULL OR expires_at>now())`, [principalId, contexto.signature])).rows[0];
    if (!cache) return { cacheHit: false, analysisRef: null, contexto };
    await emTransacao(pool, (cliente) => vincularAnalise(cliente, cache, contexto, opcoes));
    const buffer = await storage.abrir(cache.result_storage_key);
    if (hashSha256(buffer) !== String(cache.result_sha256 || '')) {
      throw new ErroInteligenciaAnexo('ANALISE_INTEGRIDADE_INVALIDA', 'A integridade da análise em cache não confere.', 500);
    }
    const resultado = await descompactarJson(buffer, { maxBytes: process.env.NEXUS_ATTACHMENT_ANALYSIS_MAX_BYTES });
    return { cacheHit: true, analysisRef: cache.id,
      resultado: validarAttachmentEvidence(resultado), contexto };
  }

  async function salvarAnalise(opcoes) {
    validarAttachmentEvidence(opcoes.resultado);
    const existente = await obterAnaliseEmCache(opcoes);
    if (existente.cacheHit) return existente;
    const contexto = existente.contexto;
    const pacote = await compactarJson(opcoes.resultado, {
      maxBytes: process.env.NEXUS_ATTACHMENT_ANALYSIS_MAX_BYTES || 32 * 1024 * 1024
    });
    const salvo = await salvarFisico.call(storage, { buffer: pacote.buffer, extensao: 'json' });
    let cache;
    try {
      cache = (await pool.query(`INSERT INTO nexus.attachment_analysis_cache
        (principal_id,department_id,signature,question_hash,asset_hashes,asset_set_hash,
         intent,depth,analyze_visual,analyzer_version,result_storage_key,result_sha256,
         result_bytes,classification,safe_metadata,status,expires_at)
        VALUES ($1,$2,$3,$4,$5::char(64)[],$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,'ready',$16)
        ON CONFLICT (principal_id,signature) DO NOTHING RETURNING *`,
      [principalId, contexto.departmentId, contexto.signature, contexto.questionHash,
        contexto.assetHashes, contexto.assetSetHash, contexto.intent, contexto.depth,
        contexto.analyzeVisual, contexto.analyzerVersion, salvo.chave, pacote.sha256, pacote.bytes,
        classificacaoMaisRestrita(contexto.anexos.map((item) => item.asset_classification || item.classification)),
        JSON.stringify({ ...(sanitizarMetadadosSeguros(opcoes.safeMetadata) || {}), encoding: pacote.encoding,
          result_original_bytes: pacote.originalBytes }), opcoes.expiresAt || null])).rows[0];
      if (!cache) {
        await excluirFisico(salvo.chave);
        cache = (await pool.query(`SELECT * FROM nexus.attachment_analysis_cache
          WHERE principal_id=$1 AND signature=$2 AND status='ready'`, [principalId, contexto.signature])).rows[0];
      }
      if (!cache) throw new ErroInteligenciaAnexo('CACHE_CONCORRENCIA', 'A análise concorrente não pôde ser consolidada.', 409);
      await emTransacao(pool, (cliente) => vincularAnalise(cliente, cache, contexto, opcoes));
      if (cache.result_storage_key !== salvo.chave) {
        const buffer = await storage.abrir(cache.result_storage_key);
        const resultado = await descompactarJson(buffer, { maxBytes: process.env.NEXUS_ATTACHMENT_ANALYSIS_MAX_BYTES });
        return { cacheHit: true, analysisRef: cache.id,
          resultado: validarAttachmentEvidence(resultado), contexto };
      }
      return { cacheHit: false, analysisRef: cache.id, resultado: opcoes.resultado, contexto };
    } catch (erro) {
      if (!cache || cache.result_storage_key !== salvo.chave) await excluirFisico(salvo.chave);
      throw erro;
    }
  }

  async function carregarAnalise({ conversationId, analysisRef, messageId = null }) {
    const valores = [analysisRef, conversationId, principalId];
    let filtroMensagem = '';
    if (messageId) { valores.push(messageId); filtroMensagem = ' AND caa.message_id=$4'; }
    const cache = (await pool.query(`SELECT DISTINCT ac.*
      FROM nexus.attachment_analysis_cache ac
      JOIN nexus.conversation_attachment_analyses caa ON caa.analysis_cache_id=ac.id
      JOIN nexus.conversations c ON c.id=caa.conversation_id
      WHERE ac.id=$1 AND caa.conversation_id=$2 AND caa.principal_id=$3
        AND c.principal_id=$3 AND caa.active=true AND ac.status='ready'${filtroMensagem}`,
    valores)).rows[0];
    if (!cache) throw new ErroInteligenciaAnexo('ANALISE_NAO_ENCONTRADA', 'A análise não pertence a esta conversa.', 404);
    const buffer = await storage.abrir(cache.result_storage_key);
    if (hashSha256(buffer) !== String(cache.result_sha256 || '')) {
      throw new ErroInteligenciaAnexo('ANALISE_INTEGRIDADE_INVALIDA', 'A integridade da análise não confere.', 500);
    }
    const resultado = await descompactarJson(buffer, { maxBytes: process.env.NEXUS_ATTACHMENT_ANALYSIS_MAX_BYTES });
    return { analysisRef: cache.id,
      resultado: validarAttachmentEvidence(resultado),
      metadados: { intent: cache.intent, depth: cache.depth, analyzeVisual: cache.analyze_visual,
        analyzerVersion: cache.analyzer_version, classification: cache.classification } };
  }

  async function atualizarAnalise({ conversationId, analysisRef, resultado }) {
    await carregarAnalise({ conversationId, analysisRef });
    validarAttachmentEvidence(resultado);
    const chaveAnterior = (await pool.query(`SELECT result_storage_key FROM nexus.attachment_analysis_cache
      WHERE id=$1 AND principal_id=$2`, [analysisRef, principalId])).rows[0]?.result_storage_key || null;
    const pacote = await compactarJson(resultado, {
      maxBytes: process.env.NEXUS_ATTACHMENT_ANALYSIS_MAX_BYTES || 32 * 1024 * 1024
    });
    const salvo = await salvarFisico.call(storage, { buffer: pacote.buffer, extensao: 'json' });
    let antigo = null;
    try {
      const linha = (await pool.query(`UPDATE nexus.attachment_analysis_cache ac
        SET result_storage_key=$2,result_sha256=$3,result_bytes=$4,
          safe_metadata=safe_metadata || $5::jsonb,atualizado_em=now()
        WHERE ac.id=$1 AND ac.principal_id=$6 AND ac.status='ready'
          AND EXISTS (SELECT 1 FROM nexus.conversation_attachment_analyses caa
            WHERE caa.analysis_cache_id=ac.id AND caa.conversation_id=$7
              AND caa.principal_id=$6 AND caa.active=true)
        RETURNING ac.id`,
      [analysisRef, salvo.chave, pacote.sha256, pacote.bytes,
        JSON.stringify({ encoding: pacote.encoding, result_original_bytes: pacote.originalBytes }),
        principalId, conversationId])).rows[0];
      if (!linha) throw new ErroInteligenciaAnexo('ANALISE_NAO_ENCONTRADA', 'A análise não pertence a esta conversa.', 404);
      antigo = chaveAnterior && chaveAnterior !== salvo.chave ? chaveAnterior : null;
      if (antigo) await excluirFisico(antigo);
      return { analysisRef: linha.id, resultado };
    } catch (erro) {
      await excluirFisico(salvo.chave);
      throw erro;
    }
  }

  async function carregarRepresentacoesDaAnalise({ conversationId, analysisRef }) {
    await carregarAnalise({ conversationId, analysisRef });
    const anexos = (await pool.query(`SELECT DISTINCT caa.attachment_id
      FROM nexus.conversation_attachment_analyses caa
      JOIN nexus.conversations c ON c.id=caa.conversation_id
      WHERE caa.analysis_cache_id=$1 AND caa.conversation_id=$2 AND caa.principal_id=$3
        AND c.principal_id=$3 AND caa.active=true
      ORDER BY caa.attachment_id`, [analysisRef, conversationId, principalId])).rows;
    const saida = [];
    for (const item of anexos) {
      const representacao = await carregarRepresentacao(conversationId, item.attachment_id);
      const [anexo] = await obterAnexos(conversationId, [item.attachment_id]);
      saida.push({ item: anexo, extraido: representacao.ir?.content || representacao.ir,
        irVersion: representacao.irVersion, assetId: representacao.assetId });
    }
    return saida;
  }

  async function carregarAnaliseRecente({ conversationId }) {
    const item = (await pool.query(`SELECT ac.id
      FROM nexus.conversation_attachment_analyses caa
      JOIN nexus.attachment_analysis_cache ac ON ac.id=caa.analysis_cache_id
      JOIN nexus.conversations c ON c.id=caa.conversation_id
      WHERE caa.conversation_id=$1 AND caa.principal_id=$2 AND c.principal_id=$2
        AND caa.active=true AND ac.status='ready'
      ORDER BY caa.criado_em DESC LIMIT 1`, [conversationId, principalId])).rows[0];
    if (!item) return null;
    return carregarAnalise({ conversationId, analysisRef: item.id });
  }

  async function obterStatusAnexo(conversationId, attachmentId) {
    await validarConversa(conversationId);
    const item = (await pool.query(`SELECT a.id,a.status,a.error_code,a.kind,a.file_name,a.format,
        a.page_count,a.sheet_count,a.cell_count,a.bytes,a.criado_em,a.atualizado_em,
        aa.status AS analysis_status,aa.error_code AS analysis_error_code,aa.ir_version,
        (aa.status='ready') AS cache_ready
      FROM nexus.conversation_attachments a
      LEFT JOIN nexus.attachment_assets aa ON aa.id=a.asset_id AND aa.principal_id=a.principal_id
      WHERE a.id=$1 AND a.conversation_id=$2 AND a.principal_id=$3`,
    [attachmentId, conversationId, principalId])).rows[0];
    if (!item) throw new ErroInteligenciaAnexo('ANEXO_NAO_ENCONTRADO', 'Anexo não encontrado.', 404);
    return item;
  }

  async function validarConversa(conversationId) {
    const conversa = (await pool.query(`SELECT id FROM nexus.conversations
      WHERE id=$1 AND principal_id=$2 AND arquivada_em IS NULL`, [conversationId, principalId])).rows[0];
    if (!conversa) throw new ErroInteligenciaAnexo('CONVERSA_NAO_ENCONTRADA', 'Conversa não encontrada.', 404);
    return conversa;
  }

  async function limparOrfaos(limite = 50) {
    const maximo = Math.min(200, Math.max(1, Number(limite) || 50));
    const analyses = (await pool.query(`SELECT ac.id,ac.result_storage_key
      FROM nexus.attachment_analysis_cache ac
      WHERE ac.principal_id=$1 AND NOT EXISTS (
        SELECT 1 FROM nexus.conversation_attachment_analyses caa WHERE caa.analysis_cache_id=ac.id
      ) ORDER BY ac.criado_em LIMIT $2`, [principalId, maximo])).rows;
    for (const item of analyses) {
      await excluirFisico(item.result_storage_key);
      await pool.query('DELETE FROM nexus.attachment_analysis_cache WHERE id=$1 AND principal_id=$2', [item.id, principalId]);
    }
    const assets = (await pool.query(`SELECT aa.id,aa.source_storage_key,aa.ir_storage_key,aa.parquet_storage_key
      FROM nexus.attachment_assets aa WHERE aa.principal_id=$1 AND NOT EXISTS (
        SELECT 1 FROM nexus.conversation_attachments ca WHERE ca.asset_id=aa.id
      ) ORDER BY aa.criado_em LIMIT $2`, [principalId, maximo])).rows;
    for (const item of assets) {
      await excluirFisico(item.source_storage_key);
      await excluirFisico(item.ir_storage_key);
      await excluirFisico(item.parquet_storage_key);
      await pool.query('DELETE FROM nexus.attachment_assets WHERE id=$1 AND principal_id=$2', [item.id, principalId]);
    }
    return { analyses: analyses.length, assets: assets.length };
  }

  return Object.freeze({ abrirFonte, buscarAssetPorHash, registrarAsset, salvarRepresentacao, registrarIndices,
    registrarParquet,
    carregarRepresentacao, obterAnaliseEmCache, salvarAnalise, carregarAnalise, atualizarAnalise,
    carregarAnaliseRecente, carregarRepresentacoesDaAnalise, obterStatusAnexo, limparOrfaos });
}

module.exports = {
  ANALYZER_VERSION,
  ErroInteligenciaAnexo,
  IR_VERSION,
  calcularAssinaturaAnalise,
  classificacaoMaisRestrita,
  compactarJson,
  criarServicoInteligenciaAnexos,
  descompactarJson,
  embeddingIndiceLocal,
  hashTermosBusca,
  normalizarPergunta,
  sanitizarMetadadosSeguros,
  serializarJsonCanonico,
  tipoLocalizadorSuportado
};
