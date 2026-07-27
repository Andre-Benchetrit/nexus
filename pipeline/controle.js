const fs = require('node:fs/promises');
const path = require('node:path');

const TEMPO_TRAVA_OBSOLETA_MS = 24 * 60 * 60 * 1000;

function caminhosControle(raizLake) {
  const raiz = path.join(raizLake, '_controle');
  return {
    raiz,
    estado: path.join(raiz, 'estado.json'),
    trava: path.join(raiz, 'pipeline.lock'),
    execucoes: path.join(raiz, 'execucoes'),
    ultimaExecucao: path.join(raiz, 'ultima-execucao.json')
  };
}

async function lerJson(caminho, padrao) {
  try {
    return JSON.parse(await fs.readFile(caminho, 'utf8'));
  } catch (erro) {
    if (erro.code === 'ENOENT') return structuredClone(padrao);
    throw erro;
  }
}

async function gravarJsonAtomico(caminho, valor) {
  await fs.mkdir(path.dirname(caminho), { recursive: true });
  const temporario = `${caminho}.${process.pid}.tmp`;
  await fs.writeFile(temporario, `${JSON.stringify(valor, null, 2)}\n`, 'utf8');
  await fs.rename(temporario, caminho);
}

async function lerEstado(raizLake) {
  const caminhos = caminhosControle(raizLake);
  return lerJson(caminhos.estado, { versao: 1, atualizadoEm: null, entidades: {} });
}

async function salvarEstado(raizLake, estado) {
  const caminhos = caminhosControle(raizLake);
  await gravarJsonAtomico(caminhos.estado, estado);
}

async function adquirirTrava(raizLake, execucao, opcoes = {}) {
  const caminhos = caminhosControle(raizLake);
  await fs.mkdir(caminhos.raiz, { recursive: true });
  try {
    const handle = await fs.open(caminhos.trava, 'wx');
    await handle.writeFile(`${JSON.stringify(execucao, null, 2)}\n`, 'utf8');
    await handle.close();
    return caminhos.trava;
  } catch (erro) {
    if (erro.code !== 'EEXIST') throw erro;
    const estatistica = await fs.stat(caminhos.trava);
    const limite = opcoes.tempoTravaObsoletaMs || TEMPO_TRAVA_OBSOLETA_MS;
    if (Date.now() - estatistica.mtimeMs <= limite) {
      const atual = await lerJson(caminhos.trava, {});
      throw new Error(
        `Ja existe uma atualizacao em andamento desde ${atual.iniciadoEm || 'horario desconhecido'} ` +
        `(pid ${atual.pid || 'desconhecido'}).`
      );
    }
    await fs.unlink(caminhos.trava);
    return adquirirTrava(raizLake, execucao, opcoes);
  }
}

async function liberarTrava(caminho) {
  if (!caminho) return;
  try {
    await fs.unlink(caminho);
  } catch (erro) {
    if (erro.code !== 'ENOENT') throw erro;
  }
}

async function salvarExecucao(raizLake, execucao) {
  const caminhos = caminhosControle(raizLake);
  const arquivo = path.join(caminhos.execucoes, `${execucao.id}.json`);
  await gravarJsonAtomico(arquivo, execucao);
  await gravarJsonAtomico(caminhos.ultimaExecucao, execucao);
  return arquivo;
}

async function lerUltimaExecucao(raizLake) {
  return lerJson(caminhosControle(raizLake).ultimaExecucao, null);
}

module.exports = {
  TEMPO_TRAVA_OBSOLETA_MS,
  adquirirTrava,
  caminhosControle,
  gravarJsonAtomico,
  lerEstado,
  lerUltimaExecucao,
  liberarTrava,
  salvarEstado,
  salvarExecucao
};
