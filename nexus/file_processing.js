const path = require('node:path');
const crypto = require('node:crypto');
const JSZip = require('jszip');
const ExcelJS = require('exceljs');
const LegacyExcel = require('@e965/xlsx');
const duckdb = require('duckdb');
const mammoth = require('mammoth');
const { extrairPdf, limparTexto, renderizarPaginaPdf } = require('./document_parser');
const { embeddingHash } = require('./embeddings');
const { detectarTabelaEmAba } = require('./spreadsheet_table_detection');

const FORMATOS = Object.freeze({
  '.pdf': { formato: 'pdf', mediaType: 'application/pdf' },
  '.docx': { formato: 'docx', mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  '.xlsx': { formato: 'xlsx', mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  '.xls': { formato: 'xls', mediaType: 'application/vnd.ms-excel' }
});

class ErroArquivo extends Error {
  constructor(codigo, mensagem, status = 400) {
    super(mensagem); this.name = 'ErroArquivo'; this.codigo = codigo; this.status = status;
  }
}

function inteiroEnv(nome, padrao) {
  const valor = Number(process.env[nome] || padrao);
  return Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : padrao;
}

function nomeSeguro(nome, formato) {
  const base = path.basename(String(nome || `arquivo.${formato}`)).replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').trim();
  return (base || `arquivo.${formato}`).slice(0, 180);
}

function normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function criarPontuadorHibrido(pergunta) {
  const termos = [...new Set(normalizar(pergunta).split(' ').filter((item) => item.length > 2))];
  const vetorPergunta = embeddingHash(String(pergunta || '').slice(0, 12_000));
  return (conteudo) => {
    const trecho = String(conteudo || '').slice(0, 12_000);
    const normalizado = normalizar(trecho);
    const lexical = termos.reduce((total, termo) => total + (normalizado.includes(termo) ? 1 : 0), 0);
    const vetor = embeddingHash(trecho);
    const vetorial = vetor.reduce((total, valor, indice) => total + valor * vetorPergunta[indice], 0);
    // Correspondencia lexical explicita prevalece; o vetor local desempata e
    // recupera variacoes morfologicas sem substituir a estrutura do documento.
    return { lexical, vetorial, total: lexical * 10 + vetorial };
  };
}

function detectarFormato({ buffer, fileName, mediaType }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new ErroArquivo('ARQUIVO_VAZIO', 'O arquivo está vazio.');
  const ext = path.extname(String(fileName || '')).toLowerCase();
  const tipo = FORMATOS[ext];
  if (!tipo) throw new ErroArquivo('FORMATO_NAO_SUPORTADO', 'Envie PDF, DOCX, XLS ou XLSX.');
  const maximo = inteiroEnv('NEXUS_FILES_MAX_BYTES', 25 * 1024 * 1024);
  if (buffer.length > maximo) throw new ErroArquivo('ARQUIVO_MUITO_GRANDE', `O arquivo excede ${Math.round(maximo / 1048576)} MB.`);
  if (tipo.formato === 'pdf' && buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new ErroArquivo('ASSINATURA_INVALIDA', 'A assinatura real do PDF é inválida.');
  }
  if (tipo.formato === 'xls' && !buffer.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) {
    throw new ErroArquivo('ASSINATURA_INVALIDA', 'O arquivo XLS não possui uma estrutura OLE/BIFF válida.');
  }
  if (['docx', 'xlsx'].includes(tipo.formato) && !(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
    throw new ErroArquivo('ASSINATURA_INVALIDA', 'O arquivo Office não possui uma estrutura ZIP válida.');
  }
  const declarado = String(mediaType || '').toLowerCase();
  if (declarado && ![tipo.mediaType, 'application/octet-stream'].includes(declarado)) {
    throw new ErroArquivo('MIME_INVALIDO', 'O tipo declarado não corresponde à extensão do arquivo.');
  }
  return { ...tipo, extensao: ext, fileName: nomeSeguro(fileName, tipo.formato) };
}

async function validarPacoteOffice(buffer, formato) {
  let zip;
  try { zip = await JSZip.loadAsync(buffer, { createFolders: false, checkCRC32: false }); }
  catch (_) { throw new ErroArquivo('OFFICE_CORROMPIDO', 'O arquivo Office está corrompido ou criptografado.'); }
  const nomes = Object.keys(zip.files);
  const obrigatorio = formato === 'xlsx' ? 'xl/workbook.xml' : 'word/document.xml';
  if (!zip.files[obrigatorio]) throw new ErroArquivo('OFFICE_ESTRUTURA_INVALIDA', 'A estrutura interna não corresponde ao formato informado.');
  const proibido = nomes.find((nome) => /(?:vbaProject\.bin|\/embeddings\/|oleObject|activeX|externalLinks\/|customUI\/)/i.test(nome));
  if (proibido) throw new ErroArquivo('CONTEUDO_ATIVO_BLOQUEADO', 'Macros, objetos incorporados e referências executáveis não são aceitos.');
  let expandido = 0;
  for (const entrada of Object.values(zip.files)) {
    if (entrada.dir) continue;
    const tamanho = Number(entrada?._data?.uncompressedSize || 0);
    expandido += tamanho;
    if (expandido > Math.min(250 * 1024 * 1024, buffer.length * 25)) {
      throw new ErroArquivo('EXPANSAO_EXCESSIVA', 'O pacote Office excede o limite seguro de expansão.');
    }
  }
  for (const nome of nomes.filter((item) => item.endsWith('.rels'))) {
    const xml = await zip.files[nome].async('string');
    const relacionamentos = xml.match(/<Relationship\b[^>]*\/?\s*>/gi) || [];
    const externoPerigoso = relacionamentos.some((relacao) => {
      if (!/TargetMode\s*=\s*["']External["']/i.test(relacao)) return false;
      const tipoRelacao = relacao.match(/Type\s*=\s*["']([^"']+)["']/i)?.[1] || '';
      // Hyperlinks ficam apenas como texto/referência; o Nexus nunca os abre.
      return !/\/hyperlink$/i.test(tipoRelacao);
    });
    if (externoPerigoso) {
      throw new ErroArquivo('REFERENCIA_EXTERNA_BLOQUEADA', 'O documento contém uma referência externa executável bloqueada.');
    }
  }
  return { zip, entryCount: nomes.length, expandedBytes: expandido };
}

function validarPdfAtivo(buffer) {
  const amostra = buffer.toString('latin1');
  if (/\/(?:JavaScript|JS|Launch|EmbeddedFile)\b|\/OpenAction\b|\/AA\s*<</i.test(amostra)) {
    throw new ErroArquivo('PDF_ATIVO_BLOQUEADO', 'PDF com JavaScript, ação automática ou arquivo incorporado não é aceito.');
  }
}

function valorSeguroCelula(valor, avisos, endereco) {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return { tipo: 'data', valor: valor.toISOString() };
  if (Buffer.isBuffer(valor)) return null;
  if (typeof valor === 'object') {
    if (Object.prototype.hasOwnProperty.call(valor, 'formula') || Object.prototype.hasOwnProperty.call(valor, 'sharedFormula')) {
      const formula = String(valor.formula || valor.sharedFormula || '');
      if (valor.result === undefined || valor.result === null || typeof valor.result === 'object') {
        avisos.push({ codigo: 'FORMULA_SEM_CACHE', celula: endereco });
      }
      return { tipo: 'formula', formula, valorCalculado: valor.result ?? null };
    }
    if (Array.isArray(valor.richText)) return valor.richText.map((x) => x.text || '').join('');
    if (valor.text !== undefined) return String(valor.text);
    if (valor.error) return { tipo: 'erro', valor: String(valor.error) };
    return String(valor.result ?? valor.hyperlink ?? '');
  }
  return valor;
}

async function extrairXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer, { ignoreNodes: ['dataValidations'] }); }
  catch (_) { throw new ErroArquivo('XLSX_CORROMPIDO', 'A planilha está corrompida ou protegida por senha.'); }
  const maxAbas = inteiroEnv('NEXUS_XLSX_MAX_SHEETS', 20);
  const maxCelulas = inteiroEnv('NEXUS_XLSX_MAX_CELLS', 250000);
  if (workbook.worksheets.length > maxAbas) throw new ErroArquivo('XLSX_ABAS_LIMITE', `A planilha excede ${maxAbas} abas.`);
  let totalCelulas = 0;
  let bytesExtraidos = 0;
  const maxBytesExtraidos = inteiroEnv('NEXUS_FILE_MAX_EXTRACTED_TEXT_BYTES', 64 * 1024 * 1024);
  const avisos = [];
  const abas = workbook.worksheets.map((sheet) => {
    const linhas = [];
    let minRow = Infinity; let maxRow = 0; let minCol = Infinity; let maxCol = 0;
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const valores = {};
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (cell.value === null || cell.value === undefined || cell.value === '') return;
        totalCelulas += 1;
        if (totalCelulas > maxCelulas) throw new ErroArquivo('XLSX_CELULAS_LIMITE', `A planilha excede ${maxCelulas} células preenchidas.`);
        minRow = Math.min(minRow, rowNumber); maxRow = Math.max(maxRow, rowNumber);
        minCol = Math.min(minCol, colNumber); maxCol = Math.max(maxCol, colNumber);
        const seguro = valorSeguroCelula(cell.value, avisos, cell.address);
        bytesExtraidos += Buffer.byteLength(JSON.stringify(seguro) || '', 'utf8');
        if (bytesExtraidos > maxBytesExtraidos) {
          throw new ErroArquivo('CONTEUDO_EXTRAIDO_EXCESSIVO', 'O conteúdo textual extraído excede o orçamento seguro.');
        }
        valores[colNumber] = seguro;
      });
      if (Object.keys(valores).length) linhas.push({ numero: rowNumber, valores });
    });
    const range = maxRow ? `${sheet.getColumn(minCol).letter}${minRow}:${sheet.getColumn(maxCol).letter}${maxRow}` : null;
    return { nome: sheet.name, range, linhas };
  });
  const nomesDefinidosBrutos = Array.isArray(workbook.definedNames?.model) ? workbook.definedNames.model : [];
  if (nomesDefinidosBrutos.length > 10_000) {
    throw new ErroArquivo('XLSX_NOMES_LIMITE', 'A planilha excede o limite seguro de nomes definidos.');
  }
  const nomesDefinidos = nomesDefinidosBrutos.map((item) => ({
    nome: String(item?.name || '').slice(0, 255),
    referencias: (Array.isArray(item?.ranges) ? item.ranges : []).map((referencia) =>
      String(referencia || '').slice(0, 4000)).slice(0, 1000)
  })).filter((item) => item.nome && item.referencias.length);
  bytesExtraidos += Buffer.byteLength(JSON.stringify(nomesDefinidos), 'utf8');
  if (bytesExtraidos > maxBytesExtraidos) {
    throw new ErroArquivo('CONTEUDO_EXTRAIDO_EXCESSIVO', 'O conteúdo textual extraído excede o orçamento seguro.');
  }
  return { tipo: 'xlsx', abas, nomesDefinidos, sheetCount: abas.length, cellCount: totalCelulas,
    extractedTextBytes: bytesExtraidos, avisos };
}

