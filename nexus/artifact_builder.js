const fs = require('node:fs/promises');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const mammoth = require('mammoth');
const { createCanvas } = require('@napi-rs/canvas');
const {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun,
  Packer, PageNumber, Paragraph, Table, TableCell, TableRow, TextRun, WidthType
} = require('docx');
const { extrairPdf, renderizarPaginaPdf } = require('./document_parser');

class ErroArtefato extends Error {
  constructor(codigo, mensagem, status = 400) {
    super(mensagem); this.name = 'ErroArtefato'; this.codigo = codigo; this.status = status;
  }
}

const CORES_PADRAO = Object.freeze({
  primaria: '#0b6b45', secundaria: '#153c2c', destaque: '#19e68c', texto: '#17211c',
  superficie: '#f3f8f5', linha: '#d8e5dd', textoSuave: '#66756d'
});

function texto(valor, maximo = 20000) {
  const resultado = String(valor ?? '').replace(/\u0000/g, '').trim();
  if (resultado.length > maximo) throw new ErroArtefato('ARTIFACT_SPEC_INVALID', `Um campo excede ${maximo} caracteres.`);
  return resultado;
}

function carregarMarca(opcoes = {}) {
  let configurada = opcoes.brand || null;
  if (!configurada && process.env.NEXUS_ARTIFACT_BRAND_JSON) {
    const jsonMarca = process.env.NEXUS_ARTIFACT_BRAND_JSON;
    try { configurada = JSON.parse(jsonMarca); }
    catch (_) {
      // Uma configuração visual inválida não pode impedir a entrega do arquivo.
      // O caso mais comum é o dotenv cortar o valor no primeiro "#" de uma cor.
      const nomeParcial = jsonMarca.match(/"nome"\s*:\s*"([^"\\]{1,100})/i)?.[1];
      configurada = nomeParcial ? { nome: nomeParcial } : null;
    }
  }
  const cores = Object.fromEntries(Object.entries({ ...CORES_PADRAO, ...(configurada?.cores || {}) })
    .map(([chave, valor]) => [chave, /^#[0-9a-f]{6}$/i.test(String(valor || '')) ? String(valor) : CORES_PADRAO[chave]]));
  return { nome: texto(configurada?.nome || 'Nexus', 100), cores,
    logo: opcoes.logo || process.env.NEXUS_ARTIFACT_BRAND_LOGO || configurada?.logo || null };
}

function protegerFormula(valor) {
  if (typeof valor === 'bigint') {
    const maximoSeguro = BigInt(Number.MAX_SAFE_INTEGER);
    const minimoSeguro = BigInt(Number.MIN_SAFE_INTEGER);
    return valor >= minimoSeguro && valor <= maximoSeguro ? Number(valor) : valor.toString();
  }
  if (typeof valor === 'string' && /^[=+\-@]/.test(valor.trimStart())) return `'${valor}`;
  return valor;
}

function normalizarRotuloXlsx(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
}

function tipoColunaXlsx(rotulo, valores = []) {
  const nome = normalizarRotuloXlsx(rotulo);
  if (/^(?:id|identificador|codigo|cod|sku|ean|gtin)\b|\b(?:id|identificador|codigo|cod|sku|ean|gtin)\s*$/.test(nome)) return 'identificador';
  if (/\b(?:data|emissao|vencimento|competencia|periodo|criado em|atualizado em)\b/.test(nome) ||
      valores.some((valor) => valor instanceof Date)) return 'data';
  if (/%|\b(?:percentual|porcentagem|taxa|margem percentual|margem pct)\b/.test(nome)) return 'percentual';
  if (/\b(?:valor|receita|faturamento|preco|custo|ticket|montante|liquido|bruto|margem bruta)\b/.test(nome)) return 'moeda';
  if (/\b(?:quantidade|qtd|contagem|numero de|ranking|rank|posicao)\b/.test(nome)) return 'inteiro';
  const numericos = valores.filter((valor) => typeof valor === 'number' && Number.isFinite(valor));
  if (numericos.length) return numericos.every(Number.isInteger) ? 'inteiro' : 'decimal';
  return 'texto';
}

function normalizarValorXlsx(valor, rotulo = '') {
  const seguro = protegerFormula(valor);
  if (seguro == null || seguro === '') return seguro;
  return tipoColunaXlsx(rotulo) === 'identificador' ? protegerFormula(String(seguro)) : seguro;
}

function formatoColunaXlsx(rotulo, valores = []) {
  const tipo = tipoColunaXlsx(rotulo, valores);
  if (tipo === 'identificador') return '@';
  if (tipo === 'data') return 'dd/mm/yyyy';
  if (tipo === 'percentual') {
    const numericos = valores.filter((valor) => typeof valor === 'number' && Number.isFinite(valor));
    return numericos.some((valor) => Math.abs(valor) > 1) ? '0.0\\%' : '0.0%';
  }
  if (tipo === 'moeda') return '"R$" #,##0.00;[Red]-"R$" #,##0.00';
  if (tipo === 'inteiro') return '#,##0';
  if (tipo === 'decimal') return '#,##0.00';
  return null;
}

function alinharCelulaXlsx(celula, rotulo, valores = []) {
  const tipo = tipoColunaXlsx(rotulo, valores);
  celula.alignment = { vertical: 'top', wrapText: true,
    horizontal: ['moeda', 'percentual', 'inteiro', 'decimal'].includes(tipo) ? 'right' : 'left' };
  const formato = formatoColunaXlsx(rotulo, valores);
  if (formato) celula.numFmt = formato;
}

function larguraColunaXlsx(rotulo, valores = [], maximo = 60) {
  const comprimentos = valores.slice(0, 250).map((valor) => {
    if (valor instanceof Date) return 10;
    return String(valor ?? '').replace(/\r?\n/g, ' ').length;
  });
  return Math.min(maximo, Math.max(12, String(rotulo || '').length + 3,
    Math.min(48, comprimentos.length ? Math.max(...comprimentos) + 2 : 12)));
}

function argb(cor) { return `FF${String(cor || '#000000').replace('#', '').toUpperCase()}`; }

function estilizarCabecalhoXlsx(linha, marca) {
  linha.height = 28;
  linha.font = { name: 'Aptos', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
  linha.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(marca.cores.primaria) } };
  linha.alignment = { vertical: 'middle', wrapText: true };
  linha.border = { bottom: { style: 'medium', color: { argb: argb(marca.cores.destaque) } } };
}

function estilizarLinhaDadosXlsx(linha, indice, marca) {
  linha.font = { name: 'Aptos', size: 10, color: { argb: argb(marca.cores.texto) } };
  linha.alignment = { vertical: 'top', wrapText: true };
  if (indice % 2 === 0) {
    linha.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(marca.cores.superficie) } };
  }
  linha.border = { bottom: { style: 'hair', color: { argb: argb(marca.cores.linha) } } };
}

