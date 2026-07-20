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
const { criarLeitorSilver } = require('../duckdb/silver');
const dimGrupo = require('../silver/postgres/dim_grupo');
const dimSubgrupo = require('../silver/postgres/dim_subgrupo');
const dimMarca = require('../silver/postgres/dim_marca');
const dimCategoria = require('../silver/postgres/dim_categoria');
const dimProduto = require('../silver/postgres/dim_produto');
const { construirSilver } = require('../silver/core/executar');

const catalogoSilver = {
  dim_grupo: dimGrupo,
  dim_subgrupo: dimSubgrupo,
  dim_marca: dimMarca,
  dim_categoria: dimCategoria,
  dim_produto: dimProduto
};

function entidade(nome, chavePrimaria, cursor) {
  return {
    nome,
    fonte: 'postgres',
    destino: { camada: 'bronze' },
    extracao: { chavePrimaria, cursor }
  };
}

const catalogoBronze = {
  produto: entidade('produto', 'id_produto', 'dt_alteracao'),
  grupo: entidade('grupo', 'id_grupo', 'datamodificacao'),
  subgrupo: entidade('subgrupo', 'id_subgrupo', 'datamodificacao'),
  marca: entidade('marca', 'id_marca', 'datamodificacao'),
  categoria: entidade('categoria', 'id_categoria', 'datamodificacao')
};

let raizLake;
let resultadoConstrucao;
let leitor;

async function criarBronze(nome, sql) {
  const diretorio = path.join(
    raizLake,
    'bronze',
    'postgres',
    nome,
    'dt_extracao=2026-07-17',
    'execucao=20260717T120000000Z'
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
    entidade: nome,
    status: 'sucesso',
    inicio: '2026-07-17T12:00:00.000Z',
    fim: '2026-07-17T12:01:00.000Z',
    totalLinhas: 2,
    arquivo: 'dados.parquet'
  }));
}

test.before(async () => {
  raizLake = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-silver-'));
  await criarBronze('produto', `
    SELECT * FROM (VALUES
      (1, ' Geladeira A ', 'SKU-1', '7891', 'FAB-1', 10, 20, 30, 40,
       5.5::DECIMAL(15,4), 'F', 'T', 'T', DATE '2026-01-01', DATE '2026-07-16'),
      (2, 'Produto inativo', 'SKU-2', NULL, NULL, 10, 20, 31, 40,
       0::DECIMAL(15,4), 'T', 'T', 'T', DATE '2026-01-02', DATE '2026-07-16')
    ) AS dados(
      id_produto, descricao, codigo_auxiliar, cod_barra, cod_fabrica,
      id_grupo, id_subgrupo, id_marca, id_categoria, estoque,
      inativo, disponivel, envia_site, dt_cadastro, dt_alteracao
    )
  `);
  await criarBronze('grupo', `
    SELECT 10 AS id_grupo, 'ELETRODOMESTICO' AS descricao,
      TIMESTAMP '2026-01-01' AS dt_registro,
      TIMESTAMP '2026-07-16 10:00:00' AS datamodificacao,
      NULL::TIMESTAMP AS datamodificacaoserver,
      NULL::TIMESTAMP AS dthr_atualizacao
  `);
  await criarBronze('subgrupo', `
    SELECT 20 AS id_subgrupo, 'REFRIGERADOR' AS descricao,
      TIMESTAMP '2026-01-01' AS dt_registro,
      TIMESTAMP '2026-07-16 10:00:00' AS datamodificacao,
      NULL::TIMESTAMP AS datamodificacaoserver,
      NULL::TIMESTAMP AS dthr_atualizacao
  `);
  await criarBronze('marca', `
    SELECT 30 AS id_marca, 'MARCA A' AS descricao,
      TIMESTAMP '2026-01-01' AS dt_registro,
      TIMESTAMP '2026-07-16 10:00:00' AS datamodificacao,
      NULL::TIMESTAMP AS datamodificacaoserver,
      NULL::TIMESTAMP AS dthr_atualizacao
  `);
  await criarBronze('categoria', `
    SELECT 40 AS id_categoria, 'LINHA BRANCA' AS descricao,
      TIMESTAMP '2026-01-01' AS dt_registro,
      TIMESTAMP '2026-07-16 10:00:00' AS datamodificacao,
      NULL::TIMESTAMP AS datamodificacaoserver,
      NULL::TIMESTAMP AS dthr_atualizacao
  `);

  const dependencias = [dimGrupo, dimSubgrupo, dimMarca, dimCategoria];
  for (const [indice, objeto] of dependencias.entries()) {
    await construirSilver(objeto, {
      raizLake,
      catalogoBronze,
      catalogoSilver,
      agora: new Date(`2026-07-17T12:${10 + indice}:00.000Z`)
    });
  }
  resultadoConstrucao = await construirSilver(dimProduto, {
    raizLake,
    catalogoBronze,
    catalogoSilver,
    agora: new Date('2026-07-17T13:00:00.000Z')
  });
  leitor = criarLeitorSilver({ raizLake, catalogo: catalogoSilver });
});