function validarEstruturaXls(workbook, buffer) {
  const caminhos = Array.isArray(workbook?.cfb?.FullPaths) ? workbook.cfb.FullPaths.map(String) : [];
  if (!caminhos.some((nome) => /\/(?:Workbook|Book)$/i.test(nome))) {
    throw new ErroArquivo('XLS_ESTRUTURA_INVALIDA', 'A estrutura interna não corresponde a uma planilha XLS.');
  }
  const proibido = caminhos.find((nome) =>
    /(?:^|\/)(?:_VBA_PROJECT_CUR|VBA|ObjectPool|Macros?)(?:\/|$)|(?:Ole10Native|Package|_VBA_PROJECT|PROJECTwm?|dir)$/i.test(nome));
  if (workbook.vbaraw || proibido) {
    throw new ErroArquivo('CONTEUDO_ATIVO_BLOQUEADO', 'Macros e objetos incorporados não são aceitos em arquivos XLS.');
  }
  const entradas = Array.isArray(workbook?.cfb?.FileIndex) ? workbook.cfb.FileIndex : [];
  if (entradas.length > 10_000) throw new ErroArquivo('XLS_ENTRADAS_LIMITE', 'O arquivo XLS possui entradas internas demais.');
  const expandido = entradas.reduce((total, entrada) => total + Math.max(0, Number(entrada?.size || 0)), 0);
  if (expandido > Math.min(250 * 1024 * 1024, buffer.length * 25)) {
    throw new ErroArquivo('EXPANSAO_EXCESSIVA', 'O arquivo XLS excede o limite seguro de expansão.');
  }
  return { entryCount: entradas.length, expandedBytes: expandido };
}

