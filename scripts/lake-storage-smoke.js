#!/usr/bin/env node

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const { criarConexaoDuckDB, fecharConexaoDuckDB, runDuckDB, allDuckDB } = require('../duckdb/connections');
const { criarLakeStorage } = require('../nexus/lake_storage');

async function main() {
  if (String(process.env.NEXUS_LAKE_STORAGE || '').toLowerCase() !== 's3') {
    throw new Error('O smoke test exige NEXUS_LAKE_STORAGE=s3.');
  }
  const id = randomUUID();
  const prefixoBase = String(process.env.NEXUS_LAKE_PREFIX || 'nexus-lake').replace(/\/+$/g, '');
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-lake-smoke-'));
  const parquet = path.join(raiz, 'dados.parquet').replace(/\\/g, '/');
  const storageBase = criarLakeStorage();
  const envSmoke = { ...process.env, NEXUS_LAKE_PREFIX: `${prefixoBase}/_smoke/${id}` };
  const storage = criarLakeStorage({ env: envSmoke });
  const conLocal = criarConexaoDuckDB();
  let conLocalFechada = false;
  let conRemota;
  try {
    await runDuckDB(conLocal, `COPY (SELECT 1::INTEGER AS id, 'ok'::VARCHAR AS status)
      TO '${parquet.replace(/'/g, "''")}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
    await fecharConexaoDuckDB(conLocal);
    conLocalFechada = true;
    const agora = new Date();
    const manifesto = { objeto: 'smoke_storage', camada: 'gold', status: 'sucesso',
      inicio: agora.toISOString(), fim: agora.toISOString(), execucao: id,
      arquivo: 'dados.parquet', totalLinhas: 1 };
    await storage.publicarSnapshot({ camada: 'gold', objeto: 'smoke_storage', manifesto,
      arquivoOrigem: path.join(raiz, 'dados.parquet'),
      prefixoRelativo: `gold/smoke_storage/execucao=${id}` });
    const versao = await storage.localizarDataset('gold', 'smoke_storage');
    if (!versao) throw new Error('Snapshot de smoke nao foi localizado.');
    if (!/^[a-f0-9]{64}$/.test(versao.manifesto.integridadeObjeto?.sha256 || '') ||
        Number(versao.manifesto.integridadeObjeto?.tamanhoBytes || 0) <= 0) {
      throw new Error('Snapshot de smoke nao possui integridade confirmada.');
    }
    conRemota = criarConexaoDuckDB();
    await storage.prepararConexaoDuckDB(conRemota);
    const [resultado] = await allDuckDB(conRemota,
      `SELECT count(*)::INTEGER AS total FROM read_parquet('${versao.arquivo.replace(/'/g, "''")}')`);
    if (Number(resultado.total) !== 1) throw new Error('Leitura remota retornou contagem inesperada.');
    process.stdout.write(`${JSON.stringify({ status: 'ok', backend: 's3', linhas: 1,
      prefixoTeste: `_smoke/${id}` }, null, 2)}\n`);
  } finally {
    if (!conLocalFechada) await fecharConexaoDuckDB(conLocal).catch(() => {});
    if (conRemota) await fecharConexaoDuckDB(conRemota);
    await storageBase.excluirPrefixoTeste(`_smoke/${id}`).catch(() => {});
    await storage.fechar?.();
    await storageBase.fechar?.();
    await fs.rm(raiz, { recursive: true, force: true });
  }
}

main().catch((erro) => {
  const codigo = String(erro.code || erro.name || 'LAKE_SMOKE_FAILED').replace(/[^A-Za-z0-9_-]/g, '');
  process.stderr.write(`Smoke test do lake falhou: ${codigo}\n`);
  process.exitCode = 1;
});
