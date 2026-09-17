const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const LegacyExcel = require('@e965/xlsx');
const JSZip = require('jszip');
const { Document, ImageRun, Packer, Paragraph } = require('docx');
const { carregarMarca, construirArtefato, formatoColunaXlsx, protegerFormula } = require('../nexus/artifact_builder');
const { ErroArquivo, processarArquivo, selecionarConteudo, validarPacoteOffice } = require('../nexus/file_processing');
const { criarServicoArtefatos } = require('../nexus/artefatos');
const { criarServicoAnexos } = require('../nexus/anexos');
const { estruturarItensPdf } = require('../nexus/document_parser');

test('análise local detecta cabeçalho real e preserva a linha associada ao máximo', () => {
  const extraido = { tipo: 'xlsx', sourceFormat: 'xls', avisos: [], abas: [{ nome: 'Saídas', linhas: [
    { numero: 1, valores: { 3: 'Relatório Saída - Produtos e Formas de Pagamento', 12: '15/09/2026' } },
    { numero: 5, valores: { 10: 'FID COMERCIO EXTERIOR LTDA' } },
    { numero: 13, valores: { 3: 'Produto', 4: 'Categoria', 9: 'Quantidade', 10: 'Valor unitário', 12: 'Total' } },
    { numero: 14, valores: { 3: 'Produto A', 4: 'Categoria A', 9: 2, 10: 10, 12: 20 } },
    { numero: 15, valores: { 3: 'Produto B', 4: 'Categoria B', 9: 8, 10: 5, 12: 40 } },
    { numero: 16, valores: { 3: 'Total', 12: 60 } }
  ] }] };
  const analise = selecionarConteudo(extraido, 'qual foi o produto mais vendido deste relatório?');
  const quantidade = analise.resumoNumerico.find((item) => item.coluna === 'Quantidade');
  assert.equal(analise.cabecalhoLinha, 13);
  assert.equal(analise.linhasAnalisadas, 2);
  assert.equal(quantidade.maximo, 8);
  assert.equal(quantidade.linhaMaximo.valores.Produto, 'Produto B');
});

