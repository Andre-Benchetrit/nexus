const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { criarConexaoDuckDB, fecharConexaoDuckDB, runDuckDB } = require('../duckdb/connections');
const { criarLeitorSilver } = require('../duckdb/silver');
const { construirSilver } = require('../silver/core/executar');
const dimCliente = require('../silver/postgres/dimensoes/dim_cliente');
const dimGrupo = require('../silver/postgres/dimensoes/dim_grupo');
const dimSubgrupo = require('../silver/postgres/dimensoes/dim_subgrupo');
const dimMarca = require('../silver/postgres/dimensoes/dim_marca');
const dimCategoria = require('../silver/postgres/dimensoes/dim_categoria');
const dimTipoPedido = require('../silver/postgres/dimensoes/dim_tipo_pedido');
const dimTransporteRegra = require('../silver/postgres/dimensoes/dim_transporte_regra');
const dimPlataformaEcommerce = require('../silver/postgres/dimensoes/dim_plataforma_ecommerce');
const dimProduto = require('../silver/postgres/dimensoes/dim_produto');
const fatoVenda = require('../silver/postgres/fatos/fato_venda');
const fatoVendaItem = require('../silver/postgres/fatos/fato_venda_item');

const catalogoSilver = {
  dim_cliente: dimCliente,
  dim_grupo: dimGrupo,
  dim_subgrupo: dimSubgrupo,
  dim_marca: dimMarca,
  dim_categoria: dimCategoria,
  dim_tipo_pedido: dimTipoPedido,
  dim_transporte_regra: dimTransporteRegra,
  dim_plataforma_ecommerce: dimPlataformaEcommerce,
  dim_produto: dimProduto,
  fato_venda: fatoVenda,
  fato_venda_item: fatoVendaItem
};

function entidade(nome, chavePrimaria, cursor) {
  return {
    nome,
    fonte: 'postgres',
    destino: { camada: 'bronze' },
    extracao: { chavePrimaria, cursor }
  };
}

const catalogoBronze = {
  cliente: entidade('cliente', 'id_cliente', 'dt_alteracao'),
  produto: entidade('produto', 'id_produto', 'dt_alteracao'),
  grupo: entidade('grupo', 'id_grupo', 'datamodificacao'),
  subgrupo: entidade('subgrupo', 'id_subgrupo', 'datamodificacao'),
  marca: entidade('marca', 'id_marca', 'datamodificacao'),
  categoria: entidade('categoria', 'id_categoria', 'datamodificacao'),
  tipo_pedido: entidade('tipo_pedido', 'id_tp_pedido', 'datamodificacao'),
  transporte_regras: entidade('transporte_regras', 'id_transporte', 'id_transporte'),
  plataforma_ecommerce: entidade('plataforma_ecommerce', 'id', 'id'),
  nota_saida: entidade('nota_saida', 'id_nota_saida', 'dt_alteracao'),
  nota_saida_itens: entidade(
    'nota_saida_itens',
    ['id_nota_saida', 'item'],
    'dthr_atualizacao'
  )
};

let raizLake;
let leitor;
let construcao;