function formulaXlsPerigosa(formula) {
  const texto = String(formula || '');
  return /\[[^\]]+\]|(?:https?|ftp|file):\/\/|(?:^|[^A-Z0-9_])(?:CALL|REGISTER|EXEC)\s*\(|[^\s'"()]+\|[^!]+![A-Z]/i.test(texto);
}

function valorSeguroCelulaXls(celula, avisos, endereco) {
  if (!celula || celula.t === 'z') return null;
  if (formulaXlsPerigosa(celula.f)) {
    throw new ErroArquivo('REFERENCIA_EXTERNA_BLOQUEADA', `A célula ${endereco} contém uma referência externa executável.`);
  }
  let valor = celula.v;
  if (celula.t === 'd' && !(valor instanceof Date)) valor = new Date(valor);
  if (valor instanceof Date) valor = { tipo: 'data', valor: valor.toISOString() };
  else if (celula.t === 'e') valor = { tipo: 'erro', valor: String(celula.w ?? celula.v ?? '') };
  if (celula.f) {
    if (celula.v === undefined || celula.v === null || celula.t === 'e') {
      avisos.push({ codigo: 'FORMULA_SEM_CACHE', celula: endereco });
    }
    return { tipo: 'formula', formula: String(celula.f), valorCalculado: valor ?? null };
  }
  return valor ?? null;
}

function extrairXls(buffer) {
  let workbook;
  try {
    workbook = LegacyExcel.read(buffer, {
      type: 'buffer', bookFiles: true, bookVBA: true, cellDates: true,
      cellFormula: true, cellHTML: false, cellNF: false, WTF: true
    });
  } catch (erro) {
    const protegido = /password|senha|encrypt|criptograf/i.test(String(erro?.message || erro?.name));
    throw new ErroArquivo(protegido ? 'XLS_CRIPTOGRAFADO' : 'XLS_CORROMPIDO',
      protegido ? 'Planilha XLS protegida por senha não é aceita.' : 'A planilha XLS está corrompida ou não é BIFF8.');
  }
  const pacote = validarEstruturaXls(workbook, buffer);
  const maxAbas = inteiroEnv('NEXUS_XLSX_MAX_SHEETS', 20);
  const maxCelulas = inteiroEnv('NEXUS_XLSX_MAX_CELLS', 250000);
  const nomesAbas = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
  if (nomesAbas.length > maxAbas) throw new ErroArquivo('XLS_ABAS_LIMITE', `A planilha excede ${maxAbas} abas.`);
  let totalCelulas = 0;
  let bytesExtraidos = 0;
  const maxBytesExtraidos = inteiroEnv('NEXUS_FILE_MAX_EXTRACTED_TEXT_BYTES', 64 * 1024 * 1024);
  const avisos = [];
  const abas = nomesAbas.map((nome) => {
    const sheet = workbook.Sheets?.[nome] || {};
    const linhas = new Map();
    let minRow = Infinity; let maxRow = 0; let minCol = Infinity; let maxCol = 0;
    for (const [endereco, celula] of Object.entries(sheet)) {
      if (endereco.startsWith('!') || !celula || celula.t === 'z') continue;
      let posicao;
      try { posicao = LegacyExcel.utils.decode_cell(endereco); } catch (_) { continue; }
      const seguro = valorSeguroCelulaXls(celula, avisos, endereco);
      if (seguro === null || seguro === '') continue;
      totalCelulas += 1;
      if (totalCelulas > maxCelulas) throw new ErroArquivo('XLS_CELULAS_LIMITE', `A planilha excede ${maxCelulas} células preenchidas.`);
      bytesExtraidos += Buffer.byteLength(JSON.stringify(seguro) || '', 'utf8');
      if (bytesExtraidos > maxBytesExtraidos) {
        throw new ErroArquivo('CONTEUDO_EXTRAIDO_EXCESSIVO', 'O conteúdo textual extraído excede o orçamento seguro.');
      }
      const numeroLinha = posicao.r + 1; const numeroColuna = posicao.c + 1;
      if (!linhas.has(numeroLinha)) linhas.set(numeroLinha, { numero: numeroLinha, valores: {} });
      linhas.get(numeroLinha).valores[numeroColuna] = seguro;
      minRow = Math.min(minRow, numeroLinha); maxRow = Math.max(maxRow, numeroLinha);
      minCol = Math.min(minCol, numeroColuna); maxCol = Math.max(maxCol, numeroColuna);
    }
    const range = maxRow ? `${LegacyExcel.utils.encode_cell({ r: minRow - 1, c: minCol - 1 })}:${LegacyExcel.utils.encode_cell({ r: maxRow - 1, c: maxCol - 1 })}` : null;
    return { nome: String(nome).slice(0, 255), range, linhas: [...linhas.values()].sort((a, b) => a.numero - b.numero) };
  });
  const nomesDefinidosBrutos = Array.isArray(workbook?.Workbook?.Names) ? workbook.Workbook.Names : [];
  if (nomesDefinidosBrutos.length > 10_000) throw new ErroArquivo('XLS_NOMES_LIMITE', 'A planilha excede o limite seguro de nomes definidos.');
  const nomesDefinidos = nomesDefinidosBrutos.map((item) => ({
    nome: String(item?.Name || '').slice(0, 255),
    referencias: item?.Ref ? [String(item.Ref).slice(0, 4000)] : []
  })).filter((item) => item.nome && item.referencias.length);
  if (nomesDefinidos.some((item) => item.referencias.some(formulaXlsPerigosa))) {
    throw new ErroArquivo('REFERENCIA_EXTERNA_BLOQUEADA', 'A planilha contém uma referência externa executável bloqueada.');
  }
  bytesExtraidos += Buffer.byteLength(JSON.stringify(nomesDefinidos), 'utf8');
  if (bytesExtraidos > maxBytesExtraidos) {
    throw new ErroArquivo('CONTEUDO_EXTRAIDO_EXCESSIVO', 'O conteúdo textual extraído excede o orçamento seguro.');
  }
  return { extraido: { tipo: 'xlsx', sourceFormat: 'xls', abas, nomesDefinidos,
    sheetCount: abas.length, cellCount: totalCelulas, extractedTextBytes: bytesExtraidos, avisos }, pacote };
}

function removerTags(html) {
  return limparTexto(String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
}

async function extrairDocxEstruturado(buffer) {
  const imagens = [];
  let html;
  try {
    const convertido = await mammoth.convertToHtml({ buffer }, {
      convertImage: mammoth.images.imgElement(async (imagem) => {
        imagens.push({ indice: imagens.length + 1, contentType: imagem.contentType,
          bytes: Buffer.from(await imagem.read('base64'), 'base64').length, section: null });
        return { src: `imagem-incorporada-${imagens.length}` };
      })
    });
    html = convertido.value;
  } catch (_) { throw new ErroArquivo('DOCX_CORROMPIDO', 'O documento Word está corrompido ou protegido por senha.'); }
  if (Buffer.byteLength(html, 'utf8') > inteiroEnv('NEXUS_FILE_MAX_EXTRACTED_TEXT_BYTES', 64 * 1024 * 1024)) {
    throw new ErroArquivo('CONTEUDO_EXTRAIDO_EXCESSIVO', 'O conteúdo textual extraído excede o orçamento seguro.');
  }
  const maxImagens = inteiroEnv('NEXUS_DOCX_MAX_IMAGES', 50);
  if (imagens.length > maxImagens) throw new ErroArquivo('DOCX_IMAGENS_LIMITE', `O documento excede ${maxImagens} imagens incorporadas.`);
  const secoes = [];
  const regex = /<(h[1-6]|p|li|table)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let atual = { titulo: 'Conteúdo principal', nivel: 1, blocos: [] }; let match;
  while ((match = regex.exec(html))) {
    const tag = match[1].toLowerCase(); const texto = removerTags(match[2]);
    if (tag.startsWith('h')) {
      if (!texto) continue;
      if (atual.blocos.length || atual.titulo !== 'Conteúdo principal') secoes.push(atual);
      atual = { titulo: texto, nivel: Number(tag.slice(1)), blocos: [] };
    }
    for (const marcador of match[2].matchAll(/imagem-incorporada-(\d+)/gi)) {
      const imagem = imagens[Number(marcador[1]) - 1];
      if (imagem) imagem.section = atual.titulo;
    }
    if (!tag.startsWith('h') && texto) {
      atual.blocos.push({ tipo: tag === 'table' ? 'tabela' : tag === 'li' ? 'lista' : 'paragrafo', texto });
    }
  }
  if (atual.blocos.length || !secoes.length) secoes.push(atual);
  const texto = secoes.map((s) => `${s.titulo}\n${s.blocos.map((b) => b.texto).join('\n')}`).join('\n\n');
  return { tipo: 'docx', secoes, texto, imageCount: imagens.length, imagens };
}

async function extrairPdfSeguro(buffer) {
  validarPdfAtivo(buffer);
  let resultado;
  try { resultado = await extrairPdf(buffer); }
  catch (erro) {
    const codigo = /password|senha/i.test(String(erro?.message || erro?.name)) ? 'PDF_CRIPTOGRAFADO' : 'PDF_CORROMPIDO';
    throw new ErroArquivo(codigo, codigo === 'PDF_CRIPTOGRAFADO' ? 'PDF protegido por senha não é aceito.' : 'O PDF está corrompido.');
  }
  const maxPaginas = inteiroEnv('NEXUS_PDF_MAX_PAGES', 200);
  if (resultado.paginas.length > maxPaginas) throw new ErroArquivo('PDF_PAGINAS_LIMITE', `O PDF excede ${maxPaginas} páginas.`);
  const bytesTexto = Buffer.byteLength(JSON.stringify(resultado.paginas || []), 'utf8');
  if (bytesTexto > inteiroEnv('NEXUS_FILE_MAX_EXTRACTED_TEXT_BYTES', 64 * 1024 * 1024)) {
    throw new ErroArquivo('CONTEUDO_EXTRAIDO_EXCESSIVO', 'O conteúdo textual extraído excede o orçamento seguro.');
  }
  return { tipo: 'pdf', ...resultado, pageCount: resultado.paginas.length,
    extractedTextBytes: bytesTexto,
    // O OCR de segurança cobre toda página que possua imagem. A seleção posterior
    // continua enviando à visão apenas as páginas relevantes para a pergunta.
    paginasOcrPendente: resultado.paginas.filter((p) => p.possuiImagem).map((p) => p.numero) };
}

async function processarArquivo({ buffer, fileName, mediaType }) {
  const tipo = detectarFormato({ buffer, fileName, mediaType });
  let extraido; let pacote = null;
  if (tipo.formato === 'pdf') extraido = await extrairPdfSeguro(buffer);
  else if (tipo.formato === 'xls') {
    const legado = extrairXls(buffer); extraido = legado.extraido; pacote = legado.pacote;
  } else {
    pacote = await validarPacoteOffice(buffer, tipo.formato);
    extraido = tipo.formato === 'xlsx' ? await extrairXlsx(buffer) : await extrairDocxEstruturado(buffer);
  }
  return {
    buffer, fileName: tipo.fileName, formato: tipo.formato, mediaType: tipo.mediaType,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'), extraido,
    metadados: {
      formato: tipo.formato, paginas: extraido.pageCount || null, abas: extraido.sheetCount || null,
      celulas: extraido.cellCount || null, imagens: extraido.imageCount || null,
      entradas_pacote: pacote?.entryCount || null,
      formulas_sem_cache: extraido.avisos?.filter((x) => x.codigo === 'FORMULA_SEM_CACHE').length || 0
    }
  };
}

function valorPrimitivo(valor) {
  if (valor && typeof valor === 'object') return valor.valorCalculado ?? valor.valor ?? null;
  return valor;
}

function numeroPlanilha(valor) {
  const primitivo = valorPrimitivo(valor);
  if (typeof primitivo === 'number') return Number.isFinite(primitivo) ? primitivo : null;
  const texto = String(primitivo ?? '').trim();
  if (!texto) return null;
  const limpo = texto.replace(/R\$\s*/gi, '').replace(/\s/g, '');
  const localizado = /^[-+]?\d{1,3}(?:\.\d{3})*(?:,\d+)?$/.test(limpo)
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo.replace(',', '.');
  const numero = Number(localizado);
  return Number.isFinite(numero) ? numero : null;
}

function analisarPlanilhaLocal(extraido, pergunta) {
  const pontuar = criarPontuadorHibrido(pergunta);
  const candidatos = (extraido.abas || []).map((aba, indice) => {
    const tabela = detectarTabelaEmAba(aba);
    if (!tabela) return null;
    const resumo = `${aba.nome || ''}\n${tabela.colunas.map((item) => item.rotulo).join(' ')}\n${tabela.linhas.slice(0, 10)
      .flatMap((linha) => tabela.colunas.map((coluna) => String(valorPrimitivo(linha.valores?.[coluna.indice]) ?? ''))).join(' ')}`;
    return { aba, tabela, indice, pontos: pontuar(resumo) };
  }).filter(Boolean).sort((a, b) => b.pontos.total - a.pontos.total ||
    b.tabela.score - a.tabela.score || a.indice - b.indice);
  const selecionada = candidatos[0];
  if (!selecionada) return { respostaLocal: 'A planilha não possui uma tabela identificável.', referencias: [] };
  const { aba, tabela } = selecionada;
  const colunas = tabela.colunas.map((item) => ({ indice: item.indice, nome: item.rotulo }));
  const dados = tabela.linhas;
  const linhaComoObjeto = (linha) => Object.fromEntries(colunas.map((c) =>
    [c.nome, valorPrimitivo(linha.valores?.[c.indice])]));
  const resumoNumerico = [];
  for (const coluna of colunas) {
    const numeros = dados.map((linha) => ({ linha, numero: numeroPlanilha(linha.valores?.[coluna.indice]) }))
      .filter((item) => item.numero !== null);
    if (!numeros.length) continue;
    const soma = numeros.reduce((total, item) => total + item.numero, 0);
    const minimo = numeros.reduce((a, b) => b.numero < a.numero ? b : a);
    const maximo = numeros.reduce((a, b) => b.numero > a.numero ? b : a);
    resumoNumerico.push({ coluna: coluna.nome, quantidade: numeros.length, soma,
      media: soma / numeros.length, minimo: minimo.numero, maximo: maximo.numero,
      linhaMinimo: { numero: minimo.linha.numero, valores: linhaComoObjeto(minimo.linha) },
      linhaMaximo: { numero: maximo.linha.numero, valores: linhaComoObjeto(maximo.linha) } });
  }
  const ausencias = colunas.map((c) => ({ coluna: c.nome,
    ausentes: dados.filter((l) => valorPrimitivo(l.valores[c.indice]) === null || valorPrimitivo(l.valores[c.indice]) === undefined || valorPrimitivo(l.valores[c.indice]) === '').length }))
    .filter((x) => x.ausentes > 0);
  const chaves = dados.map((l) => JSON.stringify(colunas.map((c) => valorPrimitivo(l.valores[c.indice]))));
  const duplicadas = chaves.length - new Set(chaves).size;
  return {
    aba: aba.nome, intervalo: tabela.intervalo, cabecalhoLinha: tabela.headerRow,
    deteccaoTabela: tabela.metodo, linhasAnalisadas: dados.length,
    colunas: colunas.map((c) => c.nome), resumoNumerico, ausencias, linhasDuplicadas: duplicadas,
    amostra: dados.slice(0, 80).map(linhaComoObjeto),
    avisos: extraido.avisos || [], referencias: [{ tipo: extraido.sourceFormat || 'xlsx', aba: aba.nome,
      intervalo: aba.range || tabela.intervalo }],
    recuperacao: 'hybrid_lexical_structural_local_embedding'
  };
}

async function complementarAnaliseDuckDb(extraido, analise) {
  if (analise.linhasAnalisadas < 5000) return { ...analise, engine: 'local-js' };
  const aba = extraido.abas.find((item) => item.nome === analise.aba);
  if (!aba) return { ...analise, engine: 'local-js' };
  const tabela = detectarTabelaEmAba(aba);
  if (!tabela) return { ...analise, engine: 'local-js' };
  const colunas = tabela.colunas.map((item) => item.indice);
  const chaves = tabela.linhas.map((linha) => JSON.stringify(colunas.map((coluna) =>
    valorPrimitivo(linha.valores[coluna]))));
  const banco = new duckdb.Database(':memory:');
  const conexao = banco.connect();
  const run = (sql, parametros = []) => new Promise((resolve, reject) =>
    conexao.run(sql, ...parametros, (erro) => erro ? reject(erro) : resolve()));
  const all = (sql) => new Promise((resolve, reject) => conexao.all(sql, (erro, linhas) => erro ? reject(erro) : resolve(linhas)));
  try {
    await run('CREATE TABLE linhas(row_key VARCHAR)');
    await run('BEGIN TRANSACTION');
    for (let inicio = 0; inicio < chaves.length; inicio += 500) {
      const lote = chaves.slice(inicio, inicio + 500);
      await run(`INSERT INTO linhas VALUES ${lote.map(() => '(?)').join(',')}`, lote);
    }
    await run('COMMIT');
    const [resultado] = await all('SELECT COUNT(*)::BIGINT AS total, COUNT(DISTINCT row_key)::BIGINT AS distintas FROM linhas');
    return { ...analise, linhasDuplicadas: Number(resultado.total) - Number(resultado.distintas), engine: 'duckdb' };
  } finally { conexao.close(); banco.close(); }
}

function selecionarConteudo(extraido, pergunta, profundidade = 'medio') {
  if (extraido.tipo === 'xlsx') return analisarPlanilhaLocal(extraido, pergunta);
  const pontuar = criarPontuadorHibrido(pergunta);
  if (extraido.tipo === 'pdf') {
    const paginas = extraido.paginas.map((pagina) => ({ ...pagina,
      pontos: pontuar(pagina.texto || pagina.textoOcr || '') }))
      .filter((p) => p.texto || p.textoOcr || p.possuiImagem)
      .sort((a, b) => b.pontos.total - a.pontos.total || a.numero - b.numero)
      .slice(0, profundidade === 'alto' ? 12 : profundidade === 'baixo' ? 3 : 6);
    return { trechos: paginas.map((p) => ({ pagina: p.numero,
      texto: String(p.texto || p.textoOcr || '').slice(0, 5000), possuiImagem: p.possuiImagem })),
      paginasOcrPendente: paginas.filter((p) => String(p.texto || p.textoOcr || '').length < 40 && p.possuiImagem)
        .map((p) => p.numero),
      referencias: paginas.map((p) => ({ tipo: 'pdf', pagina: p.numero })),
      recuperacao: 'hybrid_lexical_structural_local_embedding' };
  }
  const secoes = extraido.secoes.map((secao) => ({ ...secao,
    pontos: pontuar(`${secao.titulo} ${secao.blocos.map((b) => b.texto).join(' ')}`) }))
    .sort((a, b) => b.pontos.total - a.pontos.total)
    .slice(0, profundidade === 'alto' ? 10 : 5);
  return { trechos: secoes.map((s) => ({ secao: s.titulo, texto: s.blocos.map((b) => b.texto).join('\n').slice(0, 7000) })),
    referencias: secoes.map((s) => ({ tipo: 'docx', secao: s.titulo })),
    recuperacao: 'hybrid_lexical_structural_local_embedding' };
}

async function renderizarPaginasSelecionadas(buffer, numeros = []) {
  const saida = [];
  for (const numero of [...new Set(numeros)].slice(0, 8)) {
    saida.push({ numero, buffer: await renderizarPaginaPdf(buffer, numero, { larguraMaxima: 1400 }) });
  }
  return saida;
}

async function extrairImagensDocxBuffers(buffer, maximo = 8) {
  const imagens = [];
  await mammoth.convertToHtml({ buffer }, {
    convertImage: mammoth.images.imgElement(async (imagem) => {
      if (imagens.length < maximo) {
        try { imagens.push({ buffer: Buffer.from(await imagem.read('base64'), 'base64'), mediaType: imagem.contentType }); }
        catch (_) { /* imagem não rasterizável é ignorada com segurança */ }
      }
      return { src: 'about:blank' };
    })
  });
  return imagens;
}

module.exports = { ErroArquivo, FORMATOS, analisarPlanilhaLocal, detectarFormato,
  complementarAnaliseDuckDb, extrairImagensDocxBuffers, nomeSeguro, processarArquivo, renderizarPaginasSelecionadas, selecionarConteudo,
  validarPacoteOffice, validarPdfAtivo };
