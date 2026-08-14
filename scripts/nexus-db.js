const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
const { criarPoolNexus } = require('../nexus/db');
const { aplicarMigrations, obterStatusMigrations } = require('../nexus/migrations');

async function main() {
  const acao = process.argv[2];
  const pool = criarPoolNexus();
  try {
    if (acao === 'migrate') {
      const aplicadas = await aplicarMigrations(pool);
      console.log(aplicadas.length ? `Migrations aplicadas: ${aplicadas.join(', ')}` : 'Banco atualizado.');
      return;
    }
    if (acao === 'status') {
      const status = await obterStatusMigrations(pool);
      console.log(JSON.stringify(status, null, 2));
      if (status.some((item) => item.status !== 'aplicada')) process.exitCode = 1;
      return;
    }
    if (acao === 'health') {
      const resultado = await pool.query('SELECT current_database() AS banco, now() AS agora');
      console.log(JSON.stringify({ status: 'ok', banco: Boolean(resultado.rows[0].banco), agora: resultado.rows[0].agora }));
      return;
    }
    if (acao === 'audit-status') {
      const resultado = await pool.query(`
        SELECT
          (SELECT count(*)::int FROM nexus.authorization_decisions) AS decisoes,
          (SELECT count(*)::int FROM nexus.tool_executions) AS execucoes,
          (SELECT count(*)::int FROM nexus.tool_executions WHERE status='iniciada') AS pendentes,
          (SELECT count(*)::int FROM nexus.audit_events) AS eventos
      `);
      const decisoes = (await pool.query(`
        SELECT decisao, count(*)::int AS quantidade
        FROM nexus.authorization_decisions GROUP BY decisao ORDER BY decisao
      `)).rows;
      const exposicoes = (await pool.query(`
        SELECT
          (SELECT count(*)::int FROM nexus.tool_executions
           WHERE argument_keys::text ~* '(password|senha|secret|token|api.?key|sql)') AS chaves_sensiveis,
          (SELECT count(*)::int FROM nexus.audit_events
           WHERE metadados::text ~* 'postgres(ql)?://') AS conexoes_expostas
      `)).rows[0];
      console.log(JSON.stringify({
        status: exposicoes.chaves_sensiveis === 0 && exposicoes.conexoes_expostas === 0
          ? 'ok' : 'revisar',
        ...resultado.rows[0], decisoes, exposicoes
      }));
      return;
    }
    throw new Error('Use migrate, status, health ou audit-status.');
  } finally {
    await pool.end();
  }
}

main().catch((erro) => {
  console.error(`Erro: ${erro.message}`);
  process.exitCode = 1;
});
