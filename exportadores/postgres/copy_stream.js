const fs = require('fs');
const { pipeline } = require('stream/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const { to: copyTo } = require('pg-copy-streams');
const pool = require('../../config/db');
const executarArquivo = promisify(execFile);

async function exportarConsultaParaCsv(consulta, arquivo, dependencias = {}) {
  const poolUsado = dependencias.pool || pool;
  const criarCopy = dependencias.copyTo || copyTo;
  const executarPipeline = dependencias.pipeline || pipeline;
  const criarDestino = dependencias.criarWriteStream || fs.createWriteStream;
  const cliente = await poolUsado.connect();
  try {
    const comando = `COPY (${consulta}) TO STDOUT WITH (FORMAT CSV, HEADER true, NULL '\\N', ENCODING 'UTF8')`;
    const origem = cliente.query(criarCopy(comando));
    await executarPipeline(origem, criarDestino(arquivo));
  } finally {
    cliente.release();
  }
}

async function converterCsvParaParquet({ schema, tabela, csv, parquet, colunas }, dependencias = {}) {
  const executar = dependencias.executarArquivo || executarArquivo;
  const executavel = dependencias.execPath || process.execPath;
  const script = dependencias.script || path.join(__dirname, 'converter_csv.js');
  await executar(executavel, [script, schema, tabela, csv, parquet, JSON.stringify(colunas || ['*'])], {
    env: process.env,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
}

module.exports = { exportarConsultaParaCsv, converterCsvParaParquet };
