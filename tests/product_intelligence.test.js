const test = require('node:test');
const assert = require('node:assert/strict');

const { criarConexaoDuckDB, fecharConexaoDuckDB, runDuckDB } = require('../duckdb/connections');
const modelo = require('../gold/modelos/vendas/inteligencia_produto_canal_diaria');
const { analisarEvolucao, compararCanais, detectarExcecoes } = require('../tools/core/inteligencia_produto');
const { permissoesDaFerramenta } = require('../nexus/governanca');

function all(conexao, sql) {
  return new Promise((resolve, reject) => conexao.all(sql, (erro, linhas) => erro ? reject(erro) : resolve(linhas)));
}

test('Gold de produto preserva datas e conceitos distintos de pedido e faturamento', async () => {
  const conexao = criarConexaoDuckDB();
  try {
    await runDuckDB(conexao, `CREATE TABLE pedidos AS SELECT * FROM (VALUES
      (DATE '2026-01-05',1,10,100,0,'Produto A','SKU-A','EAN-A',1,'Marca',2,'Grupo',3,'Sub',4,'Cat',NULL,2,100,true)
    ) v(data_pedido,id_empresa,id_produto,id_pedido_vda_importado,id_plataforma,
      descricao_produto,sku,ean,id_marca,marca,id_grupo,grupo,id_subgrupo,subgrupo,
      id_categoria,categoria,plataforma,quantidade,valor_pedido_pago_item,pedido_valido)`);
    await runDuckDB(conexao, `CREATE TABLE notas AS SELECT * FROM (VALUES
      (DATE '2026-01-07',1,10,200,0,'Produto A','SKU-A','EAN-A',1,'Marca',2,'Grupo',3,'Sub',4,'Cat',NULL,2,2,120,70,10,NULL)
    ) v(data_emissao,id_empresa,id_produto,id_nota_saida,id_plataforma,
      descricao_produto,sku,ean,id_marca,marca,id_grupo,grupo,id_subgrupo,subgrupo,
      id_categoria,categoria,plataforma,quantidade_faturada,quantidade,valor_total_item,
      custo_total_item,comissao_marketplace_item,comissao_item)`);
    const sql = modelo.construirSql(new Map([
      ['fato_pedido_item', { viewAtual: 'pedidos' }], ['fato_nota_fiscal_item', { viewAtual: 'notas' }]
    ]));
    const linhas = await all(conexao, sql);
    assert.equal(linhas.length, 2);
    const data = (item) => item.data_referencia instanceof Date
      ? item.data_referencia.toISOString().slice(0, 10) : String(item.data_referencia).slice(0, 10);
    const pedido = linhas.find((item) => data(item) === '2026-01-05');
    const nota = linhas.find((item) => data(item) === '2026-01-07');
    assert.equal(Number(pedido.valor_pedidos), 100);
    assert.equal(Number(pedido.faturamento_emitido), 0);
    assert.equal(Number(nota.valor_pedidos), 0);
    assert.equal(Number(nota.faturamento_emitido), 120);
    assert.equal(Number(nota.contribuicao_apos_comissao), 40);
    assert.equal(nota.plataforma, 'Canal não identificado');
  } finally { await fecharConexaoDuckDB(conexao); }
});

