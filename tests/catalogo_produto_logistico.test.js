const test = require('node:test');
const assert = require('node:assert/strict');
const {
  criarConexaoDuckDB, fecharConexaoDuckDB, runDuckDB, allDuckDB
} = require('../duckdb/connections');
const objeto = require('../gold/modelos/catalogo/catalogo_produto_logistico');
const {
  executarListarProdutosAtivosComCubagem
} = require('../tools/listar_produtos_ativos_com_cubagem');

test('calcula cubagem em m³ e classifica medidas ausentes ou inválidas', async () => {
  const conexao = criarConexaoDuckDB();
  try {
    await runDuckDB(conexao, `CREATE TABLE produtos AS
      SELECT 1 AS id_produto, 'Exemplo' AS descricao_produto, 'SKU-1' AS sku, '789' AS ean,
        NULL::VARCHAR AS peso_liquido, NULL::VARCHAR AS peso_bruto,
        NULL::VARCHAR AS altura, NULL::VARCHAR AS largura, NULL::VARCHAR AS comprimento,
        NULL::DECIMAL(18,6) AS altura_produto_m, NULL::DECIMAL(18,6) AS largura_produto_m,
        NULL::DECIMAL(18,6) AS comprimento_produto_m,
        '0.5' AS embalagem_altura, '0.4' AS embalagem_largura, '0.3' AS embalagem_comprimento,
        0.5::DECIMAL(18,6) AS embalagem_altura_m, 0.4::DECIMAL(18,6) AS embalagem_largura_m,
        0.3::DECIMAL(18,6) AS embalagem_comprimento_m, true AS produto_ativo,
        false AS catalogo_site_ativo, NULL::VARCHAR AS grupo, NULL::VARCHAR AS subgrupo,
        NULL::VARCHAR AS marca, NULL::VARCHAR AS categoria, NULL::DATE AS dt_alteracao
      UNION ALL SELECT 2, 'Sem medida', 'SKU-2', NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, false,
        NULL, NULL, NULL, NULL, NULL
      UNION ALL SELECT 3, 'Medida inválida', 'SKU-3', NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, '-1', '0.4', '0.3', -1::DECIMAL(18,6),
        0.4::DECIMAL(18,6), 0.3::DECIMAL(18,6), true, false,
        NULL, NULL, NULL, NULL, NULL`);
    const sql = objeto.construirSql(new Map([['dim_produto', { viewAtual: 'produtos' }]]));
    const linhas = await allDuckDB(conexao, sql);
    assert.equal(linhas[0].cubagem_m3, 0.06);
    assert.equal(linhas[0].status_cubagem, 'completa');
    assert.equal(linhas[1].cubagem_m3, null);
    assert.equal(linhas[1].status_cubagem, 'incompleta');
    assert.equal(linhas[2].cubagem_m3, null);
    assert.equal(linhas[2].status_cubagem, 'invalida');
  } finally {
    await fecharConexaoDuckDB(conexao);
  }
});

test('persiste o catálogo completo, filtra ativos e limita a prévia a 20 linhas', async () => {
  const linhas = Array.from({ length: 101 }, (_, indice) => ({
    id_produto: indice + 1,
    descricao_produto: `Produto ${indice + 1}`,
    status_cubagem: indice < 80 ? 'completa' : indice < 95 ? 'incompleta' : 'invalida'
  }));
  const sqls = [];
  let persistido;
  const leitor = {
    async comObjeto(_nome, executar) {
      return executar({ contexto: {
        viewAtual: 'catalogo_atual', execucoes: [{ manifesto: { fim: '2026-10-15T12:00:00Z' } }]
      }, consultarSql: async (sql) => {
        sqls.push(sql);
        return sql.includes('count(*)') ? [{ total: 101 }] : linhas;
      } });
    },
    async fechar() {}
  };
  const resultado = JSON.parse(await executarListarProdutosAtivosComCubagem({}, {
    criarLeitor: () => leitor,
    datasetsMode: 'v1', conversationId: 'conversa', turnoIA: { id: 'turno' },
    servicoDatasets: { async criarDeLinhas(_conversa, _turno, dados, opcoes) {
      persistido = { dados, opcoes };
      return { id: 'ref-completo' };
    } }
  }));
  assert.match(sqls[0], /WHERE produto_ativo = true/);
  assert.equal(persistido.dados.length, 101);
  assert.equal(persistido.opcoes.queryManifest.objeto, 'gold.catalogo_produto_logistico');
  assert.equal(resultado.result_ref, 'ref-completo');
  assert.equal(resultado.total_produtos_ativos, 101);
  assert.equal(resultado.cubagens_completas, 80);
  assert.equal(resultado.cubagens_incompletas, 15);
  assert.equal(resultado.cubagens_invalidas, 6);
  assert.equal(resultado.previa.length, 20);
  assert.equal(resultado.resultado_truncado_no_prompt, true);
});

test('recusa catálogo acima de 50 mil sem persistir arquivo parcial', async () => {
  let persistiu = false;
  const leitor = {
    async comObjeto(_nome, executar) {
      return executar({ contexto: { viewAtual: 'catalogo_atual', execucoes: [] },
        consultarSql: async (sql) => sql.includes('count(*)') ? [{ total: 50_001 }] : [] });
    },
    async fechar() {}
  };
  await assert.rejects(executarListarProdutosAtivosComCubagem({}, {
    criarLeitor: () => leitor,
    datasetsMode: 'v1', conversationId: 'conversa', turnoIA: { id: 'turno' },
    servicoDatasets: { async criarDeLinhas() { persistiu = true; } }
  }), { codigo: 'CATALOGO_LOGISTICO_LIMITE_EXCEDIDO' });
  assert.equal(persistiu, false);
});
