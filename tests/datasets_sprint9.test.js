const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');

const { criarConexaoDuckDB, fecharConexaoDuckDB, runDuckDB } = require('../duckdb/connections');
const { classificarFluxoDatasets, intencaoExportar } = require('../agentes/fluxo_datasets');
const { construirXlsxDataset } = require('../nexus/dataset_artifact_builder');
const { criarServicoArtefatos } = require('../nexus/artefatos');
const { consultarConjunto, montarPrevia } = require('../nexus/dataset_query_engine');
const { criarServicoDatasets, descriptor, prepararTabelaXlsx,
  processarFilaLimpezaDatasets } = require('../nexus/datasets');

function escaparSql(valor) { return String(valor).replace(/'/g, "''").replace(/\\/g, '/'); }

async function parquet(caminho, definicao, valores) {
  const con = criarConexaoDuckDB();
  try {
    await runDuckDB(con, `CREATE TABLE dados (${definicao})`);
    for (const linha of valores) await runDuckDB(con, `INSERT INTO dados VALUES (${linha})`);
    await runDuckDB(con, `COPY dados TO '${escaparSql(caminho)}' (FORMAT PARQUET)`);
  } finally { await fecharConexaoDuckDB(con); }
}

function leitorParquet(caminhoCorporativo, contador) {
  const con = criarConexaoDuckDB();
  return {
    async comObjeto(_nome, executor) {
      await runDuckDB(con, `CREATE OR REPLACE TEMP VIEW corporativo_atual AS
        SELECT * FROM read_parquet('${escaparSql(caminhoCorporativo)}')`);
      return executor({
        contexto: { viewAtual: 'corporativo_atual', execucoes: [{ manifesto: { fim: '2026-09-02T12:00:00Z' } }] },
        conexao: con,
        consultarSql(sql, parametros = []) {
          contador.total += 1;
          return new Promise((resolve, reject) => con.all(sql, ...parametros,
            (erro, linhas) => erro ? reject(erro) : resolve(linhas)));
        }
      });
    },
    async fechar() {
      await runDuckDB(con, 'DROP VIEW IF EXISTS corporativo_atual').catch(() => null);
      await fecharConexaoDuckDB(con);
    }
  };
}

function datasetExtraido(quantidade = 100) {
  return { tipo: 'xlsx', abas: [{ nome: 'Produtos', linhas: [
    { numero: 1, valores: { 1: 'SKU', 2: 'Descrição' } },
    ...Array.from({ length: quantidade }, (_, indice) => ({
      numero: indice + 2, valores: { 1: `SKU-${indice + 1}`, 2: `Produto ${indice + 1}` }
    }))
  ] }] };
}

test('classificador só cruza planilha quando a pergunta relaciona arquivo e domínio corporativo', () => {
  assert.equal(classificarFluxoDatasets('Resuma esta planilha', { possuiXlsx: true }).fluxo,
    'somente_arquivo');
  assert.deepEqual(classificarFluxoDatasets('Resuma a planilha com as vendas', { possuiXlsx: true }),
    { fluxo: 'somente_arquivo', exportar: false });
  assert.equal(classificarFluxoDatasets(
    'Essas são as vendas do saldão. Qual foi o produto mais vendido desse relatório?',
    { possuiXlsx: true }).fluxo, 'somente_arquivo');
  assert.equal(classificarFluxoDatasets(
    'Compare os produtos deste relatório com as vendas do Sysemp',
    { possuiXlsx: true }).fluxo, 'misto');
  assert.equal(classificarFluxoDatasets('Desses produtos da planilha, quais estão sem estoque?',
    { possuiXlsx: true }).fluxo, 'misto');
  const vendas = classificarFluxoDatasets('Faça um Excel mostrando qual desses produtos mais vendeu este mês',
    { possuiXlsx: true });
  assert.equal(vendas.fluxo, 'misto_e_exportar');
  assert.equal(vendas.dominio, 'vendas');
  assert.equal(classificarFluxoDatasets('Faça uma planilha com esse resultado',
    { possuiRefAnterior: true }).fluxo, 'exportar_resultado');
  assert.equal(classificarFluxoDatasets('Consegue me dar uma planilha com os 20 com mais venda?',
    { possuiRefAnterior: true }).fluxo, 'exportar_resultado');
  assert.equal(classificarFluxoDatasets('Quero uma planilha com os 20 produtos com mais vendas',
    { possuiRefAnterior: false }).fluxo, 'consultar_e_exportar');
  const enriquecimento = classificarFluxoDatasets('Inclua também o código de barras nesse resultado',
    { possuiRefAnterior: true });
  assert.equal(enriquecimento.fluxo, 'enriquecer_resultado');
  assert.equal(enriquecimento.enriquecerCatalogo, true);
});

test('pedido natural de planilha refaz o ranking quando o limite mudou antes de exportar', () => {
  const referenciaAnterior = {
    tipo: 'result_ref', quantidadeLinhas: 10,
    origem: { ferramenta: 'analisar_vendas', tabela: 'dados' }
  };
  assert.deepEqual(classificarFluxoDatasets(
    'Consegue fazer uma planilha com os top 20 produtos?',
    { possuiRefAnterior: true, referenciaAnterior }
  ), {
    fluxo: 'consultar_e_exportar', exportar: true,
    dominio: 'vendas', operacao: 'ranquear', limite: 20, periodo: null
  });
  assert.equal(classificarFluxoDatasets(
    'Consegue fazer uma planilha com os top 10 produtos?',
    { possuiRefAnterior: true, referenciaAnterior }
  ).fluxo, 'exportar_resultado');
  assert.equal(classificarFluxoDatasets(
    'Consegue fazer uma planilha com esse resultado?',
    { possuiRefAnterior: true, referenciaAnterior }
  ).fluxo, 'exportar_resultado');
});

test('intenção de geração cobre pedidos naturais sem depender de uma consulta específica', () => {
  for (const pedido of [
    'Faça uma planilha com esses produtos',
    'Transforme esse resultado em Excel',
    'Coloque os dados em um XLSX',
    'Envie um arquivo com esta tabela',
    'Salve isso em uma planilha',
    'Quero um relatório em PDF',
    'Pode gerar um documento Word?'
  ]) assert.equal(intencaoExportar(pedido), true, pedido);
  assert.equal(intencaoExportar('Organize esses produtos por ranking na resposta'), false);
});

test('preparação usa todas as linhas, preserva ordem e exige escolha quando a chave é ambígua', () => {
  const tabela = prepararTabelaXlsx(datasetExtraido(120), 'use SKU');
  assert.equal(tabela.linhas.length, 120);
  assert.equal(tabela.linhas[99].__nexus_row_number, 101);
  assert.equal(tabela.linhas[119].__nexus_key, 'SKU-120');

  const ambiguo = datasetExtraido(2);
  ambiguo.abas[0].linhas[0].valores[3] = 'EAN';
  ambiguo.abas[0].linhas[1].valores[3] = '7891234567890';
  ambiguo.abas[0].linhas[2].valores[3] = '7891234567891';
  assert.throws(() => prepararTabelaXlsx(ambiguo), (erro) => erro.codigo === 'DATASET_CHAVE_AMBIGUA');
});

test('preparação encontra o cabeçalho real depois do preâmbulo do relatório', () => {
  const extraido = { tipo: 'xlsx', abas: [{ nome: 'Relatório', linhas: [
    { numero: 1, valores: { 3: 'Relatório Saída - Produtos e Formas de Pagamento', 12: '15/09/2026' } },
    { numero: 4, valores: { 10: 'FID COMERCIO EXTERIOR LTDA' } },
    { numero: 13, valores: { 3: 'Produto', 4: 'Categoria', 8: 'SKU', 9: 'Quantidade', 10: 'Valor unitário', 12: 'Total' } },
    { numero: 14, valores: { 3: 'Produto A', 4: 'Categoria A', 8: 'SKU-A', 9: 2, 10: 10, 12: 20 } },
    { numero: 15, valores: { 3: 'Produto B', 4: 'Categoria B', 8: 'SKU-B', 9: 5, 10: 8, 12: 40 } },
    { numero: 16, valores: { 3: 'Total', 12: 60 } },
    { numero: 18, valores: { 3: 'Tipo Pagamento', 4: 'Total' } }
  ] }] };
  const tabela = prepararTabelaXlsx(extraido, 'use SKU');
  assert.equal(tabela.cabecalhoLinha, 13);
  assert.equal(tabela.intervalo, 'C13:L15');
  assert.deepEqual(tabela.linhas.map((linha) => linha.produto), ['Produto A', 'Produto B']);
  assert.deepEqual(tabela.linhas.map((linha) => linha.__nexus_key), ['SKU-A', 'SKU-B']);
});

test('descritor considera vencida uma referência cujo prazo absoluto passou', () => {
  assert.equal(descriptor({ id: 'r1', kind: 'result_ref', status: 'ready',
    expires_at: '2020-01-01T00:00:00Z' }).status, 'expired');
});

test('serviço recusa referência de outra conversa, usuário ou setor antes de abrir o storage', async () => {
  let abriuStorage = false;
  const pool = { async query(sql, valores) {
    if (/SELECT id,department_id FROM nexus\.conversations/.test(sql)) {
      assert.equal(valores[1], 'principal-1');
      return { rows: valores[0] === 'conversa-1'
        ? [{ id: 'conversa-1', department_id: 'setor-2' }] : [] };
    }
    throw new Error('A consulta de dataset não deveria ocorrer sem conversa autorizada.');
  } };
  const servico = criarServicoDatasets({ pool, principalId: 'principal-1', departmentId: 'setor-1',
    modo: 'v1', storage: { async abrirCaminho() { abriuStorage = true; } } });
  await assert.rejects(() => servico.obter('conversa-2', 'ref-1'),
    (erro) => erro.codigo === 'DATASET_CONVERSA_NEGADA');
  await assert.rejects(() => servico.obter('conversa-1', 'ref-1'),
    (erro) => erro.codigo === 'DATASET_SETOR_NEGADO');
  assert.equal(abriuStorage, false);
});

test('falha ao apagar Parquet expirado cria retentativa e libera logicamente a referência', async () => {
  const consultas = [];
  const pool = { async query(sql) {
    consultas.push(sql);
    if (/SELECT id,storage_key FROM nexus\.conversation_datasets/.test(sql)) {
      return { rows: [{ id: 'ref-1', storage_key: '11111111-1111-4111-8111-111111111111.parquet' }] };
    }
    if (/SELECT id,dataset_id,storage_key,attempts FROM nexus\.dataset_cleanup_jobs/.test(sql)) {
      return { rows: [] };
    }
    return { rows: [] };
  } };
  const resultado = await processarFilaLimpezaDatasets({ pool,
    storage: { async excluir() { const erro = new Error('ocupado'); erro.code = 'EBUSY'; throw erro; } } });
  assert.equal(resultado.expirados, 1);
  assert.ok(consultas.some((sql) => /INSERT INTO nexus\.dataset_cleanup_jobs/.test(sql)));
  assert.ok(consultas.some((sql) => /SET status='expired'/.test(sql)));
});

test('prévia enviada ao modelo respeita simultaneamente 20 linhas e 32 KB', () => {
  const previa = montarPrevia(Array.from({ length: 100 }, (_, indice) => ({
    __nexus_row_number: indice + 1, sku: `SKU-${indice}`, descricao: 'x'.repeat(4_000)
  })));
  assert.ok(previa.length <= 20);
  assert.ok(Buffer.byteLength(JSON.stringify(previa), 'utf8') <= 32 * 1024);
  assert.equal(Object.hasOwn(previa[0], '__nexus_row_number'), false);
});

test('estoque é associado em uma consulta, preservando duplicidades, ordem e ausentes', async (t) => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-dataset-test-'));
  t.after(() => fs.rm(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    .catch((erro) => { if (erro.code !== 'EBUSY') throw erro; }));
  const arquivoDataset = path.join(raiz, 'dataset.parquet');
  const arquivoCorp = path.join(raiz, 'estoque.parquet');
  await parquet(arquivoDataset,
    '__nexus_row_number INTEGER, __nexus_key VARCHAR, sku_original VARCHAR', [
      "1, 'SKU-2', 'SKU-2'", "2, 'SKU-1', 'SKU-1'", "3, 'SKU-1', 'SKU-1'", "4, 'AUSENTE', 'AUSENTE'"
    ]);
  await parquet(arquivoCorp,
    'id_produto INTEGER, descricao_produto VARCHAR, sku VARCHAR, ean VARCHAR, marca VARCHAR, estoque_disponivel INTEGER, quantidade_reservada INTEGER, empresa_analisada BOOLEAN', [
      "1, 'Produto 1', 'SKU-1', '7891', 'Marca', 5, 1, true",
      "2, 'Produto 2', 'SKU-2', '7892', 'Marca', 0, 0, true"
    ]);
  const contador = { total: 0 }; let persistido;
  const servicoDatasets = {
    async abrirCaminho() { return { caminho: arquivoDataset, descriptor: {
      chaveSelecionada: { tipo: 'sku', coluna: 'sku_original' },
      colunas: [{ nome: 'sku_original', rotulo: 'SKU' }], classificacao: 'conversa_privada'
    } }; },
    async criarDeLinhas(_conversa, _turno, linhas, opcoes) {
      persistido = { linhas, opcoes };
      return { id: 'resultado-1', tipo: 'result_ref', status: 'ready' };
    }
  };
  const resultado = await consultarConjunto({ dataset_ref: 'dataset-1', dominio: 'estoque', operacao: 'enriquecer' }, {
    servicoDatasets, conversationId: 'conversa-1', turnoIA: { id: 'turno-1' },
    criarLeitorSilver: () => leitorParquet(arquivoCorp, contador)
  });
  assert.equal(contador.total, 1);
  assert.deepEqual(persistido.linhas.map((x) => x.sku_original), ['SKU-2', 'SKU-1', 'SKU-1', 'AUSENTE']);
  assert.deepEqual(persistido.linhas.map((x) => x.nexus_encontrado), [true, true, true, null]);
  assert.equal(resultado.encontrados, 3);
  assert.equal(resultado.nao_encontrados, 1);
  assert.equal(resultado.payload_previa_bytes <= 32 * 1024, true);
  assert.equal(persistido.opcoes.corporateUpdatedAt, '2026-09-02T12:00:00Z');
});

test('vendas ranqueia somente o conjunto anexado e faz uma consulta para o período', async (t) => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-sales-test-'));
  t.after(() => fs.rm(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    .catch((erro) => { if (erro.code !== 'EBUSY') throw erro; }));
  const arquivoDataset = path.join(raiz, 'dataset.parquet');
  const arquivoCorp = path.join(raiz, 'vendas.parquet');
  await parquet(arquivoDataset, '__nexus_row_number INTEGER, __nexus_key VARCHAR, sku_original VARCHAR', [
    "1, 'SKU-2', 'SKU-2'", "2, 'SKU-1', 'SKU-1'"
  ]);
  await parquet(arquivoCorp,
    'data_referencia DATE, id_produto INTEGER, descricao_produto VARCHAR, sku VARCHAR, ean VARCHAR, marca VARCHAR, quantidade_faturada INTEGER, faturamento_emitido DOUBLE, margem_bruta_produtos DOUBLE', [
      "DATE '2026-08-10', 1, 'Produto 1', 'SKU-1', '7891', 'Marca', 12, 1200, 300",
      "DATE '2026-08-10', 2, 'Produto 2', 'SKU-2', '7892', 'Marca', 3, 300, 80",
      "DATE '2026-07-10', 2, 'Produto 2', 'SKU-2', '7892', 'Marca', 100, 10000, 500"
    ]);
  const contador = { total: 0 }; let linhasPersistidas;
  const servicoDatasets = {
    async abrirCaminho() { return { caminho: arquivoDataset, descriptor: {
      chaveSelecionada: { tipo: 'sku', coluna: 'sku_original' },
      colunas: [{ nome: 'sku_original', rotulo: 'SKU' }]
    } }; },
    async criarDeLinhas(_conversa, _turno, linhas) {
      linhasPersistidas = linhas; return { id: 'resultado-vendas', tipo: 'result_ref', status: 'ready' };
    }
  };
  await consultarConjunto({ dataset_ref: 'dataset-1', dominio: 'vendas', operacao: 'ranquear',
    periodo: { inicio: '2026-08-01', fim: '2026-08-31' } }, {
    servicoDatasets, conversationId: 'conversa-1', turnoIA: { id: 'turno-1' },
    criarLeitorGold: () => leitorParquet(arquivoCorp, contador)
  });
  assert.equal(contador.total, 1);
  assert.deepEqual(linhasPersistidas.map((x) => x.sku_original), ['SKU-1', 'SKU-2']);
  assert.deepEqual(linhasPersistidas.map((x) => x.nexus_quantidade_faturada), ['12', '3']);
});

test('catálogo sinaliza associação ambígua sem perder a linha original', async (t) => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-catalog-test-'));
  t.after(() => fs.rm(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    .catch((erro) => { if (erro.code !== 'EBUSY') throw erro; }));
  const arquivoDataset = path.join(raiz, 'dataset.parquet');
  const arquivoCorp = path.join(raiz, 'catalogo.parquet');
  await parquet(arquivoDataset, '__nexus_row_number INTEGER, __nexus_key VARCHAR, sku_original VARCHAR', [
    "1, 'REPETIDO', 'REPETIDO'"
  ]);
  await parquet(arquivoCorp,
    'id_produto INTEGER, descricao_produto VARCHAR, sku VARCHAR, ean VARCHAR, marca VARCHAR, categoria VARCHAR, produto_ativo BOOLEAN, catalogo_site_ativo BOOLEAN', [
      "1, 'Produto 1', 'REPETIDO', '7891', 'Marca', 'Categoria', true, true",
      "2, 'Produto 2', 'REPETIDO', '7892', 'Marca', 'Categoria', true, true"
    ]);
  let linhasPersistidas;
  const servicoDatasets = {
    async abrirCaminho() { return { caminho: arquivoDataset, descriptor: {
      chaveSelecionada: { tipo: 'sku', coluna: 'sku_original' },
      colunas: [{ nome: 'sku_original', rotulo: 'SKU' }]
    } }; },
    async criarDeLinhas(_conversa, _turno, linhas) {
      linhasPersistidas = linhas; return { id: 'resultado-catalogo', tipo: 'result_ref', status: 'ready' };
    }
  };
  const contador = { total: 0 };
  await consultarConjunto({ dataset_ref: 'dataset-1', dominio: 'catalogo', operacao: 'enriquecer' }, {
    servicoDatasets, conversationId: 'conversa-1', turnoIA: { id: 'turno-1' },
    criarLeitorSilver: () => leitorParquet(arquivoCorp, contador)
  });
  assert.equal(contador.total, 1);
  assert.equal(linhasPersistidas[0].nexus_associacao_ambigua, true);
  assert.equal(linhasPersistidas[0].sku_original, 'REPETIDO');
});

test('exportação XLSX faz streaming e protege fórmula em dado textual', async (t) => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-export-test-'));
  t.after(() => fs.rm(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    .catch((erro) => { if (erro.code !== 'EBUSY') throw erro; }));
  const arquivoDataset = path.join(raiz, 'resultado.parquet');
  await parquet(arquivoDataset, '__nexus_row_number INTEGER, sku VARCHAR, observacao VARCHAR', [
    "1, 'SKU-1', '=HYPERLINK(''https://example.com'')'", "2, 'SKU-2', 'normal'"
  ]);
  const exportado = await construirXlsxDataset({ caminhoDataset: arquivoDataset,
    titulo: 'Resultado autorizado', quantidadeLinhas: 2,
    colunas: [{ nome: 'sku', rotulo: 'SKU' }, { nome: 'observacao', rotulo: 'Observação' }] });
  t.after(() => fs.unlink(exportado.caminho).catch(() => null));
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(exportado.caminho);
  const dados = workbook.getWorksheet('Resultado autorizado');
  assert.equal(dados.getCell('A1').value, 'Resultado autorizado');
  assert.equal(dados.getCell('A4').value, 'SKU');
  assert.equal(dados.getCell('B5').value, "'=HYPERLINK('https://example.com')");
  assert.equal(dados.getCell('B6').value, 'normal');
  assert.equal(dados.views[0].showGridLines, false);
  assert.equal(dados.getRow(4).fill.fgColor.argb, 'FF0B6B45');
});

test('exportação XLSX converte BigInt do DuckDB sem perder precisão', async (t) => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-export-bigint-test-'));
  t.after(() => fs.rm(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    .catch((erro) => { if (erro.code !== 'EBUSY') throw erro; }));
  const arquivoDataset = path.join(raiz, 'resultado-bigint.parquet');
  await parquet(arquivoDataset, '__nexus_row_number BIGINT, quantidade BIGINT, identificador BIGINT', [
    '1, 20, 9007199254740993'
  ]);
  const exportado = await construirXlsxDataset({ caminhoDataset: arquivoDataset,
    titulo: 'Resultado BigInt', quantidadeLinhas: 1,
    colunas: [{ nome: 'quantidade', rotulo: 'Quantidade' },
      { nome: 'identificador', rotulo: 'Identificador' }] });
  t.after(() => fs.unlink(exportado.caminho).catch(() => null));
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(exportado.caminho);
  const dados = workbook.getWorksheet('Resultado BigInt');
  assert.equal(dados.getCell('A5').value, 20);
  assert.equal(dados.getCell('B5').value, '9007199254740993');
  assert.equal(dados.getCell('A5').numFmt, '#,##0');
  assert.equal(dados.getCell('B5').numFmt, '@');
});

test('exportação XLSX aplica o perfil de marca recebido sem cor fixa da implantação', async (t) => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-export-brand-test-'));
  t.after(() => fs.rm(raiz, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    .catch((erro) => { if (erro.code !== 'EBUSY') throw erro; }));
  const arquivoDataset = path.join(raiz, 'resultado-brand.parquet');
  await parquet(arquivoDataset, '__nexus_row_number INTEGER, receita DOUBLE, data_pedido DATE', [
    "1, 1234.5, DATE '2026-09-03'"
  ]);
  const exportado = await construirXlsxDataset({ caminhoDataset: arquivoDataset,
    titulo: 'Resultado com marca', quantidadeLinhas: 1,
    colunas: [{ nome: 'receita', rotulo: 'Receita' }, { nome: 'data_pedido', rotulo: 'Data do pedido' }],
    marca: { nome: 'Empresa Teste', logo: null, cores: { primaria: '#123456', secundaria: '#234567',
      destaque: '#45ffaa', texto: '#17211c', superficie: '#f3f8f5', linha: '#d8e5dd', textoSuave: '#66756d' } } });
  t.after(() => fs.unlink(exportado.caminho).catch(() => null));
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(exportado.caminho);
  const resumo = workbook.getWorksheet('Resumo'); const dados = workbook.getWorksheet('Resultado com marca');
  assert.equal(resumo.getCell('B7').value, 'Nexus para Empresa Teste');
  assert.equal(dados.getRow(4).fill.fgColor.argb, 'FF123456');
  assert.match(dados.getColumn(1).numFmt, /R\$/);
  assert.equal(dados.getColumn(2).numFmt, 'dd/mm/yyyy');
  assert.equal(exportado.validacao.template, 'Empresa Teste');
});

test('resultado corporativo pequeno usa o template completo sem depender do domínio consultado', async () => {
  let bufferSalvo = null;
  const principalId = '11111111-1111-4111-8111-111111111111';
  const conversationId = '22222222-2222-4222-8222-222222222222';
  const pool = { async query(sql, valores) {
    if (/SELECT id FROM nexus\.conversations/.test(sql)) return { rows: [{ id: conversationId }] };
    if (/INSERT INTO nexus\.conversation_artifacts/.test(sql)) return { rows: [{
      id: '33333333-3333-4333-8333-333333333333', format: 'xlsx', media_type: valores[5],
      file_name: valores[6], title: valores[7], bytes: valores[10], classification: valores[11],
      status: 'ready', criado_em: new Date().toISOString()
    }] };
    return { rows: [] };
  } };
  const storage = { async salvar({ buffer }) { bufferSalvo = buffer; return { chave: 'arquivo.xlsx' }; },
    async excluir() {} };
  const servicoDatasets = {
    async abrirCaminho() { return { caminho: 'nao-usado.parquet', descriptor: {
      quantidadeLinhas: 2, classificacao: 'dados_nexus',
      colunas: [{ nome: 'rank', rotulo: 'Rank' }, { nome: 'produto', rotulo: 'Produto' }]
    } }; },
    async lerLinhas() { return { linhas: [{ rank: 1n, produto: 'A' }, { rank: 2n, produto: 'B' }] }; }
  };
  const servico = criarServicoArtefatos({ pool, storage, principalId,
    brand: { nome: 'Marca Implantada', cores: { primaria: '#123456' } } });
  const criado = await servico.gerarDeDataset(conversationId, 'turno-1', {
    result_ref: 'resultado-1', formato: 'xlsx', titulo: 'Ranking autorizado',
    colunas: [], identidadeVisual: true
  }, { mode: 'v1', servicoDatasets });
  assert.equal(criado.status, 'ready');
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bufferSalvo);
  const dados = workbook.getWorksheet('Dados');
  assert.equal(dados.getCell('A1').value, 'Dados');
  assert.equal(dados.getCell('A5').value, 1);
  assert.equal(dados.getRow(4).fill.fgColor.argb, 'FF123456');
});
