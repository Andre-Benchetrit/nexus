const { sanitizarImagem } = require('../agentes/image_processing');

class ErroAnexo extends Error {
  constructor(codigo, mensagem, status = 400) {
    super(mensagem); this.name = 'ErroAnexo'; this.codigo = codigo; this.status = status;
  }
}

function criarServicoAnexos({ pool, storage, principalId }) {
  if (!pool || !storage || !principalId) throw new Error('Pool, storage e principal são obrigatórios.');

  async function conversaAutorizada(conversationId) {
    const conversa = (await pool.query(`
      SELECT id FROM nexus.conversations WHERE id=$1 AND principal_id=$2 AND arquivada_em IS NULL
    `, [conversationId, principalId])).rows[0];
    if (!conversa) throw new ErroAnexo('CONVERSA_NAO_ENCONTRADA', 'Conversa não encontrada.', 404);
    return conversa;
  }

  async function salvar(conversationId, buffer) {
    await conversaAutorizada(conversationId);
    const imagem = await sanitizarImagem(buffer);
    const arquivo = await storage.salvarSanitizado({ buffer: imagem.buffer, extensao: imagem.extensao });
    try {
      return (await pool.query(`
        INSERT INTO nexus.conversation_attachments
          (conversation_id,principal_id,media_type,storage_key,sha256,bytes,width,height,safe_metadata,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'ready')
        RETURNING id,media_type,bytes,width,height,status,criado_em
      `, [conversationId, principalId, imagem.mime, arquivo.chave, imagem.sha256,
        imagem.buffer.length, imagem.metadados.largura, imagem.metadados.altura,
        JSON.stringify(imagem.metadados)])).rows[0];
    } catch (erro) {
      await storage.excluir(arquivo.chave).catch(() => null);
      throw erro;
    }
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
    return { item, buffer: await storage.abrir(item.storage_key) };
  }

  async function resolverParaTurno(conversationId, ids = []) {
    const unicos = [...new Set((ids || []).map(String))];
    const maximo = Number(process.env.NEXUS_IMAGE_MAX_FILES || 4);
    if (unicos.length > maximo) throw new ErroAnexo('ANEXOS_LIMITE', `Envie no máximo ${maximo} imagens por turno.`);
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
      await storage.excluir(item.storage_key);
      await pool.query('DELETE FROM nexus.conversation_attachments WHERE id=$1', [item.id]);
      return { deleted: true };
    } catch (erro) {
      await pool.query(`UPDATE nexus.conversation_attachments SET status='deleting',error_code=$2,atualizado_em=now() WHERE id=$1`,
        [item.id, erro.code || erro.name || 'STORAGE_DELETE_ERROR']);
      await pool.query(`INSERT INTO nexus.attachment_cleanup_jobs(storage_key,last_error_code)
        VALUES ($1,$2)`, [item.storage_key, erro.code || erro.name || 'STORAGE_DELETE_ERROR']);
      throw new ErroAnexo('ANEXO_EXCLUSAO_PENDENTE', 'O anexo foi marcado para exclusão.', 503);
    }
  }

  async function chavesDaConversa(conversationId) {
    await conversaAutorizada(conversationId);
    return (await pool.query(`SELECT storage_key FROM nexus.conversation_attachments
      WHERE conversation_id=$1 AND principal_id=$2`, [conversationId, principalId])).rows.map((x) => x.storage_key);
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
  }

  return { abrir, chavesDaConversa, excluir, excluirChaves, finalizarExclusaoConversa,
    obter, resolverParaTurno, salvar, vincularTurno };
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
