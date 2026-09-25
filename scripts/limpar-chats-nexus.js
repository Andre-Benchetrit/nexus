#!/usr/bin/env node

const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const { criarPoolNexus } = require('../nexus/db');
const { criarServicoHub } = require('../nexus/hub');
const { criarAttachmentStorage } = require('../nexus/attachment_storage');
const { criarServicoAnexos } = require('../nexus/anexos');
const { criarServicoInteligenciaAnexos } = require('../nexus/attachment_intelligence_store');
const { criarArtifactStorage } = require('../nexus/artifact_storage');
const { criarServicoArtefatos } = require('../nexus/artefatos');
const { criarDatasetStorage } = require('../nexus/dataset_storage');
const { criarServicoDatasets } = require('../nexus/datasets');

function argumentos(argv = process.argv.slice(2)) {
  const aplicar = argv.includes('--apply');
  const indice = argv.indexOf('--confirmation');
  const confirmacao = indice >= 0 ? argv[indice + 1] : null;
  if (aplicar && !confirmacao) throw new Error('Use --apply --confirmation <token-do-dry-run>.');
  return { aplicar, confirmacao };
}

function tokenConfirmacao(corte, ids) {
  const hash = crypto.createHash('sha256').update(`${corte}\n${ids.join('\n')}`).digest('hex');
  return `${Buffer.from(corte).toString('base64url')}.${hash}`;
}

function corteDoToken(token) {
  const [codificado, hash] = String(token || '').split('.');
  if (!codificado || !/^[0-9a-f]{64}$/.test(hash || '')) throw new Error('Token de confirmacao invalido.');
  const corte = Buffer.from(codificado, 'base64url').toString('utf8');
  if (!Number.isFinite(Date.parse(corte))) throw new Error('Token de confirmacao possui data invalida.');
  return new Date(corte).toISOString();
}

const CANDIDATAS = `
  SELECT c.id,c.principal_id,p.slug
  FROM nexus.conversations c
  JOIN nexus.principals p ON p.id=c.principal_id
  WHERE c.criada_em<=$1::timestamptz AND (
    c.titulo IS NOT NULL OR c.arquivada_em IS NULL OR
    EXISTS (SELECT 1 FROM nexus.conversation_messages m WHERE m.conversation_id=c.id) OR
    EXISTS (SELECT 1 FROM nexus.conversation_attachments a WHERE a.conversation_id=c.id) OR
    EXISTS (SELECT 1 FROM nexus.conversation_artifacts ar WHERE ar.conversation_id=c.id) OR
    EXISTS (SELECT 1 FROM nexus.conversation_datasets d WHERE d.conversation_id=c.id)
  )`;

async function inventario(pool, corte) {
  const conversas = (await pool.query(`${CANDIDATAS} ORDER BY c.id`, [corte])).rows;
  const ids = conversas.map((item) => item.id);
  if (!ids.length) return { corte, conversas, ids, mensagens: 0, anexos: 0,
    artefatos: 0, datasets: 0, bytes: 0 };
  const contagens = (await pool.query(`WITH candidatas AS (${CANDIDATAS}) SELECT
    (SELECT count(*)::int FROM nexus.conversation_messages m JOIN candidatas c ON c.id=m.conversation_id) AS mensagens,
    (SELECT count(*)::int FROM nexus.conversation_attachments a JOIN candidatas c ON c.id=a.conversation_id) AS anexos,
    (SELECT count(*)::int FROM nexus.conversation_artifacts ar JOIN candidatas c ON c.id=ar.conversation_id) AS artefatos,
    (SELECT count(*)::int FROM nexus.conversation_datasets d JOIN candidatas c ON c.id=d.conversation_id) AS datasets,
    COALESCE((SELECT sum(a.bytes)::bigint FROM nexus.conversation_attachments a JOIN candidatas c ON c.id=a.conversation_id),0)+
    COALESCE((SELECT sum(ar.bytes)::bigint FROM nexus.conversation_artifacts ar JOIN candidatas c ON c.id=ar.conversation_id),0) AS bytes`,
  [corte])).rows[0];
  return { corte, conversas, ids, mensagens: Number(contagens.mensagens),
    anexos: Number(contagens.anexos), artefatos: Number(contagens.artefatos),
    datasets: Number(contagens.datasets), bytes: Number(contagens.bytes) };
}

