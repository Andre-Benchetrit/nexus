const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { criarS3LakeStorage } = require('../nexus/lake_storage');
const { criarControlePostgres } = require('../pipeline/controle_postgres');
const { decidirExecucao, executarWorker } = require('../services/nexus-lake-worker/worker');

class S3Falso {
  constructor() { this.objetos = new Map(); this.ordem = []; this.falharManifesto = false; this.contagens = {}; }
  async send(comando) {
    const nome = comando.constructor.name;
    this.contagens[nome] = (this.contagens[nome] || 0) + 1;
    const entrada = comando.input;
    if (nome === 'PutObjectCommand') {
      this.ordem.push(entrada.Key);
      if (this.falharManifesto && entrada.Key.endsWith('/manifest.json')) {
        const erro = new Error('falha simulada'); erro.code = 'S3_FAIL'; throw erro;
      }
      this.objetos.set(entrada.Key, { body: Buffer.from(entrada.Body), metadata: entrada.Metadata || {} });
      return {};
    }
    if (nome === 'HeadObjectCommand') {
      const item = this.objetos.get(entrada.Key);
      if (!item) { const erro = new Error('ausente'); erro.name = 'NotFound'; erro.$metadata = { httpStatusCode: 404 }; throw erro; }
      return { ContentLength: item.body.length, Metadata: item.metadata };
    }
    if (nome === 'GetObjectCommand') {
      const item = this.objetos.get(entrada.Key);
      if (!item) { const erro = new Error('ausente'); erro.name = 'NoSuchKey'; throw erro; }
      return { Body: item.body };
    }
    if (nome === 'ListObjectsV2Command') {
      const chaves = [...this.objetos.keys()].filter((chave) => chave.startsWith(entrada.Prefix || ''));
      return { Contents: chaves.map((Key) => ({ Key })), IsTruncated: false };
    }
    if (nome === 'DeleteObjectsCommand') {
      for (const item of entrada.Delete.Objects) this.objetos.delete(item.Key);
      return {};
    }
    throw new Error(`Comando S3 nao simulado: ${nome}`);
  }
}

function storageS3(cliente) {
  return criarS3LakeStorage({ cliente, bucket: 'bucket-teste', endpoint: 'https://t3.storageapi.dev',
    region: 'auto', accessKeyId: 'id-teste', secretAccessKey: 'segredo-teste',
    prefixo: 'nexus-lake', urlStyle: 'virtual', criarUpload: ({ params }) => ({
      done: async () => {
        const partes = [];
        for await (const parte of params.Body) partes.push(Buffer.from(parte));
        await cliente.send({ constructor: { name: 'PutObjectCommand' }, input: {
          ...params, Body: Buffer.concat(partes)
        } });
      }
    }) });
}

test('S3 publica o manifesto por ultimo e lista somente snapshot completo', async (t) => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-s3-storage-'));
  t.after(() => fs.rm(raiz, { recursive: true, force: true }));
  const parquet = path.join(raiz, 'dados.parquet');
  await fs.writeFile(parquet, Buffer.from('parquet-fixture'));
  const cliente = new S3Falso();
  const storage = storageS3(cliente);
  await storage.publicarSnapshot({ camada: 'gold', objeto: 'kpi_teste', arquivoOrigem: parquet,
    prefixoRelativo: 'gold/kpi_teste/execucao=abc',
    manifesto: { objeto: 'kpi_teste', execucao: 'abc', inicio: '2026-01-01T00:00:00Z',
      fim: '2026-01-01T00:01:00Z', arquivo: 'dados.parquet' } });
  assert.match(cliente.ordem.at(-1), /manifest\.json$/);
  const versoes = await storage.listarVersoes('gold', 'kpi_teste');
  assert.equal(versoes.length, 1);
  assert.equal(versoes[0].arquivo, 's3://bucket-teste/nexus-lake/gold/kpi_teste/execucao=abc/dados.parquet');
  assert.deepEqual(await storage.listarReferencias('gold'),
    ['s3://bucket-teste/nexus-lake/gold/kpi_teste/execucao=abc/manifest.json']);
  assert.equal(versoes[0].manifesto.integridadeObjeto.tamanhoBytes, 15);
});

test('falha antes do manifesto deixa objetos S3 invisiveis', async (t) => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-s3-incompleto-'));
  t.after(() => fs.rm(raiz, { recursive: true, force: true }));
  const parquet = path.join(raiz, 'dados.parquet');
  await fs.writeFile(parquet, 'incompleto');
  const cliente = new S3Falso(); cliente.falharManifesto = true;
  const storage = storageS3(cliente);
  await assert.rejects(storage.publicarSnapshot({ camada: 'silver', objeto: 'fato_teste',
    arquivoOrigem: parquet, prefixoRelativo: 'silver/fato_teste/execucao=abc',
    manifesto: { objeto: 'fato_teste', execucao: 'abc', arquivo: 'dados.parquet' } }),
  /falha simulada/);
  assert.equal((await storage.listarVersoes('silver', 'fato_teste')).length, 0);
  await assert.rejects(storage.lerManifesto('silver', 'fato_teste', 'outro/manifest.json'),
    /fora do prefixo/);
});