function configurarFolhaXlsx(sheet, marca, { congelarAte = 4, colunas = 1 } = {}) {
  sheet.views = [{ state: 'frozen', ySplit: congelarAte, showGridLines: false }];
  sheet.properties.tabColor = { argb: argb(marca.cores.primaria) };
  sheet.pageSetup = { orientation: colunas > 7 ? 'landscape' : 'portrait', fitToPage: true,
    fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.55, bottom: 0.55,
      header: 0.2, footer: 0.2 } };
  sheet.headerFooter.oddFooter = `&L${marca.nome}&R&P de &N`;
}

function adicionarFaixaTituloXlsx(sheet, { titulo, subtitulo, marca, colunas }) {
  const total = Math.max(1, colunas);
  if (total > 1) { sheet.mergeCells(1, 1, 1, total); sheet.mergeCells(2, 1, 2, total); }
  const faixa = [sheet.getRow(1), sheet.getRow(2)];
  faixa.forEach((linha) => {
    linha.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(marca.cores.secundaria) } };
    linha.font = { name: 'Aptos Display', color: { argb: 'FFFFFFFF' } };
    linha.alignment = { vertical: 'middle', horizontal: 'left' };
  });
  sheet.getRow(1).height = 32; sheet.getCell(1, 1).value = titulo;
  sheet.getCell(1, 1).font = { name: 'Aptos Display', size: 17, bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(2).height = 21; sheet.getCell(2, 1).value = subtitulo;
  sheet.getCell(2, 1).font = { name: 'Aptos', size: 9, color: { argb: argb(marca.cores.destaque) } };
}

