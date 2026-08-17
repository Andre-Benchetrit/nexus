const test = require('node:test');
const assert = require('node:assert/strict');

const { construirSql, validarSqlCompilado } = require('../tools/sql/compilador');
const {
  executarConstruirSql,
  executarExplain,
  resumirPlanoExplain
} = require('../tools/construir_sql');

function especificacao(sobrescrever = {}) {
  return {
    objetivo: 'agregar',
    entidade_principal: 'nota_saida',
    campos: [],
    dimensoes: ['marketplace_pedido'],
    metricas: ['faturamento'],
    periodo: { campo: 'data_emissao', inicio: '2026-08-01', fim: '2026-08-11' },
    filtros: [],
    agrupamentos: [],
    ordenacao: null,
    limite: 100,
    regras: [],
    suposicoes: [],
    ...sobrescrever
  };
}

function poolMock({ falharExplain = false } = {}) {
  const comandos = [];
  let liberado = false;
  const cliente = {
    async query(sql, parametros) {
      comandos.push({ sql, parametros });
      if (/^EXPLAIN/.test(sql)) {
        if (falharExplain) {
          const erro = new Error('relation "x" does not exist at 10.0.0.1:5432');
          erro.code = '42P01';
          throw erro;
        }
        return {
          rows: [{ 'QUERY PLAN': [{
            Plan: {
              'Node Type': 'Aggregate', 'Startup Cost': 10, 'Total Cost': 20,
              'Plan Rows': 4, 'Plan Width': 32,
              Plans: [{ 'Node Type': 'Seq Scan' }]
            }
          }] }]
        };
      }
      return { rows: [] };
    },
    release() { liberado = true; }
  };
  return {
    pool: { async connect() { return cliente; } },
    comandos,
    liberado: () => liberado
  };
}

test('compila faturamento por marketplace com regra oficial e parametros', () => {
  const resultado = construirSql(especificacao());
  assert.match(resultado.sql, /^SELECT/);
  assert.match(resultado.sql, /LEFT JOIN "sysemp"\."tipo_pedido"/);
  assert.match(resultado.sql, /nfe_cstat/);
  assert.match(resultado.sql, /GROUP BY 1/);
  assert.deepEqual(resultado.parametros, ['2026-08-01', '2026-08-11']);
  assert.match(resultado.sql_dbeaver, /'2026-08-01'::date/);
});

