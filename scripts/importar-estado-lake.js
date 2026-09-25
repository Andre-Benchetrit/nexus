#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const { criarPoolNexus } = require('../nexus/db');
const { criarControlePostgres } = require('../pipeline/controle_postgres');

function argumentos(argv = process.argv.slice(2)) {
  const indice = argv.indexOf('--from');
  if (indice < 0 || !argv[indice + 1]) throw new Error('Use --from <estado.json>.');
  return { arquivo: path.resolve(argv[indice + 1]), aplicar: argv.includes('--apply') };
}

function validarEstado(estado) {
  if (!estado || typeof estado !== 'object' || Array.isArray(estado)) throw new Error('Estado do lake invalido.');
  const entidades = estado.entidades || {};
  for (const [nome, item] of Object.entries(entidades)) {
    if (!/^[a-zA-Z0-9_.-]{1,160}$/.test(nome)) throw new Error(`Entidade invalida no estado: ${nome}.`);
    if (item.fim && !/^\d{4}-\d{2}-\d{2}$/.test(item.fim)) throw new Error(`Watermark invalido para ${nome}.`);
  }
  return { versao: Number(estado.versao || 1), atualizadoEm: estado.atualizadoEm || null, entidades };
}

async function main() {
  const opcoes = argumentos();
  const estado = validarEstado(JSON.parse(await fs.readFile(opcoes.arquivo, 'utf8')));
  const resumo = { arquivo: opcoes.arquivo, entidades: Object.keys(estado.entidades).length,
    modo: opcoes.aplicar ? 'aplicar' : 'dry-run' };
  if (!opcoes.aplicar) {
    process.stdout.write(`${JSON.stringify(resumo, null, 2)}\n`);
    return;
  }
  const pool = criarPoolNexus();
  try {
    await criarControlePostgres(pool).salvarEstado(null, estado);
    process.stdout.write(`${JSON.stringify({ ...resumo, status: 'importado' }, null, 2)}\n`);
  } finally { await pool.end(); }
}

if (require.main === module) main().catch((erro) => {
  process.stderr.write(`Falha ao importar estado do lake: ${erro.message}\n`);
  process.exitCode = 1;
});

module.exports = { argumentos, validarEstado };