test.after(async () => {
  await leitor?.fechar();
  await fs.rm(raizLake, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test('materializa a dimensao sem perder produtos', () => {
  assert.equal(resultadoConstrucao.totalLinhas, 2);
  assert.equal(resultadoConstrucao.qualidade.totalEntrada, 2);
  assert.equal(resultadoConstrucao.qualidade.chavesNulas, 0);
  assert.equal(resultadoConstrucao.qualidade.chavesDuplicadas, 0);
});

test('registra relacionamentos ausentes sem eliminar a linha', async () => {
  assert.equal(
    resultadoConstrucao.qualidade.relacionamentos.produtos_sem_marca_correspondente,
    1
  );
  const resultado = await leitor.consultar('dim_produto', {
    colunas: ['id_produto', 'marca'],
    filtros: { id_produto: 2 }
  });
  assert.deepEqual(resultado.dados, [{ id_produto: 2, marca: null }]);
});

test('limpa textos e converte flags T/F em regras de negocio', async () => {
  const resultado = await leitor.consultar('dim_produto', {
    colunas: [
      'id_produto',
      'descricao_produto',
      'grupo',
      'produto_ativo',
      'catalogo_site_ativo'
    ],
    ordenacao: { campo: 'id_produto', direcao: 'asc' }
  });
  assert.deepEqual(resultado.dados, [
    {
      id_produto: 1,
      descricao_produto: 'Geladeira A',
      grupo: 'ELETRODOMESTICO',
      produto_ativo: true,
      catalogo_site_ativo: true
    },
    {
      id_produto: 2,
      descricao_produto: 'Produto inativo',
      grupo: 'ELETRODOMESTICO',
      produto_ativo: false,
      catalogo_site_ativo: false
    }
  ]);
});

test('publica manifesto somente depois das validacoes', async () => {
  const manifesto = JSON.parse(await fs.readFile(resultadoConstrucao.caminhos.manifesto, 'utf8'));
  assert.equal(manifesto.status, 'sucesso');
  assert.equal(manifesto.versaoContrato, 1);
  assert.equal(manifesto.totalLinhas, 2);
  assert.equal(manifesto.fontesBronze.length, 1);
  assert.equal(manifesto.fontesSilver.length, 4);
});

test('agrega a dimensao com filtros estruturados', async () => {
  const resultado = await leitor.agregar('dim_produto', {
    agrupamentos: [{ campo: 'grupo', granularidade: 'valor' }],
    calculos: [{ operacao: 'contar', campo: null }],
    filtros: { produto_ativo: { operador: 'igual', valor: 'true' } }
  });
  assert.deepEqual(resultado.dados, [{ grupo_1: 'ELETRODOMESTICO', calculo_1: 1n }]);
});

test('normaliza timestamp ISO ao filtrar coluna DATE no Silver', async () => {
  const resultado = await leitor.contar('dim_produto', {
    filtros: {
      dt_cadastro: { operador: 'igual', valor: '2026-01-01T03:00:00.000Z' }
    }
  });
  assert.equal(resultado.total, 1n);
});
