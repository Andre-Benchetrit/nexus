#!/usr/bin/env node

const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const { criarPoolNexus, comTransacao } = require('../nexus/db');
const { slugDoEmail } = require('../nexus/hub');

function argumentos(argv) {
  const saida = {};
  for (let i = 0; i < argv.length; i += 1) {
    const chave = argv[i];
    if (!['--email', '--nome'].includes(chave)) throw new Error(`Opcao desconhecida: ${chave}`);
    saida[chave.slice(2)] = argv[++i];
  }
  if (!saida.email || !saida.nome) throw new Error('Use --email <email> --nome <nome>.');
  return saida;
}

async function bootstrap(pool, dados) {
  const email = String(dados.email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail invalido.');
  const nome = String(dados.nome).trim();
  if (!nome) throw new Error('Nome obrigatorio.');
  return comTransacao(pool, async (cliente) => {
    const principal = (await cliente.query(`
      INSERT INTO nexus.principals (slug,tipo,nome,email,ativo)
      VALUES ($1,'usuario',$2,$3,true)
      ON CONFLICT (slug) DO UPDATE SET nome=EXCLUDED.nome,email=EXCLUDED.email,
        ativo=true,atualizado_em=now() RETURNING id,slug,nome,email,ativo
    `, [slugDoEmail(email), nome, email])).rows[0];
    await cliente.query(`
      INSERT INTO nexus.role_assignments (principal_id,role_id,department_id)
      SELECT $1,id,NULL FROM nexus.roles WHERE slug='administrador'
      ON CONFLICT DO NOTHING
    `, [principal.id]);
    await cliente.query(`INSERT INTO nexus.audit_events
      (principal_id,tipo,recurso,resultado,metadados)
      VALUES ($1,'hub_bootstrap_admin',$2,'success','{}'::jsonb)`, [principal.id, principal.slug]);
    return principal;
  });
}

async function main() {
  const pool = criarPoolNexus();
  try {
    const resultado = await bootstrap(pool, argumentos(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(resultado, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) main().catch((erro) => {
  process.stderr.write(`${erro.message}\n`);
  process.exitCode = 1;
});

module.exports = { argumentos, bootstrap };