async function contextoInteligencia() {
  const conexao = criarConexaoDuckDB();
  await runDuckDB(conexao, `CREATE TABLE intel AS SELECT * FROM (VALUES
    (DATE '2026-01-01',1,1,'Produto A','SKU-A','EAN-A','Marca A','Cat A',10,'Loja',1,1,2,100,1,1,2,100,60,40,10,30),
    (DATE '2026-01-01',1,2,'Produto B','SKU-B','EAN-B','Marca B','Cat B',10,'Loja',1,1,1,80,1,1,1,80,50,30,5,25),
    (DATE '2026-02-01',1,2,'Produto B','SKU-B','EAN-B','Marca B','Cat B',10,'Loja',1,1,2,160,1,1,2,160,100,60,10,50),
    (DATE '2026-03-01',1,1,'Produto A','SKU-A','EAN-A','Marca A','Cat A',10,'Loja',1,1,6,300,1,1,6,300,180,120,30,90),
    (DATE '2026-03-01',1,1,'Produto A','SKU-A','EAN-A','Marca A','Cat A',11,'Marketplace',1,1,4,200,1,1,4,200,120,80,20,60),
    (DATE '2026-03-01',1,2,'Produto B','SKU-B','EAN-B','Marca B','Cat B',10,'Loja',1,1,3,240,1,1,3,240,150,90,15,75)
  ) v(data_referencia,id_empresa,id_produto,descricao_produto,sku,ean,marca,categoria,
    id_plataforma,plataforma,pedidos,itens_pedidos,quantidade_pedida,valor_pedidos,
    notas_fiscais,itens_faturados,quantidade_faturada,faturamento_emitido,custo_produtos,
    margem_bruta_produtos,comissao_marketplace,contribuicao_apos_comissao)`);
  await runDuckDB(conexao, `CREATE TABLE risco AS SELECT * FROM (VALUES
    (1,'Produto A','SKU-A','EAN-A','Marca A','Cat A',DATE '2026-03-01',5,1,10,50,10,20,0.5,10,NULL,'NORMAL',false,NULL,false,NULL,TIMESTAMP '2026-03-01 08:00:00'),
    (3,'Produto C','SKU-C','EAN-C','Marca C','Cat C',DATE '2026-03-01',8,0,20,160,0,0,0,999,NULL,'NORMAL',false,NULL,false,NULL,TIMESTAMP '2026-03-01 08:00:00')
  ) v(id_produto,descricao_produto,sku,ean,marca,categoria,data_referencia,
    estoque_disponivel,quantidade_reservada,custo_produto_atual,valor_estoque_custo,
    saida_venda_30d,saida_venda_90d,media_diaria_saida_90d,dias_cobertura,
    data_estimada_ruptura,classificacao_risco,tem_reposicao_prevista,proxima_data_prevista,
    tem_entrega_atrasada,data_entrega_atrasada_mais_antiga,dthr_atualizacao_estoque)`);
  const leitor = { async prepararObjeto(nome) {
    if (nome === 'risco_ruptura_produto') return {
      viewAtual: 'risco', execucoes: [{ manifesto: { fim: '2026-03-01T08:00:00Z' } }]
    };
    if (nome !== 'inteligencia_produto_canal_diaria') throw new Error('objeto não preparado');
    return { viewAtual: 'intel', execucoes: [{ manifesto: { fim: '2026-03-31T23:59:00Z' } }] };
  }, async fechar() {} };
  return { conexao, dependencias: { productIntelligenceMode: 'shadow',
    criarConexao: () => conexao, criarLeitor: () => leitor, fecharConexao: async () => {} } };
}

test('evolução congela o top N e preenche mês sem movimento com zero', async () => {
  const { conexao, dependencias } = await contextoInteligencia();
  try {
    const resultado = await analisarEvolucao({
      selecao: { modo: 'top_periodo', produtos: null, top_n: 2,
        metrica_ranking: 'faturamento_emitido', data_referencia_inicial: '2026-03-01',
        data_referencia_final: '2026-03-31' },
      data_inicial: '2026-01-01', data_final: '2026-03-31', granularidade: 'mes',
      metricas: ['faturamento_emitido'], comparar_periodo_anterior: false
    }, dependencias);
    assert.equal(resultado.produtos.length, 2);
    assert.equal(resultado.dados.length, 6);
    assert.equal(resultado.dados.find((item) => item.periodo === '2026-02-01' && item.id_produto === 1)
      .faturamento_emitido, 0);
    assert.equal(resultado.fonte, 'Dados do Sysemp');
    assert.equal(resultado.definicoes_metricas.faturamento_emitido.rotulo, 'Faturamento emitido');
    assert.equal(resultado.cobertura_fontes.comprova_integridade_da_carga, false);
    assert.equal(resultado.cobertura_fontes.fontes.faturamento.dias_com_registro_no_periodo, 3);
    assert.match(resultado.cobertura_fontes.aviso, /não comprovam a integridade/i);
  } finally { await fecharConexaoDuckDB(conexao); }
});

