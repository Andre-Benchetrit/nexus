const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
const { criarPoolNexus } = require('../nexus/db');
const { importarManifesto, lerManifesto } = require('../nexus/pricing');

async function main() {
  const acao = process.argv[2];
  const pool = criarPoolNexus();
  try {
    if (acao === 'import') {
      const manifesto = lerManifesto(process.argv[3]);
      console.log(JSON.stringify(await importarManifesto(pool, manifesto), null, 2));
      return;
    }
    if (acao === 'status') {
      const resultado = (await pool.query(`
        SELECT
          (SELECT count(*)::int FROM nexus.pricing_rates) AS tarifas,
          (SELECT count(*)::int FROM nexus.exchange_rates) AS cambios,
          (SELECT count(*)::int FROM nexus.llm_calls WHERE status='sucesso' AND NOT pricing_complete) AS chamadas_sem_preco,
          (SELECT count(*)::int FROM nexus.usage_line_items WHERE pricing_status='pricing_missing') AS itens_sem_tarifa,
          (SELECT count(*)::int FROM nexus.usage_line_items
             WHERE pricing_status='priced' AND exchange_rate_id IS NULL) AS itens_sem_cambio,
          (SELECT count(*)::int FROM nexus.llm_calls WHERE status='iniciada') AS chamadas_pendentes
      `)).rows[0];
      console.log(JSON.stringify(resultado, null, 2));
      return;
    }
    throw new Error('Use import ou status.');
  } finally { await pool.end(); }
}

main().catch((erro) => { console.error(`Erro: ${erro.message}`); process.exitCode = 1; });
