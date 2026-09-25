const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { executar, inventariarLake } = require('../scripts/migrar-lake-s3');
const { executarComConcorrencia } = require('../scripts/validar-lake-s3');
const { argumentos: argumentosWorker, decidirExecucao } = require('../services/nexus-lake-worker/worker');
const { corteDoToken, tokenConfirmacao } = require('../scripts/limpar-chats-nexus');
const { criarServicoAnexos } = require('../nexus/anexos');
const { criarServicoArtefatos } = require('../nexus/artefatos');
const { criarServicoDatasets } = require('../nexus/datasets');

async function lakeFixture(t) {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-sprint2-'));
  t.after(() => fs.rm(raiz, { recursive: true, force: true }));
  const destino = path.join(raiz, 'gold', 'kpi_teste', 'dt_processamento=2026-09-24',
    'execucao=teste');
  await fs.mkdir(destino, { recursive: true });
  await fs.writeFile(path.join(destino, 'dados.parquet'), 'parquet-fixture');
  await fs.writeFile(path.join(destino, 'extra.bin'), 'extra-fixture');
  await fs.writeFile(path.join(destino, 'manifest.json'), JSON.stringify({
    objeto: 'kpi_teste', camada: 'gold', status: 'sucesso', arquivo: 'dados.parquet',
    execucao: 'teste', inicio: '2026-09-24T10:00:00Z', fim: '2026-09-24T10:01:00Z',
    totalLinhas: 1
  }));
  return raiz;
}

test('inventario do Sprint 2 preserva caminho, principal, extras e hashes', async (t) => {
  const [snapshot] = await inventariarLake(await lakeFixture(t));
  assert.equal(snapshot.camada, 'gold');
  assert.equal(snapshot.objeto, 'kpi_teste');
  assert.equal(snapshot.nomePrincipal, 'dados.parquet');
  assert.match(snapshot.prefixoRelativo,
    /^gold\/kpi_teste\/dt_processamento=2026-09-24\/execucao=teste$/);
  assert.deepEqual(snapshot.arquivos.map((item) => item.nome), ['dados.parquet', 'extra.bin']);
  assert.ok(snapshot.arquivos.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)));
});

test('inventario ignora execucao historica invalidada', async (t) => {
  const raiz = await lakeFixture(t);
  const destino = path.join(raiz, 'bronze', 'postgres', 'cliente',
    'dt_extracao=2026-09-23', 'execucao=invalida');
  await fs.mkdir(destino, { recursive: true });
  await fs.writeFile(path.join(destino, 'dados.parquet'), 'nao-publicavel');
  await fs.writeFile(path.join(destino, 'manifest.json'), JSON.stringify({
    entidade: 'cliente', status: 'invalido', arquivo: 'dados.parquet'
  }));
  const snapshots = await inventariarLake(raiz);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].objeto, 'kpi_teste');
});

test('migrador e resumivel somente quando a integridade coincide', async (t) => {
  const raiz = await lakeFixture(t);
  let manifesto = null;
  const storage = {
    tipo: 's3', bucket: 'bucket', prefixo: 'nexus-lake',
    async lerManifesto() {
      if (manifesto) return manifesto;
      const erro = new Error('ausente'); erro.name = 'NoSuchKey'; erro.$metadata = { httpStatusCode: 404 };
      throw erro;
    },
    async publicarSnapshot(snapshot) { manifesto = snapshot.manifesto; },
    async fechar() {}
  };
  const primeiro = await executar({ raiz, aplicar: true, retomar: false }, { storage });
  assert.equal(primeiro.publicados, 1);
  const retomado = await executar({ raiz, aplicar: true, retomar: true }, { storage });
  assert.equal(retomado.ignorados, 1);
  manifesto.integridadeMigracao.arquivos[0].sha256 = '0'.repeat(64);
  await assert.rejects(executar({ raiz, aplicar: true, retomar: true }, { storage }),
    (erro) => erro.codigo === 'LAKE_MIGRATION_DESTINATION_CONFLICT');
});

