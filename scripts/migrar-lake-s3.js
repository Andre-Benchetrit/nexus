#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const { criarLakeStorage } = require('../nexus/lake_storage');

const CAMADAS = new Set(['bronze', 'silver', 'gold']);

function argumentos(argv = process.argv.slice(2)) {
  const indice = argv.indexOf('--from');
  if (indice < 0 || !argv[indice + 1]) throw new Error('Use --from <diretorio-do-lake>.');
  return {
    raiz: path.resolve(argv[indice + 1]),
    aplicar: argv.includes('--apply'),
    retomar: argv.includes('--resume')
  };
}

async function sha256Arquivo(caminho) {
  const hash = crypto.createHash('sha256');
  const arquivo = await fs.open(caminho, 'r');
  try {
    for await (const bloco of arquivo.createReadStream()) hash.update(bloco);
  } finally { await arquivo.close().catch(() => {}); }
  return hash.digest('hex');
}

async function listarArquivos(diretorio) {
  const entradas = await fs.readdir(diretorio, { withFileTypes: true });
  const arquivos = [];
  for (const entrada of entradas) {
    const atual = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) arquivos.push(...await listarArquivos(atual));
    else if (entrada.isFile()) arquivos.push(atual);
  }
  return arquivos;
}

function relativoSeguro(raiz, caminho) {
  const relativo = path.relative(raiz, caminho).replace(/\\/g, '/');
  if (!relativo || relativo.startsWith('../') || path.isAbsolute(relativo)) {
    throw new Error('Arquivo fora da raiz autorizada do lake.');
  }
  return relativo;
}

async function inventariarSnapshot(raiz, caminhoManifesto) {
  const diretorio = path.dirname(caminhoManifesto);
  const relativoManifesto = relativoSeguro(raiz, caminhoManifesto);
  const partes = relativoManifesto.split('/');
  const camada = partes[0];
  if (!CAMADAS.has(camada) || partes.at(-1) !== 'manifest.json') {
    throw new Error(`Manifesto fora de uma camada valida: ${relativoManifesto}.`);
  }
  let manifesto;
  try { manifesto = JSON.parse(await fs.readFile(caminhoManifesto, 'utf8')); }
  catch (_) { throw new Error(`Manifesto JSON invalido: ${relativoManifesto}.`); }
  const objeto = String(manifesto.objeto || manifesto.entidade || '').trim();
  if (!objeto || manifesto.status !== 'sucesso') {
    throw new Error(`Manifesto sem objeto ou sem sucesso: ${relativoManifesto}.`);
  }
  if (manifesto.camada && manifesto.camada !== camada) {
    throw new Error(`Camada divergente no manifesto: ${relativoManifesto}.`);
  }
  const nomePrincipal = String(manifesto.arquivo || 'dados.parquet');
  if (path.basename(nomePrincipal) !== nomePrincipal) {
    throw new Error(`Arquivo principal inseguro no manifesto: ${relativoManifesto}.`);
  }
  const entradas = await fs.readdir(diretorio, { withFileTypes: true });
  if (entradas.some((item) => item.isDirectory())) {
    throw new Error(`Snapshot contem subdiretorio inesperado: ${relativoManifesto}.`);
  }
  const caminhos = entradas.filter((item) => item.isFile() && item.name !== 'manifest.json')
    .map((item) => path.join(diretorio, item.name));
  if (!caminhos.some((item) => path.basename(item) === nomePrincipal)) {
    throw new Error(`Arquivo principal ausente: ${relativoManifesto}.`);
  }
  const arquivos = [];
  for (const caminho of caminhos.sort()) {
    const stat = await fs.stat(caminho);
    arquivos.push({ nome: path.basename(caminho), caminho, tamanhoBytes: stat.size,
      sha256: await sha256Arquivo(caminho) });
  }
  return {
    camada, objeto, manifesto, caminhoManifesto,
    prefixoRelativo: relativoSeguro(raiz, diretorio),
    relativoManifesto, nomePrincipal, arquivos
  };
}

async function inventariarLake(raiz) {
  const stat = await fs.stat(raiz).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('A raiz informada do lake nao existe.');
  const todos = await listarArquivos(raiz);
  const manifestos = todos.filter((item) => path.basename(item) === 'manifest.json' &&
    CAMADAS.has(relativoSeguro(raiz, item).split('/')[0]));
  const snapshots = [];
  for (const manifesto of manifestos.sort()) {
    const relativo = relativoSeguro(raiz, manifesto);
    let conteudo;
    try { conteudo = JSON.parse(await fs.readFile(manifesto, 'utf8')); }
    catch (_) { throw new Error(`Manifesto JSON invalido: ${relativo}.`); }
    // Execucoes invalidadas fazem parte do historico operacional local, mas nunca
    // foram snapshots consultaveis e portanto nao devem atravessar a migracao.
    if (conteudo.status !== 'sucesso') continue;
    snapshots.push(await inventariarSnapshot(raiz, manifesto));
  }
  const caminhos = new Set();
  for (const item of snapshots) {
    if (caminhos.has(item.prefixoRelativo)) throw new Error(`Snapshot duplicado: ${item.prefixoRelativo}.`);
    caminhos.add(item.prefixoRelativo);
  }
  return snapshots;
}