async function limparConversa({ pool, storages, conversa }) {
  const ator = { principalId: conversa.principal_id, principalSlug: conversa.slug };
  const inteligencia = criarServicoInteligenciaAnexos({ pool, storage: storages.anexos,
    principalId: conversa.principal_id });
  const anexos = criarServicoAnexos({ pool, storage: storages.anexos,
    principalId: conversa.principal_id, inteligencia });
  const artefatos = criarServicoArtefatos({ pool, storage: storages.artefatos,
    principalId: conversa.principal_id });
  const datasets = criarServicoDatasets({ pool, storage: storages.datasets,
    principalId: conversa.principal_id, modo: 'v1' });
  const hub = criarServicoHub({ pool, ...ator });
  const [chavesAnexos, chavesArtefatos, chavesDatasets] = await Promise.all([
    anexos.chavesDaConversa(conversa.id), artefatos.chavesDaConversa(conversa.id),
    datasets.chavesDaConversa(conversa.id)
  ]);
  // Conhecimento ja aprovado sobrevive ao descarte do chat de origem.
  await pool.query(`UPDATE nexus.knowledge_items k SET source_candidate_id=NULL
    FROM nexus.memory_candidates mc
    WHERE k.source_candidate_id=mc.id AND mc.conversation_id=$1`, [conversa.id]);
  await hub.excluirConversa(conversa.id);
  await anexos.finalizarExclusaoConversa(conversa.id, chavesAnexos);
  await artefatos.finalizarExclusaoConversa(conversa.id, chavesArtefatos);
  await datasets.finalizarExclusaoConversa(conversa.id, chavesDatasets);
}

async function executar(opcoes = {}, dependencias = {}) {
  const pool = dependencias.pool || criarPoolNexus();
  const corte = opcoes.confirmacao ? corteDoToken(opcoes.confirmacao) : new Date().toISOString();
  const dados = await inventario(pool, corte);
  const token = tokenConfirmacao(corte, dados.ids);
  const resumo = { modo: opcoes.aplicar ? 'apply' : 'dry-run', corte,
    conversas: dados.ids.length, mensagens: dados.mensagens, anexos: dados.anexos,
    artefatos: dados.artefatos, datasets: dados.datasets, bytes: dados.bytes,
    confirmation: token, processadas: 0 };
  if (!opcoes.aplicar) {
    if (!dependencias.pool) await pool.end();
    return resumo;
  }
  if (token !== opcoes.confirmacao) {
    if (!dependencias.pool) await pool.end();
    const erro = new Error('O inventario mudou desde o dry-run; gere uma nova confirmacao.');
    erro.codigo = 'CHAT_CLEANUP_CONFIRMATION_MISMATCH'; throw erro;
  }
  const storages = dependencias.storages || {
    anexos: criarAttachmentStorage(), artefatos: criarArtifactStorage(), datasets: criarDatasetStorage()
  };
  try {
    for (const conversa of dados.conversas) {
      await limparConversa({ pool, storages, conversa });
      resumo.processadas += 1;
      dependencias.onEvento?.({ processadas: resumo.processadas, total: dados.ids.length });
    }
    return resumo;
  } finally {
    if (!dependencias.pool) await pool.end();
  }
}

async function main() {
  const resultado = await executar(argumentos(), { onEvento: (evento) => {
    process.stdout.write(`${JSON.stringify({ level: 'info', event: 'chat_cleanup_progress', ...evento })}\n`);
  } });
  process.stdout.write(`${JSON.stringify({ level: 'info', event: 'chat_cleanup_finished', ...resultado }, null, 2)}\n`);
}

if (require.main === module) main().catch((erro) => {
  const codigo = String(erro.codigo || erro.code || erro.name || 'CHAT_CLEANUP_FAILED')
    .replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  process.stderr.write(`${JSON.stringify({ level: 'error', event: 'chat_cleanup_failed', code: codigo })}\n`);
  process.exitCode = 1;
});

module.exports = { argumentos, corteDoToken, executar, inventario, limparConversa, tokenConfirmacao };