test('dry-run do migrador nao cria storage nem publica objetos', async (t) => {
  const resumo = await executar({ raiz: await lakeFixture(t), aplicar: false }, {
    storage: { tipo: 's3', publicarSnapshot: async () => assert.fail('nao deve publicar') }
  });
  assert.equal(resumo.modo, 'dry-run');
  assert.equal(resumo.snapshots, 1);
  assert.equal(resumo.publicados, 0);
});

test('Worker aceita full e intraday manuais mesmo com cron desabilitado', () => {
  const env = { NEXUS_LAKE_WORKER_ENABLED: '0', NEXUS_LAKE_WORKER_TIMEZONE: 'America/Sao_Paulo' };
  assert.deepEqual(argumentosWorker(['--run', 'full']), { tipoManual: 'full' });
  assert.deepEqual(argumentosWorker(['--run=intraday']), { tipoManual: 'intraday' });
  const decisao = decidirExecucao(new Date('2026-09-24T15:00:00Z'), env, 'full');
  assert.equal(decisao.executar, true);
  assert.equal(decisao.tipo, 'full');
  assert.equal(decisao.manual, true);
  assert.throws(() => argumentosWorker(['--run', 'invalido']), /full ou intraday/);
});

test('token da limpeza fixa corte e conjunto de conversas', () => {
  const corte = '2026-09-24T12:00:00.000Z';
  const token = tokenConfirmacao(corte, ['a', 'b']);
  assert.equal(corteDoToken(token), corte);
  assert.equal(tokenConfirmacao(corte, ['a', 'b']), token);
  assert.notEqual(tokenConfirmacao(corte, ['a', 'c']), token);
  assert.throws(() => corteDoToken('invalido'), /invalido/);
});

test('limpeza de conversa nao apaga diretamente assets deduplicados', async () => {
  const consultas = [];
  const pool = { async query(sql) {
    consultas.push(sql);
    if (/SELECT id FROM nexus\.conversations/.test(sql)) return { rows: [{ id: 'conversa-1' }] };
    if (/SELECT storage_key,derived_storage_key/.test(sql)) {
      assert.match(sql, /asset_id IS NULL/);
      return { rows: [{ storage_key: 'direto.pdf', derived_storage_key: 'direto.json' }] };
    }
    return { rows: [] };
  } };
  const servico = criarServicoAnexos({ pool, storage: {}, principalId: 'principal-1' });
  assert.deepEqual(await servico.chavesDaConversa('conversa-1'), ['direto.pdf', 'direto.json']);
  assert.ok(consultas.some((sql) => /asset_id IS NULL/.test(sql)));
});

test('finalizacao remove registros de artefatos e datasets mesmo apos excluir os arquivos', async () => {
  const removidos = [];
  const consultas = [];
  const storage = { async excluir(chave) { removidos.push(chave); } };
  const pool = { async query(sql) { consultas.push(sql); return { rows: [] }; } };
  const contexto = { pool, storage, principalId: 'principal-1', departmentId: 'setor-1' };
  await criarServicoArtefatos(contexto).finalizarExclusaoConversa('conversa-1', ['artefato.xlsx']);
  await criarServicoDatasets({ ...contexto, modo: 'v1' })
    .finalizarExclusaoConversa('conversa-1', ['dataset.parquet']);
  assert.deepEqual(removidos, ['artefato.xlsx', 'dataset.parquet']);
  assert.ok(consultas.some((sql) => /DELETE FROM nexus\.conversation_artifacts/.test(sql)));
  assert.ok(consultas.some((sql) => /DELETE FROM nexus\.conversation_datasets/.test(sql)));
});

test('validador limita concorrencia sem perder itens', async () => {
  let ativos = 0; let maximo = 0;
  const concluidos = [];
  await executarComConcorrencia(Array.from({ length: 25 }, (_, indice) => indice), 4,
    async (item) => {
      ativos += 1; maximo = Math.max(maximo, ativos);
      await new Promise((resolve) => setTimeout(resolve, 2));
      concluidos.push(item); ativos -= 1;
    });
  assert.ok(maximo <= 4);
  assert.deepEqual(concluidos.sort((a, b) => a - b), Array.from({ length: 25 }, (_, indice) => indice));
});
