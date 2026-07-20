const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('stream');

const {
  exportarConsultaParaCsv,
  converterCsvParaParquet
} = require('../exportadores/postgres/copy_stream');
const { operacaoArquivoComRetentativas } = require('../exportadores/postgres/exportar');

test('exporta a consulta por streaming e sempre libera o cliente PostgreSQL', async () => {
  let comandoCopy;
  let liberado = false;
  let conteudo = '';
  const cliente = {
    query(comando) {
      assert.deepEqual(comando, { tipo: 'copy', sql: comandoCopy });
      return Readable.from(['id,nome\n1,Cliente\n']);
    },
    release() { liberado = true; }
  };

  await exportarConsultaParaCsv('SELECT * FROM "public"."cliente"', 'temporario.csv', {
    pool: { async connect() { return cliente; } },
    copyTo(sql) {
      comandoCopy = sql;
      return { tipo: 'copy', sql };
    },
    criarWriteStream() {
      return new Writable({
        write(chunk, _, callback) {
          conteudo += chunk.toString();
          callback();
        }
      });
    }
  });

  assert.match(comandoCopy, /^COPY \(SELECT \* FROM/);
  assert.match(comandoCopy, /FORMAT CSV, HEADER true/);
  assert.equal(conteudo, 'id,nome\n1,Cliente\n');
  assert.equal(liberado, true);
});

test('executa a conversão isolada com caminhos e opções controlados', async () => {
  let chamada;
  await converterCsvParaParquet({
    schema: 'public',
    tabela: 'cliente',
    csv: 'entrada.csv',
    parquet: 'saida.parquet',
    colunas: ['id', 'nome']
  }, {
    execPath: 'node-teste',
    script: 'converter-teste.js',
    async executarArquivo(...argumentos) { chamada = argumentos; }
  });

  assert.equal(chamada[0], 'node-teste');
  assert.deepEqual(chamada[1], [
    'converter-teste.js',
    'public',
      'cliente',
      'entrada.csv',
      'saida.parquet',
      '["id","nome"]'
  ]);
  assert.equal(chamada[2].windowsHide, true);
});

test('repete a limpeza quando o Windows mantém o arquivo ocupado', async () => {
  let tentativas = 0;
  await operacaoArquivoComRetentativas(async () => {
    tentativas += 1;
    if (tentativas < 3) {
      const erro = new Error('arquivo ocupado');
      erro.code = 'EBUSY';
      throw erro;
    }
  });
  assert.equal(tentativas, 3);
});
