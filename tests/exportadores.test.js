const test = require('node:test');
const assert = require('node:assert/strict');

const notaSaida = require('../exportadores/postgres/entidades/nota_saida');
const { criarCaminhosExportacao } = require('../exportadores/core/caminhos');
const { montarConsultaPostgres, validarEntidade } = require('../exportadores/core/sql');

test('monta consulta para uma tabela PostgreSQL', () => {
  assert.equal(
    montarConsultaPostgres(notaSaida, { inicio: '2026-07-01', fim: '2026-07-02' }),
    'SELECT * FROM "pg_db"."sysemp"."nota_saida" WHERE ' +
      '("dt_alteracao" >= DATE \'2026-07-01\' AND "dt_alteracao" < DATE \'2026-07-02\') OR ' +
      '("dt_cadastro" >= DATE \'2026-07-01\' AND "dt_cadastro" < DATE \'2026-07-02\')'
  );
});

test('monta consulta nativa sem o alias usado pelo DuckDB', () => {
  assert.match(
    montarConsultaPostgres(notaSaida, { inicio: '2026-07-01', fim: '2026-07-02' }, null),
    /^SELECT \* FROM "sysemp"\."nota_saida" WHERE/
  );
});

test('mantém um único cursor como padrão para outras entidades', () => {
  const entidade = {
    ...notaSaida,
    nome: 'teste',
    extracao: {
      ...notaSaida.extracao,
      cursoresIncrementais: undefined
    }
  };
  assert.match(
    montarConsultaPostgres(entidade, { inicio: '2026-07-01', fim: '2026-07-02' }),
    /WHERE \("dt_alteracao" >=/
  );
});

test('impede incremental sem intervalo de datas', () => {
  assert.throws(() => montarConsultaPostgres(notaSaida), /inicio deve estar/);
});

test('cria caminho particionado e uma execução única', () => {
  const caminhos = criarCaminhosExportacao(
    notaSaida,
    new Date('2026-07-10T14:30:12.345Z')
  );

  assert.match(caminhos.diretorio, /dt_extracao=2026-07-10/);
  assert.match(caminhos.diretorio, /execucao=20260710T143012345Z/);
  assert.match(caminhos.parquet, /dados\.parquet$/);
});

test('rejeita identificadores que poderiam injetar SQL', () => {
  const invalida = { ...notaSaida, tabela: 'nota_saida; DROP TABLE x' };
  assert.throws(() => validarEntidade(invalida), /identificador inválido/);
});

test('rejeita transporte de extração desconhecido', () => {
  const invalida = {
    ...notaSaida,
    extracao: { ...notaSaida.extracao, transporte: 'sql_livre' }
  };
  assert.throws(() => validarEntidade(invalida), /Transporte de extração não suportado/);
});
