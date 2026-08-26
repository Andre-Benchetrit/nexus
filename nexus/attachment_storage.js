const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function raizAnexos(valor = process.env.NEXUS_ATTACHMENTS_ROOT) {
  return path.resolve(valor || path.join(process.cwd(), '.runtime', 'attachments'));
}

function chaveSegura(chave) {
  const valor = String(chave || '');
  if (!/^[a-f0-9-]{36}\.(?:png|jpe?g|webp)$/i.test(valor)) throw new Error('Chave de anexo inválida.');
  return valor;
}

function criarFileSystemAttachmentStorage(opcoes = {}) {
  const raiz = raizAnexos(opcoes.root);
  async function garantirRaiz() { await fs.mkdir(raiz, { recursive: true }); }
  async function salvarSanitizado({ buffer, extensao }) {
    await garantirRaiz();
    const ext = String(extensao || '').replace(/^\./, '').toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) throw new Error('Extensão de anexo inválida.');
    const chave = `${randomUUID()}.${ext === 'jpeg' ? 'jpg' : ext}`;
    const destino = path.join(raiz, chave);
    const temporario = `${destino}.${randomUUID()}.tmp`;
    await fs.writeFile(temporario, buffer, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporario, destino);
    return { chave, bytes: buffer.length };
  }
  async function abrir(chave) { return fs.readFile(path.join(raiz, chaveSegura(chave))); }
  async function excluir(chave) {
    try { await fs.unlink(path.join(raiz, chaveSegura(chave))); return true; }
    catch (erro) { if (erro.code === 'ENOENT') return true; throw erro; }
  }
  async function verificarSaude() {
    try { await garantirRaiz(); await fs.access(raiz); return { saudavel: true, tipo: 'filesystem', raiz }; }
    catch (erro) { return { saudavel: false, tipo: 'filesystem', erro: erro.code || erro.name }; }
  }
  return { tipo: 'filesystem', raiz, salvarSanitizado, abrir, excluir, verificarSaude };
}

function criarAttachmentStorage(opcoes = {}) {
  if (opcoes.storage) return opcoes.storage;
  const tipo = String(opcoes.tipo || process.env.NEXUS_ATTACHMENT_STORAGE || 'filesystem').toLowerCase();
  if (tipo === 'filesystem') return criarFileSystemAttachmentStorage(opcoes);
  throw new Error(`Armazenamento de anexos não suportado: ${tipo}.`);
}

module.exports = { criarAttachmentStorage, criarFileSystemAttachmentStorage, raizAnexos };
