const crypto = require('node:crypto');
const { processarImagemLocal, sanitizarImagem } = require('../agentes/image_processing');
const {
  detectarFormato, extrairImagensDocxBuffers, nomeSeguro, processarArquivo,
  renderizarPaginasSelecionadas, validarPacoteOffice, validarPdfAtivo
} = require('./file_processing');
const {
  compactarJson, descompactarJson
} = require('./attachment_intelligence_store');
const {
  construirEntradasIndice, criarAttachmentIr, detectarRiscosConteudo,
  resolverModoInteligenciaAnexos
} = require('./attachment_analysis');
const { escreverParquet } = require('./datasets');

class ErroAnexo extends Error {
  constructor(codigo, mensagem, status = 400) {
    super(mensagem); this.name = 'ErroAnexo'; this.codigo = codigo; this.status = status;
  }
}

function criarServicoAnexos({ pool, storage, principalId, departmentId = null,
  inteligencia = null, intelligenceMode, onStatus = null }) {
  if (!pool || !storage || !principalId) throw new Error('Pool, storage e principal são obrigatórios.');
  const salvarFisico = storage.salvar || storage.salvarSanitizado;
  const modoInteligencia = resolverModoInteligenciaAnexos(intelligenceMode);
  const usaArmazenamentoCanonico = modoInteligencia === 'v1' && Boolean(inteligencia);

  function status(etapa, dados = {}) {
    try { onStatus?.({ etapa, ...dados }); } catch (_) { /* progresso nao altera o processamento */ }
  }

  async function conversaAutorizada(conversationId) {
    const conversa = (await pool.query(`
      SELECT id FROM nexus.conversations WHERE id=$1 AND principal_id=$2 AND arquivada_em IS NULL
    `, [conversationId, principalId])).rows[0];
    if (!conversa) throw new ErroAnexo('CONVERSA_NAO_ENCONTRADA', 'Conversa não encontrada.', 404);
    return conversa;
  }

  async function salvar(conversationId, entrada) {
    await conversaAutorizada(conversationId);
    const buffer = Buffer.isBuffer(entrada) ? entrada : entrada?.buffer;
    const fileName = Buffer.isBuffer(entrada) ? null : entrada?.fileName;
    const mediaType = Buffer.isBuffer(entrada) ? null : entrada?.mediaType;
    const pareceImagem = String(mediaType || '').startsWith('image/') ||
      /\.(?:png|jpe?g|webp)$/i.test(String(fileName || ''));
    if (!pareceImagem) return salvarDocumento(conversationId, { buffer, fileName, mediaType });
    status('validando_arquivo');
    const sanitizada = await sanitizarImagem(buffer);
    const cache = modoInteligencia !== 'off' && inteligencia
      ? await inteligencia.buscarAssetPorHash(sanitizada.sha256) : null;
    status(cache ? 'recuperando_analise' : 'extraindo_conteudo', { cacheHit: Boolean(cache) });
    const local = cache ? null : await processarImagemLocal(sanitizada.buffer, { sanitizada });
    const extraido = cache?.ir?.content || {
      tipo: 'image', format: sanitizada.extensao === 'jpg' ? 'jpeg' : sanitizada.extensao,
      width: sanitizada.metadados.largura, height: sanitizada.metadados.altura,
      texto: local?.texto || '', confiancaOcr: local?.confiancaOcr ?? null,
      ocrFalhou: local?.ocrFalhou === true, codigos: local?.codigos || []
    };
    const classificacao = cache?.asset?.classification ||
      (local?.sensibilidade?.sensivel ? 'sensivel' : detectarRiscosConteudo(extraido, {
        fileName, safeMetadata: sanitizada.metadados
      }).classification);
    let arquivo = null;
    const pacoteDerivado = await compactarJson(extraido);
    let derivado = null;
    let item = null;
    try {
      if (!usaArmazenamentoCanonico) {
        arquivo = await storage.salvarSanitizado({ buffer: sanitizada.buffer, extensao: sanitizada.extensao });
        derivado = await salvarFisico({ buffer: pacoteDerivado.buffer, extensao: 'json' });
      }
      item = (await pool.query(`
        INSERT INTO nexus.conversation_attachments
          (conversation_id,principal_id,department_id,asset_id,media_type,storage_key,
           derived_storage_key,sha256,bytes,width,height,safe_metadata,classification,
           status,kind,file_name,format)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,'ready','image',$14,$15)
        RETURNING id,asset_id,media_type,bytes,width,height,status,kind,file_name,format,
          classification,department_id,criado_em
      `, [conversationId, principalId, departmentId, cache?.asset?.id || null,
        sanitizada.mime, arquivo?.chave || null, derivado?.chave || null, sanitizada.sha256,
        sanitizada.buffer.length, sanitizada.metadados.largura, sanitizada.metadados.altura,
        JSON.stringify({ ...sanitizada.metadados, ocr_disponivel: !extraido.ocrFalhou }),
        classificacao, nomeSeguro(fileName || `imagem.${sanitizada.extensao}`, sanitizada.extensao),
        sanitizada.extensao === 'jpg' ? 'jpeg' : sanitizada.extensao])).rows[0];
      status('indexando_anexo', { attachmentId: item.id, cacheHit: Boolean(cache) });
      const consolidado = await consolidarInteligencia(conversationId, item, sanitizada.buffer,
        extraido, cache, { ...sanitizada.metadados, kind: 'image' });
      return { ...item, asset_id: consolidado.assetId || item.asset_id,
        cache_hit: consolidado.cacheHit,
        analysis_status: consolidado.status || 'ready' };
    } catch (erro) {
      if (item?.id) await pool.query('DELETE FROM nexus.conversation_attachments WHERE id=$1 AND principal_id=$2',
        [item.id, principalId]).catch(() => null);
      await inteligencia?.limparOrfaos?.(10).catch(() => null);
      await Promise.allSettled([arquivo?.chave, derivado?.chave].filter(Boolean)
        .map((chave) => storage.excluir(chave)));
      throw erro;
    }
  }

  async function salvarDocumento(conversationId, { buffer, fileName, mediaType }) {
    status('validando_arquivo');
    const tipo = detectarFormato({ buffer, fileName, mediaType });
    if (tipo.formato === 'pdf') validarPdfAtivo(buffer);
    else if (tipo.formato !== 'xls') await validarPacoteOffice(buffer, tipo.formato);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const cache = modoInteligencia !== 'off' && inteligencia
      ? await inteligencia.buscarAssetPorHash(hash) : null;
    status(cache ? 'recuperando_analise' : 'extraindo_conteudo', { cacheHit: Boolean(cache) });
    const processado = cache ? {
      buffer, fileName: tipo.fileName, formato: tipo.formato, mediaType: tipo.mediaType,
      sha256: hash, extraido: cache.ir?.content || cache.ir,
      metadados: cache.asset.safe_metadata || {}
    } : await processarArquivo({ buffer, fileName, mediaType });
    if (!cache) await completarVisuaisCanonicos(processado);
    const risco = detectarRiscosConteudo(processado.extraido, {
      fileName: processado.fileName, safeMetadata: processado.metadados
    });
    const classificacao = cache?.asset?.classification || risco.classification;
    let arquivo = null;
    let derivado = null;
    let item = null;
    try {
      if (!usaArmazenamentoCanonico) {
        arquivo = await salvarFisico({ buffer: processado.buffer, extensao: processado.formato });
        const pacoteDerivado = await compactarJson(processado.extraido);
        derivado = await salvarFisico({ buffer: pacoteDerivado.buffer, extensao: 'json' });
      }
      item = (await pool.query(`
        INSERT INTO nexus.conversation_attachments
          (conversation_id,principal_id,department_id,asset_id,media_type,storage_key,
           derived_storage_key,sha256,bytes,safe_metadata,classification,status,kind,
           file_name,format,page_count,sheet_count,cell_count)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,'ready','document',$12,$13,$14,$15,$16)
        RETURNING id,asset_id,media_type,bytes,width,height,status,kind,file_name,format,page_count,
          sheet_count,cell_count,classification,department_id,criado_em
      `, [conversationId, principalId, departmentId, cache?.asset?.id || null,
        processado.mediaType, arquivo?.chave || null, derivado?.chave || null, processado.sha256,
        processado.buffer.length, JSON.stringify(processado.metadados), classificacao,
        processado.fileName, processado.formato, processado.metadados.paginas,
        processado.metadados.abas, processado.metadados.celulas])).rows[0];
      status('indexando_anexo', { attachmentId: item.id, cacheHit: Boolean(cache) });
      const consolidado = await consolidarInteligencia(conversationId, item, processado.buffer,
        processado.extraido, cache, processado.metadados);
      return { ...item, asset_id: consolidado.assetId || item.asset_id,
        cache_hit: consolidado.cacheHit,
        analysis_status: consolidado.status || 'ready' };
    } catch (erro) {
      if (item?.id) await pool.query('DELETE FROM nexus.conversation_attachments WHERE id=$1 AND principal_id=$2',
        [item.id, principalId]).catch(() => null);
      await inteligencia?.limparOrfaos?.(10).catch(() => null);
      await Promise.allSettled([arquivo?.chave, derivado?.chave].filter(Boolean)
        .map((chave) => storage.excluir(chave)));
      throw erro;
    }
  }

  async function completarVisuaisCanonicos(processado) {
    if (processado.formato === 'pdf' && processado.extraido.paginasOcrPendente?.length) {
      status('extraindo_imagens');
      const numeros = processado.extraido.paginasOcrPendente;
      const renderizadas = [];
      for (let inicio = 0; inicio < numeros.length; inicio += 8) {
        renderizadas.push(...await renderizarPaginasSelecionadas(processado.buffer,
          numeros.slice(inicio, inicio + 8)));
      }
      let ocrIncompleto = false;
      for (const imagem of renderizadas) {
        const local = await processarImagemLocal(imagem.buffer);
        const pagina = processado.extraido.paginas.find((item) => item.numero === imagem.numero);
        if (!pagina) continue;
        pagina.textoOriginal = pagina.texto || '';
        pagina.textoOcr = local.texto || '';
        pagina.texto = [pagina.textoOriginal, pagina.textoOcr].filter(Boolean).join('\n');
        pagina.ocrConfianca = local.confiancaOcr;
        pagina.ocrFalhou = local.ocrFalhou === true;
        pagina.codigos = local.codigos || [];
        if (local.ocrFalhou) ocrIncompleto = true;
      }
      processado.extraido.ocrIncomplete = ocrIncompleto;
      processado.extraido.paginasOcrPendente = processado.extraido.paginas
        .filter((pagina) => pagina.ocrFalhou).map((pagina) => pagina.numero);
    }
    if (processado.formato === 'docx' && Number(processado.extraido.imageCount || 0) > 0) {
      status('extraindo_imagens');
      const imagens = await extrairImagensDocxBuffers(processado.buffer,
        Number(process.env.NEXUS_DOCX_MAX_IMAGES || 50));
      const metadadosImagens = new Map((processado.extraido.imagens || [])
        .map((imagem) => [Number(imagem.indice), imagem]));
      processado.extraido.imagens = [];
      for (const [indice, imagem] of imagens.entries()) {
        const local = await processarImagemLocal(imagem.buffer);
        const metadados = metadadosImagens.get(indice + 1);
        processado.extraido.imagens.push({ indice: indice + 1,
          section: metadados?.section || processado.extraido.secoes?.[0]?.titulo || 'Conteúdo principal',
          mediaType: imagem.mediaType, textoOcr: local.texto || '', codigos: local.codigos || [],
          ocrConfianca: local.confiancaOcr, ocrFalhou: local.ocrFalhou === true,
          sensivel: local.sensibilidade?.sensivel === true });
      }
      processado.extraido.ocrIncomplete = processado.extraido.imagens.some((item) => item.ocrFalhou);
    }
  }

  async function consolidarInteligencia(conversationId, item, sourceBuffer, extraido, cache, safeMetadata) {
    if (modoInteligencia === 'off' || !inteligencia) return { cacheHit: false, status: 'legacy' };
    try {
      if (cache?.asset?.id) return { cacheHit: true, status: 'ready', assetId: cache.asset.id };
      const registro = await inteligencia.registrarAsset({ conversationId,
        attachmentId: item.id, sourceBuffer, safeMetadata });
      const ir = criarAttachmentIr({ item: { ...item, sha256: crypto.createHash('sha256')
        .update(sourceBuffer).digest('hex') }, extraido });
      await inteligencia.salvarRepresentacao({ conversationId, attachmentId: item.id, ir,
        indexEntries: construirEntradasIndice(extraido), safeMetadata });
      if (extraido.tipo === 'xlsx' && storage.reservar && inteligencia.registrarParquet) {
        const linhasParquet = linhasCanonicasXlsx(extraido);
        if (linhasParquet.length) {
          const parquet = await escreverParquet(storage, linhasParquet);
          try {
            await inteligencia.registrarParquet({ conversationId, attachmentId: item.id,
              storageKey: parquet.chave });
          } catch (erro) {
            await storage.excluir(parquet.chave).catch(() => null);
            throw erro;
          }
        }
      }
      return { cacheHit: registro.cacheHit === true, status: 'ready', assetId: registro.asset.id };
    } catch (erro) {
      if (modoInteligencia === 'v1') throw erro;
      return { cacheHit: false, status: 'error', errorCode: erro.codigo || erro.code || erro.name };
    }
  }

  function linhasCanonicasXlsx(extraido) {
    const linhas = [];
    for (const aba of extraido.abas || []) for (const linha of aba.linhas || []) {
      for (const [coluna, bruto] of Object.entries(linha.valores || {})) {
        const formula = bruto && typeof bruto === 'object' && bruto.tipo === 'formula'
          ? String(bruto.formula || '') : null;
        const valor = bruto && typeof bruto === 'object'
          ? bruto.valorCalculado ?? bruto.valor ?? null : bruto;
        linhas.push({ sheet: String(aba.nome || ''), row_number: Number(linha.numero),
          column_number: Number(coluna), cell: `${coluna}:${linha.numero}`,
          value_type: formula ? 'formula' : valor == null ? 'null' : typeof valor,
          value_text: valor == null ? null : valor instanceof Date ? valor.toISOString() : String(valor),
          value_number: typeof valor === 'number' && Number.isFinite(valor) ? valor : null,
          formula, cached_value: formula && valor != null ? String(valor) : null });
      }
    }
    return linhas;
  }

  async function obter(conversationId, attachmentId) {
    await conversaAutorizada(conversationId);
    const item = (await pool.query(`
      SELECT * FROM nexus.conversation_attachments
      WHERE id=$1 AND conversation_id=$2 AND principal_id=$3 AND status='ready'
    `, [attachmentId, conversationId, principalId])).rows[0];
    if (!item) throw new ErroAnexo('ANEXO_NAO_ENCONTRADO', 'Anexo não encontrado.', 404);
    return item;
  }

  async function abrir(conversationId, attachmentId) {
    const item = await obter(conversationId, attachmentId);
    const [buffer, derivadoBuffer] = await Promise.all([
      item.storage_key ? storage.abrir(item.storage_key)
        : inteligencia?.abrirFonte?.(conversationId, attachmentId),
      item.derived_storage_key ? storage.abrir(item.derived_storage_key) : Promise.resolve(null)
    ]);
    if (!Buffer.isBuffer(buffer)) {
      throw new ErroAnexo('FONTE_NAO_DISPONIVEL', 'A fonte validada do anexo está indisponível.', 500);
    }
    let extraido = null;
    if (derivadoBuffer) {
      try {
        extraido = derivadoBuffer[0] === 0x1f && derivadoBuffer[1] === 0x8b
          ? await descompactarJson(derivadoBuffer, { maxBytes: process.env.NEXUS_ATTACHMENT_IR_MAX_BYTES })
          : JSON.parse(derivadoBuffer.toString('utf8'));
      } catch (_) { throw new ErroAnexo('DERIVADO_INVALIDO', 'O conteúdo extraído do arquivo está indisponível.', 500); }
    } else if (inteligencia && item.asset_id) {
      const representacao = await inteligencia.carregarRepresentacao(conversationId, attachmentId);
      extraido = representacao.ir?.content || representacao.ir;
    }
    return { item, buffer, extraido };
  }

  async function obterStatus(conversationId, attachmentId) {
    await conversaAutorizada(conversationId);
    if (inteligencia?.obterStatusAnexo) {
      const item = await inteligencia.obterStatusAnexo(conversationId, attachmentId);
      return {
        id: item.id, status: item.status, analysisStatus: item.analysis_status || item.status,
        errorCode: item.analysis_error_code || item.error_code || null,
        kind: item.kind, name: item.file_name, format: item.format, bytes: Number(item.bytes || 0),
        pages: item.page_count, sheets: item.sheet_count, cells: item.cell_count,
        cacheHit: item.cache_ready === true, irVersion: item.ir_version || null,
        createdAt: item.criado_em, updatedAt: item.atualizado_em
      };
    }
    const item = (await pool.query(`SELECT id,status,error_code,kind,file_name,format,bytes,
        page_count,sheet_count,cell_count,criado_em,atualizado_em
      FROM nexus.conversation_attachments
      WHERE id=$1 AND conversation_id=$2 AND principal_id=$3`,
    [attachmentId, conversationId, principalId])).rows[0];
    if (!item) throw new ErroAnexo('ANEXO_NAO_ENCONTRADO', 'Anexo não encontrado.', 404);
    return { id: item.id, status: item.status, analysisStatus: item.status,
      errorCode: item.error_code || null, kind: item.kind, name: item.file_name,
      format: item.format, bytes: Number(item.bytes || 0), pages: item.page_count,
      sheets: item.sheet_count, cells: item.cell_count, cacheHit: false,
      createdAt: item.criado_em, updatedAt: item.atualizado_em };
  }

  async function resolverParaTurno(conversationId, ids = []) {
    const unicos = [...new Set((ids || []).map(String))];
    const maximo = Number(process.env.NEXUS_FILES_MAX_FILES || process.env.NEXUS_IMAGE_MAX_FILES || 4);
    if (unicos.length > maximo) throw new ErroAnexo('ANEXOS_LIMITE', `Envie no máximo ${maximo} arquivos por turno.`);
    const itens = [];
    for (const id of unicos) itens.push(await abrir(conversationId, id));
    return itens;
  }

  async function vincularTurno(ids, turnId) {
    if (!ids?.length || !turnId) return;
    await pool.query(`UPDATE nexus.conversation_attachments SET turn_id=$2,atualizado_em=now()
      WHERE id=ANY($1::uuid[]) AND principal_id=$3`, [ids, turnId, principalId]);
  }

  async function excluir(conversationId, attachmentId) {
    const item = await obter(conversationId, attachmentId);
    try {
      await Promise.all([item.storage_key, item.derived_storage_key].filter(Boolean)
        .map((chave) => storage.excluir(chave)));
      await pool.query('DELETE FROM nexus.conversation_attachments WHERE id=$1', [item.id]);
      await inteligencia?.limparOrfaos?.(20);
      return { deleted: true };
    } catch (erro) {
      await pool.query(`UPDATE nexus.conversation_attachments SET status='deleting',error_code=$2,atualizado_em=now() WHERE id=$1`,
        [item.id, erro.code || erro.name || 'STORAGE_DELETE_ERROR']);
      for (const chave of [item.storage_key, item.derived_storage_key].filter(Boolean)) {
        await pool.query(`INSERT INTO nexus.attachment_cleanup_jobs(storage_key,last_error_code)
          VALUES ($1,$2)`, [chave, erro.code || erro.name || 'STORAGE_DELETE_ERROR']);
      }
      throw new ErroAnexo('ANEXO_EXCLUSAO_PENDENTE', 'O anexo foi marcado para exclusão.', 503);
    }
  }

  async function chavesDaConversa(conversationId) {
    await conversaAutorizada(conversationId);
    return (await pool.query(`SELECT storage_key,derived_storage_key FROM nexus.conversation_attachments
      WHERE conversation_id=$1 AND principal_id=$2`, [conversationId, principalId])).rows
      .flatMap((x) => [x.storage_key, x.derived_storage_key]).filter(Boolean);
  }

  async function excluirChaves(chaves = []) {
    for (const chave of chaves) {
      try { await storage.excluir(chave); }
      catch (erro) {
        await pool.query(`INSERT INTO nexus.attachment_cleanup_jobs(storage_key,last_error_code)
          VALUES ($1,$2)`, [chave, erro.code || erro.name || 'STORAGE_DELETE_ERROR']);
      }
    }
  }

  async function finalizarExclusaoConversa(conversationId, chaves = []) {
    await excluirChaves(chaves);
    await pool.query(`DELETE FROM nexus.conversation_attachments
      WHERE conversation_id=$1 AND principal_id=$2`, [conversationId, principalId]);
    await inteligencia?.limparOrfaos?.(100);
  }

  return { abrir, chavesDaConversa, excluir, excluirChaves, finalizarExclusaoConversa,
    obter, obterStatus, resolverParaTurno, salvar, vincularTurno };
}

async function processarFilaLimpeza({ pool, storage, limite = 20 }) {
  const jobs = (await pool.query(`SELECT id,storage_key,attempts FROM nexus.attachment_cleanup_jobs
    WHERE concluida_em IS NULL AND proxima_tentativa_em<=now()
    ORDER BY criado_em LIMIT $1`, [Math.min(100, Math.max(1, Number(limite)))])).rows;
  for (const job of jobs) {
    try {
      await storage.excluir(job.storage_key);
      await pool.query('UPDATE nexus.attachment_cleanup_jobs SET concluida_em=now() WHERE id=$1', [job.id]);
    } catch (erro) {
      const attempts = Number(job.attempts || 0) + 1;
      await pool.query(`UPDATE nexus.attachment_cleanup_jobs SET attempts=$2,last_error_code=$3,
        proxima_tentativa_em=now() + make_interval(secs => LEAST(3600, POWER(2,$2)::int * 30))
        WHERE id=$1`, [job.id, attempts, erro.code || erro.name || 'STORAGE_DELETE_ERROR']);
    }
  }
  return { processados: jobs.length };
}

module.exports = { ErroAnexo, criarServicoAnexos, processarFilaLimpeza };
