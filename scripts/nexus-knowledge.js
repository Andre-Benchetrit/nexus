#!/usr/bin/env node
require('dotenv').config({ quiet: true });
const { criarPoolNexus } = require('../nexus/db');
const { importarDiretorioLocal, reconciliarOrigensDuplicadas,
  sincronizarDocumentacaoOneDrive } = require('../nexus/documentacao_onedrive');

async function principalSincronizacao(pool) {
  const slug = process.env.NEXUS_KNOWLEDGE_SYNC_PRINCIPAL || 'knowledge-sync';
  const principal = (await pool.query('SELECT id FROM nexus.principals WHERE slug=$1 AND ativo=true', [slug])).rows[0];
  if (!principal) throw new Error(`Principal de sincronizacao nao encontrado: ${slug}.`);
  return principal.id;
}

async function main(argumentos = process.argv.slice(2)) {
  const comando = argumentos[0] || 'status';
  const pool = criarPoolNexus();
  try {
    if (comando === 'sync') {
      const resultado = await sincronizarDocumentacaoOneDrive({ pool,
        principalId: await principalSincronizacao(pool) });
      console.log(JSON.stringify(resultado, null, 2));
      return;
    }
    if (comando === 'import-local') {
      const resultado = await importarDiretorioLocal({ pool,
        principalId: await principalSincronizacao(pool),
        rootPath: argumentos[1] || process.env.NEXUS_KNOWLEDGE_LOCAL_IMPORT_ROOT });
      console.log(JSON.stringify(resultado, null, 2));
      return;
    }
    if (comando === 'reconcile-origins') {
      const resultado = await reconciliarOrigensDuplicadas({ pool,
        principalId: await principalSincronizacao(pool), dryRun: argumentos.includes('--dry-run') });
      console.log(JSON.stringify(resultado, null, 2));
      return;
    }
    if (comando === 'status') {
      const estado = (await pool.query(`SELECT source_key,last_success_at,last_scan_at,status,
        erro_codigo,metadados FROM nexus.knowledge_sync_state ORDER BY source_key`)).rows;
      const fila = (await pool.query(`SELECT status,count(*)::integer AS total
        FROM nexus.knowledge_documents GROUP BY status ORDER BY status`)).rows;
      const porEscopo = (await pool.query(`SELECT d.escopo,COALESCE(dep.nome,'Global') AS setor,
        d.tipo,d.status,count(*)::integer AS total
        FROM nexus.knowledge_documents d LEFT JOIN nexus.departments dep ON dep.id=d.department_id
        GROUP BY d.escopo,dep.nome,d.tipo,d.status ORDER BY d.escopo,setor,d.tipo,d.status`)).rows;
      const slug = process.env.NEXUS_KNOWLEDGE_SYNC_PRINCIPAL || 'knowledge-sync';
      const papeis = (await pool.query(`SELECT r.slug,ra.department_id FROM nexus.role_assignments ra
        JOIN nexus.roles r ON r.id=ra.role_id JOIN nexus.principals p ON p.id=ra.principal_id
        WHERE p.slug=$1 ORDER BY r.slug`, [slug])).rows;
      const permissoesDiretas = (await pool.query(`SELECT pe.codigo,po.efeito,po.department_id,po.expira_em
        FROM nexus.permission_overrides po
        JOIN nexus.permissions pe ON pe.id=po.permission_id
        JOIN nexus.principals p ON p.id=po.principal_id
        WHERE p.slug=$1 AND (po.expira_em IS NULL OR po.expira_em>now())
        ORDER BY pe.codigo,po.department_id NULLS FIRST`, [slug])).rows;
      console.log(JSON.stringify({ estado, documentos: fila, porEscopo,
        sincronizacao: { principal: slug, papeis, permissoesDiretas } }, null, 2));
      return;
    }
    throw new Error('Use sync, import-local [diretorio], reconcile-origins [--dry-run] ou status.');
  } finally { await pool.end(); }
}

if (require.main === module) main().catch((erro) => {
  console.error(`Falha na base de conhecimento: ${erro.message}`);
  process.exitCode = 1;
});

module.exports = { main, principalSincronizacao };