test('compila faturamento por produto no grao dos itens sem duplicar total da nota', () => {
  const resultado = construirSql(especificacao({
    entidade_principal: 'nota_saida_itens',
    dimensoes: ['descricao_produto'],
    metricas: ['faturamento_itens'],
    periodo: { campo: 'data_pedido', inicio: '2026-08-01', fim: '2026-08-10' }
  }));
  assert.match(resultado.sql, /FROM "sysemp"\."nota_saida_itens" nsi/);
  assert.match(resultado.sql, /JOIN "sysemp"\."nota_saida" ns/);
  assert.match(resultado.sql, /JOIN "sysemp"\."produto" p/);
  assert.match(resultado.sql, /sum\(coalesce\(nsi\.valor_total_liquido/);
  assert.match(resultado.sql, /AS "faturamento"/);
  assert.match(resultado.sql, /ns\."data_pedido"/);
  assert.match(resultado.sql, /nfe_cstat/);
  assert.doesNotMatch(resultado.sql, /sum\(ns\.total_nota_fiscal\)/);
});

test('compila listagem de produtos ativos com projeção e regras de SKU aprovadas', () => {
  const resultado = construirSql(especificacao({
    objetivo: 'listar', entidade_principal: 'produto',
    campos: [
      'codigo_barra', 'sku', 'codigo_fabricante', 'id_produto',
      'tipo_produto', 'descricao_produto', 'volume'
    ],
    dimensoes: [], metricas: [], periodo: null,
    regras: ['produto_ativo_vendavel', 'sku_sem_sufixo_variacao']
  }));
  assert.match(resultado.sql, /'''' \|\| p\."cod_barra" AS "codigo_barra"/);
  assert.match(resultado.sql, /JOIN "sysemp"\."tipo_produto" tprod/);
  assert.match(resultado.sql, /p\."composicao_estoque" IN \(0, 6, 50\)/);
  assert.match(resultado.sql, /p\."inativo" = 'F'/);
  assert.match(resultado.sql, /p\."codigo_auxiliar" !~ '\(_\[0-9\]\+\|_OUT\)\$'/);
  assert.match(resultado.sql, /round\(p\."volumes"\) AS "volume"/);
  assert.deepEqual(resultado.regras_aplicadas, [
    'Somente produtos ativos com composição de estoque 0, 6 ou 50, incluindo kits.',
    'Exclui SKUs terminados em _<número> ou _OUT.'
  ]);
});

test('escapa literais para DBeaver sem inserir SQL do usuario', () => {
  const resultado = construirSql(especificacao({
    objetivo: 'listar', metricas: [], dimensoes: [], campos: ['marketplace_pedido'],
    periodo: null,
    filtros: [{ campo: 'marketplace_pedido', operador: 'igual', valor: "O'Brien" }]
  }));
  assert.match(resultado.sql, /\$1/);
  assert.match(resultado.sql_dbeaver, /'O''Brien'/);
});

test('rejeita entidades campos metricas e SQL destrutivo fora do catalogo', () => {
  assert.throws(() => construirSql(especificacao({ entidade_principal: 'usuarios' })), /nao autorizada/);
  assert.throws(() => construirSql(especificacao({ campos: ['senha'] })), /Campo nao autorizado/);
  assert.throws(() => construirSql(especificacao({ metricas: ['lucro_inventado'] })), /Metrica nao autorizada/);
  assert.throws(() => validarSqlCompilado('DROP TABLE sysemp.nota_saida'), /somente permite SELECT/);
  assert.throws(() => validarSqlCompilado('SELECT 1; DELETE FROM x'), /nao permitido/);
});

test('protege periodo obrigatorio e expansao de grao em agregacoes', () => {
  assert.throws(() => construirSql(especificacao({ periodo: null })), /exige periodo explicito/);
  assert.throws(() => construirSql(especificacao({
    dimensoes: ['descricao_produto']
  })), /expande o grao/);
});

test('EXPLAIN usa transacao read only, timeout, parametros e rollback', async () => {
  const mock = poolMock();
  const plano = await executarExplain('SELECT $1::integer', [1], { pool: mock.pool, statementTimeoutMs: 5000 });
  assert.equal(mock.comandos[0].sql, 'BEGIN READ ONLY');
  assert.match(mock.comandos[1].sql, /statement_timeout/);
  assert.match(mock.comandos[2].sql, /^EXPLAIN \(FORMAT JSON\) SELECT/);
  assert.deepEqual(mock.comandos[2].parametros, [1]);
  assert.equal(mock.comandos.at(-1).sql, 'ROLLBACK');
  assert.equal(mock.liberado(), true);
  assert.equal(plano.custo_total, 20);
  assert.match(plano.alerta, /leitura sequencial/);
});

test('falha do EXPLAIN devolve rascunho sanitizado sem executar dados', async () => {
  const mock = poolMock({ falharExplain: true });
  const resultado = JSON.parse(await executarConstruirSql(especificacao(), { pool: mock.pool }));
  assert.equal(resultado.status, 'rascunho_nao_validado');
  assert.equal(resultado.executou_dados, false);
  assert.equal(resultado.falha_validacao.codigo, '42P01');
  assert.doesNotMatch(resultado.falha_validacao.mensagem, /10\.0\.0\.1/);
  assert.equal(mock.comandos.at(-1).sql, 'ROLLBACK');
});

test('resume plano JSON do PostgreSQL sem expor o plano bruto', () => {
  assert.deepEqual(resumirPlanoExplain([{ Plan: {
    'Node Type': 'Index Scan', 'Startup Cost': 0, 'Total Cost': 1,
    'Plan Rows': 1, 'Plan Width': 8
  } }]), {
    custo_inicial: 0, custo_total: 1, linhas_estimadas: 1,
    largura_estimada: 8, nos_principais: ['Index Scan'], alerta: null
  });
});
