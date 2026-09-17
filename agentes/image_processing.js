const { createHash } = require('node:crypto');
const sharp = require('sharp');

const FORMATOS = Object.freeze({ jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' });
const SENSIVEL = /\b(?:cpf|rg|cnh|passaporte|prontu[aá]rio|diagn[oó]stico|atestado|cid\s*[-:]?\s*[a-z]\d|cart[aã]o\s+(?:de\s+)?cr[eé]dito|ag[eê]ncia|conta\s+banc[aá]ria|senha|password|api[_ -]?key)\b|\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/i;
const PEDIDO_LOCAL = /\b(ocr|transcrev|texto|qr|c[oó]digo de barras|ean|metadados?|dimens[oõ]es|resolu[cç][aã]o)\b/i;
const PEDIDO_VISAO = /\b(descrev|compare|dano|avaria|defeito|cena|layout|gr[aá]fico|diagrama|imagem mostra|foto mostra|visualmente|apar[eê]ncia)\b/i;

function resolverModoImagem(valor = process.env.NEXUS_IMAGE_MODE || 'off') {
  const modo = String(valor).toLowerCase();
  if (!['off', 'local', 'v1'].includes(modo)) throw new Error(`NEXUS_IMAGE_MODE invalido: ${modo}.`);
  return modo;
}

function precisaInterpretacaoVisual(pergunta = '', resultadoLocal = {}) {
  if (PEDIDO_VISAO.test(pergunta)) return true;
  if (PEDIDO_LOCAL.test(pergunta)) return false;
  // Com uma imagem anexada, OCR casual não comprova que a intenção do usuário
  // era textual. Fotografias frequentemente produzem caracteres espúrios; por
  // isso, toda solicitação que não nomeia uma operação local segura exige visão.
  return true;
}

function classificarSensibilidade(texto = '') {
  return { sensivel: SENSIVEL.test(String(texto)), codigo: SENSIVEL.test(String(texto)) ? 'DADO_PESSOAL_SENSIVEL' : null };
}

async function sanitizarImagem(buffer, opcoes = {}) {
  const maxBytes = Number(opcoes.maxBytes || process.env.NEXUS_IMAGE_MAX_BYTES || 10 * 1024 * 1024);
  const maxPixels = Number(opcoes.maxPixels || process.env.NEXUS_IMAGE_MAX_PIXELS || 20_000_000);
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > maxBytes) {
    const erro = new Error(`A imagem deve ter no máximo ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    erro.codigo = 'IMAGEM_TAMANHO_INVALIDO'; throw erro;
  }
  let pipeline = sharp(buffer, { limitInputPixels: maxPixels, failOn: 'error', sequentialRead: true });
  const metadata = await pipeline.metadata();
  if (!FORMATOS[metadata.format]) {
    const erro = new Error('Use uma imagem PNG, JPEG ou WebP válida.');
    erro.codigo = 'IMAGEM_FORMATO_INVALIDO'; throw erro;
  }
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > maxPixels) {
    const erro = new Error('A resolução da imagem excede o limite permitido.');
    erro.codigo = 'IMAGEM_PIXELS_EXCEDIDOS'; throw erro;
  }
  pipeline = pipeline.rotate();
  let sanitizada;
  let extensao;
  if (metadata.format === 'jpeg') { sanitizada = await pipeline.jpeg({ quality: 88, mozjpeg: true }).toBuffer(); extensao = 'jpg'; }
  else if (metadata.format === 'webp') { sanitizada = await pipeline.webp({ quality: 88 }).toBuffer(); extensao = 'webp'; }
  else { sanitizada = await pipeline.png({ compressionLevel: 8 }).toBuffer(); extensao = 'png'; }
  const final = await sharp(sanitizada).metadata();
  return {
    buffer: sanitizada, extensao, mime: FORMATOS[metadata.format],
    sha256: createHash('sha256').update(sanitizada).digest('hex'),
    metadados: { formato: metadata.format, largura: final.width, altura: final.height,
      orientacaoCorrigida: Boolean(metadata.orientation), bytes: sanitizada.length }
  };
}

function detectarCodigo(buffer, opcoes = {}) {
  if (opcoes.detectarCodigo) return opcoes.detectarCodigo(buffer);
  try {
    const { BinaryBitmap, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } = require('@zxing/library');
    return sharp(buffer).greyscale().raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => {
      try {
        const source = new RGBLuminanceSource(Uint8ClampedArray.from(data), info.width, info.height);
        const result = new MultiFormatReader().decode(new BinaryBitmap(new HybridBinarizer(source)));
        return [{ valor: result.getText(), formato: String(result.getBarcodeFormat()) }];
      } catch (_) { return []; }
    });
  } catch (_) { return Promise.resolve([]); }
}

let workerPromise;
async function obterWorkerOcr(opcoes = {}) {
  if (opcoes.ocrWorker) return opcoes.ocrWorker;
  if (!workerPromise) {
    const { createWorker } = require('tesseract.js');
    workerPromise = createWorker(opcoes.langs || process.env.NEXUS_OCR_LANGS || 'por+eng');
  }
  return workerPromise;
}

async function processarImagemLocal(buffer, opcoes = {}) {
  const inicio = Date.now();
  const sanitizada = opcoes.sanitizada || await sanitizarImagem(buffer, opcoes);
  opcoes.onEtapa?.('extraindo_texto');
  let texto = '';
  let confiancaOcr = null;
  let ocrFalhou = false;
  try {
    const worker = await obterWorkerOcr(opcoes);
    const resultado = await worker.recognize(sanitizada.buffer);
    texto = String(resultado.data?.text || '').trim().slice(0, 20_000);
    confiancaOcr = Number.isFinite(Number(resultado.data?.confidence)) ? Number(resultado.data.confidence) : null;
  } catch (erro) {
    ocrFalhou = true;
    if (opcoes.exigirOcr) throw erro;
  }
  const codigos = await detectarCodigo(sanitizada.buffer, opcoes);
  const sensibilidade = ocrFalhou
    ? { sensivel: true, codigo: 'OCR_INDISPONIVEL' }
    : classificarSensibilidade([texto, ...codigos.map((item) => item.valor)].join('\n'));
  return {
    ...sanitizada, texto, confiancaOcr, ocrFalhou, codigos, sensibilidade,
    duracaoMs: Date.now() - inicio,
    megapixels: Number(((sanitizada.metadados.largura * sanitizada.metadados.altura) / 1_000_000).toFixed(3))
  };
}

async function criarDerivadoVisao(buffer, opcoes = {}) {
  return sharp(buffer).resize({ width: Number(opcoes.maxWidth || 2048), height: Number(opcoes.maxHeight || 2048),
    fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
}

module.exports = {
  classificarSensibilidade, criarDerivadoVisao, precisaInterpretacaoVisual,
  processarImagemLocal, resolverModoImagem, sanitizarImagem
};
