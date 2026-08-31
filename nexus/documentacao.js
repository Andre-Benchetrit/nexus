const { createHash } = require('node:crypto');
const { comTransacao } = require('./db');
const { decisaoPermissao, ErroHub } = require('./hub');
const { criarEmbeddingProvider, serializarVetor } = require('./embeddings');
const { dividirEmChunks, extrairDocumento, renderizarPaginaPdf,
  renderizarVisualDocx } = require('./document_parser');
const { gerarDocx, gerarPdf, normalizarConteudo } = require('./document_builder');
const { criarKnowledgeStorage } = require('./knowledge_storage');

function slugificar(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 110);
}

function checksum(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function validarTipo(tipo) {
  const valor = String(tipo || 'procedimento').toLowerCase();
  if (!['procedimento', 'politica', 'manual'].includes(valor)) throw new ErroHub('TIPO_DOCUMENTO_INVALIDO', 'Tipo de documento invalido.', 400);
  return valor;
}

function erroAcesso() {
  return new ErroHub('ACESSO_NEGADO', 'Voce nao possui acesso a este documento.', 403);
}

function textoEstruturadoParaBusca(versao = {}) {
  const conteudo = versao.conteudo_estruturado || {};
  const secoes = [
    ['Titulo', versao.titulo],
    ['Resumo', versao.resumo],
    ['Objetivo e conteudo principal', conteudo.objetivo],
    ['Publico', conteudo.publico],
    ['Pre-requisitos', ...(conteudo.preRequisitos || [])],
    ['Passos', ...(conteudo.passos || []).flatMap((passo) => [passo?.titulo, passo?.descricao])],
    ['Alertas', ...(conteudo.alertas || [])],
    ['Referencias', ...(conteudo.referencias || [])]
  ];
  return secoes.map(([titulo, ...itens]) => {
    const texto = itens.filter(Boolean).map((item) => String(item).trim()).filter(Boolean).join('\n');
    return texto ? `${titulo}:\n${texto}` : '';
  }).filter(Boolean).join('\n\n');
}

async function pode(pool, principalId, permissao, departmentId) {
  const decisao = await decisaoPermissao(pool, principalId, permissao, departmentId || null);
  return decisao.permitida;
}

function criarServicoDocumentacao(opcoes = {}) {
  const { pool, principalId } = opcoes;
  if (!pool || !principalId) throw new Error('Documentacao exige pool e principalId.');
  const storage = opcoes.storage || criarKnowledgeStorage(opcoes.storageOptions);
  const embeddings = opcoes.embeddings === undefined ? criarEmbeddingProvider(opcoes.embeddingOptions) : opcoes.embeddings;
  const publisher = opcoes.publisher || null;

  async function auditar(cliente, tipo, recurso, resultado, metadados = {}) {
    await cliente.query(`INSERT INTO nexus.audit_events
      (principal_id,tipo,recurso,resultado,metadados) VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [principalId, tipo, recurso, resultado, JSON.stringify(metadados)]);
  }

  async function autorizar(permissao, departmentId) {
    if (!await pode(pool, principalId, permissao, departmentId)) throw erroAcesso();
  }

  async function resolverSetor(departmentId) {
    if (!departmentId) return null;
    const setor = (await pool.query(`SELECT d.id,d.slug,d.nome FROM nexus.departments d
      JOIN nexus.principal_departments pd ON pd.department_id=d.id
      WHERE d.id=$1 AND d.ativo=true AND pd.principal_id=$2`, [departmentId, principalId])).rows[0];
    if (!setor) {
      if (!await pode(pool, principalId, 'documentacao.administrar.global', null)) throw erroAcesso();
      const administrado = (await pool.query(
        'SELECT id,slug,nome FROM nexus.departments WHERE id=$1 AND ativo=true', [departmentId]
      )).rows[0];
      if (!administrado) throw erroAcesso();
      return administrado;
    }
    return setor;
  }

  async function obterDocumentoAutorizado(id, { edicao = false, departmentId = null } = {}) {
    const documento = (await pool.query(`SELECT d.*,dep.slug AS department_slug,dep.nome AS department_name
      FROM nexus.knowledge_documents d LEFT JOIN nexus.departments dep ON dep.id=d.department_id
      WHERE d.id=$1`, [id])).rows[0];
    if (!documento) throw new ErroHub('DOCUMENTO_NAO_ENCONTRADO', 'Documento nao encontrado.', 404);
    if (documento.escopo === 'setor' && documento.department_id !== departmentId &&
        !await pode(pool, principalId, 'documentacao.administrar.global', null)) throw erroAcesso();
    if (edicao) {
      const permissao = documento.escopo === 'global'
        ? 'documentacao.administrar.global' : 'documentacao.editar.setor';
      await autorizar(permissao, documento.department_id);
    } else await autorizar('documentacao.consultar', documento.department_id || departmentId);
    return documento;
  }

  async function listar({ departmentId = null, status = 'publicado', busca = '', limite = 100 } = {}) {
    const setor = departmentId ? await resolverSetor(departmentId) : null;
    await autorizar('documentacao.consultar', setor?.id || null);
    if (!status) {
      const podeEditar = await pode(pool, principalId, 'documentacao.editar.setor', setor?.id || null) ||
        await pode(pool, principalId, 'documentacao.auditar', setor?.id || null) ||
        await pode(pool, principalId, 'documentacao.administrar.global', null);
      if (!podeEditar) throw erroAcesso();
    }
    const maximo = Math.min(200, Math.max(1, Number(limite) || 100));
    return (await pool.query(`SELECT d.id,d.slug,d.titulo,d.tipo,d.escopo,d.status,d.origem,
        d.department_id,dep.nome AS setor,d.atualizado_em,v.numero AS versao,v.publicado_em
        ,(SELECT pv.status FROM nexus.knowledge_document_versions pv
          WHERE pv.document_id=d.id AND pv.status IN ('rascunho','em_revisao')
          ORDER BY pv.numero DESC LIMIT 1) AS pending_status
      FROM nexus.knowledge_documents d
      LEFT JOIN nexus.departments dep ON dep.id=d.department_id
      LEFT JOIN nexus.knowledge_document_versions v ON v.id=d.current_published_version_id
      WHERE ($1::text IS NULL OR d.status=$1)
        AND (d.escopo='global' OR d.department_id=$2)
        AND ($3='' OR d.titulo ILIKE '%' || $3 || '%')
      ORDER BY CASE d.tipo WHEN 'politica' THEN 0 WHEN 'manual' THEN 1 ELSE 2 END,
        d.atualizado_em DESC LIMIT $4`, [status || null, setor?.id || null, String(busca || '').trim(), maximo])).rows;
  }

  async function criarRascunho(entrada = {}) {
    const tipo = validarTipo(entrada.tipo);
    const titulo = String(entrada.titulo || '').trim();
    if (titulo.length < 3 || titulo.length > 240) throw new ErroHub('TITULO_INVALIDO', 'Informe um titulo entre 3 e 240 caracteres.', 400);
    const escopo = entrada.escopo === 'global' ? 'global' : 'setor';
    const setor = escopo === 'setor' ? await resolverSetor(entrada.departmentId) : null;
    await autorizar(escopo === 'global' ? 'documentacao.administrar.global' : 'documentacao.criar.setor', setor?.id);
    const conteudo = normalizarConteudo(entrada.conteudo || {});
    const bruto = Buffer.from(JSON.stringify({ titulo, tipo, conteudo }), 'utf8');
    return comTransacao(pool, async (cliente) => {
      let slug = slugificar(entrada.slug || titulo) || `documento-${Date.now()}`;
      const existe = await cliente.query('SELECT 1 FROM nexus.knowledge_documents WHERE slug=$1', [slug]);
      if (existe.rowCount) slug = `${slug}-${Date.now().toString(36)}`;
      const documento = (await cliente.query(`INSERT INTO nexus.knowledge_documents
        (slug,titulo,tipo,escopo,department_id,status,origem,criado_por)
        VALUES ($1,$2,$3,$4,$5,'rascunho','nexus',$6) RETURNING *`,
      [slug, titulo, tipo, escopo, setor?.id || null, principalId])).rows[0];
      const versao = (await cliente.query(`INSERT INTO nexus.knowledge_document_versions
        (document_id,numero,status,titulo,resumo,conteudo_estruturado,checksum,extracao_status,criado_por)
        VALUES ($1,1,'rascunho',$2,$3,$4::jsonb,$5,'concluida',$6) RETURNING *`,
      [documento.id, titulo, String(entrada.resumo || '').trim() || null,
        JSON.stringify(conteudo), checksum(bruto), principalId])).rows[0];
      await auditar(cliente, 'documentacao_criada', documento.id, 'sucesso', {
        tipo, escopo, department_id: setor?.id || null
      });
      return { documento, versao };
    });
  }

  async function atualizarRascunho(documentId, entrada = {}) {
    const documento = await obterDocumentoAutorizado(documentId, {
      edicao: true, departmentId: entrada.departmentId || null
    });
    let atual = (await pool.query(`SELECT * FROM nexus.knowledge_document_versions
      WHERE document_id=$1 AND status IN ('rascunho','em_revisao') ORDER BY numero DESC LIMIT 1`, [documentId])).rows[0];
    if (!atual && documento.current_published_version_id) {
      atual = (await pool.query(`INSERT INTO nexus.knowledge_document_versions
        (document_id,numero,status,titulo,resumo,conteudo_estruturado,checksum,extracao_status,criado_por)
        SELECT document_id,(SELECT MAX(numero)+1 FROM nexus.knowledge_document_versions WHERE document_id=$1),
          'rascunho',titulo,resumo,conteudo_estruturado,checksum,'concluida',$2
        FROM nexus.knowledge_document_versions WHERE id=$3 RETURNING *`,
      [documentId, principalId, documento.current_published_version_id])).rows[0];
    }
    if (!atual) throw new ErroHub('RASCUNHO_AUSENTE', 'Nao ha rascunho editavel para este documento.', 409);
    const titulo = String(entrada.titulo ?? atual.titulo).trim();
    const conteudo = normalizarConteudo(entrada.conteudo ?? atual.conteudo_estruturado);
    const bruto = Buffer.from(JSON.stringify({ titulo, conteudo }), 'utf8');
    const versao = (await pool.query(`UPDATE nexus.knowledge_document_versions SET
      titulo=$2,resumo=$3,conteudo_estruturado=$4::jsonb,checksum=$5,status='rascunho',erro_codigo=NULL
      WHERE id=$1 RETURNING *`, [atual.id, titulo, entrada.resumo ?? atual.resumo,
      JSON.stringify(conteudo), checksum(bruto)])).rows[0];
    await pool.query(`UPDATE nexus.knowledge_documents SET
      titulo=CASE WHEN current_published_version_id IS NULL THEN $2 ELSE titulo END,
      status=CASE WHEN current_published_version_id IS NULL THEN 'rascunho' ELSE 'publicado' END,
      atualizado_em=now() WHERE id=$1`, [documentId, titulo]);
    await auditar(pool, 'documentacao_editada', documentId, 'sucesso', {
      versao: versao.numero, department_id: documento.department_id
    });
    return { documento: { ...documento, titulo: documento.current_published_version_id ? documento.titulo : titulo,
      status: documento.current_published_version_id ? 'publicado' : 'rascunho' }, versao };
  }

  async function enviarParaRevisao(documentId, departmentId) {
    const documento = await obterDocumentoAutorizado(documentId, { edicao: true, departmentId });
    const versao = (await pool.query(`UPDATE nexus.knowledge_document_versions SET status='em_revisao'
      WHERE id=(SELECT id FROM nexus.knowledge_document_versions WHERE document_id=$1 AND status='rascunho'
        ORDER BY numero DESC LIMIT 1) RETURNING id,numero,status`, [documentId])).rows[0];
    if (!versao) throw new ErroHub('RASCUNHO_AUSENTE', 'Nao ha rascunho para revisar.', 409);
    await pool.query(`UPDATE nexus.knowledge_documents SET
      status=CASE WHEN current_published_version_id IS NULL THEN 'em_revisao' ELSE 'publicado' END,
      atualizado_em=now() WHERE id=$1`, [documentId]);
    await auditar(pool, 'documentacao_enviada_revisao', documentId, 'sucesso', {
      versao: versao.numero, department_id: documento.department_id
    });
    return { documentoId: documento.id, versao };
  }

  async function solicitarAjustes(documentId, { departmentId = null, motivo = '' } = {}) {
    const documento = await obterDocumentoAutorizado(documentId, { edicao: true, departmentId });
    await autorizar(documento.escopo === 'global'
      ? 'documentacao.administrar.global' : 'documentacao.publicar.setor', documento.department_id);
    const justificativa = String(motivo || '').trim();
    if (justificativa.length < 5) {
      throw new ErroHub('MOTIVO_REVISAO_OBRIGATORIO',
        'Informe o motivo dos ajustes solicitados.', 400);
    }
    const versao = (await pool.query(`UPDATE nexus.knowledge_document_versions SET status='rascunho'
      WHERE id=(SELECT id FROM nexus.knowledge_document_versions WHERE document_id=$1 AND status='em_revisao'
        ORDER BY numero DESC LIMIT 1) RETURNING id,numero,status`, [documentId])).rows[0];
    if (!versao) throw new ErroHub('REVISAO_AUSENTE', 'Nao ha versao em revisao.', 409);
    await pool.query(`UPDATE nexus.knowledge_documents SET
      status=CASE WHEN current_published_version_id IS NULL THEN 'rascunho' ELSE 'publicado' END,
      atualizado_em=now() WHERE id=$1`, [documentId]);
    await auditar(pool, 'documentacao_ajustes_solicitados', documentId, 'sucesso', {
      versao: versao.numero, department_id: documento.department_id,
      motivo_informado: true
    });
    return { documentoId: documento.id, versao };
  }

  async function realocarDocumento(documentId, entrada = {}) {
    await autorizar('documentacao.administrar.global', null);
    const documento = (await pool.query(`SELECT d.*,dep.nome AS department_name
      FROM nexus.knowledge_documents d LEFT JOIN nexus.departments dep ON dep.id=d.department_id
      WHERE d.id=$1`, [documentId])).rows[0];
    if (!documento) throw new ErroHub('DOCUMENTO_NAO_ENCONTRADO', 'Documento nao encontrado.', 404);
    const escopo = entrada.escopo === 'global' ? 'global' : 'setor';
    const setor = escopo === 'setor' ? await resolverSetor(entrada.departmentId) : null;
    if (escopo === 'setor' && !setor) {
      throw new ErroHub('SETOR_OBRIGATORIO', 'Selecione o setor de destino.', 400);
    }
    const destinoId = setor?.id || null;
    if (documento.escopo === escopo && documento.department_id === destinoId) {
      return { documento, alterado: false };
    }
    const atualizado = await comTransacao(pool, async (cliente) => {
      const linha = (await cliente.query(`UPDATE nexus.knowledge_documents SET
        escopo=$2,department_id=$3,atualizado_em=now() WHERE id=$1 RETURNING *`,
      [documentId, escopo, destinoId])).rows[0];
      await auditar(cliente, 'documentacao_realocada', documentId, 'sucesso', {
        escopo_anterior: documento.escopo,
        department_id_anterior: documento.department_id,
        escopo_novo: escopo,
        department_id_novo: destinoId
      });
      return linha;
    });
    return { documento: atualizado, alterado: true };
  }

  async function indexarVersao(cliente, versionId, paginas) {
    await cliente.query('DELETE FROM nexus.knowledge_document_pages WHERE version_id=$1', [versionId]);
    const pageIds = new Map();
    for (const pagina of paginas) {
      if (!Number.isInteger(pagina.numero) || pagina.numero <= 0) continue;
      const linha = (await cliente.query(`INSERT INTO nexus.knowledge_document_pages
        (version_id,numero,texto,possui_imagem,metadados) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id`,
      [versionId, pagina.numero, pagina.texto || '', Boolean(pagina.possuiImagem), JSON.stringify(pagina.metadados || {})])).rows[0];
      pageIds.set(pagina.numero, linha.id);
    }
    const chunks = dividirEmChunks(paginas);
    const registros = [];
    for (let indice = 0; indice < chunks.length; indice += 1) {
      const chunk = chunks[indice];
      let vetor = null;
      if (embeddings) {
        try { vetor = serializarVetor(await embeddings.gerar(chunk.conteudo, 'passage')); }
        catch (_) { vetor = null; }
      }
      registros.push([versionId, pageIds.get(chunk.pagina) || null, indice, chunk.conteudo, vetor]);
    }
    for (let inicio = 0; inicio < registros.length; inicio += 50) {
      const lote = registros.slice(inicio, inicio + 50);
      const parametros = [];
      const valores = lote.map((registro) => {
        const base = parametros.length;
        parametros.push(...registro);
        return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5}::vector,'{}'::jsonb)`;
      });
      await cliente.query(`INSERT INTO nexus.knowledge_document_chunks
        (version_id,page_id,ordinal,conteudo,embedding,metadados) VALUES ${valores.join(',')}`, parametros);
    }
    return chunks.length;
  }

  async function publicar(documentId, { departmentId = null, justificativa = '' } = {}) {
    const documento = await obterDocumentoAutorizado(documentId, { edicao: true, departmentId });
    await autorizar(documento.escopo === 'global'
      ? 'documentacao.administrar.global' : 'documentacao.publicar.setor', documento.department_id);
    const versao = (await pool.query(`SELECT * FROM nexus.knowledge_document_versions
      WHERE document_id=$1 AND status IN ('rascunho','em_revisao') ORDER BY numero DESC LIMIT 1`, [documentId])).rows[0];
    if (!versao) throw new ErroHub('VERSAO_AUSENTE', 'Nao ha versao pronta para publicar.', 409);
    const conflitosPotenciais = (await pool.query(`SELECT d.id,d.titulo,d.tipo,d.escopo,dep.nome AS setor
      FROM nexus.knowledge_documents d LEFT JOIN nexus.departments dep ON dep.id=d.department_id
      WHERE d.id<>$1 AND d.status='publicado'
        AND ((d.tipo='politica' AND d.escopo='global') OR ($2='politica' AND $3='global'))
        AND similarity(d.titulo,$4)>0.22
      ORDER BY similarity(d.titulo,$4) DESC LIMIT 10`,
    [documentId, documento.tipo, documento.escopo, versao.titulo])).rows;
    const paginasExistentes = (await pool.query(`SELECT numero,texto,possui_imagem,metadados
      FROM nexus.knowledge_document_pages WHERE version_id=$1 ORDER BY numero`, [versao.id])).rows
      .map((pagina) => ({ ...pagina, possuiImagem: pagina.possui_imagem }));
    const passosImportados = paginasExistentes.flatMap((pagina) => {
      const partes = String(pagina.texto || '').match(/[\s\S]{1,4800}/g) || [];
      return partes.map((descricao, indice) => ({
        titulo: `Pagina ${pagina.numero}${partes.length > 1 ? ` - parte ${indice + 1}` : ''}`,
        descricao
      }));
    });
    const conteudoGeracao = Object.keys(versao.conteudo_estruturado || {}).length
      ? versao.conteudo_estruturado
      : { objetivo: versao.resumo || 'Conteudo importado do repositorio oficial.', publico: '',
        preRequisitos: [], passos: passosImportados, alertas: [], referencias: [] };
    const [docxBuffer, pdfBuffer] = await Promise.all([
      gerarDocx({ titulo: versao.titulo, tipo: documento.tipo, versao: versao.numero, conteudo: conteudoGeracao }),
      gerarPdf({ titulo: versao.titulo, tipo: documento.tipo, versao: versao.numero, conteudo: conteudoGeracao })
    ]);
    const publicacaoOficial = publisher ? await publisher.publicar({
      documento, versao, docxBuffer, pdfBuffer
    }) : null;
    const salvos = {};
    if (docxBuffer) salvos.docx = await storage.salvar({ buffer: docxBuffer, categoria: 'published', documentId, versionId: versao.id, extensao: 'docx' });
    if (pdfBuffer) salvos.pdf = await storage.salvar({ buffer: pdfBuffer, categoria: 'published', documentId, versionId: versao.id, extensao: 'pdf' });
    const textoEstruturado = textoEstruturadoParaBusca(versao);
    const paginas = paginasExistentes.length
      ? [...paginasExistentes, ...(textoEstruturado ? [{ numero: null, texto: textoEstruturado,
        possuiImagem: false, metadados: { origem: 'conteudo_estruturado' } }] : [])]
      : [{ numero: 1, texto: textoEstruturado, possuiImagem: false,
        metadados: { origem: 'conteudo_estruturado' } }];
    const resultado = await comTransacao(pool, async (cliente) => {
      const totalChunks = await indexarVersao(cliente, versao.id, paginas);
      await cliente.query(`UPDATE nexus.knowledge_document_versions SET status='substituido'
        WHERE document_id=$1 AND status='publicado' AND id<>$2`, [documentId, versao.id]);
      await cliente.query(`UPDATE nexus.knowledge_document_versions SET status='publicado',extracao_status='concluida',
        docx_storage_key=$2,pdf_storage_key=$3,publicado_por=$4,publicado_em=now(),erro_codigo=NULL WHERE id=$1`,
      [versao.id, salvos.docx?.chave || versao.docx_storage_key, salvos.pdf?.chave || versao.pdf_storage_key, principalId]);
      await cliente.query(`UPDATE nexus.knowledge_documents SET status='publicado',current_published_version_id=$2,
        titulo=$3,atualizado_em=now() WHERE id=$1`, [documentId, versao.id, versao.titulo]);
      await cliente.query(`INSERT INTO nexus.audit_events (principal_id,tipo,recurso,resultado,metadados)
        VALUES ($1,'documentacao_publicada',$2,'sucesso',$3::jsonb)`, [principalId, documentId,
        JSON.stringify({ versao: versao.numero, escopo: documento.escopo,
          department_id: documento.department_id, justificativa_informada: Boolean(String(justificativa).trim()),
          chunks: totalChunks, onedrive_publicado: Boolean(publicacaoOficial) })]);
      return { documentId, versionId: versao.id, versao: versao.numero, chunks: totalChunks };
    });
    return { ...resultado, arquivos: { docx: Boolean(salvos.docx), pdf: Boolean(salvos.pdf) },
      onedrive: Boolean(publicacaoOficial),
      conflitos_potenciais: conflitosPotenciais };
  }

  async function registrarImportacao(entrada = {}) {
    const setor = entrada.escopo === 'global' ? null : await resolverSetor(entrada.departmentId);
    await autorizar(entrada.escopo === 'global' ? 'documentacao.administrar.global' : 'documentacao.importar', setor?.id);
    const tipo = validarTipo(entrada.tipo);
    const titulo = String(entrada.titulo || entrada.nomeArquivo || '').replace(/\.(pdf|docx|dotx)$/i, '').trim();
    const hash = checksum(entrada.buffer);
    let existente = entrada.externalItemId ? (await pool.query(
      'SELECT * FROM nexus.knowledge_documents WHERE external_item_id=$1', [entrada.externalItemId]
    )).rows[0] : null;
    let reconciliado = false;
    let reconciliacaoPendente = null;
    if (!existente && entrada.externalItemId) {
      const parametros = [entrada.externalPath || null];
      const porCaminho = entrada.externalPath ? (await pool.query(`SELECT d.*
        FROM nexus.knowledge_documents d
        WHERE lower(d.external_path)=lower($1)
          AND (d.external_drive_id IS NULL OR d.external_drive_id='local-onedrive-sync')
        ORDER BY d.atualizado_em DESC LIMIT 2`, parametros)).rows : [];
      let candidatos = porCaminho;
      if (!candidatos.length) {
        candidatos = (await pool.query(`SELECT DISTINCT d.*
          FROM nexus.knowledge_documents d
          JOIN nexus.knowledge_document_versions v ON v.document_id=d.id AND v.checksum=$1
          WHERE d.tipo=$2 AND d.escopo=$3
            AND d.department_id IS NOT DISTINCT FROM $4::uuid
            AND (d.external_drive_id IS NULL OR d.external_drive_id='local-onedrive-sync')
          ORDER BY d.atualizado_em DESC LIMIT 2`,
        [hash, tipo, entrada.escopo || 'setor', setor?.id || null])).rows;
      }
      if (candidatos.length === 1) {
        existente = candidatos[0];
        reconciliacaoPendente = candidatos[0];
      }
    }
    if (existente) {
      const setorEsperado = setor?.id || null;
      if (existente.escopo !== (entrada.escopo || 'setor')
        || String(existente.department_id || '') !== String(setorEsperado || '')) {
        if (entrada.preservarEscopoExistente === true) {
          await autorizar(existente.escopo === 'global'
            ? 'documentacao.administrar.global' : 'documentacao.importar',
          existente.department_id || null);
        } else {
          throw new ErroHub('ESCOPO_DOCUMENTAL_DIVERGENTE',
            'O documento ja existe em outro escopo ou setor e exige revisao administrativa.', 409);
        }
      }
      if (reconciliacaoPendente) {
        await pool.query(`UPDATE nexus.knowledge_documents SET external_drive_id=$2,
          external_item_id=$3,external_path=COALESCE($4,external_path),atualizado_em=now()
          WHERE id=$1`, [existente.id, entrada.externalDriveId || null,
          entrada.externalItemId, entrada.externalPath || null]);
        existente = { ...existente, external_drive_id: entrada.externalDriveId || null,
          external_item_id: entrada.externalItemId,
          external_path: entrada.externalPath || existente.external_path };
        reconciliado = true;
        await auditar(pool, 'documentacao_origem_reconciliada', existente.id, 'sucesso', {
          external_source_key: entrada.externalSourceKey || null,
          origem_anterior: reconciliacaoPendente.external_drive_id || null,
          origem_atual: entrada.externalDriveId || null,
          escopo_preservado: existente.escopo
        });
      }
      const duplicada = (await pool.query(`SELECT id FROM nexus.knowledge_document_versions
        WHERE document_id=$1 AND checksum=$2`, [existente.id, hash])).rows[0];
      if (duplicada) return { documentId: existente.id, versionId: duplicada.id,
        duplicada: true, reconciliada: reconciliado };
    }
    const extraido = await extrairDocumento(entrada);
    return comTransacao(pool, async (cliente) => {
      let documento = existente;
      if (!documento) {
        let slug = slugificar(titulo) || `documento-${Date.now()}`;
        if ((await cliente.query('SELECT 1 FROM nexus.knowledge_documents WHERE slug=$1', [slug])).rowCount) slug += `-${Date.now().toString(36)}`;
        documento = (await cliente.query(`INSERT INTO nexus.knowledge_documents
          (slug,titulo,tipo,escopo,department_id,status,origem,external_drive_id,external_item_id,external_path,criado_por)
          VALUES ($1,$2,$3,$4,$5,'em_revisao','onedrive',$6,$7,$8,$9) RETURNING *`,
        [slug, titulo, tipo, entrada.escopo || 'setor', setor?.id || null,
          entrada.externalDriveId || null, entrada.externalItemId || null, entrada.externalPath || null, principalId])).rows[0];
      }
      const ultima = Number((await cliente.query('SELECT COALESCE(MAX(numero),0) AS numero FROM nexus.knowledge_document_versions WHERE document_id=$1', [documento.id])).rows[0].numero);
      const duplicada = (await cliente.query('SELECT id FROM nexus.knowledge_document_versions WHERE document_id=$1 AND checksum=$2', [documento.id, hash])).rows[0];
      if (duplicada) return { documentId: documento.id, versionId: duplicada.id, duplicada: true };
      const versao = (await cliente.query(`INSERT INTO nexus.knowledge_document_versions
        (document_id,numero,status,titulo,source_filename,source_media_type,checksum,origem_modificada_em,
         extracao_status,criado_por) VALUES ($1,$2,'em_revisao',$3,$4,$5,$6,$7,'processando',$8) RETURNING *`,
      [documento.id, ultima + 1, titulo, entrada.nomeArquivo, extraido.mediaType, hash,
        entrada.modificadoEm || null, principalId])).rows[0];
      const salvo = await storage.salvar({ buffer: entrada.buffer, categoria: 'sources', documentId: documento.id,
        versionId: versao.id, extensao: extraido.extensao });
      await cliente.query('UPDATE nexus.knowledge_document_versions SET source_storage_key=$2 WHERE id=$1', [versao.id, salvo.chave]);
      const totalChunks = await indexarVersao(cliente, versao.id, extraido.paginas);
      await cliente.query(`UPDATE nexus.knowledge_document_versions SET extracao_status='concluida' WHERE id=$1`, [versao.id]);
      await cliente.query(`UPDATE nexus.knowledge_documents SET
        status=CASE WHEN current_published_version_id IS NULL THEN 'em_revisao' ELSE 'publicado' END,
        atualizado_em=now(),
        external_path=COALESCE($2,external_path) WHERE id=$1`, [documento.id, entrada.externalPath || null]);
      await auditar(cliente, 'documentacao_importada', documento.id, 'sucesso', {
        versao: versao.numero, escopo: documento.escopo,
        department_id: documento.department_id, paginas: extraido.paginas.length, chunks: totalChunks
      });
      return { documentId: documento.id, versionId: versao.id, versao: versao.numero,
        paginas: extraido.paginas.length, chunks: totalChunks, duplicada: false };
    });
  }

  async function buscar({ consulta, documentId = null, departmentId = null, limite = 8 } = {}) {
    const setor = departmentId ? await resolverSetor(departmentId) : null;
    await autorizar('documentacao.consultar', setor?.id || null);
    const termo = String(consulta || '').trim();
    if (termo.length < 2 || termo.length > 1000) throw new ErroHub('CONSULTA_INVALIDA', 'Informe uma consulta documental valida.', 400);
    const documentoSelecionado = documentId ? String(documentId).trim().toLowerCase() : null;
    if (documentoSelecionado && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(documentoSelecionado)) {
      throw new ErroHub('DOCUMENTO_INVALIDO', 'A referencia do documento e invalida.', 400);
    }
    const maximo = Math.min(12, Math.max(1, Number(limite) || 8));
    let vetor = null;
    if (embeddings) {
      try { vetor = serializarVetor(await embeddings.gerar(termo, 'query')); } catch (_) { vetor = null; }
    }
    const linhas = (await pool.query(`SELECT d.id AS document_id,d.titulo,d.tipo,d.escopo,dep.nome AS setor,
        v.numero AS versao,p.numero AS pagina,p.possui_imagem,c.conteudo,
        ts_rank_cd(c.search_vector,websearch_to_tsquery('portuguese',$2)) AS text_rank,
        CASE WHEN $3::vector IS NULL OR c.embedding IS NULL THEN NULL
          ELSE 1-(c.embedding <=> $3::vector) END AS semantic_rank
      FROM nexus.knowledge_document_chunks c
      JOIN nexus.knowledge_document_versions v ON v.id=c.version_id AND v.status='publicado'
      JOIN nexus.knowledge_documents d ON d.current_published_version_id=v.id AND d.status='publicado'
      LEFT JOIN nexus.knowledge_document_pages p ON p.id=c.page_id
      LEFT JOIN nexus.departments dep ON dep.id=d.department_id
      WHERE (d.escopo='global' OR d.department_id=$1)
        AND (($5::uuid IS NOT NULL AND d.id=$5)
          OR ($5::uuid IS NULL AND (c.search_vector @@ websearch_to_tsquery('portuguese',$2)
            OR similarity(d.titulo,$2)>0.12 OR ($3::vector IS NOT NULL AND c.embedding IS NOT NULL))))
      ORDER BY (CASE WHEN d.tipo='politica' AND d.escopo='global' THEN 0.15
        WHEN d.tipo='politica' THEN 0.08 WHEN d.tipo='manual' THEN 0.03 ELSE 0 END
        + CASE WHEN $5::uuid IS NOT NULL AND c.conteudo ~* '(https?://|link|acesso|portal|site|sistema|painel)' THEN 1.2 ELSE 0 END
        + ts_rank_cd(c.search_vector,websearch_to_tsquery('portuguese',$2))*1.8
        + similarity(d.titulo,$2)*0.7
        + COALESCE(1-(c.embedding <=> $3::vector),0)) DESC
      LIMIT $4`, [setor?.id || null, termo, vetor, maximo, documentoSelecionado])).rows;
    return {
      status: linhas.length ? 'sucesso' : 'vazio',
      consulta: termo,
      resultados: linhas.map((linha) => ({
        documento_id: linha.document_id,
        titulo: linha.titulo,
        tipo: linha.tipo,
        setor: linha.setor,
        versao: linha.versao,
        pagina: linha.pagina,
        pagina_visual_disponivel: Boolean(linha.possui_imagem),
        trecho: linha.conteudo,
        links: [...new Set((String(linha.conteudo || '').match(/https?:\/\/[^\s<>"']+/giu) || [])
          .map((url) => url.replace(/[),.;:!?]+$/u, '')))],
        citacao: `${linha.titulo} - versao ${linha.versao}${linha.pagina ? `, pagina ${linha.pagina}` : ''}`
      }))
    };
  }

  async function obter(documentId, { departmentId = null } = {}) {
    const documento = await obterDocumentoAutorizado(documentId, { departmentId, edicao: true });
    const versoes = (await pool.query(`SELECT id,numero,status,titulo,resumo,source_filename,extracao_status,
      criado_em,publicado_em FROM nexus.knowledge_document_versions WHERE document_id=$1 ORDER BY numero DESC`, [documentId])).rows;
    const edicao = (await pool.query(`SELECT id,numero,status,titulo,resumo,conteudo_estruturado
      FROM nexus.knowledge_document_versions WHERE document_id=$1
      ORDER BY CASE WHEN status IN ('rascunho','em_revisao') THEN 0 ELSE 1 END,numero DESC LIMIT 1`,
    [documentId])).rows[0] || null;
    if (edicao) {
      edicao.texto_extraido = (await pool.query(`SELECT left(COALESCE(string_agg(texto,E'\n\n'
        ORDER BY numero),''),100000) AS texto FROM nexus.knowledge_document_pages WHERE version_id=$1`,
      [edicao.id])).rows[0]?.texto || '';
    }
    return { documento, versoes, edicao };
  }

  async function abrirPublicado(documentId, formato, { departmentId = null } = {}) {
    const documento = await obterDocumentoAutorizado(documentId, { departmentId });
    const campo = formato === 'docx' ? 'docx_storage_key' : formato === 'pdf' ? 'pdf_storage_key' : null;
    if (!campo) throw new ErroHub('FORMATO_INVALIDO', 'Formato de download invalido.', 400);
    const versao = (await pool.query(`SELECT ${campo} AS storage_key FROM nexus.knowledge_document_versions WHERE id=$1`, [documento.current_published_version_id])).rows[0];
    if (!versao?.storage_key) throw new ErroHub('ARQUIVO_INDISPONIVEL', 'Este formato ainda nao esta disponivel.', 404);
    return storage.abrir(versao.storage_key);
  }

  async function abrirPaginaVisual(documentId, numero, { departmentId = null } = {}) {
    const documento = await obterDocumentoAutorizado(documentId, { departmentId });
    await autorizar('documentacao.visual.consultar', documento.department_id || departmentId);
    const pagina = (await pool.query(`SELECT p.*,v.source_storage_key,v.source_media_type
      FROM nexus.knowledge_document_pages p
      JOIN nexus.knowledge_document_versions v ON v.id=p.version_id
      WHERE v.id=$1 AND p.numero=$2`, [documento.current_published_version_id, Number(numero)])).rows[0];
    if (!pagina) throw new ErroHub('PAGINA_NAO_ENCONTRADA', 'Pagina documental nao encontrada.', 404);
    if (pagina.image_storage_key) return storage.abrir(pagina.image_storage_key);
    if (!pagina.source_storage_key) {
      throw new ErroHub('PAGINA_VISUAL_INDISPONIVEL', 'A pagina visual nao esta disponivel neste formato.', 404);
    }
    const origem = await storage.abrir(pagina.source_storage_key);
    let renderizada;
    if (pagina.source_media_type === 'application/pdf') {
      renderizada = await renderizarPaginaPdf(origem, Number(numero));
    } else if ([
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.template'
    ].includes(pagina.source_media_type)) {
      renderizada = await renderizarVisualDocx(origem);
    } else {
      throw new ErroHub('PAGINA_VISUAL_INDISPONIVEL', 'A pagina visual nao esta disponivel neste formato.', 404);
    }
    const salvo = await storage.salvar({ buffer: renderizada, categoria: 'pages', documentId,
      versionId: documento.current_published_version_id, pagina: Number(numero), extensao: 'png' });
    await pool.query('UPDATE nexus.knowledge_document_pages SET image_storage_key=$2 WHERE id=$1', [pagina.id, salvo.chave]);
    return renderizada;
  }

  return { abrirPaginaVisual, abrirPublicado, atualizarRascunho, buscar, criarRascunho, enviarParaRevisao,
    listar, obter, publicar, realocarDocumento, registrarImportacao, solicitarAjustes, storage };
}

module.exports = { checksum, criarServicoDocumentacao, slugificar, textoEstruturadoParaBusca,
  validarTipo };
