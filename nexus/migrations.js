const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { comTransacao } = require('./db');

const DIRETORIO_MIGRATIONS = path.join(__dirname, 'migrations');
const CHAVE_TRAVA = 721_913_047;

function listarMigrations(diretorio = DIRETORIO_MIGRATIONS) {
  return fs.readdirSync(diretorio)
    .filter((nome) => /^\d{3}_[a-z0-9_]+\.sql$/.test(nome))
    .sort()
    .map((nome) => {
      const sql = fs.readFileSync(path.join(diretorio, nome), 'utf8');
      return {
        nome,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex')
      };
    });
}

async function prepararControle(cliente) {
  await cliente.query('CREATE SCHEMA IF NOT EXISTS nexus');
  await cliente.query(`CREATE TABLE IF NOT EXISTS nexus.schema_migrations (
    nome text PRIMARY KEY,
    checksum text NOT NULL,
    aplicada_em timestamptz NOT NULL DEFAULT now()
  )`);
}

async function obterStatusMigrations(pool, opcoes = {}) {
  const migrations = listarMigrations(opcoes.diretorio);
  const cliente = await pool.connect();
  try {
    await prepararControle(cliente);
    const aplicadas = new Map((await cliente.query(
      'SELECT nome, checksum, aplicada_em FROM nexus.schema_migrations ORDER BY nome'
    )).rows.map((item) => [item.nome, item]));
    return migrations.map((migration) => {
      const aplicada = aplicadas.get(migration.nome);
      return {
        nome: migration.nome,
        status: !aplicada ? 'pendente' :
          aplicada.checksum === migration.checksum ? 'aplicada' : 'checksum_divergente',
        aplicadaEm: aplicada?.aplicada_em || null
      };
    });
  } finally {
    cliente.release();
  }
}

async function aplicarMigrations(pool, opcoes = {}) {
  const migrations = listarMigrations(opcoes.diretorio);
  return comTransacao(pool, async (cliente) => {
    await cliente.query('SELECT pg_advisory_xact_lock($1)', [CHAVE_TRAVA]);
    await prepararControle(cliente);
    const aplicadas = new Map((await cliente.query(
      'SELECT nome, checksum FROM nexus.schema_migrations'
    )).rows.map((item) => [item.nome, item.checksum]));
    const novas = [];
    for (const migration of migrations) {
      const checksum = aplicadas.get(migration.nome);
      if (checksum && checksum !== migration.checksum) {
        throw new Error(`Migration ${migration.nome} foi alterada depois de aplicada.`);
      }
      if (checksum) continue;
      await cliente.query(migration.sql);
      await cliente.query(
        'INSERT INTO nexus.schema_migrations (nome, checksum) VALUES ($1, $2)',
        [migration.nome, migration.checksum]
      );
      novas.push(migration.nome);
    }
    return novas;
  });
}

module.exports = {
  aplicarMigrations,
  listarMigrations,
  obterStatusMigrations
};