function integridade(snapshot) {
  return { versao: 1, arquivos: snapshot.arquivos.map(({ nome, tamanhoBytes, sha256 }) => (
    { nome, tamanhoBytes, sha256 }
  )) };
}

function mesmaIntegridade(a, b) {
  return JSON.stringify(a || null) === JSON.stringify(b || null);
}

function referenciaDestino(storage, snapshot) {
  const partes = [storage.prefixo, snapshot.prefixoRelativo, 'manifest.json'].filter(Boolean);
  return `s3://${storage.bucket}/${partes.join('/')}`;
}

async function manifestoDestino(storage, snapshot) {
  try { return await storage.lerManifesto(snapshot.camada, snapshot.objeto,
    referenciaDestino(storage, snapshot)); }
  catch (erro) {
    if (erro?.$metadata?.httpStatusCode === 404 || ['NotFound', 'NoSuchKey'].includes(erro?.name)) return null;
    throw erro;
  }
}

async function migrarSnapshot(storage, snapshot, { retomar = false } = {}) {
  const assinatura = integridade(snapshot);
  const existente = await manifestoDestino(storage, snapshot);
  if (existente) {
    if (retomar && mesmaIntegridade(existente.integridadeMigracao, assinatura)) return 'ignorado';
    const erro = new Error(`Snapshot existente diverge ou --resume nao foi informado: ${snapshot.prefixoRelativo}.`);
    erro.codigo = 'LAKE_MIGRATION_DESTINATION_CONFLICT';
    throw erro;
  }
  const principal = snapshot.arquivos.find((item) => item.nome === snapshot.nomePrincipal);
  const extras = snapshot.arquivos.filter((item) => item !== principal)
    .map((item) => ({ nome: item.nome, origem: item.caminho }));
  await storage.publicarSnapshot({
    camada: snapshot.camada,
    objeto: snapshot.objeto,
    prefixoRelativo: snapshot.prefixoRelativo,
    arquivoOrigem: principal.caminho,
    arquivosExtras: extras,
    manifesto: { ...snapshot.manifesto, integridadeMigracao: assinatura }
  });
  return 'publicado';
}

async function executar(opcoes = {}, dependencias = {}) {
  const snapshots = dependencias.snapshots || await inventariarLake(opcoes.raiz);
  const resumo = {
    modo: opcoes.aplicar ? 'apply' : 'dry-run', raiz: opcoes.raiz,
    snapshots: snapshots.length,
    arquivos: snapshots.reduce((total, item) => total + item.arquivos.length, 0),
    bytes: snapshots.reduce((total, item) => total + item.arquivos.reduce((soma, arquivo) => soma + arquivo.tamanhoBytes, 0), 0),
    publicados: 0, ignorados: 0
  };
  if (!opcoes.aplicar) return resumo;
  const storage = dependencias.storage || criarLakeStorage();
  if (storage.tipo !== 's3') throw new Error('A migracao exige NEXUS_LAKE_STORAGE=s3.');
  try {
    for (const [indice, snapshot] of snapshots.entries()) {
      const status = await migrarSnapshot(storage, snapshot, opcoes);
      resumo[status === 'publicado' ? 'publicados' : 'ignorados'] += 1;
      dependencias.onEvento?.({ indice: indice + 1, total: snapshots.length,
        camada: snapshot.camada, objeto: snapshot.objeto, status });
    }
    return resumo;
  } finally { if (!dependencias.storage) await storage.fechar?.(); }
}

async function main() {
  const opcoes = argumentos();
  const resumo = await executar(opcoes, { onEvento: (evento) => {
    process.stdout.write(`${JSON.stringify({ level: 'info', event: 'lake_migration_progress', ...evento })}\n`);
  } });
  process.stdout.write(`${JSON.stringify({ level: 'info', event: 'lake_migration_finished', ...resumo }, null, 2)}\n`);
}

if (require.main === module) main().catch((erro) => {
  const codigo = String(erro.codigo || erro.code || erro.name || 'LAKE_MIGRATION_FAILED')
    .replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  process.stderr.write(`${JSON.stringify({ level: 'error', event: 'lake_migration_failed', code: codigo })}\n`);
  process.exitCode = 1;
});

module.exports = { argumentos, executar, integridade, inventariarLake, inventariarSnapshot,
  manifestoDestino, mesmaIntegridade, migrarSnapshot, sha256Arquivo };
