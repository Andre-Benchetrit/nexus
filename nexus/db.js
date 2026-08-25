const { Pool } = require('pg');

const POOL_MAX_PADRAO = 10;
const TIMEOUT_CONEXAO_PADRAO_MS = 10_000;

function inteiroConfiguracao(valor, padrao, nome, minimo = 1, maximo = 100) {
  const numero = Number(valor ?? padrao);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${nome} deve ser um inteiro entre ${minimo} e ${maximo}.`);
  }
  return numero;
}

function obterConfiguracaoBanco(env = process.env) {
  const connectionString = String(env.NEXUS_DATABASE_URL || '').trim();
  if (!connectionString) throw new Error('NEXUS_DATABASE_URL nao foi definida.');
  return {
    connectionString,
    max: inteiroConfiguracao(env.NEXUS_DB_POOL_MAX, POOL_MAX_PADRAO, 'NEXUS_DB_POOL_MAX'),
    connectionTimeoutMillis: inteiroConfiguracao(
      env.NEXUS_DB_CONNECT_TIMEOUT_MS,
      TIMEOUT_CONEXAO_PADRAO_MS,
      'NEXUS_DB_CONNECT_TIMEOUT_MS',
      100,
      120_000
    ),
    application_name: 'nexus-core',
    allowExitOnIdle: true
  };
}

function criarPoolNexus(opcoes = {}) {
  if (opcoes.pool) return opcoes.pool;
  const pool = new Pool({
    ...obterConfiguracaoBanco(opcoes.env),
    ...(opcoes.configuracao || {})
  });
  // O pg remove automaticamente do pool um cliente ocioso que perdeu a
  // conexao. Sem listener, porém, o EventEmitter encerra todo o processo.
  pool.on('error', (erro) => {
    opcoes.onErro?.({
      codigo: String(erro?.code || erro?.name || 'DB_CONNECTION_LOST')
    });
  });
  return pool;
}

async function comTransacao(pool, executar) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await executar(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (erro) {
    try { await cliente.query('ROLLBACK'); } catch (_) { /* preserva o erro original */ }
    throw erro;
  } finally {
    cliente.release();
  }
}

module.exports = {
  POOL_MAX_PADRAO,
  TIMEOUT_CONEXAO_PADRAO_MS,
  comTransacao,
  criarPoolNexus,
  obterConfiguracaoBanco
};
