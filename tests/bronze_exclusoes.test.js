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
  nome: 'itens_reconciliados',
  fonte: 'postgres',
  destino: { camada: 'bronze' },
  extracao: {
    modo: 'incremental_data',
    cursor: 'dthr_atualizacao',
    chavePrimaria: ['id_pedido', 'item'],
    reconciliarExclusoes: true
  },
  consulta: {
    colunasPadrao: ['id_pedido', 'item', 'quantidade', 'dthr_atualizacao']
  }
};

async function criarExecucao(raiz, { data, execucao, sqlDados, sqlChaves = null }) {
  const diretorio = path.join(
    raiz,
    'bronze',
    'postgres',
    entidade.nome,
    `dt_extracao=${data}`,
    `execucao=${execucao}`
  );
  await fs.mkdir(diretorio, { recursive: true });
  const parquet = path.join(diretorio, 'dados.parquet').replace(/\\/g, '/').replace(/'/g, "''");
  const parquetChaves = path.join(diretorio, 'chaves_atuais.parquet').replace(/\\/g, '/').replace(/'/g, "''");
  const con = criarConexaoDuckDB();
  try {
    await runDuckDB(con, `COPY (${sqlDados}) TO '${parquet}' (FORMAT PARQUET)`);
    if (sqlChaves) {
      await runDuckDB(con, `COPY (${sqlChaves}) TO '${parquetChaves}' (FORMAT PARQUET)`);
    }
  } finally {
    await fecharConexaoDuckDB(con);
  }

  await fs.writeFile(path.join(diretorio, 'manifest.json'), JSON.stringify({
    entidade: entidade.nome,
    status: 'sucesso',
    inicio: `${data}T10:00:00.000Z`,
    fim: `${data}T10:01:00.000Z`,
    totalLinhas: 1,
    arquivo: 'dados.parquet',
    reconciliacaoExclusoes: sqlChaves
      ? {
          estrategia: 'snapshot_chaves_atuais',
          arquivo: 'chaves_atuais.parquet',
          totalChaves: 1
        }
      : null
  }));
}

test('visao atual remove chaves ausentes na origem e historico preserva auditoria', async (t) => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-exclusoes-'));
  t.after(() => fs.rm(raiz, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100
  }));

  await criarExecucao(raiz, {
    data: '2026-08-10',
    execucao: '20260810T100000000Z',
    sqlDados: `
      SELECT * FROM (VALUES
        (100::BIGINT, 1, 2, TIMESTAMP '2026-08-10 09:00:00'),
        (100::BIGINT, 2, 1, TIMESTAMP '2026-08-10 09:00:00')
      ) AS dados(id_pedido, item, quantidade, dthr_atualizacao)
    `
  });
  await criarExecucao(raiz, {
    data: '2026-08-11',
    execucao: '20260811T100000000Z',
    sqlDados: `
      SELECT 100::BIGINT AS id_pedido, 1 AS item, 3 AS quantidade,
             TIMESTAMP '2026-08-11 09:00:00' AS dthr_atualizacao
    `,
    sqlChaves: `SELECT 100::BIGINT AS id_pedido, 1 AS item`
  });

  const leitor = criarLeitorBronze({
    raizLake: raiz,
    catalogo: { [entidade.nome]: entidade }
  });
  try {
    assert.equal((await leitor.contar(entidade.nome)).total, 1n);
    assert.equal((await leitor.contar(entidade.nome, { visao: 'historico' })).total, 3n);

    const atual = await leitor.consultar(entidade.nome, {
      colunas: ['id_pedido', 'item', 'quantidade'],
      limite: 10
    });
    assert.deepEqual(atual.dados, [
      { id_pedido: 100n, item: 1, quantidade: 3 }
    ]);

    const contexto = await leitor.prepararEntidade(entidade.nome);
    assert.equal(contexto.reconciliacaoExclusoes.estrategia, 'snapshot_chaves_atuais');
  } finally {
    await leitor.fechar();
  }
});

test('mantem compatibilidade enquanto ainda nao existe carga com snapshot de chaves', async (t) => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-exclusoes-legado-'));
  t.after(() => fs.rm(raiz, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100
  }));

  await criarExecucao(raiz, {
    data: '2026-08-10',
    execucao: '20260810T100000000Z',
    sqlDados: `
      SELECT 100::BIGINT AS id_pedido, 1 AS item, 2 AS quantidade,
             TIMESTAMP '2026-08-10 09:00:00' AS dthr_atualizacao
    `
  });

  const leitor = criarLeitorBronze({
    raizLake: raiz,
    catalogo: { [entidade.nome]: entidade }
  });
  try {
    assert.equal((await leitor.contar(entidade.nome)).total, 1n);
    const contexto = await leitor.prepararEntidade(entidade.nome);
    assert.equal(contexto.reconciliacaoExclusoes, null);
  } finally {
    await leitor.fechar();
  }
});
