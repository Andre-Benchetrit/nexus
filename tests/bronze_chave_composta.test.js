const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  criarConexaoDuckDB,
  fecharConexaoDuckDB,
  runDuckDB
} = require('../duckdb/connections');
const { criarLeitorBronze } = require('../duckdb/bronze');

const entidadeItens = {
  nome: 'itens',
  fonte: 'postgres',
  destino: { camada: 'bronze' },
  extracao: {
    modo: 'incremental_data',
    cursor: 'dthr_atualizacao',
    chavePrimaria: ['id_nota_saida', 'item']
  },
  consulta: {
    colunasPadrao: ['id_nota_saida', 'item', 'quantidade', 'dthr_atualizacao']
  }
};

let raizLake;
let leitor;

async function criarExecucao(data, id, sql, totalLinhas) {
  const diretorio = path.join(
    raizLake,
    'bronze',
    'postgres',
    'itens',
    `dt_extracao=${data}`,
    `execucao=${id}`
  );
  await fs.mkdir(diretorio, { recursive: true });
  const parquet = path.join(diretorio, 'dados.parquet').replace(/\\/g, '/').replace(/'/g, "''");
  const con = criarConexaoDuckDB();
  try {
    await runDuckDB(con, `COPY (${sql}) TO '${parquet}' (FORMAT PARQUET)`);
  } finally {
    await fecharConexaoDuckDB(con);
  }
  await fs.writeFile(path.join(diretorio, 'manifest.json'), JSON.stringify({
    entidade: 'itens',
    status: 'sucesso',
    inicio: `${data}T00:00:00.000Z`,
    fim: `${data}T01:00:00.000Z`,
    totalLinhas,
    arquivo: 'dados.parquet'
  }));
}

test.before(async () => {
  raizLake = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-chave-composta-'));
  await criarExecucao('2026-07-16', '20260716T000000000Z', `
    SELECT * FROM (VALUES
      (100::BIGINT, 1, 2::DECIMAL(15,4), TIMESTAMP '2026-07-16 10:00:00'),
      (100::BIGINT, 2, 1::DECIMAL(15,4), TIMESTAMP '2026-07-16 10:00:00')
    ) AS dados(id_nota_saida, item, quantidade, dthr_atualizacao)
  `, 2);
  await criarExecucao('2026-07-17', '20260717T000000000Z', `
    SELECT 100::BIGINT AS id_nota_saida, 1 AS item,
           3::DECIMAL(15,4) AS quantidade,
           TIMESTAMP '2026-07-17 09:00:00' AS dthr_atualizacao
  `, 1);
  leitor = criarLeitorBronze({ raizLake, catalogo: { itens: entidadeItens } });
});

test.after(async () => {
  await leitor.fechar();
  await fs.rm(raizLake, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test('deduplica pela combinacao de nota e item', async () => {
  assert.equal((await leitor.contar('itens', { visao: 'historico' })).total, 3n);
  assert.equal((await leitor.contar('itens', { visao: 'atual' })).total, 2n);

  const resultado = await leitor.consultar('itens', {
    colunas: ['id_nota_saida', 'item', 'quantidade'],
    ordenacao: { campo: 'item', direcao: 'asc' }
  });
  assert.deepEqual(resultado.dados, [
    { id_nota_saida: 100n, item: 1, quantidade: 3 },
    { id_nota_saida: 100n, item: 2, quantidade: 1 }
  ]);
});

test('busca chave composta somente com todas as partes', async () => {
  const resultado = await leitor.buscarPorId('itens', { id_nota_saida: 100, item: 2 }, {
    colunas: ['id_nota_saida', 'item', 'quantidade']
  });
  assert.deepEqual(resultado.dados, [{ id_nota_saida: 100n, item: 2, quantidade: 1 }]);
  await assert.rejects(leitor.buscarPorId('itens', 100), /exige as chaves: id_nota_saida, item/);
});
