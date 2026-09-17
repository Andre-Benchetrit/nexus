const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function raizArtefatos(valor = process.env.NEXUS_ARTIFACTS_ROOT) {
  return path.resolve(valor || path.join(process.cwd(), '.runtime', 'artifacts'));
}

function chaveSegura(chave) {
  const valor = String(chave || '');
  if (!/^[a-f0-9-]{36}\.(?:xlsx|docx|pdf)$/i.test(valor)) throw new Error('Chave de artefato inválida.');
  return valor;
}

function criarArtifactStorage(opcoes = {}) {
  if (opcoes.storage) return opcoes.storage;
  const raiz = raizArtefatos(opcoes.root);
  async function garantirRaiz() { await fs.mkdir(raiz, { recursive: true }); }
  async function salvar({ buffer, extensao }) {
    const ext = String(extensao || '').replace(/^\./, '').toLowerCase();
    if (!['xlsx', 'docx', 'pdf'].includes(ext)) throw new Error('Formato de artefato inválido.');
    await garantirRaiz();
    const chave = `${randomUUID()}.${ext}`;
    const destino = path.join(raiz, chave); const temporario = `${destino}.${randomUUID()}.tmp`;
    await fs.writeFile(temporario, buffer, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporario, destino);
    return { chave, bytes: buffer.length };
  }
  async function salvarArquivo({ caminho, extensao }) {
    const ext = String(extensao || '').replace(/^\./, '').toLowerCase();
    if (!['xlsx', 'docx', 'pdf'].includes(ext)) throw new Error('Formato de artefato inválido.');
    await garantirRaiz();
    const chave = `${randomUUID()}.${ext}`;
    const destino = path.join(raiz, chave); const temporario = `${destino}.${randomUUID()}.tmp`;
    await fs.copyFile(path.resolve(caminho), temporario, constants.COPYFILE_EXCL);
    await fs.rename(temporario, destino);
    const stat = await fs.stat(destino);
    return { chave, bytes: stat.size };
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
  return { tipo: 'filesystem', raiz, salvar, salvarArquivo, abrir, excluir, verificarSaude };
}

module.exports = { criarArtifactStorage, raizArtefatos };
