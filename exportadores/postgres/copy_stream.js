const fs = require('fs');
const { pipeline } = require('stream/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const { to: copyTo } = require('pg-copy-streams');
const iconv = require('iconv-lite');
const pool = require('../../config/db');
const executarArquivo = promisify(execFile);

const CODIFICACOES_SUPORTADAS = Object.freeze({
  UTF8: null,
  WIN1252: 'win1252',
  LATIN1: 'latin1'
});

async function exportarConsultaParaCsv(consulta, arquivo, dependencias = {}) {
  const poolUsado = dependencias.pool || pool;
  const criarCopy = dependencias.copyTo || copyTo;
  const executarPipeline = dependencias.pipeline || pipeline;
  const criarDestino = dependencias.criarWriteStream || fs.createWriteStream;
  const cliente = await poolUsado.connect();
  try {
    const respostaEncoding = await cliente.query('SHOW server_encoding');
    const encodingServidor = String(respostaEncoding.rows?.[0]?.server_encoding || 'UTF8').toUpperCase();
    if (!Object.hasOwn(CODIFICACOES_SUPORTADAS, encodingServidor)) {
      throw new Error(`Codificacao PostgreSQL nao suportada no streaming: ${encodingServidor}.`);
    }
    const comando = `COPY (${consulta}) TO STDOUT WITH (FORMAT CSV, HEADER true, NULL '\\N', ENCODING '${encodingServidor}')`;
    const origem = cliente.query(criarCopy(comando));
    const destino = criarDestino(arquivo);
    const codec = CODIFICACOES_SUPORTADAS[encodingServidor];
    if (codec) {
      await executarPipeline(origem, iconv.decodeStream(codec), iconv.encodeStream('utf8'), destino);
    } else {
      await executarPipeline(origem, destino);
    }
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
