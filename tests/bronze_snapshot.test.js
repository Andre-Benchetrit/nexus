const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  criarConexaoDuckDB,
  fecharConexaoDuckDB,
  runDuckDB
} = require('../duckdb/connections');
const { criarLeitorBronze } = require('../duckdb/bronze');

const entidade = {
  nome: 'planilha',
  fonte: 'onedrive',
  destino: { camada: 'bronze' },
  extracao: { estrategiaVisaoAtual: 'ultima_execucao' },
  consulta: { colunasPadrao: ['id', 'nome'] }
};

async function criarSnapshot(raiz, execucao, data, sql, totalLinhas) {
  const diretorio = path.join(
    raiz,
    'bronze',
    'onedrive',
    'planilha',
    `dt_extracao=${data}`,
    `execucao=${execucao}`
  );
  await fs.mkdir(diretorio, { recursive: true });
  const arquivo = path.join(diretorio, 'dados.parquet').replace(/\\/g, '/').replace(/'/g, "''");
  const con = criarConexaoDuckDB();
  try {
    await runDuckDB(con, `COPY (${sql}) TO '${arquivo}' (FORMAT PARQUET)`);
  } finally {
    await fecharConexaoDuckDB(con);
  }
  await fs.writeFile(path.join(diretorio, 'manifest.json'), JSON.stringify({
    entidade: 'planilha',
    status: 'sucesso',
    inicio: `${data}T12:00:00.000Z`,
    fim: `${data}T12:01:00.000Z`,
    totalLinhas,
    arquivo: 'dados.parquet'
  }));
}

test('snapshot atual usa somente a ultima execucao completa', async (t) => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-snapshot-'));
  t.after(() => fs.rm(raiz, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100
  }));
  await criarSnapshot(
    raiz,
    '20260726T120000000Z',
    '2026-07-26',
    `SELECT * FROM (VALUES (1, 'A'), (2, 'B')) AS dados(id, nome)`,
    2
  );
  await criarSnapshot(
    raiz,
    '20260727T120000000Z',
    '2026-07-27',
    `SELECT 1 AS id, 'A atualizado' AS nome`,
    1
  );

  const leitor = criarLeitorBronze({
    raizLake: raiz,
    catalogo: { planilha: entidade }
  });
  try {
    const atual = await leitor.contar('planilha');
    const historico = await leitor.contar('planilha', { visao: 'historico' });
    const linhas = await leitor.consultar('planilha', {
      colunas: ['id', 'nome'],
      limite: 10
    });
    assert.equal(atual.total, 1n);
    assert.equal(historico.total, 3n);
    assert.deepEqual(linhas.dados, [{ id: 1, nome: 'A atualizado' }]);
  } finally {
    await leitor.fechar();
  }
});