test('evolução distingue pedidos, linhas faturadas e unidades faturadas sem chamar troca de correção', async () => {
  const { conexao, dependencias } = await contextoInteligencia();
  try {
    const resultado = await analisarEvolucao({
      selecao: { modo: 'produtos', produtos: [{ tipo: 'sku', valor: 'SKU-A' }],
        top_n: null, metrica_ranking: null, data_referencia_inicial: null,
        data_referencia_final: null },
      data_inicial: '2026-01-01', data_final: '2026-03-31', granularidade: 'mes',
      metricas: ['pedidos', 'itens_faturados', 'quantidade_faturada'],
      comparar_periodo_anterior: false
    }, dependencias);
    assert.equal(resultado.definicoes_metricas.pedidos.rotulo, 'Pedidos distintos');
    assert.equal(resultado.definicoes_metricas.itens_faturados.rotulo, 'Linhas de item faturadas');
    assert.equal(resultado.definicoes_metricas.quantidade_faturada.rotulo, 'Unidades faturadas');
    assert.equal(resultado.cobertura_fontes.comprova_integridade_da_carga, false);
    assert.deepEqual(Object.keys(resultado.cobertura_fontes.fontes).sort(), ['faturamento', 'pedidos']);
  } finally { await fecharConexaoDuckDB(conexao); }
});

test('comparação por canal calcula participação mesmo quando faturamento não foi solicitado', async () => {
  const { conexao, dependencias } = await contextoInteligencia();
  try {
    const resultado = await compararCanais({
      selecao: { modo: 'produtos', produtos: [{ tipo: 'sku', valor: 'SKU-A' }],
        top_n: null, metrica_ranking: null, data_referencia_inicial: null,
        data_referencia_final: null },
      data_inicial: '2026-03-01', data_final: '2026-03-31', periodo_comparacao: null,
      metricas: ['quantidade_faturada'], limite_canais: 10
    }, dependencias);
    assert.deepEqual(resultado.dados.map((item) => item.participacao_faturamento_pct).sort(), [40, 60]);
    assert.equal(resultado.dados.reduce((soma, item) => soma + Number(item.quantidade_faturada), 0), 10);
  } finally { await fecharConexaoDuckDB(conexao); }
});

test('alerta de estoque sem giro inclui produto sem linha de venda nos últimos 30 dias', async () => {
  const { conexao, dependencias } = await contextoInteligencia();
  try {
    const resultado = await detectarExcecoes({ data_inicial: null, data_final: null,
      filtros: { produto: null, marca: null, categoria: null },
      regras: ['estoque_sem_giro'], limites: { queda_pct: null,
        concentracao_canal_pct: null, diferenca_periodo_pct: null }, limite_resultados: 20
    }, dependencias);
    const produto = resultado.dados.find((item) => item.id_produto === 3);
    assert.ok(produto);
    assert.equal(produto.alertas[0].regra, 'estoque_sem_giro');
    assert.equal(produto.alertas[0].periodo_sem_venda.inicio, '2026-01-31');
  } finally { await fecharConexaoDuckDB(conexao); }
});

test('capabilities compostas revalidam todas as fontes de origem', () => {
  assert.deepEqual(permissoesDaFerramenta('diagnosticar_produto_360'), [
    'produto.consultar', 'catalogo.consultar', 'vendas.consultar',
    'desempenho.consultar', 'estoque.consultar', 'reposicoes.consultar'
  ]);
  assert.deepEqual(permissoesDaFerramenta('comparar_canais_produto'), [
    'produto.consultar', 'vendas.consultar', 'desempenho.consultar'
  ]);
});
