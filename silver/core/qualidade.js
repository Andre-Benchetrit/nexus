const { allDuckDB } = require('../../duckdb/connections');
const { normalizarChavesPrimarias } = require('../../exportadores/core/sql');
const { caminhoParaDuckDB } = require('./caminhos');

function citar(nome) {
  return `"${nome.replace(/"/g, '""')}"`;
}

function numero(valor) {
  return Number(valor || 0);
}

async function validarArquivoSilver(con, arquivo, objeto, totalEntrada) {
  const arquivoSql = caminhoParaDuckDB(arquivo);
  const schema = await allDuckDB(
    con,
    `DESCRIBE SELECT * FROM read_parquet('${arquivoSql}', hive_partitioning=false)`
  );
  const colunasEncontradas = schema.map((coluna) => coluna.column_name);
  if (JSON.stringify(colunasEncontradas) !== JSON.stringify(objeto.colunas)) {
    throw new Error(
      `Schema inesperado em ${objeto.nome}. ` +
      `Esperado: ${objeto.colunas.join(', ')}. ` +
      `Encontrado: ${colunasEncontradas.join(', ')}.`
    );
  }

  const chaves = normalizarChavesPrimarias(objeto.chavePrimaria);
  if (!chaves.length) throw new Error(`Objeto Silver sem chave primaria: ${objeto.nome}.`);
  const algumaChaveNula = chaves.map((chave) => `${citar(chave)} IS NULL`).join(' OR ');
  const expressaoDistinta = chaves.length === 1
    ? citar(chaves[0])
    : `(${chaves.map(citar).join(', ')})`;
  const [resultado] = await allDuckDB(con, `
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE ${algumaChaveNula}) AS chaves_nulas,
      count(*) - count(DISTINCT ${expressaoDistinta}) -
        count(*) FILTER (WHERE ${algumaChaveNula}) AS chaves_duplicadas,
      bit_xor(hash(dados)) AS checksum
    FROM read_parquet('${arquivoSql}', hive_partitioning=false) AS dados
  `);

  const metricas = {
    totalEntrada: Number(totalEntrada),
    totalSaida: numero(resultado.total),
    chavesNulas: numero(resultado.chaves_nulas),
    chavesDuplicadas: numero(resultado.chaves_duplicadas),
    checksum: resultado.checksum?.toString() || null
  };
  const erros = [];
  if (metricas.totalSaida !== metricas.totalEntrada) {
    erros.push(`entrada=${metricas.totalEntrada}, saida=${metricas.totalSaida}`);
  }
  if (metricas.chavesNulas) erros.push(`chaves nulas=${metricas.chavesNulas}`);
  if (metricas.chavesDuplicadas) erros.push(`chaves duplicadas=${metricas.chavesDuplicadas}`);
  if (erros.length) {
    throw new Error(`Qualidade reprovada em ${objeto.nome}: ${erros.join('; ')}.`);
  }

  return { ...metricas, schema };
}

module.exports = { validarArquivoSilver };