async function adicionarLogoXlsx(workbook, sheet, marca, { col = 0, row = 0 } = {}) {
  if (!marca.logo) return false;
  try {
    const extensao = String(marca.logo).toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
    const id = workbook.addImage({ buffer: await fs.readFile(marca.logo), extension: extensao });
    sheet.addImage(id, { tl: { col: col + 0.12, row: row + 0.12 }, ext: { width: 92, height: 38 } });
    return true;
  } catch (_) { return false; }
}

function normalizarSpec(spec = {}) {
  const formato = String(spec.formato || '').toLowerCase();
  if (!['xlsx', 'docx', 'pdf'].includes(formato)) throw new ErroArtefato('ARTIFACT_FORMAT_INVALID', 'O formato deve ser XLSX, DOCX ou PDF.');
  const titulo = texto(spec.titulo || 'Documento Nexus', 180);
  const secoes = (Array.isArray(spec.secoes) ? spec.secoes : []).slice(0, 100).map((secao) => ({
    titulo: texto(secao?.titulo, 300), conteudo: texto(secao?.conteudo, 30000),
    itens: (Array.isArray(secao?.itens) ? secao.itens : []).slice(0, 300).map((x) => texto(x, 5000))
  }));
  const tabelas = (Array.isArray(spec.tabelas) ? spec.tabelas : []).slice(0, 30).map((tabela, indice) => {
    const colunas = (Array.isArray(tabela?.colunas) ? tabela.colunas : []).slice(0, 80).map((x) => texto(x, 200));
    const linhas = (Array.isArray(tabela?.linhas) ? tabela.linhas : []).slice(0, 50000)
      .map((linha) => (Array.isArray(linha) ? linha : colunas.map((c) => linha?.[c])).slice(0, colunas.length));
    return { titulo: texto(tabela?.titulo || `Tabela ${indice + 1}`, 200), colunas, linhas };
  });
  const graficos = (Array.isArray(spec.graficos) ? spec.graficos : []).slice(0, 10).map((g) => ({
    titulo: texto(g?.titulo || 'Gráfico', 200), tipo: ['barra', 'linha'].includes(g?.tipo) ? g.tipo : 'barra',
    categorias: (g?.categorias || []).slice(0, 40).map((x) => texto(x, 100)),
    valores: (g?.valores || []).slice(0, 40).map(Number)
  })).filter((g) => g.categorias.length && g.categorias.length === g.valores.length && g.valores.every(Number.isFinite));
  return { formato, titulo, modelo: texto(spec.modelo || 'livre', 50), secoes, tabelas, graficos,
    fontes: (Array.isArray(spec.fontes) ? spec.fontes : []).slice(0, 100).map((x) => texto(x, 1000)),
    identidadeVisual: spec.identidadeVisual !== false };
}

function nomeAbaUnico(titulo, indice, usados) {
  const base = (titulo || `Tabela ${indice + 1}`).replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 31)
    || `Tabela ${indice + 1}`;
  let nome = base;
  let sufixo = 2;
  while (usados.has(nome.toLocaleLowerCase('pt-BR'))) {
    const complemento = ` (${sufixo})`;
    nome = `${base.slice(0, 31 - complemento.length)}${complemento}`;
    sufixo += 1;
  }
  usados.add(nome.toLocaleLowerCase('pt-BR'));
  return nome;
}

