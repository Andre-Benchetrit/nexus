const path = require('node:path');
const mammoth = require('mammoth');
const sharp = require('sharp');

const TIPOS_SUPORTADOS = Object.freeze(new Map([
  ['.pdf', 'application/pdf'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.dotx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.template']
]));

function limparTexto(texto) {
  return String(texto || '').replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n').trim();
}

function detectarTipo(nomeArquivo, mediaType) {
  const extensao = path.extname(String(nomeArquivo || '')).toLowerCase();
  const esperado = TIPOS_SUPORTADOS.get(extensao);
  if (!esperado) throw new Error(`Formato documental nao suportado: ${extensao || 'sem extensao'}.`);
  if (mediaType && ![esperado, 'application/octet-stream'].includes(String(mediaType).toLowerCase())) {
    throw new Error('O tipo real informado nao corresponde ao arquivo documental.');
  }
  return { extensao, mediaType: esperado };
}

async function extrairPdf(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const carregamento = pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true });
  const documento = await carregamento.promise;
  const paginas = [];
  for (let numero = 1; numero <= documento.numPages; numero += 1) {
    const pagina = await documento.getPage(numero);
    const [conteudo, operadores] = await Promise.all([
      pagina.getTextContent(), pagina.getOperatorList().catch(() => null)
    ]);
    const texto = limparTexto((conteudo.items || []).map((item) => item.str || '').join(' '));
    const possuiImagem = Boolean(operadores?.fnArray?.some((fn) => [
      pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject,
      pdfjs.OPS.paintImageMaskXObject, pdfjs.OPS.paintSolidColorImageMask
    ].includes(fn)));
    paginas.push({ numero, texto, possuiImagem, metadados: {} });
    pagina.cleanup();
  }
  await carregamento.destroy();
  return { paginas, texto: paginas.map((pagina) => pagina.texto).join('\n\n') };
}

async function renderizarPaginaPdf(buffer, numero, opcoes = {}) {
  const [{ createCanvas }, pdfjs] = await Promise.all([
    import('@napi-rs/canvas'), import('pdfjs-dist/legacy/build/pdf.mjs')
  ]);
  const carregamento = pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true });
  const documento = await carregamento.promise;
  try {
    if (!Number.isInteger(Number(numero)) || Number(numero) < 1 || Number(numero) > documento.numPages) {
      throw new Error('Pagina documental invalida.');
    }
    const pagina = await documento.getPage(Number(numero));
    const viewportOriginal = pagina.getViewport({ scale: 1 });
    const larguraMaxima = Math.min(2200, Math.max(600, Number(opcoes.larguraMaxima || 1600)));
    const escala = Math.min(2, larguraMaxima / viewportOriginal.width);
    const viewport = pagina.getViewport({ scale: escala });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await pagina.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    pagina.cleanup();
    return canvas.toBuffer('image/png');
  } finally { await carregamento.destroy(); }
}

async function renderizarVisualDocx(buffer, opcoes = {}) {
  const imagens = [];
  await mammoth.convertToHtml({ buffer }, {
    convertImage: mammoth.images.imgElement(async (imagem) => {
      try {
        const conteudo = Buffer.from(await imagem.read('base64'), 'base64');
        if (conteudo?.length) imagens.push(conteudo);
      } catch (_) {
        // Imagens vetoriais ou corrompidas nao impedem a consulta do texto.
      }
      return { src: 'about:blank' };
    })
  });
  const maximo = Math.min(6, Math.max(1, Number(opcoes.maximoImagens || 4)));
  const renderizadas = [];
  for (const imagem of imagens.slice(0, maximo)) {
    try {
      const resultado = await sharp(imagem).rotate().flatten({ background: '#ffffff' })
        .resize({ width: 1400, height: 900, fit: 'inside', withoutEnlargement: true })
        .png().toBuffer({ resolveWithObject: true });
      renderizadas.push(resultado);
    } catch (_) {
      // Alguns formatos incorporados do Office nao sao rasterizaveis pelo Sharp.
    }
  }
  if (!renderizadas.length) throw new Error('O documento Word nao possui imagem rasterizavel.');
  const margem = 24;
  const largura = Math.max(...renderizadas.map((item) => item.info.width)) + margem * 2;
  const altura = renderizadas.reduce((total, item) => total + item.info.height,
    margem * (renderizadas.length + 1));
  let topo = margem;
  const composite = renderizadas.map((item) => {
    const entrada = { input: item.data, left: Math.floor((largura - item.info.width) / 2), top: topo };
    topo += item.info.height + margem;
    return entrada;
  });
  return sharp({ create: { width: largura, height: altura, channels: 3, background: '#ffffff' } })
    .composite(composite).png().toBuffer();
}

