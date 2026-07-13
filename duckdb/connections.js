const duckdb = require('duckdb');

function criarConexaoDuckDB() {
  const db = new duckdb.Database(':memory:');
  const con = db.connect();
  Object.defineProperty(con, '__nexusDatabase', { value: db });

  return con;
}

async function fecharConexaoDuckDB(con) {
  await new Promise((resolve) => con.close(() => resolve()));
  if (con.__nexusDatabase) {
    await new Promise((resolve) => con.__nexusDatabase.close(() => resolve()));
  }
}

function runDuckDB(con, sql) {
  return new Promise((resolve, reject) => {
    con.run(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function allDuckDB(con, sql) {
  return new Promise((resolve, reject) => {
    con.all(sql, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function prepararPostgresDuckDB(con) {
  try {
    await runDuckDB(con, 'LOAD postgres;');
  } catch (_) {
    await runDuckDB(con, 'INSTALL postgres;');
    await runDuckDB(con, 'LOAD postgres;');
  }
}

function montarPostgresConnectionString() {
  const env = {
    host: process.env.POSTGRES_HOST || process.env.PG_HOST,
    port: process.env.POSTGRES_PORT || process.env.PG_PORT,
    database: process.env.POSTGRES_DATABASE || process.env.PG_DATABASE,
    user: process.env.POSTGRES_USER || process.env.PG_USER,
    password: process.env.POSTGRES_PASSWORD || process.env.PG_PASSWORD
  };

  const ausentes = Object.entries(env)
    .filter(([, valor]) => !valor)
    .map(([chave]) => chave);

  if (ausentes.length) {
    throw new Error(`Configuração PostgreSQL ausente: ${ausentes.join(', ')}`);
  }

  return (
    `host=${env.host} ` +
    `port=${env.port} ` +
    `dbname=${env.database} ` +
    `user=${env.user} ` +
    `password=${env.password} ` +
    `client_encoding=UTF8 ` +
    `sslmode=disable`
  );
}

async function conectarPostgresNoDuckDB(con, alias = 'pg_db') {
  const connectionString = montarPostgresConnectionString().replace(/'/g, "''");

  await runDuckDB(
    con,
    `ATTACH '${connectionString}' AS ${alias} (TYPE POSTGRES);`
  );
}

module.exports = {
  criarConexaoDuckDB,
  fecharConexaoDuckDB,
  runDuckDB,
  allDuckDB,
  prepararPostgresDuckDB,
  conectarPostgresNoDuckDB,
  montarPostgresConnectionString
};
