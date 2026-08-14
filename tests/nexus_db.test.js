const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { comTransacao, obterConfiguracaoBanco } = require('../nexus/db');
const { listarMigrations, obterStatusMigrations } = require('../nexus/migrations');

test('configuracao do banco operacional exige URL e valida limites', () => {
  assert.throws(() => obterConfiguracaoBanco({}), /NEXUS_DATABASE_URL/);
  assert.deepEqual(
    obterConfiguracaoBanco({ NEXUS_DATABASE_URL: 'postgresql://exemplo', NEXUS_DB_POOL_MAX: '4' }).max,
    4
  );
  assert.throws(() => obterConfiguracaoBanco({
    NEXUS_DATABASE_URL: 'postgresql://exemplo', NEXUS_DB_POOL_MAX: '0'
  }), /NEXUS_DB_POOL_MAX/);
});

test('migrations possuem ordem e checksum deterministico', (t) => {
  const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-migrations-'));
  t.after(() => fs.rmSync(diretorio, { recursive: true, force: true }));
  fs.writeFileSync(path.join(diretorio, '002_segunda.sql'), 'SELECT 2;');
  fs.writeFileSync(path.join(diretorio, '001_primeira.sql'), 'SELECT 1;');
  const migrations = listarMigrations(diretorio);
  assert.deepEqual(migrations.map((item) => item.nome), ['001_primeira.sql', '002_segunda.sql']);
  assert.equal(migrations[0].checksum.length, 64);
  assert.equal(listarMigrations(diretorio)[0].checksum, migrations[0].checksum);
});

test('status acusa migration alterada depois da aplicacao', async (t) => {
  const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-status-'));
  t.after(() => fs.rmSync(diretorio, { recursive: true, force: true }));
  fs.writeFileSync(path.join(diretorio, '001_teste.sql'), 'SELECT 1;');
  const migration = listarMigrations(diretorio)[0];
  const cliente = {
    async query(sql) {
      if (/SELECT nome, checksum/.test(sql)) return {
        rows: [{ nome: migration.nome, checksum: 'checksum-antigo', aplicada_em: new Date() }]
      };
      return { rows: [] };
    },
    release() {}
  };
  const status = await obterStatusMigrations({ connect: async () => cliente }, { diretorio });
  assert.equal(status[0].status, 'checksum_divergente');
});

test('transacao sempre executa rollback quando a operacao falha', async () => {
  const comandos = [];
  const cliente = {
    async query(sql) { comandos.push(sql); },
    release() { comandos.push('RELEASE'); }
  };
  await assert.rejects(
    comTransacao({ connect: async () => cliente }, async () => { throw new Error('falha'); }),
    /falha/
  );
  assert.deepEqual(comandos, ['BEGIN', 'ROLLBACK', 'RELEASE']);
});
