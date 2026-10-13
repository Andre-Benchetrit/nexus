const test = require('node:test');
const assert = require('node:assert/strict');

const {
  prepararPostgresDuckDB,
  desconectarPostgresNoDuckDB
} = require('../duckdb/connections');

function conexaoFalsa() {
  const sql = [];
  return {
    sql,
    run(comando, callback) {
      sql.push(comando);
      callback(null);
    }
  };
}

test('scanner PostgreSQL limita e nao mantem conexoes em cache', async () => {
  const con = conexaoFalsa();
  await prepararPostgresDuckDB(con);

  assert.deepEqual(con.sql, [
    'LOAD postgres;',
    'SET threads=2;',
    'SET pg_connection_limit=2;',
    'SET pg_connection_cache=false;'
  ]);
});

test('desconecta explicitamente o catalogo PostgreSQL', async () => {
  const con = conexaoFalsa();
  await desconectarPostgresNoDuckDB(con);
  assert.deepEqual(con.sql, ['DETACH pg_db;']);
  await assert.rejects(
    desconectarPostgresNoDuckDB(con, 'alias; DROP TABLE x'),
    /Alias PostgreSQL invalido/
  );
});
