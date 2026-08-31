const {
  Document, HeadingLevel, Packer, Paragraph, TextRun
} = require('docx');
const PDFDocument = require('pdfkit');

function textoSeguro(valor, maximo = 20_000) {
  const texto = String(valor || '').trim();
  if (texto.length > maximo) {
    const erro = new Error(`Este campo excede o limite de ${maximo} caracteres.`);
    erro.name = 'ErroValidacaoDocumento';
    erro.codigo = 'CONTEUDO_DOCUMENTO_INVALIDO';
    erro.status = 400;
    throw erro;
  }
  return texto;
}

function normalizarConteudo(conteudo = {}) {
  const passos = Array.isArray(conteudo.passos) ? conteudo.passos.slice(0, 200).map((item, indice) => {
    const tituloOriginal = String(typeof item === 'string' ? item : item?.titulo || '').trim();
    const descricaoOriginal = String(typeof item === 'string' ? '' : item?.descricao || '').trim();
    if (tituloOriginal.length <= 300) return {
      titulo: textoSeguro(tituloOriginal, 300), descricao: textoSeguro(descricaoOriginal, 5000)
    };
    const descricaoComTitulo = [tituloOriginal, descricaoOriginal].filter(Boolean).join('\n\n');
    return { titulo: `Passo ${indice + 1}`, descricao: textoSeguro(descricaoComTitulo, 5000) };
  }).filter((item) => item.titulo || item.descricao) : [];
  const lista = (nome) => Array.isArray(conteudo[nome])
    ? conteudo[nome].slice(0, 100).map((item) => textoSeguro(item, 2000)).filter(Boolean) : [];
  return {
    objetivo: textoSeguro(conteudo.objetivo, 5000),
    publico: textoSeguro(conteudo.publico, 1000),
    preRequisitos: lista('preRequisitos'),
    passos,
    alertas: lista('alertas'),
    referencias: lista('referencias')
  };
}

function paragrafosLista(itens) {
  return itens.map((item) => new Paragraph({ text: item, bullet: { level: 0 } }));
}

async function gerarDocx({ titulo, tipo, versao, conteudo }) {
  const dados = normalizarConteudo(conteudo);
  const filhos = [
    new Paragraph({ children: [new TextRun({ text: titulo, bold: true, size: 38, color: '123D2A' })] }),
    new Paragraph({ children: [new TextRun({ text: `${tipo} - versao ${versao}`, italics: true, color: '54645A' })] })
  ];
  const secao = (nome, corpo = []) => {
    if (!corpo.length) return;
    filhos.push(new Paragraph({ text: nome, heading: HeadingLevel.HEADING_1 }), ...corpo);
  };
  secao('Objetivo', dados.objetivo ? [new Paragraph(dados.objetivo)] : []);
  secao('Publico', dados.publico ? [new Paragraph(dados.publico)] : []);
  secao('Pre-requisitos', paragrafosLista(dados.preRequisitos));
  secao('Procedimento', dados.passos.map((passo, indice) => new Paragraph({
    children: [new TextRun({ text: `${indice + 1}. ${passo.titulo}`, bold: true }),
      ...(passo.descricao ? [new TextRun({ text: `\n${passo.descricao}` })] : [])]
  })));
  secao('Alertas', paragrafosLista(dados.alertas));
  secao('Referencias', paragrafosLista(dados.referencias));
  const documento = new Document({ sections: [{ properties: {}, children: filhos }] });
  return Packer.toBuffer(documento);
}

async function gerarPdf({ titulo, tipo, versao, conteudo }) {
  const dados = normalizarConteudo(conteudo);
  return new Promise((resolve, reject) => {
    const partes = [];
    const pdf = new PDFDocument({ size: 'A4', margins: { top: 55, right: 55, bottom: 55, left: 55 }, info: { Title: titulo } });
    pdf.on('data', (parte) => partes.push(parte));
    pdf.on('error', reject);
    pdf.on('end', () => resolve(Buffer.concat(partes)));
    pdf.fontSize(22).fillColor('#123D2A').text(titulo);
    pdf.moveDown(0.4).fontSize(9).fillColor('#54645A').text(`${tipo} - versao ${versao}`);
    const secao = (nome, escrever) => {
      pdf.moveDown().fontSize(15).fillColor('#123D2A').text(nome);
      pdf.moveDown(0.25).fontSize(10.5).fillColor('#111111');
      escrever();
    };
    if (dados.objetivo) secao('Objetivo', () => pdf.text(dados.objetivo, { lineGap: 3 }));
    if (dados.publico) secao('Publico', () => pdf.text(dados.publico, { lineGap: 3 }));
    if (dados.preRequisitos.length) secao('Pre-requisitos', () => dados.preRequisitos.forEach((item) => pdf.text(`- ${item}`, { lineGap: 2 })));
    if (dados.passos.length) secao('Procedimento', () => dados.passos.forEach((passo, indice) => {
      pdf.font('Helvetica-Bold').text(`${indice + 1}. ${passo.titulo}`);
      if (passo.descricao) pdf.font('Helvetica').text(passo.descricao, { indent: 14, lineGap: 2 });
      pdf.moveDown(0.35);
    }));
    if (dados.alertas.length) secao('Alertas', () => dados.alertas.forEach((item) => pdf.text(`- ${item}`, { lineGap: 2 })));
    if (dados.referencias.length) secao('Referencias', () => dados.referencias.forEach((item) => pdf.text(`- ${item}`, { lineGap: 2 })));
    pdf.end();
  });
}

module.exports = { gerarDocx, gerarPdf, normalizarConteudo };
