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

const entidadeCliente = {
  nome: 'cliente',
  fonte: 'postgres',
  destino: { camada: 'bronze' },
  extracao: {
    modo: 'incremental_data',
    cursor: 'dt_alteracao',
    chavePrimaria: 'id_cliente'
  },
  consulta: {
    colunasPadrao: ['id_cliente', 'nome', 'dt_alteracao']
  }
};

let raizTemporaria;
let leitor;

async function criarExecucao({ id, dataExtracao, sql, status = 'sucesso', totalLinhas }) {
  const diretorio = path.join(
    raizTemporaria,
    'bronze',
    'postgres',
    'cliente',
    `dt_extracao=${dataExtracao}`,
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
    entidade: 'cliente',
    status,
    inicio: `${dataExtracao}T00:00:00.000Z`,
    fim: `${dataExtracao}T01:00:00.000Z`,
    totalLinhas,
    arquivo: 'dados.parquet'
  }));
}

test.before(async () => {
  raizTemporaria = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-bronze-'));

  await criarExecucao({
    id: '20260101T000000000Z',
    dataExtracao: '2026-01-01',
    totalLinhas: 2,
    sql: `
      SELECT * FROM (VALUES
        (1, 'Ana', DATE '2026-01-01'),
        (2, 'Bia', DATE '2026-01-01')
      ) AS dados(id_cliente, nome, dt_alteracao)
    `
  });

  await criarExecucao({
    id: '20260102T000000000Z',
    dataExtracao: '2026-01-02',
    totalLinhas: 1,
    sql: `
      SELECT 1 AS id_cliente, 'Ana nova' AS nome,
             DATE '2026-01-02' AS dt_alteracao,
             'ana@example.com' AS email
    `
  });

  await criarExecucao({
    id: '20260103T000000000Z',
    dataExtracao: '2026-01-03',
    totalLinhas: 1,
    status: 'falha',
    sql: `
      SELECT 3 AS id_cliente, 'Carga ignorada' AS nome,
             DATE '2026-01-03' AS dt_alteracao
    `
  });

  leitor = criarLeitorBronze({
    raizLake: raizTemporaria,
    catalogo: { cliente: entidadeCliente }
  });
});

test.after(async () => {
  await leitor.fechar();
  await fs.rm(raizTemporaria, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
});

test('lista somente execuções concluídas com sucesso', async () => {
  const [resultado] = await leitor.listarEntidades();
  assert.deepEqual(resultado, {
    entidade: 'cliente',
    disponivel: true,
    execucoes: 2,
    totalLinhasManifestos: 3,
    ultimaExtracao: '2026-01-02T01:00:00.000Z'
  });
});

test('mantém histórico e deduplica a visão atual pela chave', async () => {
  const historico = await leitor.contar('cliente', { visao: 'historico' });
  const atual = await leitor.contar('cliente', { visao: 'atual' });
  const anas = await leitor.contar('cliente', {
    visao: 'atual',
    filtros: { nome: 'Ana nova' }
  });
  assert.equal(historico.total, 3n);
  assert.equal(atual.total, 2n);
  assert.equal(anas.total, 1n);
});

test('retorna a versão mais recente e aceita evolução de schema', async () => {
  const resultado = await leitor.buscarPorId('cliente', 1, {
    colunas: ['id_cliente', 'nome', 'email', 'dt_alteracao']
  });
  assert.equal(resultado.totalRetornado, 1);
  assert.equal(resultado.dados[0].nome, 'Ana nova');
  assert.equal(resultado.dados[0].email, 'ana@example.com');

  const schema = await leitor.descreverEntidade('cliente');
  assert.ok(schema.some((coluna) => coluna.nome === 'email'));
});

test('filtra texto parcialmente sem diferenciar maiúsculas e combina com OU', async () => {
  const resultado = await leitor.contar('cliente', {
    visao: 'atual',
    filtros: {
      nome: { operador: 'contem', valor: 'ANA' },
      email: { operador: 'contem', valor: 'inexistente' }
    },
    combinacaoFiltros: 'qualquer'
  });
  assert.equal(resultado.total, 1n);
});

test('rejeita coluna desconhecida e limites excessivos', async () => {
  await assert.rejects(
    leitor.consultar('cliente', { colunas: ['senha'] }),
    /Coluna não encontrada/
  );
  await assert.rejects(
    leitor.consultar('cliente', { limite: 501 }),
    /limite deve ser/
  );
});
