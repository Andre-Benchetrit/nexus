const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function raizAnexos(valor) {
  return path.resolve(valor || process.env.NEXUS_FILES_ROOT || process.env.NEXUS_ATTACHMENTS_ROOT ||
    path.join(process.cwd(), '.runtime', 'files'));
}

function chaveSegura(chave) {
  const valor = String(chave || '');
  if (!/^[a-f0-9-]{36}\.(?:png|jpe?g|webp|pdf|docx|xlsx?|json|parquet)$/i.test(valor)) {
    throw new Error('Chave de anexo inválida.');
  }
  return valor;
}

function criarFileSystemAttachmentStorage(opcoes = {}) {
  const raiz = raizAnexos(opcoes.root);
  async function garantirRaiz() { await fs.mkdir(raiz, { recursive: true }); }
  async function salvar({ buffer, extensao }) {
    await garantirRaiz();
    const ext = String(extensao || '').replace(/^\./, '').toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'webp', 'pdf', 'docx', 'xls', 'xlsx', 'json', 'parquet'].includes(ext)) {
      throw new Error('Extensão de anexo inválida.');
    }
    const chave = `${randomUUID()}.${ext === 'jpeg' ? 'jpg' : ext}`;
    const destino = path.join(raiz, chave);
    const temporario = `${destino}.${randomUUID()}.tmp`;
    await fs.writeFile(temporario, buffer, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporario, destino);
    return { chave, bytes: buffer.length };
  }
  const salvarSanitizado = salvar;
  async function reservar(extensao = 'parquet') {
    await garantirRaiz();
    const ext = String(extensao || '').replace(/^\./, '').toLowerCase();
    if (ext !== 'parquet') throw new Error('Reserva de derivado inválida.');
    const chave = `${randomUUID()}.${ext}`;
    const destino = path.join(raiz, chave);
    return { chave, caminho: destino, temporario: `${destino}.${randomUUID()}.tmp` };
  }
  async function confirmar(reserva) {
    if (!reserva?.chave || !reserva?.temporario) throw new Error('Reserva de derivado inválida.');
    const destino = path.join(raiz, chaveSegura(reserva.chave));
    await fs.rename(reserva.temporario, destino);
    const stat = await fs.stat(destino);
    return { chave: reserva.chave, bytes: stat.size };
  }
  async function descartarReserva(reserva) {
    if (!reserva?.temporario) return;
    try { await fs.unlink(reserva.temporario); } catch (erro) { if (erro.code !== 'ENOENT') throw erro; }
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
  return { tipo: 'filesystem', raiz, salvar, salvarSanitizado, reservar, confirmar,
    descartarReserva, abrir, excluir, verificarSaude };
}

function criarAttachmentStorage(opcoes = {}) {
  if (opcoes.storage) return opcoes.storage;
  const tipo = String(opcoes.tipo || process.env.NEXUS_ATTACHMENT_STORAGE || 'filesystem').toLowerCase();
  if (tipo === 'filesystem') return criarFileSystemAttachmentStorage(opcoes);
  throw new Error(`Armazenamento de anexos não suportado: ${tipo}.`);
}

module.exports = { criarAttachmentStorage, criarFileSystemAttachmentStorage, raizAnexos };
