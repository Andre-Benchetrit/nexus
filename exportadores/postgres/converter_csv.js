require('dotenv').config({ quiet: true });

const {
  criarConexaoDuckDB,
  fecharConexaoDuckDB,
  runDuckDB,
  prepararPostgresDuckDB,
  conectarPostgresNoDuckDB
} = require('../../duckdb/connections');
const { caminhoParaDuckDB } = require('../core/caminhos');

const IDENTIFICADOR_SEGURO = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;

function citarIdentificador(valor) {
  if (!IDENTIFICADOR_SEGURO.test(valor || '')) throw new Error(`Identificador inválido: ${valor}`);
  return `"${valor}"`;
}

async function main() {
  const [, , schema, tabela, csv, parquet, colunasJson] = process.argv;
  if (!schema || !tabela || !csv || !parquet) throw new Error('Argumentos de conversão incompletos.');
  const colunas = JSON.parse(colunasJson || '["*"]');
  if (!Array.isArray(colunas) || !colunas.length) throw new Error('Lista de colunas de conversão inválida.');
  const selecao = colunas.length === 1 && colunas[0] === '*'
    ? '*'
    : colunas.map(citarIdentificador).join(', ');

  const con = criarConexaoDuckDB();
  try {
    await prepararPostgresDuckDB(con);
    await runDuckDB(con, 'SET pg_use_binary_copy=false;');
    await conectarPostgresNoDuckDB(con);

    const origem = `pg_db.${citarIdentificador(schema)}.${citarIdentificador(tabela)}`;
    const arquivoCsv = caminhoParaDuckDB(csv);
    const arquivoParquet = caminhoParaDuckDB(parquet);
    await runDuckDB(con, `CREATE TEMP TABLE staging AS SELECT ${selecao} FROM ${origem} LIMIT 0;`);
    await runDuckDB(con, `COPY staging FROM '${arquivoCsv}' (FORMAT CSV, HEADER true, NULL '\\N');`);
    await runDuckDB(con, `COPY staging TO '${arquivoParquet}' (FORMAT PARQUET, COMPRESSION ZSTD);`);
  } finally {
    await fecharConexaoDuckDB(con);
  }
}

main().catch((erro) => {
  console.error(erro.message);
  process.exitCode = 1;
});
