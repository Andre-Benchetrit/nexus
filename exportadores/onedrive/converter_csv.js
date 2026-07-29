const {
  allDuckDB,
  criarConexaoDuckDB,
  fecharConexaoDuckDB,
  runDuckDB
} = require('../../duckdb/connections');
const { caminhoParaDuckDB } = require('../core/caminhos');

async function main() {
  const [, , csv, parquet] = process.argv;
  if (!csv || !parquet) throw new Error('Argumentos de conversao incompletos.');
  const con = criarConexaoDuckDB();
  let resultado;
  try {
    await runDuckDB(
      con,
      `COPY (` +
      `SELECT * FROM read_csv('${caminhoParaDuckDB(csv)}', ` +
      `header=true, all_varchar=true, null_padding=true)` +
      `) TO '${caminhoParaDuckDB(parquet)}' (FORMAT PARQUET, COMPRESSION ZSTD);`
    );
    [resultado] = await allDuckDB(
      con,
      `SELECT count(*) AS total, bit_xor(hash(dados)) AS checksum ` +
      `FROM read_parquet('${caminhoParaDuckDB(parquet)}') AS dados`
    );
  } finally {
    await fecharConexaoDuckDB(con);
  }
  console.log(JSON.stringify({
    totalLinhas: Number(resultado.total),
    checksum: resultado.checksum?.toString() || null
  }));
}

main().catch((erro) => {
  console.error(erro.message);
  process.exitCode = 1;
});
