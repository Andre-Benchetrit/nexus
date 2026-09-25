const fs = require('node:fs/promises');
const path = require('node:path');
const { criarLakeStorage } = require('./lake_storage');

async function criarWorkspaceLake(opcoes = {}, rotulo = 'pipeline') {
  const storage = opcoes.lakeStorage || criarLakeStorage({
    raizLake: opcoes.raizLake,
    env: opcoes.env
  });
  if (storage.tipo === 'filesystem') {
    return { storage, raiz: storage.raizLake, temporario: false };
  }
  await fs.mkdir(storage.raizTemporaria, { recursive: true });
  const nome = String(rotulo || 'pipeline').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60);
  const raiz = await fs.mkdtemp(path.join(storage.raizTemporaria, `${nome}-`));
  return { storage, raiz, temporario: true };
}

function prefixoRelativoWorkspace(workspace, diretorio) {
  const relativo = path.relative(workspace.raiz, diretorio).replace(/\\/g, '/');
  if (!relativo || relativo.startsWith('..') || path.isAbsolute(relativo)) {
    throw new Error('Diretorio de publicacao fora do workspace do lake.');
  }
  return relativo;
}

async function limparWorkspaceLake(workspace, dependencias = {}) {
  if (!workspace?.temporario || !workspace.raiz) return true;
  const remover = dependencias.remover || ((caminho) => fs.rm(caminho, { recursive: true, force: true }));
  const aguardar = dependencias.aguardar || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const tentativas = dependencias.tentativas || 6;
  for (let tentativa = 0; tentativa < tentativas; tentativa += 1) {
    try {
      await remover(workspace.raiz);
      return true;
    } catch (erro) {
      if (erro.code === 'ENOENT') return true;
      if (!['EBUSY', 'EPERM'].includes(erro.code)) throw erro;
      if (tentativa < tentativas - 1) await aguardar(100 * (tentativa + 1));
    }
  }
  // O snapshot ja foi publicado antes desta limpeza. Um arquivo temporario
  // preso pelo SO nao pode reclassificar uma publicacao valida como falha.
  return false;
}

module.exports = { criarWorkspaceLake, limparWorkspaceLake, prefixoRelativoWorkspace };
