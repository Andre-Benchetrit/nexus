const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { resolverConexao } = require('../integracoes/microsoft/conexoes');
const { criarClienteGraph } = require('../integracoes/microsoft/graph');
const { criarServicoDocumentacao } = require('./documentacao');

const SETORES_PADRAO = Object.freeze({
  comercial: 'comercial', financeiro: 'financeiro', logistica: 'logistica',
  marketing: 'marketing', rh: 'rh', sac: 'sac', tecnologia: 'ti'
});
const TIPOS_DOCUMENTO = new Set(['procedimento', 'politica', 'manual']);
const ESCOPOS_DOCUMENTO = new Set(['global', 'setor']);

function normalizarNome(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/^procedimentos?\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function classificarPasta(nome, mapa = SETORES_PADRAO) {
  const normalizado = normalizarNome(nome);
  if (/^(politicas?( internas?)?|manuais?( da empresa)?|corporativo|global)$/.test(normalizado)) {
    return { escopo: 'global', tipo: /politic/.test(normalizado) ? 'politica' : 'manual' };
  }
  const slug = mapa[normalizado];
  return slug ? { escopo: 'setor', setorSlug: slug, tipo: 'procedimento' } : null;
}

function extensaoPermitida(nome) {
  return ['.pdf', '.docx', '.dotx'].includes(path.extname(String(nome || '')).toLowerCase());
}

function falhaTransitoria(erro) {
  return /\b(terminated|econnreset|etimedout|timeout|fetch failed|429|500|502|503|504)\b/i
    .test(String(erro?.message || erro || ''));
}

async function baixarItemComRetry(graph, itemId, driveId, tentativas = 3) {
  let ultimoErro;
  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    try { return await graph.baixarItem(itemId, driveId); } catch (erro) {
      ultimoErro = erro;
      if (tentativa >= tentativas || !falhaTransitoria(erro)) throw erro;
      await new Promise((resolve) => setTimeout(resolve, tentativa * 350));
    }
  }
  throw ultimoErro;
}

async function registrarImportacaoComRetry(servico, entrada, tentativas = 3) {
  let ultimoErro;
  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    try { return await servico.registrarImportacao(entrada); } catch (erro) {
      ultimoErro = erro;
      if (tentativa >= tentativas || !falhaTransitoria(erro)) throw erro;
      await new Promise((resolve) => setTimeout(resolve, tentativa * 350));
    }
  }
  throw ultimoErro;
}

async function listarRecursivamente(graph, { driveId, itemId, caminho = '', classificacao = null }) {
  const itens = await graph.listarFilhos({ driveId, itemId });
  const arquivos = [];
  for (const item of itens) {
    const caminhoItem = caminho ? `${caminho}/${item.name}` : item.name;
    if (item.folder) {
      const proximaClassificacao = classificacao || classificarPasta(item.name);
      arquivos.push(...await listarRecursivamente(graph, {
        driveId, itemId: item.id, caminho: caminhoItem, classificacao: proximaClassificacao
      }));
    } else if (item.file && extensaoPermitida(item.name)) {
      arquivos.push({ item, caminho: caminhoItem, classificacao });
    }
  }
  return arquivos;
}

