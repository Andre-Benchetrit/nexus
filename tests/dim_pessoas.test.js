const test = require('node:test');
const assert = require('node:assert/strict');

const {
  criarConexaoDuckDB,
  fecharConexaoDuckDB,
  runDuckDB,
  allDuckDB
} = require('../duckdb/connections');
const dimFuncionario = require('../silver/postgres/dimensoes/dim_funcionario');
const dimTransportadora = require('../silver/postgres/dimensoes/dim_transportadora');
const {
  objetos,
  listarObjetosAgente,
  ordenarObjetosPorDependencias
} = require('../silver/catalogo');

test('separa funcionarios e transportadoras de todas as empresas', async () => {
  const con = criarConexaoDuckDB();
  try {
    await runDuckDB(con, `
      CREATE TEMP VIEW cliente_atual AS
      SELECT * FROM (VALUES
        (1, 'FUNCIONARIO EMPRESA 1', NULL, 1, 'F', 'Sao Paulo', 35, 'T', 'T', 'F', 0, DATE '2026-01-01', DATE '2026-07-01'),
        (2, 'TRANSPORTADORA EMPRESA 10', 'TRANSP 10', 10, 'J', 'Barueri', 35, 'T', 'F', 'T', 0, DATE '2026-01-02', DATE '2026-07-02'),
        (3, 'CLIENTE COMUM', NULL, 7, 'J', 'Curitiba', 41, 'T', 'F', 'F', 0, DATE '2026-01-03', DATE '2026-07-03'),
        (4, 'FUNCIONARIO EMPRESA 7', NULL, 7, 'F', 'Curitiba', 41, 'F', 'T', 'F', 0, DATE '2026-01-04', DATE '2026-07-04')
      ) AS dados(
        id_cliente, razsocial, fantasia, id_empresa, pessoafj, cidade, id_uf,
        ativo, funcionario_vend, transportadora, id_funcao, dt_cadastro, dt_alteracao
      )
    `);
    const contextos = new Map([['cliente', { viewAtual: 'cliente_atual' }]]);

    const funcionarios = await allDuckDB(
      con,
      `SELECT id_funcionario, funcionario, id_empresa, funcionario_ativo
       FROM (${dimFuncionario.construirSql(contextos)})
       ORDER BY id_funcionario`
    );
    assert.deepEqual(funcionarios, [
      {
        id_funcionario: 1,
        funcionario: 'FUNCIONARIO EMPRESA 1',
        id_empresa: 1,
        funcionario_ativo: true
      },
      {
        id_funcionario: 4,
        funcionario: 'FUNCIONARIO EMPRESA 7',
        id_empresa: 7,
        funcionario_ativo: false
      }
    ]);

    const transportadoras = await allDuckDB(
      con,
      `SELECT id_transportadora, transportadora, id_empresa
       FROM (${dimTransportadora.construirSql(contextos)})
       ORDER BY id_transportadora`
    );
    assert.deepEqual(transportadoras, [{
      id_transportadora: 2,
      transportadora: 'TRANSP 10',
      id_empresa: 10
    }]);
  } finally {
    await fecharConexaoDuckDB(con);
  }
});

test('catalogo Silver publica as novas dimensoes automaticamente', () => {
  assert.equal(objetos.dim_funcionario, dimFuncionario);
  assert.equal(objetos.dim_transportadora, dimTransportadora);
  assert.equal(dimFuncionario.preservaTotalEntrada, false);
  assert.equal(dimTransportadora.preservaTotalEntrada, false);
  assert.ok(listarObjetosAgente().includes('dim_funcionario'));
  assert.ok(listarObjetosAgente().includes('dim_transportadora'));
  const nomesOrdenados = ordenarObjetosPorDependencias()
    .map((objeto) => objeto.nome);
  assert.ok(nomesOrdenados.includes('dim_funcionario'));
  assert.ok(nomesOrdenados.includes('dim_transportadora'));
});