async function xlsxFixture() {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Vendas');
  ws.addRow(['Produto', 'Quantidade', 'Valor']);
  ws.addRow(['A', 2, 10]); ws.addRow(['B', 3, 20]); ws.addRow(['B', 3, 20]);
  ws.getCell('D2').value = { formula: 'B2*C2', result: 20 };
  wb.definedNames.add('Vendas!$A$2:$A$4', 'ProdutosVendidos');
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function xlsFixture() {
  const wb = LegacyExcel.utils.book_new();
  const ws = LegacyExcel.utils.aoa_to_sheet([
    ['Produto', 'Quantidade', 'Valor'], ['A', 2, 10], ['B', 3, 20], ['B', 3, 20]
  ]);
  LegacyExcel.utils.book_append_sheet(wb, ws, 'Vendas');
  return LegacyExcel.write(wb, { type: 'buffer', bookType: 'biff8' });
}

async function docxFixture() {
  return Packer.toBuffer(new Document({ sections: [{ children: [
    new Paragraph({ text: 'Abertura do chamado', heading: 'Heading1' }),
    new Paragraph('Acesse Meus Chamados e clique em Adicionar.'),
    new Paragraph({ text: 'Tela de confirmação', heading: 'Heading1' }),
    new Paragraph({ children: [new ImageRun({
      data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64'),
      transformation: { width: 1, height: 1 }, type: 'png'
    })] })
  ] }] }));
}

test('processa XLSX e calcula resumos, ausencias e duplicidades localmente', async () => {
  const arquivo = await processarArquivo({ buffer: await xlsxFixture(), fileName: 'relatorio.xlsx',
    mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  assert.equal(arquivo.formato, 'xlsx');
  assert.equal(arquivo.metadados.abas, 1);
  assert.deepEqual(arquivo.extraido.nomesDefinidos, [
    { nome: 'ProdutosVendidos', referencias: ['Vendas!$A$2:$A$4'] }
  ]);
  const analise = selecionarConteudo(arquivo.extraido, 'analise vendas', 'medio');
  assert.equal(analise.aba, 'Vendas');
  assert.equal(analise.resumoNumerico.find((x) => x.coluna === 'Quantidade').soma, 8);
  assert.equal(analise.linhasDuplicadas, 1);
  assert.deepEqual(analise.referencias[0], { tipo: 'xlsx', aba: 'Vendas', intervalo: 'A1:D4' });
});

test('processa XLS legado no mesmo IR e mantém referências no formato de origem', async () => {
  const arquivo = await processarArquivo({ buffer: xlsFixture(), fileName: 'relatorio.xls',
    mediaType: 'application/vnd.ms-excel' });
  assert.equal(arquivo.formato, 'xls');
  assert.equal(arquivo.extraido.tipo, 'xlsx');
  assert.equal(arquivo.extraido.sourceFormat, 'xls');
  assert.equal(arquivo.metadados.abas, 1);
  assert.equal(arquivo.metadados.celulas, 12);
  assert.ok(arquivo.metadados.entradas_pacote >= 1);
  const analise = selecionarConteudo(arquivo.extraido, 'analise vendas', 'medio');
  assert.equal(analise.resumoNumerico.find((x) => x.coluna === 'Quantidade').soma, 8);
  assert.equal(analise.linhasDuplicadas, 1);
  assert.deepEqual(analise.referencias[0], { tipo: 'xls', aba: 'Vendas', intervalo: 'A1:C4' });
});

test('não aceita XLSX apenas renomeado para XLS', async () => {
  const buffer = await xlsxFixture();
  await assert.rejects(() => processarArquivo({ buffer, fileName: 'renomeado.xls',
    mediaType: 'application/vnd.ms-excel' }),
  (erro) => erro instanceof ErroArquivo && erro.codigo === 'ASSINATURA_INVALIDA');
});

test('extrai secoes de DOCX com referencia estrutural', async () => {
  const arquivo = await processarArquivo({ buffer: await docxFixture(), fileName: 'procedimento.docx',
    mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const analise = selecionarConteudo(arquivo.extraido, 'onde abrir chamado', 'medio');
  assert.match(analise.trechos[0].texto, /Meus Chamados/);
  assert.equal(analise.referencias[0].tipo, 'docx');
  assert.equal(arquivo.extraido.imagens[0].section, 'Tela de confirmação');
});

test('estrutura linhas e candidatos a tabela de PDF sem executar conteúdo', () => {
  const estrutura = estruturarItensPdf([
    { str: 'Produto', transform: [1, 0, 0, 10, 10, 100], width: 50, height: 10 },
    { str: 'Valor', transform: [1, 0, 0, 10, 200, 100], width: 30, height: 10 },
    { str: 'Fogão', transform: [1, 0, 0, 10, 10, 80], width: 40, height: 10 },
    { str: '100', transform: [1, 0, 0, 10, 200, 80], width: 20, height: 10 }
  ]);
  assert.equal(estrutura.blocos.length, 2);
  assert.equal(estrutura.tabelas.length, 1);
  assert.deepEqual(estrutura.tabelas[0].linhas, [['Produto', 'Valor'], ['Fogão', '100']]);
  assert.equal(estrutura.tabelas[0].deteccao, 'estrutural_heuristica');
});

test('bloqueia macro ou objeto incorporado em pacote Office', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document/>');
  zip.file('word/vbaProject.bin', Buffer.from('macro'));
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => processarArquivo({ buffer, fileName: 'perigoso.docx',
    mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
  (erro) => erro instanceof ErroArquivo && erro.codigo === 'CONTEUDO_ATIVO_BLOQUEADO');
});

test('aceita hyperlink comum em Office sem abrir a URL', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document/>');
  zip.file('word/_rels/document.xml.rels', [
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" ',
    'Target="https://example.com" TargetMode="External"/>',
    '</Relationships>'
  ].join(''));
  const resultado = await validarPacoteOffice(await zip.generateAsync({ type: 'nodebuffer' }), 'docx');
  assert.ok(resultado.entryCount >= 2);
});

test('bloqueia imagem ou modelo externo em pacote Office', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document/>');
  zip.file('word/_rels/document.xml.rels', [
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ',
    'Target="https://example.com/rastreio.png" TargetMode="External"/>',
    '</Relationships>'
  ].join(''));
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => validarPacoteOffice(buffer, 'docx'),
    (erro) => erro instanceof ErroArquivo && erro.codigo === 'REFERENCIA_EXTERNA_BLOQUEADA');
});

test('bloqueia PDF com JavaScript antes da extracao', async () => {
  const buffer = Buffer.from('%PDF-1.7\n1 0 obj << /JavaScript (alert) >> endobj\n%%EOF', 'latin1');
  await assert.rejects(() => processarArquivo({ buffer, fileName: 'ativo.pdf', mediaType: 'application/pdf' }),
    (erro) => erro.codigo === 'PDF_ATIVO_BLOQUEADO');
});

test('protege formula injection em valores textuais', () => {
  assert.equal(protegerFormula('=HYPERLINK("x")'), "'=HYPERLINK(\"x\")");
  assert.equal(protegerFormula('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(protegerFormula('texto normal'), 'texto normal');
  assert.equal(protegerFormula(20n), 20);
  assert.equal(protegerFormula(9007199254740993n), '9007199254740993');
});

test('formata percentuais sem multiplicar valores que já vieram em pontos percentuais', () => {
  assert.equal(formatoColunaXlsx('Margem percentual', [0.125]), '0.0%');
  assert.equal(formatoColunaXlsx('Margem percentual', [12.5]), '0.0\\%');
});

test('configuracao visual invalida usa a marca parcial e o tema padrao sem derrubar a geracao', () => {
  const anterior = process.env.NEXUS_ARTIFACT_BRAND_JSON;
  process.env.NEXUS_ARTIFACT_BRAND_JSON = '{"nome":"FID","cores":{"primaria":"';
  try {
    const marca = carregarMarca();
    assert.equal(marca.nome, 'FID');
    assert.equal(marca.cores.primaria, '#0b6b45');
  } finally {
    if (anterior == null) delete process.env.NEXUS_ARTIFACT_BRAND_JSON;
    else process.env.NEXUS_ARTIFACT_BRAND_JSON = anterior;
  }
});

for (const formato of ['xlsx', 'docx', 'pdf']) {
  test(`gera, reabre e valida artefato ${formato}`, async () => {
    const resultado = await construirArtefato({ formato, titulo: `Relatorio ${formato}`, modelo: 'relatorio',
      secoes: [{ titulo: 'Resumo', conteudo: 'Conteudo validado.', itens: ['Item um'] }],
      tabelas: [{ titulo: 'Dados', colunas: ['Nome', 'Valor'], linhas: [['A', 10], ['=RISCO', 20]] }],
      graficos: [{ titulo: 'Valores', tipo: 'barra', categorias: ['A', 'B'], valores: [10, 20] }],
      fontes: ['Fonte interna autorizada'], identidadeVisual: true },
    { brand: { nome: 'Teste', cores: { primaria: '#0b6b45' } } });
    assert.ok(resultado.buffer.length > 500);
    assert.ok(Object.values(resultado.validacao)[0] > 0);
    if (formato === 'xlsx') {
      const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(resultado.buffer);
      const resumo = workbook.getWorksheet('Resumo'); const dados = workbook.getWorksheet('Dados');
      assert.equal(resumo.getCell('A1').value, 'Relatorio xlsx');
      assert.equal(resumo.getCell('A4').value, 'Seção');
      assert.equal(resumo.getRow(4).fill.fgColor.argb, 'FF0B6B45');
      assert.equal(resumo.views[0].showGridLines, false);
      assert.equal(dados.getCell('A1').value, 'Dados');
      assert.equal(dados.getCell('A4').value, 'Nome');
      assert.equal(dados.getCell('A5').value, 'A');
      assert.equal(dados.getCell('B5').value, 10);
      assert.match(dados.getColumn(2).numFmt, /R\$/);
    }
    if (formato === 'pdf') assert.ok(resultado.validacao.paginasRenderizadas >= 1);
  });
}

test('servico de artefatos isola conversa, persiste e reabre o binario gerado', async () => {
  const principalId = '11111111-1111-4111-8111-111111111111';
  const conversationId = '22222222-2222-4222-8222-222222222222';
  const artifactId = '33333333-3333-4333-8333-333333333333';
  let registro = null;
  let binario = null;
  const storage = {
    async salvar({ buffer, extensao }) { binario = buffer; return { chave: `44444444-4444-4444-8444-444444444444.${extensao}` }; },
    async abrir(chave) { assert.equal(chave, registro.storage_key); return binario; },
    async excluir(chave) { assert.equal(chave, registro.storage_key); binario = null; return true; }
  };
  const pool = { async query(sql, valores) {
    if (/SELECT id FROM nexus\.conversations/.test(sql)) {
      return { rows: valores[0] === conversationId && valores[1] === principalId ? [{ id: conversationId }] : [] };
    }
    if (/INSERT INTO nexus\.conversation_artifacts/.test(sql)) {
      registro = { id: artifactId, conversation_id: valores[0], principal_id: valores[1], turn_id: valores[2],
        department_id: valores[3], format: valores[4], media_type: valores[5], file_name: valores[6],
        title: valores[7], storage_key: valores[8], sha256: valores[9], bytes: valores[10],
        classification: valores[11], status: 'ready', criado_em: new Date().toISOString() };
      return { rows: [registro] };
    }
    if (/SELECT \* FROM nexus\.conversation_artifacts/.test(sql)) {
      return { rows: registro && valores[0] === artifactId && valores[1] === conversationId
        && valores[2] === principalId ? [registro] : [] };
    }
    if (/DELETE FROM nexus\.conversation_artifacts/.test(sql)) { registro = null; return { rows: [], rowCount: 1 }; }
    return { rows: [] };
  } };
  const servico = criarServicoArtefatos({ pool, storage, principalId });
  const criado = await servico.gerar(conversationId, 'turno-1', {
    formato: 'xlsx', titulo: 'Resumo autorizado', secoes: [{ titulo: 'Resumo', conteudo: 'Conteúdo privado.' }]
  }, { mode: 'v1', classification: 'dados_nexus' });
  assert.equal(criado.id, artifactId);
  assert.equal(criado.classification, 'dados_nexus');
  assert.equal(criado.url, `/v1/conversations/${conversationId}/artifacts/${artifactId}`);
  assert.ok((await servico.abrir(conversationId, artifactId)).buffer.length > 500);
  assert.equal((await servico.excluir(conversationId, artifactId)).deleted, true);
  assert.equal(binario, null);
});

test('falha ao salvar derivado remove o arquivo original sem deixar orfao', async () => {
  const principalId = '11111111-1111-4111-8111-111111111111';
  const conversationId = '22222222-2222-4222-8222-222222222222';
  const removidos = [];
  let gravacoes = 0;
  const storage = {
    async salvar() {
      gravacoes += 1;
      if (gravacoes === 2) throw new Error('volume indisponível');
      return { chave: '44444444-4444-4444-8444-444444444444.xlsx' };
    },
    async excluir(chave) { removidos.push(chave); return true; }
  };
  const pool = { async query(sql, valores) {
    if (/SELECT id FROM nexus\.conversations/.test(sql)) {
      return { rows: valores[0] === conversationId && valores[1] === principalId ? [{ id: conversationId }] : [] };
    }
    throw new Error('não deveria persistir no banco');
  } };
  const servico = criarServicoAnexos({ pool, storage, principalId });
  await assert.rejects(async () => servico.salvar(conversationId, { buffer: await xlsxFixture(), fileName: 'dados.xlsx',
    mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), /volume indisponível/);
  assert.deepEqual(removidos, ['44444444-4444-4444-8444-444444444444.xlsx']);
});
