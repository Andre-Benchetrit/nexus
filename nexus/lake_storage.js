const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const RAIZ_LAKE_LOCAL = path.resolve(__dirname, '..', 'lake');

function resolverRaizLake(opcoes = {}) {
  return path.resolve(
    opcoes.raizLake ||
    opcoes.env?.NEXUS_LAKE_ROOT ||
    process.env.NEXUS_LAKE_ROOT ||
    process.env.RAILWAY_VOLUME_MOUNT_PATH ||
    RAIZ_LAKE_LOCAL
  );
}

function caminhoSeguro(raiz, ...partes) {
  const destino = path.resolve(raiz, ...partes);
  const relativo = path.relative(path.resolve(raiz), destino);
  if (relativo.startsWith('..') || path.isAbsolute(relativo)) {
    throw new Error('Caminho fora da raiz autorizada do lake.');
  }
  return destino;
}

async function listarArquivos(diretorio, nomeArquivo) {
  let entradas;
  try {
    entradas = await fs.readdir(diretorio, { withFileTypes: true });
  } catch (erro) {
    if (erro.code === 'ENOENT') return [];
    throw erro;
  }
  const arquivos = [];
  for (const entrada of entradas) {
    const atual = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) arquivos.push(...await listarArquivos(atual, nomeArquivo));
    else if (entrada.isFile() && entrada.name === nomeArquivo) arquivos.push(atual);
  }
  return arquivos;
}

function criarFileSystemLakeStorage(opcoes = {}) {
  const raizLake = resolverRaizLake(opcoes);

  async function lerManifesto(_camada, _objeto, referencia) {
    const bruto = typeof referencia === 'string' ? referencia : referencia?.caminhoManifesto;
    if (!bruto) throw new Error('Informe a referencia do manifesto.');
    const caminho = caminhoSeguro(raizLake, path.relative(raizLake, path.resolve(bruto)));
    return JSON.parse(await fs.readFile(caminho, 'utf8'));
  }

  async function listarVersoes(camada, objeto) {
    if (!['bronze', 'silver', 'gold'].includes(camada)) {
      throw new Error(`Camada do lake invalida: ${camada}.`);
    }
    const manifestos = await listarArquivos(caminhoSeguro(raizLake, camada), 'manifest.json');
    const versoes = [];
    for (const caminhoManifesto of manifestos) {
      const manifesto = await lerManifesto(camada, objeto, caminhoManifesto);
      if (manifesto.status !== 'sucesso' || (manifesto.objeto || manifesto.entidade) !== objeto) continue;
      const nomeArquivo = manifesto.arquivo || 'dados.parquet';
      if (path.basename(nomeArquivo) !== nomeArquivo) {
        throw new Error(`Manifesto aponta para arquivo invalido: ${caminhoManifesto}`);
      }
      const arquivo = path.join(path.dirname(caminhoManifesto), nomeArquivo);
      try { await fs.access(arquivo); } catch (erro) {
        if (erro.code === 'ENOENT') continue;
        throw erro;
      }
      let arquivoChavesAtuais = null;
      if (manifesto.reconciliacaoExclusoes) {
        const nomeChaves = manifesto.reconciliacaoExclusoes.arquivo;
        if (!nomeChaves || path.basename(nomeChaves) !== nomeChaves) {
          throw new Error(`Manifesto aponta para snapshot de chaves invalido: ${caminhoManifesto}`);
        }
        arquivoChavesAtuais = path.join(path.dirname(caminhoManifesto), nomeChaves);
        try { await fs.access(arquivoChavesAtuais); } catch (erro) {
          if (erro.code === 'ENOENT') continue;
          throw erro;
        }
      }
      versoes.push({ manifesto, caminhoManifesto, arquivo, arquivoChavesAtuais });
    }
    return versoes.sort((a, b) => {
      const dataA = a.manifesto.fim || a.manifesto.inicio || '';
      const dataB = b.manifesto.fim || b.manifesto.inicio || '';
      return dataA.localeCompare(dataB) || a.arquivo.localeCompare(b.arquivo);
    });
  }

  async function localizarDataset(camada, objeto, versao = 'latest') {
    const versoes = await listarVersoes(camada, objeto);
    if (!versoes.length) return null;
    if (versao === 'latest') return versoes.at(-1);
    return versoes.find((item) =>
      item.manifesto.idExecucao === versao || item.manifesto.execucao === versao
    ) || null;
  }

  async function publicarSnapshot(snapshot) {
    const { camada, objeto, manifesto, arquivoOrigem, arquivosExtras = [] } = snapshot || {};
    if (!camada || !objeto || !manifesto || !arquivoOrigem) {
      throw new Error('Snapshot exige camada, objeto, manifesto e arquivoOrigem.');
    }
    const execucao = String(manifesto.idExecucao || manifesto.execucao || Date.now())
      .replace(/[^a-zA-Z0-9_-]/g, '');
    if (!execucao) throw new Error('Identificador de execucao invalido.');
    const destinoFinal = caminhoSeguro(raizLake, camada, objeto, `execucao=${execucao}`);
    const destinoTemporario = `${destinoFinal}.tmp-${randomUUID()}`;
    await fs.mkdir(destinoTemporario, { recursive: true });
    try {
      const nomeArquivo = manifesto.arquivo || 'dados.parquet';
      await fs.copyFile(arquivoOrigem, path.join(destinoTemporario, nomeArquivo));
      for (const extra of arquivosExtras) {
        if (!extra?.origem || !extra?.nome || path.basename(extra.nome) !== extra.nome) {
          throw new Error('Arquivo extra do snapshot invalido.');
        }
        await fs.copyFile(extra.origem, path.join(destinoTemporario, extra.nome));
      }
      await fs.writeFile(
        path.join(destinoTemporario, 'manifest.json'),
        `${JSON.stringify({ ...manifesto, status: 'sucesso' }, null, 2)}\n`,
        'utf8'
      );
      await fs.mkdir(path.dirname(destinoFinal), { recursive: true });
      await fs.rename(destinoTemporario, destinoFinal);
      return { caminho: destinoFinal, manifesto: { ...manifesto, status: 'sucesso' } };
    } catch (erro) {
      await fs.rm(destinoTemporario, { recursive: true, force: true });
      throw erro;
    }
  }

  async function verificarSaude() {
    try {
      await fs.mkdir(raizLake, { recursive: true });
      await fs.access(raizLake);
      const camadas = {};
      for (const camada of ['bronze', 'silver', 'gold']) {
        camadas[camada] = (await listarArquivos(caminhoSeguro(raizLake, camada), 'manifest.json')).length;
      }
      return { saudavel: true, tipo: 'filesystem', raizLake, camadas };
    } catch (erro) {
      return { saudavel: false, tipo: 'filesystem', raizLake, codigo: erro.code || erro.name };
    }
  }

  return Object.freeze({
    tipo: 'filesystem', raizLake, localizarDataset, lerManifesto,
    listarVersoes, publicarSnapshot, verificarSaude
  });
}

function criarLakeStorage(opcoes = {}) {
  const tipo = String(opcoes.tipo || process.env.NEXUS_LAKE_STORAGE || 'filesystem').toLowerCase();
  if (tipo === 'filesystem') return criarFileSystemLakeStorage(opcoes);
  throw new Error(`LakeStorage nao implementado: ${tipo}.`);
}

module.exports = {
  RAIZ_LAKE_LOCAL,
  caminhoSeguro,
  criarFileSystemLakeStorage,
  criarLakeStorage,
  resolverRaizLake
};
