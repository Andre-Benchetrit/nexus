const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
const { criarPoolNexus } = require('../nexus/db');
const { relatorioComparativo, relatorioExecutivo, relatorioTrace } = require('../nexus/relatorios_uso');

function argumentos(lista) {
  const opcoes = {};
  for (let i = 0; i < lista.length; i += 1) {
    if (!lista[i].startsWith('--')) continue;
    opcoes[lista[i].slice(2)] = lista[++i];
  }
  return opcoes;
}

async function main() {
  const acao = process.argv[2];
  const pool = criarPoolNexus();
  try {
    const resultado = acao === 'trace'
      ? await relatorioTrace(pool, process.argv[3])
      : acao === 'compare'
        ? await relatorioComparativo(pool, argumentos(process.argv.slice(3)))
        : await relatorioExecutivo(pool, argumentos(process.argv.slice(3)));
    console.log(JSON.stringify(resultado, null, 2));
  } finally { await pool.end(); }
}

main().catch((erro) => { console.error(`Erro: ${erro.message}`); process.exitCode = 1; });