test('S3 reutiliza a leitura dos manifestos entre objetos da mesma camada', async (t) => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-s3-cache-'));
  t.after(() => fs.rm(raiz, { recursive: true, force: true }));
  const parquet = path.join(raiz, 'dados.parquet');
  await fs.writeFile(parquet, 'cache-fixture');
  const cliente = new S3Falso();
  const storage = storageS3(cliente);
  for (const objeto of ['objeto_a', 'objeto_b']) {
    await storage.publicarSnapshot({ camada: 'bronze', objeto, arquivoOrigem: parquet,
      prefixoRelativo: `bronze/${objeto}/execucao=abc`,
      manifesto: { objeto, execucao: 'abc', arquivo: 'dados.parquet' } });
  }

  assert.equal((await storage.listarVersoes('bronze', 'objeto_a')).length, 1);
  const leiturasDepoisDoPrimeiro = cliente.contagens.GetObjectCommand;
  assert.equal((await storage.listarVersoes('bronze', 'objeto_b')).length, 1);
  assert.equal(cliente.contagens.GetObjectCommand, leiturasDepoisDoPrimeiro);
  assert.equal(cliente.contagens.ListObjectsV2Command, 1);
});

test('snapshot S3 publicado e imutavel', async (t) => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-s3-imutavel-'));
  t.after(() => fs.rm(raiz, { recursive: true, force: true }));
  const parquet = path.join(raiz, 'dados.parquet');
  await fs.writeFile(parquet, 'primeira-versao');
  const storage = storageS3(new S3Falso());
  const snapshot = { camada: 'gold', objeto: 'kpi_teste', arquivoOrigem: parquet,
    prefixoRelativo: 'gold/kpi_teste/execucao=imutavel',
    manifesto: { objeto: 'kpi_teste', execucao: 'imutavel', arquivo: 'dados.parquet' } };
  await storage.publicarSnapshot(snapshot);
  await fs.writeFile(parquet, 'segunda-versao');
  await assert.rejects(storage.publicarSnapshot(snapshot),
    (erro) => erro.codigo === 'S3_SNAPSHOT_ALREADY_PUBLISHED');
});

test('controle PostgreSQL mantem um unico lock por vez', async () => {
  let travado = false;
  const pool = {
    query: async () => ({ rows: [] }),
    connect: async () => ({
      query: async (sql) => {
        if (sql.includes('pg_try_advisory_lock')) {
          if (travado) return { rows: [{ adquirida: false }] };
          travado = true; return { rows: [{ adquirida: true }] };
        }
        if (sql.includes('pg_advisory_unlock')) { travado = false; return { rows: [] }; }
        return { rows: [] };
      },
      release() {}
    })
  };
  const controle = criarControlePostgres(pool);
  const primeira = await controle.adquirirTrava(null, { id: '1' });
  await assert.rejects(controle.adquirirTrava(null, { id: '2' }),
    (erro) => erro.codigo === 'LAKE_PIPELINE_LOCKED');
  await controle.liberarTrava(primeira);
  const terceira = await controle.adquirirTrava(null, { id: '3' });
  await controle.liberarTrava(terceira);
});

test('Worker escolhe carga completa, intradiaria e skip no fuso configurado', async () => {
  const env = { NEXUS_LAKE_WORKER_ENABLED: '1', NEXUS_LAKE_WORKER_TIMEZONE: 'America/Sao_Paulo',
    NEXUS_LAKE_FULL_HOUR: '2', NEXUS_LAKE_INTRADAY_HOURS: '8,10,12,14,16,18,20,22' };
  assert.equal(decidirExecucao(new Date('2026-09-17T05:15:00Z'), env).tipo, 'full');
  assert.equal(decidirExecucao(new Date('2026-09-17T13:15:00Z'), env).tipo, 'intraday');
  assert.equal(decidirExecucao(new Date('2026-09-17T10:15:00Z'), env).executar, false);
  assert.equal(decidirExecucao(new Date(), { NEXUS_LAKE_WORKER_ENABLED: '0' }).motivo,
    'worker_desabilitado');
});

test('Worker encerra o pool depois da execucao', async () => {
  let encerrado = false;
  let storageEncerrado = false;
  const pool = { end: async () => { encerrado = true; } };
  const resultado = await executarWorker({
    agora: new Date('2026-09-17T13:15:00Z'),
    env: { NEXUS_LAKE_WORKER_ENABLED: '1', NEXUS_LAKE_WORKER_TIMEZONE: 'America/Sao_Paulo',
      NEXUS_LAKE_FULL_HOUR: '2', NEXUS_LAKE_INTRADAY_HOURS: '10' },
    criarPool: () => pool,
    criarStorage: () => ({ tipo: 's3', fechar: async () => { storageEncerrado = true; } }),
    executarPipeline: async (opcoes) => {
      assert.equal(opcoes.modoControle, 'postgres');
      assert.equal(opcoes.incluirHoje, true);
      return { execucao: { id: 'run-1', status: 'sucesso' } };
    }
  });
  assert.equal(encerrado, true);
  assert.equal(storageEncerrado, true);
  assert.equal(resultado.execucaoId, 'run-1');
});

test('Worker valida configuracao S3 mesmo quando esta desabilitado', async () => {
  await assert.rejects(executarWorker({
    env: { NEXUS_LAKE_WORKER_ENABLED: '0', NEXUS_LAKE_STORAGE: 's3' }
  }), /Configuracao S3 do lake incompleta/);
});