function desenharGrafico(grafico, marca) {
  const canvas = createCanvas(1200, 620); const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1200, 620);
  ctx.fillStyle = marca.cores.texto; ctx.font = 'bold 30px Arial'; ctx.fillText(grafico.titulo, 70, 55);
  const max = Math.max(...grafico.valores, 1); const base = 520; const largura = 1000 / grafico.valores.length;
  ctx.strokeStyle = '#d8e2dc'; ctx.beginPath(); ctx.moveTo(70, base); ctx.lineTo(1130, base); ctx.stroke();
  if (grafico.tipo === 'linha') {
    ctx.strokeStyle = marca.cores.primaria; ctx.lineWidth = 5; ctx.beginPath();
    grafico.valores.forEach((valor, i) => { const x = 90 + i * largura; const y = base - (valor / max) * 390; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  } else {
    grafico.valores.forEach((valor, i) => { const altura = (valor / max) * 390;
      ctx.fillStyle = marca.cores.primaria; ctx.fillRect(85 + i * largura, base - altura, Math.max(12, largura * 0.62), altura); });
  }
  ctx.fillStyle = marca.cores.texto; ctx.font = '18px Arial';
  grafico.categorias.forEach((categoria, i) => ctx.fillText(categoria.slice(0, 12), 80 + i * largura, 555));
  return canvas.toBuffer('image/png');
}

async function gerarXlsx(spec, marca) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Nexus'; workbook.company = marca.nome; workbook.title = spec.titulo;
  workbook.subject = `Arquivo corporativo gerado pelo Nexus para ${marca.nome}`;
  workbook.keywords = 'Nexus, arquivo corporativo';
  const resumo = workbook.addWorksheet('Resumo');
  const nomesUsados = new Set(['resumo']);
  resumo.columns = [{ key: 'secao', width: 32 }, { key: 'conteudo', width: 90 }];
  configurarFolhaXlsx(resumo, marca, { congelarAte: 4, colunas: 2 });
  adicionarFaixaTituloXlsx(resumo, { titulo: spec.titulo,
    subtitulo: `Gerado pelo Nexus para ${marca.nome}`, marca, colunas: 2 });
  resumo.addRow([]);
  const cabecalhoResumo = resumo.addRow(['Seção', 'Conteúdo']); estilizarCabecalhoXlsx(cabecalhoResumo, marca);
  let indiceResumo = 0;
  for (const secao of spec.secoes) {
    const linha = resumo.addRow({ secao: protegerFormula(secao.titulo),
      conteudo: protegerFormula([secao.conteudo, ...secao.itens].filter(Boolean).join('\n')) });
    estilizarLinhaDadosXlsx(linha, ++indiceResumo, marca);
  }
  if (spec.fontes.length) {
    const linha = resumo.addRow({ secao: 'Fontes', conteudo: protegerFormula(spec.fontes.join('\n')) });
    estilizarLinhaDadosXlsx(linha, ++indiceResumo, marca);
  }
  await adicionarLogoXlsx(workbook, resumo, marca, { col: 1.36, row: 0.22 });
  resumo.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, resumo.rowCount), column: 2 } };
  resumo.getColumn(1).alignment = { vertical: 'top', wrapText: true };
  resumo.getColumn(2).alignment = { vertical: 'top', wrapText: true };
  spec.tabelas.forEach((tabela, indice) => {
    const nome = nomeAbaUnico(tabela.titulo, indice, nomesUsados);
    const totalColunas = Math.max(1, tabela.colunas.length);
    const sheet = workbook.addWorksheet(nome, { properties: { defaultRowHeight: 20 } });
    configurarFolhaXlsx(sheet, marca, { congelarAte: 4, colunas: totalColunas });
    adicionarFaixaTituloXlsx(sheet, { titulo: tabela.titulo,
      subtitulo: `${spec.titulo} · ${marca.nome}`, marca, colunas: totalColunas });
    sheet.addRow([]);
    const cabecalho = sheet.addRow(tabela.colunas.map(protegerFormula));
    estilizarCabecalhoXlsx(cabecalho, marca);
    tabela.linhas.forEach((valores, linhaIndice) => {
      const linha = sheet.addRow(valores.map((valor, colunaIndice) =>
        normalizarValorXlsx(valor, tabela.colunas[colunaIndice])));
      estilizarLinhaDadosXlsx(linha, linhaIndice + 1, marca);
    });
    sheet.autoFilter = { from: { row: 4, column: 1 },
      to: { row: Math.max(4, sheet.rowCount), column: totalColunas } };
    sheet.columns.forEach((coluna, i) => {
      const valores = tabela.linhas.map((linha) => linha[i]);
      coluna.width = larguraColunaXlsx(tabela.colunas[i], valores);
      const formato = formatoColunaXlsx(tabela.colunas[i], valores);
      if (formato) coluna.numFmt = formato;
    });
  });
  if (spec.graficos.length) {
    const sheet = workbook.addWorksheet(nomeAbaUnico('Gráficos', spec.tabelas.length, nomesUsados));
    configurarFolhaXlsx(sheet, marca, { congelarAte: 2, colunas: 8 });
    adicionarFaixaTituloXlsx(sheet, { titulo: 'Gráficos', subtitulo: `${spec.titulo} · ${marca.nome}`,
      marca, colunas: 8 });
    let linha = 4;
    for (const grafico of spec.graficos) {
      const id = workbook.addImage({ buffer: desenharGrafico(grafico, marca), extension: 'png' });
      sheet.addImage(id, { tl: { col: 0, row: linha - 1 }, ext: { width: 900, height: 465 } }); linha += 25;
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function celulaDocx(valor, cabecalho = false) {
  return new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: texto(valor, 5000), bold: cabecalho })] })],
    shading: cabecalho ? { fill: 'DDEFE5' } : undefined });
}

