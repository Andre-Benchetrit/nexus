const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  caminhoSeguro, criarFileSystemLakeStorage, criarLakeStorage, resolverRaizLake
} = require('../nexus/lake_storage');

async function fixture(t, camada = 'silver', objeto = 'fato_teste') {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-lake-storage-'));
  t.after(() => fs.rm(raiz, { recursive: true, force: true }));
  const diretorio = path.join(raiz, camada, objeto, 'dt_processamento=2026-08-24', 'execucao=1');
  await fs.mkdir(diretorio, { recursive: true });
  await fs.writeFile(path.join(diretorio, 'dados.parquet'), 'parquet-falso');
  await fs.writeFile(path.join(diretorio, 'manifest.json'), JSON.stringify({
    status: 'sucesso', objeto, arquivo: 'dados.parquet', fim: '2026-08-24', execucao: '1'
  }));
  return raiz;
}

test('filesystem lake storage localiza versoes e informa saude', async (t) => {
  const raiz = await fixture(t);
  const storage = criarFileSystemLakeStorage({ raizLake: raiz });
  const versoes = await storage.listarVersoes('silver', 'fato_teste');
  assert.equal(versoes.length, 1);
  assert.equal((await storage.localizarDataset('silver', 'fato_teste')).manifesto.execucao, '1');
  const saude = await storage.verificarSaude();
  assert.equal(saude.saudavel, true);
  assert.equal(saude.camadas.silver, 1);
});

test('publicacao de snapshot grava manifesto por ultimo em diretorio atomico', async (t) => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-lake-publicar-'));
  t.after(() => fs.rm(raiz, { recursive: true, force: true }));
  const origem = path.join(raiz, 'origem.parquet');
  await fs.writeFile(origem, 'dados');
  const storage = criarFileSystemLakeStorage({ raizLake: raiz });
  const publicado = await storage.publicarSnapshot({
    camada: 'gold', objeto: 'kpi_teste', arquivoOrigem: origem,
    manifesto: { objeto: 'kpi_teste', arquivo: 'dados.parquet', execucao: 'abc' }
  });
  assert.equal(publicado.manifesto.status, 'sucesso');
  assert.equal((await storage.listarVersoes('gold', 'kpi_teste')).length, 1);
});

test('raiz do lake e configuravel e caminhos nao escapam do storage', () => {
  const raiz = path.resolve('lake-teste');
  assert.equal(resolverRaizLake({ env: { NEXUS_LAKE_ROOT: raiz } }), raiz);
  assert.equal(criarLakeStorage({ raizLake: raiz }).tipo, 'filesystem');
  assert.throws(() => caminhoSeguro(raiz, '..', 'segredo'), /fora da raiz/i);
});
