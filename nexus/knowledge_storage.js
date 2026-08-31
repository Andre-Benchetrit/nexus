const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function resolverRaizConhecimento(opcoes = {}) {
  return path.resolve(
    opcoes.root || opcoes.env?.NEXUS_KNOWLEDGE_ROOT ||
    process.env.NEXUS_KNOWLEDGE_ROOT ||
    path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(process.cwd(), '.runtime'), 'knowledge')
  );
}

function extensaoSegura(valor) {
  const extensao = String(valor || '').replace(/^\./, '').toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(extensao)) throw new Error('Extensao documental invalida.');
  return extensao;
}

function chaveSegura(chave) {
  const valor = String(chave || '').replace(/\\/g, '/');
  if (!/^(sources|published|pages)\/[a-f0-9-]{36}\/[a-f0-9-]{36}(?:\/\d{1,6})?\.[a-z0-9]{1,8}$/i.test(valor)) {
    throw new Error('Chave de conhecimento invalida.');
  }
  return valor;
}

function caminhoSeguro(raiz, chave) {
  const destino = path.resolve(raiz, ...chaveSegura(chave).split('/'));
  const relativo = path.relative(raiz, destino);
  if (relativo.startsWith('..') || path.isAbsolute(relativo)) {
    throw new Error('Caminho fora da raiz autorizada de conhecimento.');
  }
  return destino;
}

function criarFileSystemKnowledgeStorage(opcoes = {}) {
  const raiz = resolverRaizConhecimento(opcoes);

  async function salvar({ buffer, categoria = 'sources', documentId, versionId, extensao, pagina }) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Conteudo documental vazio.');
    if (!['sources', 'published', 'pages'].includes(categoria)) throw new Error('Categoria documental invalida.');
    const sufixo = categoria === 'pages' ? `/${Number(pagina)}` : '';
    const chave = `${categoria}/${documentId}/${versionId}${sufixo}.${extensaoSegura(extensao)}`;
    const destino = caminhoSeguro(raiz, chave);
    const temporario = `${destino}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.writeFile(temporario, buffer, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporario, destino);
    return { chave, bytes: buffer.length };
  }

  async function abrir(chave) {
    return fs.readFile(caminhoSeguro(raiz, chave));
  }

  async function excluir(chave) {
    try {
      await fs.unlink(caminhoSeguro(raiz, chave));
      return true;
    } catch (erro) {
      if (erro.code === 'ENOENT') return true;
      throw erro;
    }
  }

  async function verificarSaude() {
    try {
      await fs.mkdir(raiz, { recursive: true });
      await fs.access(raiz);
      return { saudavel: true, tipo: 'filesystem', raiz };
    } catch (erro) {
      return { saudavel: false, tipo: 'filesystem', codigo: erro.code || erro.name };
    }
  }

  return Object.freeze({ tipo: 'filesystem', raiz, salvar, abrir, excluir, verificarSaude });
}

function criarKnowledgeStorage(opcoes = {}) {
  if (opcoes.storage) return opcoes.storage;
  const tipo = String(opcoes.tipo || process.env.NEXUS_KNOWLEDGE_STORAGE || 'filesystem').toLowerCase();
  if (tipo === 'filesystem') return criarFileSystemKnowledgeStorage(opcoes);
  throw new Error(`KnowledgeAssetStorage nao implementado: ${tipo}.`);
}

module.exports = {
  chaveSegura,
  criarFileSystemKnowledgeStorage,
  criarKnowledgeStorage,
  resolverRaizConhecimento
};