async function logoRun(marca) {
  if (!marca.logo) return null;
  try { const data = await fs.readFile(marca.logo); return new ImageRun({ data, transformation: { width: 120, height: 48 }, type: 'png' }); }
  catch (_) { return null; }
}

async function gerarDocx(spec, marca) {
  const children = [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: spec.titulo, color: marca.cores.primaria.replace('#', ''), bold: true })] })];
  for (const secao of spec.secoes) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: secao.titulo }));
    if (secao.conteudo) children.push(new Paragraph({ text: secao.conteudo }));
    secao.itens.forEach((item) => children.push(new Paragraph({ text: item, bullet: { level: 0 } })));
  }
  for (const tabela of spec.tabelas) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: tabela.titulo }));
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
      new TableRow({ tableHeader: true, children: tabela.colunas.map((x) => celulaDocx(x, true)) }),
      ...tabela.linhas.slice(0, 5000).map((linha) => new TableRow({ children: tabela.colunas.map((_, i) => celulaDocx(linha[i])) }))
    ] }));
  }
  for (const grafico of spec.graficos) children.push(new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new ImageRun({ data: desenharGrafico(grafico, marca), transformation: { width: 620, height: 320 }, type: 'png' })] }));
  if (spec.fontes.length) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Fontes' }));
    spec.fontes.forEach((fonte) => children.push(new Paragraph({ text: fonte, bullet: { level: 0 } })));
  }
  const logo = await logoRun(marca);
  const doc = new Document({ sections: [{ headers: { default: new Header({ children: [new Paragraph({
    children: [logo, new TextRun({ text: logo ? '' : marca.nome, bold: true, color: marca.cores.primaria.replace('#', '') })].filter(Boolean)
  })] }) }, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
    children: [new TextRun('Página '), new TextRun({ children: [PageNumber.CURRENT] })] })] }) }, children }] });
  return Packer.toBuffer(doc);
}

