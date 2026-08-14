const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });
const { criarPoolNexus } = require('../nexus/db');
const {
  exportarConhecimento,
  importarMemoria,
  verificarMemoria
} = require('../nexus/migracao_memoria');

async function main() {
  const acao = process.argv[2];
  const pool = criarPoolNexus();
  try {
    if (acao === 'import') {
      console.log(JSON.stringify(await importarMemoria(pool), null, 2));
      return;
    }
    if (acao === 'verify') {
      const resultado = await verificarMemoria(pool);
      console.log(JSON.stringify(resultado, null, 2));
      if (resultado.status !== 'ok') process.exitCode = 1;
      return;
    }
    if (acao === 'export-knowledge') {
      const destino = process.argv[3];
      const resultado = await exportarConhecimento(pool);
      if (destino) {
        const absoluto = path.resolve(destino);
        fs.mkdirSync(path.dirname(absoluto), { recursive: true });
        fs.writeFileSync(absoluto, `${JSON.stringify(resultado, null, 2)}\n`, 'utf8');
        console.log(`Conhecimento exportado para ${absoluto}.`);
      } else console.log(JSON.stringify(resultado, null, 2));
      return;
    }
    throw new Error('Use import, verify ou export-knowledge [arquivo].');
  } finally {
    await pool.end();
  }
}

main().catch((erro) => {
  console.error(`Erro: ${erro.message}`);
  process.exitCode = 1;
});