async function extrairDocx(buffer) {
  let imagens = 0;
  const [resultado, html] = await Promise.all([
    mammoth.extractRawText({ buffer }),
    mammoth.convertToHtml({ buffer }, {
      convertImage: mammoth.images.imgElement(async () => {
        imagens += 1;
        return { src: 'about:blank' };
      })
    }).catch(() => ({ messages: [] }))
  ]);
  const texto = limparTexto(resultado.value);
  return {
    paginas: [{ numero: 1, texto, possuiImagem: imagens > 0,
      metadados: { paginacao: 'nao_preservada', imagens_detectadas: imagens,
        avisos_extracao: resultado.messages.length + (html.messages?.length || 0) } }],
    texto
  };
}

async function extrairDocumento({ buffer, nomeArquivo, mediaType }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Documento vazio.');
  const tipo = detectarTipo(nomeArquivo, mediaType);
  const maximo = Number(process.env.NEXUS_KNOWLEDGE_MAX_BYTES || 50 * 1024 * 1024);
  if (buffer.length > maximo) throw new Error('Documento excede o limite de tamanho configurado.');
  const extraido = tipo.extensao === '.pdf' ? await extrairPdf(buffer) : await extrairDocx(buffer);
  if (!extraido.texto && !extraido.paginas.some((pagina) => pagina.possuiImagem)) {
    throw new Error('Documento sem texto ou conteudo visual extraivel.');
  }
  return { ...tipo, ...extraido };
}

function dividirEmChunks(paginas, opcoes = {}) {
  const tamanho = Number(opcoes.tamanho || process.env.NEXUS_KNOWLEDGE_CHUNK_CHARS || 1800);
  const sobreposicao = Number(opcoes.sobreposicao || 250);
  if (!Number.isInteger(tamanho) || tamanho < 400 || tamanho > 6000) throw new Error('Tamanho de chunk invalido.');
  if (!Number.isInteger(sobreposicao) || sobreposicao < 0 || sobreposicao >= tamanho) {
    throw new Error('Sobreposicao de chunk invalida.');
  }
  const chunks = [];
  for (const pagina of paginas) {
    const texto = limparTexto(pagina.texto);
    if (!texto) continue;
    let inicio = 0;
    while (inicio < texto.length) {
      let fim = Math.min(texto.length, inicio + tamanho);
      if (fim < texto.length) {
        const quebra = Math.max(texto.lastIndexOf('\n', fim), texto.lastIndexOf('. ', fim));
        if (quebra > inicio + Math.floor(tamanho * 0.55)) fim = quebra + 1;
      }
      chunks.push({ pagina: pagina.numero, conteudo: texto.slice(inicio, fim).trim() });
      if (fim >= texto.length) break;
      inicio = Math.max(inicio + 1, fim - sobreposicao);
    }
  }
  return chunks.filter((item) => item.conteudo);
}

module.exports = { TIPOS_SUPORTADOS, detectarTipo, dividirEmChunks, extrairDocumento,
  limparTexto, renderizarPaginaPdf, renderizarVisualDocx };