async function criarBronze(nome, sql) {
  const diretorio = path.join(
    raizLake, 'bronze', 'postgres', nome,
    'dt_extracao=2026-07-17', 'execucao=20260717T120000000Z'
  );
  await fs.mkdir(diretorio, { recursive: true });
  const arquivo = path.join(diretorio, 'dados.parquet').replace(/\\/g, '/').replace(/'/g, "''");
  const con = criarConexaoDuckDB();
  try {
    await runDuckDB(con, `COPY (${sql}) TO '${arquivo}' (FORMAT PARQUET)`);
  } finally {
    await fecharConexaoDuckDB(con);
  }
  await fs.writeFile(path.join(diretorio, 'manifest.json'), JSON.stringify({
    entidade: nome,
    status: 'sucesso',
    inicio: '2026-07-17T12:00:00.000Z',
    fim: '2026-07-17T12:01:00.000Z',
    totalLinhas: 1,
    arquivo: 'dados.parquet'
  }));
}

test.before(async () => {
  raizLake = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-fato-venda-'));
  await criarBronze('cliente', `
    SELECT 10 AS id_cliente, 'FID COMERCIO EXTERIOR LTDA' AS razsocial,
      'FIDComex' AS fantasia, 1 AS id_empresa, 'J' AS pessoafj,
      'SAO PAULO' AS cidade, 35 AS id_uf, 'T' AS ativo,
      DATE '2026-01-01' AS dt_cadastro, DATE '2026-07-17' AS dt_alteracao
  `);
  await criarBronze('produto', `
    SELECT 1 AS id_produto, 'Produto A' AS descricao, 'SKU-1' AS codigo_auxiliar,
      '789' AS cod_barra, 'FAB' AS cod_fabrica, 10 AS id_grupo,
      20 AS id_subgrupo, 30 AS id_marca, 40 AS id_categoria,
      5::DECIMAL(15,4) AS estoque, 'F' AS inativo, 'T' AS disponivel,
      'T' AS envia_site, DATE '2026-01-01' AS dt_cadastro,
      DATE '2026-07-17' AS dt_alteracao
  `);
  await criarBronze('grupo', `SELECT 10 AS id_grupo, 'ELETRODOMESTICO' AS descricao, TIMESTAMP '2026-01-01' AS dt_registro, TIMESTAMP '2026-07-17' AS datamodificacao, NULL::TIMESTAMP AS datamodificacaoserver, NULL::TIMESTAMP AS dthr_atualizacao`);
  await criarBronze('subgrupo', `SELECT 20 AS id_subgrupo, 'REFRIGERADOR' AS descricao, TIMESTAMP '2026-01-01' AS dt_registro, TIMESTAMP '2026-07-17' AS datamodificacao, NULL::TIMESTAMP AS datamodificacaoserver, NULL::TIMESTAMP AS dthr_atualizacao`);
  await criarBronze('marca', `SELECT 30 AS id_marca, 'MARCA A' AS descricao, TIMESTAMP '2026-01-01' AS dt_registro, TIMESTAMP '2026-07-17' AS datamodificacao, NULL::TIMESTAMP AS datamodificacaoserver, NULL::TIMESTAMP AS dthr_atualizacao`);
  await criarBronze('categoria', `SELECT 40 AS id_categoria, 'LINHA BRANCA' AS descricao, TIMESTAMP '2026-01-01' AS dt_registro, TIMESTAMP '2026-07-17' AS datamodificacao, NULL::TIMESTAMP AS datamodificacaoserver, NULL::TIMESTAMP AS dthr_atualizacao`);
  await criarBronze('tipo_pedido', `
    SELECT 3 AS id_tp_pedido, 'MARKETPLACE' AS descricao, 'MKT' AS tipo,
      'T' AS permite_faturamento, 'F' AS bloqueado, 9 AS id_nat_operacao,
      TIMESTAMP '2026-01-01' AS dt_registro,
      TIMESTAMP '2026-07-17' AS datamodificacao,
      NULL::TIMESTAMP AS datamodificacaoserver,
      NULL::TIMESTAMP AS dthr_atualizacao
  `);
  await criarBronze('transporte_regras', `
    SELECT 77 AS id_transporte, 'RAPIDA PADRAO' AS descricao,
      4 AS id_transportadora, 'RAPIDA' AS nome_site, 1 AS id_empresa,
      '1' AS empresas, 9 AS id_servico, '2' AS plataformas, '1' AS serie,
      'SP' AS uf, 'SAO PAULO' AS cidade, NULL::VARCHAR AS cep_inicial,
      NULL::VARCHAR AS cep_final, NULL::DECIMAL(15,4) AS peso_de,
      NULL::DECIMAL(15,4) AS peso_ate, 0 AS regra_cepuf,
      1 AS frete_padrao, 'T' AS exato, 0 AS id_atendimento, 'WEB' AS canal
  `);
  await criarBronze('plataforma_ecommerce', `
    SELECT 2 AS id, 20::SMALLINT AS plataforma, 'MERCADO LIVRE' AS descricao,
      'ML' AS apelido, true AS ativo, 1 AS id_empresa,
      4 AS id_transportadora, 1 AS plataforma_principal,
      TIMESTAMP '2026-07-17' AS data_ultimo_pedido,
      NULL::TIMESTAMP AS data_ultimo_produto,
      NULL::TIMESTAMP AS data_ultimo_estoque,
      NULL::TIMESTAMP AS data_ultimo_preco,
      NULL::TIMESTAMP AS data_ultimo_status
  `);
  await criarBronze('nota_saida', `
    SELECT 500::BIGINT AS id_nota_saida, 10 AS id_cliente, 1 AS id_empresa,
      3 AS id_tp_pedido, 2 AS id_plataforma, 4 AS id_transportadora,
      123 AS id_nr_nf, '1' AS serie, DATE '2026-07-16' AS data_pedido,
      DATE '2026-07-16' AS data_emissao, 'F' AS situacao,
      'MKT-500' AS marketplace_pedido, 'RJ' AS entrega_uf,
      30::DECIMAL(15,4) AS total_nota_fiscal,
      DATE '2026-07-16' AS dt_cadastro,
      DATE '2026-07-17' AS dt_alteracao
  `);
  await criarBronze('nota_saida_itens', `
    SELECT * FROM (VALUES
      (500::BIGINT, 1, 1, 10, 1, 3, 123, '1', DATE '2026-07-16',
       2::DECIMAL(15,4), 2::DECIMAL(15,4), 0::DECIMAL(15,4),
       10::DECIMAL(15,4), 0::DECIMAL(15,4), 0::DECIMAL(15,2),
       10::DECIMAL(15,4), 20::DECIMAL(15,2), 0::DECIMAL(15,2),
       0::DECIMAL(15,2), 0::DECIMAL(15,2), 0::DECIMAL(15,2),
       20::DECIMAL(15,2), 6::DECIMAL(15,4), 6::DECIMAL(15,3),
       1::DECIMAL(15,2), 0::DECIMAL(15,2), 'T', 'T', 1,
       TIMESTAMP '2026-07-16 10:00:00'),
      (500::BIGINT, 2, 1, 10, 1, 3, 123, '1', DATE '2026-07-16',
       1::DECIMAL(15,4), 1::DECIMAL(15,4), 0::DECIMAL(15,4),
       10::DECIMAL(15,4), 0::DECIMAL(15,4), 0::DECIMAL(15,2),
       10::DECIMAL(15,4), 10::DECIMAL(15,2), 0::DECIMAL(15,2),
       0::DECIMAL(15,2), 0::DECIMAL(15,2), 0::DECIMAL(15,2),
       10::DECIMAL(15,2), 6::DECIMAL(15,4), 6::DECIMAL(15,3),
       1::DECIMAL(15,2), 0::DECIMAL(15,2), 'T', 'T', 2,
       TIMESTAMP '2026-07-16 10:01:00')
    ) AS dados(
      id_nota_saida, item, id_produto, id_cliente, id_empresa, id_tp_pedido,
      id_nr_nf, serie, data_emissao, qtde, qtde_faturada, qtde_devolvida,
      valor_bruto, valor_desconto, desconto_total_item, valor_liquido,
      valor_total_liquido, vr_frete, vr_seguro, vr_outros, vr_acrescimo,
      vr_financeiro, custo_produto, custo_medio, comissao, valor_comissao_ml,
      movimenta_estoque, gera_financeiro, item_marketplace, dthr_atualizacao
    )
  `);

  const ordem = [
    dimCliente, dimGrupo, dimSubgrupo, dimMarca, dimCategoria,
    dimTipoPedido, dimTransporteRegra, dimPlataformaEcommerce,
    dimProduto, fatoVenda, fatoVendaItem
  ];
  for (const [indice, objeto] of ordem.entries()) {
    const resultado = await construirSilver(objeto, {
      raizLake,
      catalogoBronze,
      catalogoSilver,
      agora: new Date(`2026-07-17T${String(12 + indice).padStart(2, '0')}:00:00.000Z`)
    });
    if (objeto.nome === 'fato_venda_item') construcao = resultado;
  }
  leitor = criarLeitorSilver({
    raizLake,
    catalogo: catalogoSilver
  });
});

test.after(async () => {
  await leitor?.fechar();
  await fs.rm(raizLake, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test('materializa dois itens da mesma nota usando chave composta', () => {
  assert.equal(construcao.totalLinhas, 2);
  assert.equal(construcao.qualidade.chavesNulas, 0);
  assert.equal(construcao.qualidade.chavesDuplicadas, 0);
  assert.equal(construcao.qualidade.relacionamentos.itens_sem_venda_correspondente, 0);
  assert.equal(construcao.qualidade.relacionamentos.itens_sem_produto_correspondente, 0);
});

test('enriquece item com pedido e dimensao de produto', async () => {
  const resultado = await leitor.buscarPorId('fato_venda_item', {
    id_nota_saida: 500,
    item: 1
  }, {
    colunas: [
      'id_nota_saida', 'item', 'descricao_produto', 'grupo',
      'data_pedido', 'marketplace_pedido', 'cliente', 'tipo_pedido',
      'plataforma', 'transporte_regras', 'quantidade', 'valor_total_item'
    ]
  });
  assert.equal(resultado.dados[0].descricao_produto, 'Produto A');
  assert.equal(resultado.dados[0].grupo, 'ELETRODOMESTICO');
  assert.equal(resultado.dados[0].marketplace_pedido, 'MKT-500');
  assert.equal(resultado.dados[0].cliente, 'FIDComex');
  assert.equal(resultado.dados[0].tipo_pedido, 'MARKETPLACE');
  assert.equal(resultado.dados[0].plataforma, 'ML');
  assert.equal(resultado.dados[0].transporte_regras, 'RAPIDA PADRAO');
  assert.equal(resultado.dados[0].quantidade, 2);
  assert.equal(resultado.dados[0].valor_total_item, 20);
});

test('soma valor total sem multiplicar novamente o valor unitario', async () => {
  const resultado = await leitor.agregar('fato_venda_item', {
    agrupamentos: [{ campo: 'grupo', granularidade: 'valor' }],
    calculos: [{ operacao: 'somar', campo: 'valor_total_item' }]
  });
  assert.equal(resultado.dados[0].calculo_1, 30);
});