function normalizarFonte(fonte, indice) {
  if (!fonte || typeof fonte !== 'object' || Array.isArray(fonte)) {
    throw new Error(`Fonte documental ${indice + 1} invalida.`);
  }
  const key = String(fonte.key || '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(key)) {
    throw new Error(`A fonte documental ${indice + 1} precisa de uma key valida.`);
  }
  const itemId = String(fonte.itemId || '').trim() || null;
  const rootItemId = String(fonte.rootItemId || '').trim() || null;
  const rootPath = String(fonte.rootPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim() || null;
  const origens = [itemId, rootItemId, rootPath].filter(Boolean);
  if (origens.length !== 1) {
    throw new Error(`A fonte ${key} deve informar exatamente um itemId, rootItemId ou rootPath.`);
  }
  const tipo = fonte.tipo == null ? null : String(fonte.tipo).trim().toLowerCase();
  const escopo = fonte.escopo == null ? null : String(fonte.escopo).trim().toLowerCase();
  const setorSlug = fonte.setorSlug == null ? null : String(fonte.setorSlug).trim().toLowerCase();
  if (itemId && (!TIPOS_DOCUMENTO.has(tipo) || !ESCOPOS_DOCUMENTO.has(escopo))) {
    throw new Error(`A fonte de arquivo ${key} exige tipo e escopo validos.`);
  }
  if ((tipo && !TIPOS_DOCUMENTO.has(tipo)) || (escopo && !ESCOPOS_DOCUMENTO.has(escopo))) {
    throw new Error(`A classificacao da fonte ${key} e invalida.`);
  }
  if ((tipo && !escopo) || (!tipo && escopo)) {
    throw new Error(`A fonte ${key} deve informar tipo e escopo em conjunto.`);
  }
  if (escopo === 'setor' && !setorSlug) {
    throw new Error(`A fonte setorial ${key} exige setorSlug.`);
  }
  return Object.freeze({
    key, itemId, rootItemId, rootPath, tipo, escopo,
    setorSlug: escopo === 'setor' ? setorSlug : null,
    titulo: String(fonte.titulo || '').trim() || null,
    caminho: String(fonte.caminho || '').replace(/\\/g, '/').replace(/^\/+/, '').trim() || null
  });
}

function lerFontesOneDrive(opcoes = {}) {
  if (Array.isArray(opcoes.sources)) return validarFontes(opcoes.sources);
  const catalogo = opcoes.sourcesJson ?? process.env.NEXUS_KNOWLEDGE_ONEDRIVE_SOURCES_JSON;
  if (String(catalogo || '').trim()) {
    let fontes;
    try { fontes = JSON.parse(catalogo); } catch (_) {
      throw new Error('NEXUS_KNOWLEDGE_ONEDRIVE_SOURCES_JSON contem JSON invalido.');
    }
    if (!Array.isArray(fontes)) {
      throw new Error('NEXUS_KNOWLEDGE_ONEDRIVE_SOURCES_JSON deve ser uma lista JSON.');
    }
    return validarFontes(fontes);
  }
  const rootItemId = opcoes.rootItemId || process.env.NEXUS_KNOWLEDGE_ONEDRIVE_ROOT_ITEM_ID;
  const rootPath = opcoes.rootPath || process.env.NEXUS_KNOWLEDGE_ONEDRIVE_ROOT_PATH;
  if (!rootItemId && !rootPath) {
    throw new Error('Configure NEXUS_KNOWLEDGE_ONEDRIVE_SOURCES_JSON, NEXUS_KNOWLEDGE_ONEDRIVE_ROOT_ITEM_ID ou NEXUS_KNOWLEDGE_ONEDRIVE_ROOT_PATH.');
  }
  return validarFontes([{ key: 'legado', rootItemId, rootPath }]);
}

function validarFontes(fontes) {
  if (!fontes.length || fontes.length > 30) throw new Error('Configure entre 1 e 30 fontes documentais.');
  const normalizadas = fontes.map(normalizarFonte);
  const chaves = new Set();
  for (const fonte of normalizadas) {
    if (chaves.has(fonte.key)) throw new Error(`A fonte documental ${fonte.key} esta duplicada.`);
    chaves.add(fonte.key);
  }
  return normalizadas;
}

async function resolverPastaPorCaminho(graph, driveId, rootPath) {
  const partes = String(rootPath || '').split('/').filter(Boolean);
  const nome = partes.pop();
  const candidatos = await graph.listarFilhos({ driveId, caminho: partes.join('/') || undefined });
  const esperado = normalizarNome(nome);
  return candidatos.find((item) => item.folder && normalizarNome(item.name) === esperado)?.id || null;
}

async function listarArquivosFontesGraph(graph, { driveId, fontes }) {
  const arquivosPorId = new Map();
  const estados = [];
  const erros = [];
  for (const fonte of fontes) {
    try {
      let arquivos;
      const classificacao = fonte.tipo ? {
        tipo: fonte.tipo, escopo: fonte.escopo, setorSlug: fonte.setorSlug
      } : null;
      if (fonte.itemId) {
        const item = await graph.obterItem(fonte.itemId, driveId);
        if (!item?.file || !extensaoPermitida(item.name)) {
          throw new Error('O item configurado nao e um PDF, DOCX ou DOTX suportado.');
        }
        arquivos = [{ item, caminho: fonte.caminho || item.name, classificacao,
          titulo: fonte.titulo, sourceKey: fonte.key }];
      } else {
        const raizItemId = fonte.rootItemId
          || await resolverPastaPorCaminho(graph, driveId, fonte.rootPath);
        if (!raizItemId) throw new Error(`Pasta nao encontrada: ${fonte.rootPath}.`);
        arquivos = (await listarRecursivamente(graph, {
          driveId, itemId: raizItemId, classificacao
        })).map((arquivo) => ({ ...arquivo, sourceKey: fonte.key }));
      }
      for (const arquivo of arquivos) {
        if (!arquivosPorId.has(arquivo.item.id)) arquivosPorId.set(arquivo.item.id, arquivo);
      }
      estados.push({ key: fonte.key, status: 'concluido', encontrados: arquivos.length });
    } catch (erro) {
      estados.push({ key: fonte.key, status: 'erro', encontrados: 0 });
      erros.push({ codigo: String(erro.codigo || erro.code || erro.name || 'SOURCE_ERROR'),
        fonte: fonte.key, mensagem: String(erro.message || erro).slice(0, 300) });
    }
  }
  if (!estados.some((estado) => estado.status === 'concluido')) {
    const erro = new Error('Nenhuma fonte documental do Microsoft Graph pode ser consultada.');
    erro.codigo = 'KNOWLEDGE_SOURCES_UNAVAILABLE';
    erro.detalhes = erros;
    throw erro;
  }
  return { arquivos: [...arquivosPorId.values()], estados, erros };
}

function primeiroSegmento(caminho) {
  return String(caminho || '').replace(/\\/g, '/').split('/').filter(Boolean)[0]?.toLowerCase() || null;
}

async function removerDocumentosAusentes(opcoes = {}) {
  const { pool, servico, driveId, arquivos = [], fontes = [], estados = [] } = opcoes;
  if (!pool || !servico || !driveId) throw new Error('Reconciliacao de ausentes exige pool, servico e driveId.');
  const concluidas = new Set(estados.filter((item) => item.status === 'concluido').map((item) => item.key));
  const fontesRecursivas = new Set(fontes
    .filter((fonte) => (fonte.rootItemId || fonte.rootPath) && concluidas.has(fonte.key))
    .map((fonte) => fonte.key));
  const arquivosRecursivos = arquivos.filter((arquivo) => fontesRecursivas.has(arquivo.sourceKey));
  const prefixosAtivos = new Set(arquivosRecursivos.map((arquivo) => primeiroSegmento(arquivo.caminho)).filter(Boolean));
  if (!fontesRecursivas.size || !prefixosAtivos.size) {
    return { candidatos: 0, removidos: 0, protegidos: 0, falhas: [] };
  }
  const idsAtuais = new Set(arquivos.map((arquivo) => String(arquivo.item?.id || '')).filter(Boolean));
  const caminhosExatos = new Set(fontes.filter((fonte) => fonte.itemId).map((fonte) =>
    String(fonte.caminho || '').replace(/\\/g, '/').toLowerCase()).filter(Boolean));
  const registros = (await pool.query(`SELECT id,external_item_id,external_path
    FROM nexus.knowledge_documents
    WHERE origem='onedrive' AND external_drive_id=$1
      AND current_published_version_id IS NULL AND status IN ('rascunho','em_revisao')`, [driveId])).rows;
  const candidatos = registros.filter((documento) => {
    const caminho = String(documento.external_path || '').replace(/\\/g, '/').toLowerCase();
    return caminho && prefixosAtivos.has(primeiroSegmento(caminho)) &&
      !caminhosExatos.has(caminho) && !idsAtuais.has(String(documento.external_item_id || ''));
  });
  const resumo = { candidatos: candidatos.length, removidos: 0, protegidos: 0, falhas: [] };
  for (const documento of candidatos) {
    try {
      const resultado = await servico.removerRascunhoSincronizado(documento.id, {
        motivo: 'ausente_na_origem_onedrive'
      });
      if (resultado.removido) resumo.removidos += 1;
      else resumo.protegidos += 1;
      if (resultado.falhasArquivos?.length) resumo.falhas.push({
        codigo: 'LIMPEZA_STORAGE_PARCIAL', caminho: documento.external_path,
        arquivos: resultado.falhasArquivos.length
      });
    } catch (erro) {
      resumo.falhas.push({ codigo: String(erro.codigo || erro.code || erro.name || 'PRUNE_ERROR'),
        caminho: documento.external_path, mensagem: String(erro.message || erro).slice(0, 300) });
    }
  }
  return resumo;
}

async function sincronizarDocumentacaoOneDrive(opcoes = {}) {
  const { pool, principalId } = opcoes;
  if (!pool || !principalId) throw new Error('Sincronizacao documental exige pool e principalId.');
  const conexao = opcoes.conexao || resolverConexao(opcoes.conexaoId || 'fid_onedrive');
  const graph = opcoes.graph || criarClienteGraph(conexao);
  let driveId = opcoes.driveId || conexao.driveId;
  if (!driveId) driveId = (await graph.resolverDrive()).id;
  const fontes = lerFontesOneDrive(opcoes);
  const leitura = await listarArquivosFontesGraph(graph, { driveId, fontes });
  const arquivos = leitura.arquivos;
  const setores = new Map((await pool.query('SELECT id,slug FROM nexus.departments WHERE ativo=true')).rows
    .map((item) => [item.slug, item.id]));
  const servico = criarServicoDocumentacao({ pool, principalId, storage: opcoes.storage,
    embeddings: opcoes.embeddings });
  const resumo = { encontrados: arquivos.length, importados: 0, duplicados: 0, ignorados: 0,
    fontes: leitura.estados, erros: [...leitura.erros] };
  for (const arquivo of arquivos) {
    const classe = arquivo.classificacao;
    const departmentId = classe?.escopo === 'setor' ? setores.get(classe.setorSlug) : null;
    if (!classe || classe.escopo === 'setor' && !departmentId) {
      resumo.ignorados += 1;
      resumo.erros.push({ codigo: 'SETOR_NAO_MAPEADO', caminho: arquivo.caminho });
      continue;
    }
    try {
      const baixado = await baixarItemComRetry(graph, arquivo.item.id, driveId,
        Math.min(5, Math.max(1, Number(opcoes.downloadRetries || 3))));
      const resultado = await registrarImportacaoComRetry(servico, {
        buffer: baixado.buffer, nomeArquivo: arquivo.item.name,
        mediaType: arquivo.item.file?.mimeType || baixado.contentType,
        titulo: arquivo.titulo || arquivo.item.name.replace(/\.(pdf|docx|dotx)$/i, ''),
        tipo: classe.tipo, escopo: classe.escopo, departmentId,
        externalDriveId: driveId, externalItemId: arquivo.item.id,
        externalPath: arquivo.caminho, externalSourceKey: arquivo.sourceKey,
        preservarEscopoExistente: true,
        modificadoEm: arquivo.item.lastModifiedDateTime
      }, Math.min(5, Math.max(1, Number(opcoes.importRetries || 3))));
      if (resultado.duplicada) resumo.duplicados += 1;
      else resumo.importados += 1;
    } catch (erro) {
      resumo.erros.push({ codigo: String(erro.codigo || erro.code || erro.name || 'IMPORT_ERROR'),
        caminho: arquivo.caminho, mensagem: String(erro.message || erro).slice(0, 300) });
    }
  }
  const ausentes = await removerDocumentosAusentes({
    pool, servico, driveId, arquivos, fontes, estados: leitura.estados
  });
  resumo.ausentes = ausentes;
  resumo.erros.push(...ausentes.falhas);
  await pool.query(`INSERT INTO nexus.knowledge_sync_state
    (source_key,last_success_at,last_scan_at,status,erro_codigo,metadados)
    VALUES ('onedrive-conhecimento',now(),now(),$1,NULL,$2::jsonb)
    ON CONFLICT (source_key) DO UPDATE SET last_success_at=now(),last_scan_at=now(),status=EXCLUDED.status,
      erro_codigo=NULL,metadados=EXCLUDED.metadados`,
  [resumo.erros.length ? 'concluido_com_alertas' : 'concluido', JSON.stringify({
    encontrados: resumo.encontrados, importados: resumo.importados,
    duplicados: resumo.duplicados, ignorados: resumo.ignorados, erros: resumo.erros.length,
    fontes: resumo.fontes, ausentes: resumo.ausentes
  })]);
  return resumo;
}

async function importarDiretorioLocal(opcoes = {}) {
  const { pool, principalId } = opcoes;
  const raiz = path.resolve(opcoes.rootPath || process.env.NEXUS_KNOWLEDGE_LOCAL_IMPORT_ROOT || '');
  if (!pool || !principalId || !opcoes.rootPath && !process.env.NEXUS_KNOWLEDGE_LOCAL_IMPORT_ROOT) {
    throw new Error('Importacao local exige pool, principalId e NEXUS_KNOWLEDGE_LOCAL_IMPORT_ROOT.');
  }
  const setores = new Map((await pool.query('SELECT id,slug FROM nexus.departments WHERE ativo=true')).rows
    .map((item) => [item.slug, item.id]));
  const servico = criarServicoDocumentacao({ pool, principalId, storage: opcoes.storage,
    embeddings: opcoes.embeddings });
  const resumo = { encontrados: 0, importados: 0, duplicados: 0, ignorados: 0, erros: [] };
  async function percorrer(diretorio, classificacao = null) {
    const entradas = await fs.readdir(diretorio, { withFileTypes: true });
    for (const entrada of entradas) {
      const absoluto = path.join(diretorio, entrada.name);
      const classe = classificacao || (entrada.isDirectory() ? classificarPasta(entrada.name) : null);
      if (entrada.isDirectory()) await percorrer(absoluto, classe);
      else if (entrada.isFile() && extensaoPermitida(entrada.name)) {
        resumo.encontrados += 1;
        const departmentId = classe?.escopo === 'setor' ? setores.get(classe.setorSlug) : null;
        if (!classe || classe.escopo === 'setor' && !departmentId) {
          resumo.ignorados += 1;
          resumo.erros.push({ codigo: 'SETOR_NAO_MAPEADO', caminho: path.relative(raiz, absoluto) });
          continue;
        }
        try {
          const [buffer, stat] = await Promise.all([fs.readFile(absoluto), fs.stat(absoluto)]);
          const relativo = path.relative(raiz, absoluto).replace(/\\/g, '/');
          const resultado = await registrarImportacaoComRetry(servico, {
            buffer, nomeArquivo: entrada.name,
            titulo: entrada.name.replace(/\.(pdf|docx|dotx)$/i, ''),
            tipo: classe.tipo, escopo: classe.escopo, departmentId,
            externalDriveId: 'local-onedrive-sync',
            externalItemId: createHash('sha256').update(relativo.toLowerCase()).digest('hex'),
            externalPath: relativo, preservarEscopoExistente: true,
            modificadoEm: stat.mtime.toISOString()
          }, Math.min(5, Math.max(1, Number(opcoes.importRetries || 3))));
          if (resultado.duplicada) resumo.duplicados += 1;
          else resumo.importados += 1;
        } catch (erro) {
          resumo.erros.push({ codigo: String(erro.codigo || erro.code || erro.name || 'IMPORT_ERROR'),
            caminho: path.relative(raiz, absoluto), mensagem: String(erro.message || erro).slice(0, 300) });
        }
      }
    }
  }
  await percorrer(raiz);
  await pool.query(`INSERT INTO nexus.knowledge_sync_state
    (source_key,last_success_at,last_scan_at,status,erro_codigo,metadados)
    VALUES ('local-procedimentos',now(),now(),$1,NULL,$2::jsonb)
    ON CONFLICT (source_key) DO UPDATE SET last_success_at=now(),last_scan_at=now(),status=EXCLUDED.status,
      erro_codigo=NULL,metadados=EXCLUDED.metadados`,
  [resumo.erros.length ? 'concluido_com_alertas' : 'concluido', JSON.stringify({
    encontrados: resumo.encontrados, importados: resumo.importados,
    duplicados: resumo.duplicados, ignorados: resumo.ignorados, erros: resumo.erros.length
  })]);
  return resumo;
}

async function reconciliarOrigensDuplicadas(opcoes = {}) {
  const { pool, principalId } = opcoes;
  if (!pool || !principalId) throw new Error('Reconciliacao documental exige pool e principalId.');
  const documentos = (await pool.query(`SELECT d.* FROM nexus.knowledge_documents d
    JOIN (SELECT lower(external_path) AS caminho FROM nexus.knowledge_documents
      WHERE external_path IS NOT NULL GROUP BY lower(external_path) HAVING count(*)>1) repetidos
      ON lower(d.external_path)=repetidos.caminho
    ORDER BY lower(d.external_path),d.criado_em`)).rows;
  const grupos = new Map();
  for (const documento of documentos) {
    const chave = String(documento.external_path).toLowerCase();
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(documento);
  }
  const candidatos = [];
  for (const [caminho, itens] of grupos) {
    const destinos = itens.filter((item) => item.current_published_version_id);
    const origens = itens.filter((item) => !item.current_published_version_id
      && item.external_item_id && item.external_drive_id !== 'local-onedrive-sync');
    if (destinos.length !== 1 || origens.length !== 1 || destinos[0].tipo !== origens[0].tipo) continue;
    candidatos.push({ caminho, destino: destinos[0], origem: origens[0] });
  }
  if (opcoes.dryRun === true) return { encontrados: candidatos.length,
    consolidados: 0, candidatos: candidatos.map(({ caminho, destino, origem }) => ({
      caminho, destinoId: destino.id, origemId: origem.id,
      escopoPreservado: destino.escopo
    })) };
  const consolidados = [];
  for (const candidato of candidatos) {
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      const bloqueados = (await cliente.query(`SELECT * FROM nexus.knowledge_documents
        WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [[candidato.destino.id, candidato.origem.id]])).rows;
      const destino = bloqueados.find((item) => item.id === candidato.destino.id);
      const origem = bloqueados.find((item) => item.id === candidato.origem.id);
      if (!destino?.current_published_version_id || origem?.current_published_version_id) {
        throw new Error('O estado dos documentos mudou durante a reconciliacao.');
      }
      let proximoNumero = Number((await cliente.query(`SELECT COALESCE(MAX(numero),0)::integer AS numero
        FROM nexus.knowledge_document_versions WHERE document_id=$1`, [destino.id])).rows[0].numero) + 1;
      const versoes = (await cliente.query(`SELECT id FROM nexus.knowledge_document_versions
        WHERE document_id=$1 ORDER BY numero`, [origem.id])).rows;
      for (const versao of versoes) {
        await cliente.query(`UPDATE nexus.knowledge_document_versions SET document_id=$2,numero=$3
          WHERE id=$1`, [versao.id, destino.id, proximoNumero++]);
      }
      await cliente.query(`UPDATE nexus.knowledge_documents SET external_drive_id=$2,
        external_item_id=$3,external_path=$4,atualizado_em=now() WHERE id=$1`,
      [destino.id, origem.external_drive_id, origem.external_item_id, origem.external_path]);
      await cliente.query('DELETE FROM nexus.knowledge_documents WHERE id=$1', [origem.id]);
      await cliente.query(`INSERT INTO nexus.audit_events
        (principal_id,tipo,recurso,resultado,metadados) VALUES
        ($1,'documentacao_origem_consolidada',$2,'sucesso',$3::jsonb)`,
      [principalId, destino.id, JSON.stringify({ origem_documento_id: origem.id,
        caminho: candidato.caminho, versoes_movidas: versoes.length,
        escopo_preservado: destino.escopo, department_id: destino.department_id })]);
      await cliente.query('COMMIT');
      consolidados.push({ caminho: candidato.caminho, destinoId: destino.id,
        origemId: origem.id, versoesMovidas: versoes.length, escopoPreservado: destino.escopo });
    } catch (erro) {
      await cliente.query('ROLLBACK').catch(() => {});
      throw erro;
    } finally { cliente.release(); }
  }
  return { encontrados: candidatos.length, consolidados: consolidados.length, candidatos: consolidados };
}

module.exports = { classificarPasta, extensaoPermitida, importarDiretorioLocal,
  baixarItemComRetry, lerFontesOneDrive, listarArquivosFontesGraph, listarRecursivamente, normalizarNome,
  reconciliarOrigensDuplicadas, registrarImportacaoComRetry, removerDocumentosAusentes,
  sincronizarDocumentacaoOneDrive };
