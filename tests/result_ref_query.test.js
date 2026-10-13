const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  criarConexaoDuckDB,
  fecharConexaoDuckDB,
  runDuckDB
} = require('../duckdb/connections');
const { consultarResultadoRef } = require('../nexus/result_ref_query_engine');

async function criarParquet() {
  const diretorio = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-result-ref-'));
  const arquivo = path.join(diretorio, 'dados.parquet');
  const destino = arquivo.replace(/\\/g, '/').replace(/'/g, "''");
  const con = criarConexaoDuckDB();
  try {
    await runDuckDB(con, `COPY (
      SELECT * FROM (VALUES
        (1,'PED-1','SKU-A','Produto A',2),
        (2,'PED-2','SKU-A','Produto A',1),
        (3,'PED-2','SKU-A','Produto A',1),
        (4,'PED-3','SKU-B','Produto B',5)
      ) AS t(__nexus_row_number,marketplace_pedido,sku,descricao_produto,quantidade_pedida)
    ) TO '${destino}' (FORMAT PARQUET)`);
  } finally {
    await fecharConexaoDuckDB(con);
  }
  return { diretorio, arquivo };
}

test('result_ref agrupa e conta entidades distintas localmente', async () => {
  const { diretorio, arquivo } = await criarParquet();
  let persistido = null;
  try {
    const servicoDatasets = {
      async abrirCaminho(_conversationId, id) {
        assert.equal(id, 'ref-origem');
        return {
          caminho: arquivo,
          descriptor: {
            id, tipo: 'result_ref', status: 'ready', classificacao: 'dados_nexus',
            colunas: [
              'marketplace_pedido', 'sku', 'descricao_produto', 'quantidade_pedida'
            ].map((nome) => ({ nome }))
          }
        };
      },
      async criarDeLinhas(_conversationId, _turnId, linhas, opcoes) {
        persistido = { linhas, opcoes };
        return { id: 'ref-derivada', tipo: 'result_ref', status: 'ready' };
      }
    };
    const resultado = await consultarResultadoRef({
      result_ref: 'ref-origem',
      operacao: 'agrupar',
      colunas: [],
      agrupar_por: ['sku', 'descricao_produto'],
      metricas: [
        { operacao: 'contar_distintos', campo: 'marketplace_pedido' },
        { operacao: 'somar', campo: 'quantidade_pedida' }
      ],
      filtros: [],
      ordenar_por: 'contagem_distinta_marketplace_pedido',
      direcao: 'desc',
      limite: 50
    }, {
      servicoDatasets,
      conversationId: 'conversa-1',
      turnoIA: { id: 'turno-1' }
    });
    assert.equal(resultado.result_ref.id, 'ref-derivada');
    assert.deepEqual(persistido.linhas, [
      {
        sku: 'SKU-A', descricao_produto: 'Produto A',
        contagem_distinta_marketplace_pedido: 2,
        soma_quantidade_pedida: 4
      },
      {
        sku: 'SKU-B', descricao_produto: 'Produto B',
        contagem_distinta_marketplace_pedido: 1,
        soma_quantidade_pedida: 5
      }
    ]);
    assert.equal(persistido.opcoes.parentDatasetId, 'ref-origem');
    assert.equal(persistido.opcoes.queryManifest.tipo, 'result_ref_query');
  } finally {
    await fs.rm(diretorio, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('result_ref rejeita campo que não pertence ao esquema autorizado', async () => {
  const { diretorio, arquivo } = await criarParquet();
  try {
    await assert.rejects(() => consultarResultadoRef({
      result_ref: 'ref-origem',
      operacao: 'consultar',
      colunas: ['sku; DROP TABLE x'],
      agrupar_por: [], metricas: [], filtros: [],
      ordenar_por: null, direcao: 'asc', limite: 20
    }, {
      servicoDatasets: {
        async abrirCaminho() {
          return { caminho: arquivo, descriptor: {
            tipo: 'result_ref', status: 'ready', colunas: [{ nome: 'sku' }]
          } };
        }
      },
      conversationId: 'conversa-1', turnoIA: { id: 'turno-1' }
    }), (erro) => erro.codigo === 'RESULT_REF_FIELD_NOT_FOUND');
  } finally {
    await fs.rm(diretorio, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
