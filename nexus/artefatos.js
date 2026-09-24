const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { carregarMarca, construirArtefato } = require('./artifact_builder');
const { construirXlsxDataset } = require('./dataset_artifact_builder');

class ErroArtefatoServico extends Error {
  constructor(codigo, mensagem, status = 400) {
    super(mensagem); this.name = 'ErroArtefatoServico'; this.codigo = codigo; this.status = status;
  }
}

function nomeArquivo(titulo, formato) {
  const base = String(titulo || 'arquivo-nexus').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]+/g, '').trim().replace(/\s+/g, '-').slice(0, 120) || 'arquivo-nexus';
  return `${base}.${formato}`;
}

function sha256Arquivo(caminho) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(caminho);
    stream.on('error', reject); stream.on('data', (bloco) => hash.update(bloco));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function linhagemSegura(itens = []) {
  return (Array.isArray(itens) ? itens : []).slice(0, 20).map((item) => ({
    type: ['analysis_ref', 'result_ref', 'dataset_ref'].includes(String(item?.type))
      ? String(item.type) : 'reference',
    id: String(item?.id || '').slice(0, 100)
  })).filter((item) => item.id);
}

function criarServicoArtefatos({ pool, storage, principalId, departmentId = null, brand = null }) {
  if (!pool || !storage || !principalId) throw new Error('Pool, storage e principal são obrigatórios.');
  async function conversaAutorizada(conversationId) {
    const item = (await pool.query(`SELECT id FROM nexus.conversations
      WHERE id=$1 AND principal_id=$2 AND arquivada_em IS NULL`, [conversationId, principalId])).rows[0];
    if (!item) throw new ErroArtefatoServico('CONVERSA_NAO_ENCONTRADA', 'Conversa não encontrada.', 404);
    return item;
  }
  async function gerar(conversationId, turnId, spec, opcoes = {}) {
    await conversaAutorizada(conversationId);
    const modo = String(opcoes.mode || process.env.NEXUS_ARTIFACTS_MODE || 'off').toLowerCase();
    if (modo === 'off') throw new ErroArtefatoServico('ARTIFACTS_DISABLED', 'A geração de arquivos está desativada.', 503);
    const construido = await construirArtefato(spec, { brand: brand || opcoes.brand, logo: opcoes.logo });
    if (modo === 'shadow') return { shadow: true, formato: construido.spec.formato, validacao: construido.validacao };
    const salvo = await storage.salvar({ buffer: construido.buffer, extensao: construido.spec.formato });
    try {
      const item = (await pool.query(`INSERT INTO nexus.conversation_artifacts
        (conversation_id,principal_id,turn_id,department_id,format,media_type,file_name,title,
         storage_key,sha256,bytes,classification,safe_metadata,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,'ready')
        RETURNING id,format,media_type,file_name,title,bytes,classification,status,criado_em`,
      [conversationId, principalId, turnId || null, opcoes.departmentId || departmentId,
        construido.spec.formato, construido.mediaType, nomeArquivo(construido.spec.titulo, construido.spec.formato),
        construido.spec.titulo, salvo.chave, crypto.createHash('sha256').update(construido.buffer).digest('hex'),
        construido.buffer.length, opcoes.classification || 'conversa_privada',
        JSON.stringify({ validacao: construido.validacao, modelo: construido.spec.modelo,
          lineage: linhagemSegura(opcoes.lineage) })])).rows[0];
      return { id: item.id, format: item.format, mediaType: item.media_type,
        name: item.file_name, title: item.title, bytes: Number(item.bytes),
        classification: item.classification, status: item.status, createdAt: item.criado_em,
        url: `/v1/conversations/${conversationId}/artifacts/${item.id}`, validacao: construido.validacao };
    } catch (erro) { await storage.excluir(salvo.chave).catch(() => null); throw erro; }
  }
  async function gerarDeDataset(conversationId, turnId, spec, opcoes = {}) {
    await conversaAutorizada(conversationId);
    const datasets = opcoes.servicoDatasets;
    if (!datasets) throw new ErroArtefatoServico('DATASET_SERVICE_UNAVAILABLE',
      'O serviço de resultados não está disponível.', 503);
    const modo = String(opcoes.mode || process.env.NEXUS_ARTIFACTS_MODE || 'off').toLowerCase();
    if (modo === 'off') throw new ErroArtefatoServico('ARTIFACTS_DISABLED', 'A geração de arquivos está desativada.', 503);
    const aberto = await datasets.abrirCaminho(conversationId, spec.result_ref);
    const disponiveis = aberto.descriptor.colunas || [];
    const solicitadas = Array.isArray(spec.colunas) && spec.colunas.length ? spec.colunas : disponiveis.map((x) => x.nome);
    const colunas = solicitadas.map((nome) => disponiveis.find((x) => x.nome === nome)).filter(Boolean);
    if (!colunas.length) throw new ErroArtefatoServico('ARTIFACT_COLUMNS_INVALID',
      'Nenhuma coluna autorizada foi selecionada.');
    const formato = String(spec.formato || 'xlsx').toLowerCase();
    const titulo = String(spec.titulo || 'Resultado Nexus').slice(0, 180);
    const limiteTemplateCompleto = 5_000;
    const usaTemplateCompleto = formato !== 'xlsx' ||
      aberto.descriptor.quantidadeLinhas <= limiteTemplateCompleto;
    if (usaTemplateCompleto) {
      const limiteLeitura = formato === 'xlsx'
        ? Math.max(1, aberto.descriptor.quantidadeLinhas) : 500;
      const lido = await datasets.lerLinhas(conversationId, spec.result_ref, limiteLeitura);
      const linhas = lido.linhas.map((linha) => colunas.map(({ nome }) => linha[nome]));
      return gerar(conversationId, turnId, {
        formato, titulo, modelo: 'relatorio', identidadeVisual: spec.identidadeVisual !== false,
        secoes: [{ titulo: 'Resumo',
          conteudo: formato !== 'xlsx' && aberto.descriptor.quantidadeLinhas > 500
            ? `O conjunto possui ${aberto.descriptor.quantidadeLinhas} linhas. Este formato apresenta as primeiras 500; use XLSX para a versão integral.`
            : `Conjunto com ${aberto.descriptor.quantidadeLinhas} linhas.`, itens: [] }],
        tabelas: [{ titulo: 'Dados', colunas: colunas.map((x) => x.rotulo || x.nome), linhas }],
        graficos: [], fontes: ['Dados corporativos autorizados do Sysemp']
      }, { ...opcoes, classification: aberto.descriptor.classificacao || 'dados_nexus' });
    }
    const construido = await construirXlsxDataset({ caminhoDataset: aberto.caminho,
      titulo, colunas, quantidadeLinhas: aberto.descriptor.quantidadeLinhas,
      marca: carregarMarca({ brand: brand || opcoes.brand, logo: opcoes.logo }) });
    if (modo === 'shadow') {
      await fs.unlink(construido.caminho).catch(() => null);
      return { shadow: true, formato: 'xlsx', validacao: construido.validacao };
    }
    let salvo = null;
    try {
      salvo = storage.salvarArquivo
        ? await storage.salvarArquivo({ caminho: construido.caminho, extensao: 'xlsx' })
        : await storage.salvar({ buffer: await fs.readFile(construido.caminho), extensao: 'xlsx' });
      const hash = await sha256Arquivo(construido.caminho);
      const item = (await pool.query(`INSERT INTO nexus.conversation_artifacts
        (conversation_id,principal_id,turn_id,department_id,format,media_type,file_name,title,
         storage_key,sha256,bytes,classification,safe_metadata,status)
        VALUES ($1,$2,$3,$4,'xlsx',$5,$6,$7,$8,$9,$10,$11,$12::jsonb,'ready')
        RETURNING id,format,media_type,file_name,title,bytes,classification,status,criado_em`,
      [conversationId, principalId, turnId || null, opcoes.departmentId || departmentId,
        construido.mediaType, nomeArquivo(titulo, 'xlsx'), titulo, salvo.chave, hash,
        salvo.bytes || construido.bytes, aberto.descriptor.classificacao || 'dados_nexus',
        JSON.stringify({ validacao: construido.validacao, modelo: 'dados', result_ref: spec.result_ref })])).rows[0];
      return { id: item.id, format: item.format, mediaType: item.media_type,
        name: item.file_name, title: item.title, bytes: Number(item.bytes),
        classification: item.classification, status: item.status, createdAt: item.criado_em,
        url: `/v1/conversations/${conversationId}/artifacts/${item.id}`, validacao: construido.validacao };
    } catch (erro) {
      if (salvo?.chave) await storage.excluir(salvo.chave).catch(() => null);
      throw erro;
    } finally { await fs.unlink(construido.caminho).catch(() => null); }
  }
  async function obter(conversationId, artifactId) {
    await conversaAutorizada(conversationId);
    const item = (await pool.query(`SELECT * FROM nexus.conversation_artifacts
      WHERE id=$1 AND conversation_id=$2 AND principal_id=$3 AND status='ready'`,
    [artifactId, conversationId, principalId])).rows[0];
    if (!item) throw new ErroArtefatoServico('ARTEFATO_NAO_ENCONTRADO', 'Arquivo gerado não encontrado.', 404);
    return item;
  }
  async function abrir(conversationId, artifactId) {
    const item = await obter(conversationId, artifactId); return { item, buffer: await storage.abrir(item.storage_key) };
  }
  async function excluir(conversationId, artifactId) {
    const item = await obter(conversationId, artifactId);
    try { await storage.excluir(item.storage_key); await pool.query('DELETE FROM nexus.conversation_artifacts WHERE id=$1', [item.id]); return { deleted: true }; }
    catch (erro) {
      const codigo = erro.code || erro.name || 'STORAGE_DELETE_ERROR';
      await pool.query(`UPDATE nexus.conversation_artifacts SET status='deleting',error_code=$2,atualizado_em=now() WHERE id=$1`, [item.id, codigo]);
      await pool.query('INSERT INTO nexus.artifact_cleanup_jobs(storage_key,last_error_code) VALUES ($1,$2)', [item.storage_key, codigo]);
      throw new ErroArtefatoServico('ARTEFATO_EXCLUSAO_PENDENTE', 'O arquivo foi marcado para exclusão.', 503);
    }
  }
  async function listarPorTurno(turnId) {
    if (!turnId) return [];
    return (await pool.query(`SELECT id,format,media_type,file_name,title,bytes,classification,status,criado_em
      FROM nexus.conversation_artifacts WHERE turn_id=$1 AND principal_id=$2 AND status='ready'
      ORDER BY criado_em,id`, [turnId, principalId])).rows;
  }
  async function chavesDaConversa(conversationId) {
    await conversaAutorizada(conversationId);
    return (await pool.query(`SELECT storage_key FROM nexus.conversation_artifacts
      WHERE conversation_id=$1 AND principal_id=$2`, [conversationId, principalId])).rows.map((x) => x.storage_key);
  }
  async function excluirChaves(chaves = []) {
    for (const chave of chaves) {
      try { await storage.excluir(chave); }
      catch (erro) { await pool.query('INSERT INTO nexus.artifact_cleanup_jobs(storage_key,last_error_code) VALUES ($1,$2)', [chave, erro.code || erro.name || 'STORAGE_DELETE_ERROR']); }
    }
  }
  async function finalizarExclusaoConversa(conversationId, chaves = []) {
    await excluirChaves(chaves);
    await pool.query(`DELETE FROM nexus.conversation_artifacts
      WHERE conversation_id=$1 AND principal_id=$2`, [conversationId, principalId]);
  }
  return { abrir, chavesDaConversa, excluir, excluirChaves, finalizarExclusaoConversa,
    gerar, gerarDeDataset, listarPorTurno, obter };
}

async function processarFilaLimpezaArtefatos({ pool, storage, limite = 20 }) {
  const jobs = (await pool.query(`SELECT id,storage_key,attempts FROM nexus.artifact_cleanup_jobs
    WHERE concluida_em IS NULL AND proxima_tentativa_em<=now() ORDER BY criado_em LIMIT $1`,
  [Math.min(100, Math.max(1, Number(limite)))])).rows;
  for (const job of jobs) {
    try { await storage.excluir(job.storage_key); await pool.query('UPDATE nexus.artifact_cleanup_jobs SET concluida_em=now() WHERE id=$1', [job.id]); }
    catch (erro) { const attempts = Number(job.attempts || 0) + 1; await pool.query(`UPDATE nexus.artifact_cleanup_jobs SET attempts=$2,last_error_code=$3,
      proxima_tentativa_em=now() + make_interval(secs => LEAST(3600, POWER(2,$2)::int * 30)) WHERE id=$1`,
    [job.id, attempts, erro.code || erro.name || 'STORAGE_DELETE_ERROR']); }
  }
  return { processados: jobs.length };
}

module.exports = { ErroArtefatoServico, criarServicoArtefatos, nomeArquivo, processarFilaLimpezaArtefatos };
