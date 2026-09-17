const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function raizDatasets(valor = process.env.NEXUS_DATASETS_ROOT) {
  return path.resolve(valor || path.join(process.cwd(), '.runtime', 'datasets'));
}

function chaveSegura(chave) {
  const valor = String(chave || '');
  if (!/^[a-f0-9-]{36}\.parquet$/i.test(valor)) throw new Error('Chave de dataset inválida.');
  return valor;
}

function criarDatasetStorage(opcoes = {}) {
  if (opcoes.storage) return opcoes.storage;
  const raiz = raizDatasets(opcoes.root);
  async function garantirRaiz() { await fs.mkdir(raiz, { recursive: true }); }
  function caminho(chave) { return path.join(raiz, chaveSegura(chave)); }
  async function reservar() {
    await garantirRaiz();
    const chave = `${randomUUID()}.parquet`;
    return { chave, caminho: caminho(chave), temporario: `${caminho(chave)}.${randomUUID()}.tmp` };
  }
  async function confirmar(reserva) {
    if (!reserva?.chave || !reserva?.temporario) throw new Error('Reserva de dataset inválida.');
    await fs.rename(reserva.temporario, caminho(reserva.chave));
    const stat = await fs.stat(caminho(reserva.chave));
    return { chave: reserva.chave, bytes: stat.size };
  }
  async function abrirCaminho(chave) {
    const destino = caminho(chave);
    await fs.access(destino);
    return destino;
  }
  async function excluir(chave) {
    try { await fs.unlink(caminho(chave)); return true; }
    catch (erro) { if (erro.code === 'ENOENT') return true; throw erro; }
  }
  async function descartarReserva(reserva) {
    if (!reserva?.temporario) return;
    try { await fs.unlink(reserva.temporario); } catch (erro) { if (erro.code !== 'ENOENT') throw erro; }
  }
  async function verificarSaude() {
    try { await garantirRaiz(); await fs.access(raiz); return { saudavel: true, tipo: 'filesystem', raiz }; }
    catch (erro) { return { saudavel: false, tipo: 'filesystem', erro: erro.code || erro.name }; }
  }
  return { tipo: 'filesystem', raiz, abrirCaminho, confirmar, descartarReserva, excluir,
    reservar, verificarSaude };
}

module.exports = { criarDatasetStorage, raizDatasets };