async function gerarPdf(spec, marca) {
  return new Promise((resolve, reject) => {
    const partes = []; const pdf = new PDFDocument({ size: 'A4', margins: { top: 55, bottom: 55, left: 55, right: 55 }, info: { Title: spec.titulo, Author: 'Nexus' }, bufferPages: true });
    pdf.on('data', (x) => partes.push(x)); pdf.on('error', reject); pdf.on('end', () => resolve(Buffer.concat(partes)));
    pdf.fillColor(marca.cores.primaria).fontSize(23).font('Helvetica-Bold').text(spec.titulo);
    pdf.moveDown(0.4).fillColor('#66756d').fontSize(9).font('Helvetica').text(`Gerado por ${marca.nome}`);
    for (const secao of spec.secoes) {
      pdf.moveDown().fillColor(marca.cores.primaria).fontSize(15).font('Helvetica-Bold').text(secao.titulo, { keepTogether: true });
      if (secao.conteudo) pdf.moveDown(0.25).fillColor(marca.cores.texto).fontSize(10.5).font('Helvetica').text(secao.conteudo, { lineGap: 3 });
      secao.itens.forEach((item) => pdf.text(`• ${item}`, { indent: 10, lineGap: 2 }));
    }
    for (const tabela of spec.tabelas) {
      pdf.moveDown().fillColor(marca.cores.primaria).fontSize(14).font('Helvetica-Bold').text(tabela.titulo);
      const colunas = tabela.colunas.length || 1; const largura = (pdf.page.width - 110) / colunas;
      const linha = (valores, cabecalho) => {
        const altura = 28; if (pdf.y + altura > pdf.page.height - 60) pdf.addPage(); const y = pdf.y;
        valores.forEach((valor, i) => { pdf.rect(55 + i * largura, y, largura, altura).fillAndStroke(cabecalho ? '#DDEFE5' : '#FFFFFF', '#B8C8BF');
          pdf.fillColor(marca.cores.texto).font(cabecalho ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).text(texto(valor, 500), 59 + i * largura, y + 6, { width: largura - 8, height: altura - 8, ellipsis: true }); });
        pdf.y = y + altura;
      };
      linha(tabela.colunas, true); tabela.linhas.slice(0, 3000).forEach((valores) => linha(valores, false));
    }
    for (const grafico of spec.graficos) { if (pdf.y > 400) pdf.addPage(); pdf.image(desenharGrafico(grafico, marca), { fit: [490, 260], align: 'center' }); pdf.moveDown(); }
    if (spec.fontes.length) { pdf.addPage(); pdf.fillColor(marca.cores.primaria).fontSize(15).font('Helvetica-Bold').text('Fontes');
      pdf.fillColor(marca.cores.texto).fontSize(9).font('Helvetica'); spec.fontes.forEach((fonte) => pdf.text(`• ${fonte}`)); }
    const total = pdf.bufferedPageRange().count;
    for (let i = 0; i < total; i += 1) { pdf.switchToPage(i); pdf.fillColor('#75827b').fontSize(8).text(`${marca.nome} · ${i + 1}/${total}`, 55, pdf.page.height - 36, { align: 'right', width: pdf.page.width - 110 }); }
    pdf.end();
  });
}

async function validarBinario(buffer, formato) {
  const max = Number(process.env.NEXUS_ARTIFACT_MAX_BYTES || 50 * 1024 * 1024);
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > max) throw new ErroArtefato('ARTIFACT_BINARY_INVALID', 'O arquivo gerado está vazio ou excede o limite.');
  if (formato === 'xlsx') { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer); if (!wb.worksheets.length) throw new Error('Planilha sem abas.'); return { abas: wb.worksheets.length }; }
  if (formato === 'docx') { const resultado = await mammoth.extractRawText({ buffer }); return { caracteres: resultado.value.length }; }
  const resultado = await extrairPdf(buffer);
  if (!resultado.paginas.length) throw new Error('PDF sem páginas.');
  const paginasRenderizadas = new Set([1, resultado.paginas.length]);
  for (const pagina of paginasRenderizadas) {
    const imagem = await renderizarPaginaPdf(buffer, pagina, { larguraMaxima: 900 });
    if (!Buffer.isBuffer(imagem) || imagem.length < 100) throw new Error(`Falha ao renderizar a página ${pagina}.`);
  }
  return { paginas: resultado.paginas.length, paginasRenderizadas: paginasRenderizadas.size };
}

async function construirArtefato(specOriginal, opcoes = {}) {
  const spec = normalizarSpec(specOriginal); const marca = carregarMarca(opcoes);
  const buffer = spec.formato === 'xlsx' ? await gerarXlsx(spec, marca) : spec.formato === 'docx' ? await gerarDocx(spec, marca) : await gerarPdf(spec, marca);
  const validacao = await validarBinario(buffer, spec.formato);
  return { spec, buffer, validacao, mediaType: spec.formato === 'xlsx'
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : spec.formato === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf' };
}

module.exports = { ErroArtefato, adicionarFaixaTituloXlsx, adicionarLogoXlsx, alinharCelulaXlsx, argb,
  carregarMarca, configurarFolhaXlsx, construirArtefato, desenharGrafico,
  estilizarCabecalhoXlsx, estilizarLinhaDadosXlsx, formatoColunaXlsx,
  larguraColunaXlsx, normalizarSpec, normalizarValorXlsx, protegerFormula,
  tipoColunaXlsx, validarBinario };
