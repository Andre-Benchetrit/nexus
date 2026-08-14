const path = require('node:path');
const { randomUUID } = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
const { criarPoolNexus } = require('../nexus/db');
const { ErroAutorizacao, criarServicoGovernanca } = require('../nexus/governanca');

async function main() {
  const pool = criarPoolNexus();
  const cliente = await pool.connect();
  const sufixo = randomUUID();
  try {
    await cliente.query('BEGIN');
    const principal = (await cliente.query(`
      INSERT INTO nexus.principals (slug,tipo,nome)
      VALUES ($1,'tecnico','Smoke test') RETURNING id
    `, [`smoke-${sufixo}`])).rows[0];
    const audit = criarServicoGovernanca({
      pool: cliente, principalSlug: `smoke-${sufixo}`, sessao: 'smoke-audit', modo: 'audit'
    });
    const execucao = await audit.iniciarTool('analisar_vendas', { limite: 10 }, {
      provider: 'smoke', modelo: 'smoke'
    });
    await audit.concluirTool(execucao, { sucesso: true, duracaoMs: 1 });
    const enforce = criarServicoGovernanca({
      pool: cliente, principalSlug: `smoke-${sufixo}`, sessao: 'smoke-enforce', modo: 'enforce'
    });
    await assertNegada(enforce.iniciarTool('analisar_vendas', { limite: 10 }));
    const contagem = (await cliente.query(`
      SELECT
        (SELECT count(*)::int FROM nexus.authorization_decisions WHERE principal_id=$1) AS decisoes,
        (SELECT count(*)::int FROM nexus.tool_executions WHERE principal_id=$1) AS execucoes,
        (SELECT count(*)::int FROM nexus.audit_events WHERE principal_id=$1) AS eventos
    `, [principal.id])).rows[0];
    if (contagem.decisoes !== 2 || contagem.execucoes !== 2 || contagem.eventos !== 1) {
      throw new Error('Smoke test nao confirmou as gravacoes esperadas.');
    }
    await cliente.query('ROLLBACK');
    console.log(JSON.stringify({ status: 'ok', transacao: 'rollback', ...contagem }));
  } catch (erro) {
    try { await cliente.query('ROLLBACK'); } catch (_) { /* preserva erro */ }
    throw erro;
  } finally {
    cliente.release();
    await pool.end();
  }
}

async function assertNegada(promessa) {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof ErroAutorizacao) return;
    throw erro;
  }
  throw new Error('Modo enforce nao bloqueou a tool sem permissao.');
}

main().catch((erro) => {
  console.error(`Erro: ${erro.message}`);
  process.exitCode = 1;
});
