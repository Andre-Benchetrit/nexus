const crypto = require('node:crypto');
const sharp = require('sharp');

class ErroProjetoImagem extends Error {
  constructor(codigo, mensagem, status = 400) {
    super(mensagem); this.name = 'ErroProjetoImagem'; this.codigo = codigo; this.status = status;
  }
}

const PRESETS = Object.freeze({
  square: { width: 1024, height: 1024 },
  portrait: { width: 1024, height: 1280 },
  story: { width: 1024, height: 1792 },
  landscape: { width: 1536, height: 1024 }
});
const ANCHORS = new Set([
  'top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right',
  'bottom-left', 'bottom-center', 'bottom-right'
]);

function texto(valor, maximo = 4000) {
  return String(valor ?? '').replace(/\u0000/g, '').trim().slice(0, maximo);
}
function limitar(numero, minimo, maximo, fallback) {
  const n = Number(numero); return Number.isFinite(n) ? Math.min(maximo, Math.max(minimo, n)) : fallback;
}
function escaparSvg(valor) {
  return texto(valor, 1000).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function normalizarSpecImagem(spec = {}) {
  const action = ['generate', 'edit', 'variation'].includes(spec.action) ? spec.action : 'generate';
  const preset = PRESETS[spec.preset] ? spec.preset : 'square';
  const brandMode = ['none', 'visual_identity', 'full_brand'].includes(spec.brandMode)
    ? spec.brandMode : 'none';
  const logo = spec.logo || {};
  const textBlocks = (Array.isArray(spec.textBlocks) ? spec.textBlocks : []).slice(0, 12)
    .map((item, indice) => ({
      id: texto(item.id || `text-${indice + 1}`, 80), text: texto(item.text, 500),
      anchor: ANCHORS.has(item.anchor) ? item.anchor : 'center',
      widthPercent: limitar(item.widthPercent, 10, 90, 70),
      fontSizePercent: limitar(item.fontSizePercent, 1, 12, 4),
      color: /^#[0-9a-f]{6}$/i.test(String(item.color || '')) ? item.color : '#ffffff',
      align: ['left', 'center', 'right'].includes(item.align) ? item.align : 'center'
    })).filter((item) => item.text);
  return {
    action, title: texto(spec.title || 'Imagem Nexus', 180), prompt: texto(spec.prompt, 12000),
    format: ['png', 'jpeg', 'webp'].includes(spec.format) ? spec.format : 'png',
    preset, quality: ['low', 'medium', 'high'].includes(spec.quality)
      ? spec.quality : String(process.env.NEXUS_IMAGE_GENERATION_DEFAULT_QUALITY || 'medium'),
    brandMode, regenerateBase: action === 'generate' ? true : spec.regenerateBase !== false,
    replaceTextLayers: spec.replaceTextLayers === true,
    sourceArtifactId: texto(spec.sourceArtifactId, 80) || null,
    logo: {
      enabled: brandMode === 'full_brand' && logo.enabled !== false,
      anchor: ANCHORS.has(logo.anchor) ? logo.anchor : 'bottom-right',
      widthPercent: limitar(logo.widthPercent, 4, 30, 12),
      marginPercent: limitar(logo.marginPercent, 1, 12, 4),
      contrastTreatment: ['none', 'light', 'dark'].includes(logo.contrastTreatment)
        ? logo.contrastTreatment : 'none'
    },
    textBlocks,
    shapeBlocks: (Array.isArray(spec.shapeBlocks) ? spec.shapeBlocks : []).slice(0, 12).map((item, indice) => ({
      id: texto(item.id || `shape-${indice + 1}`, 80),
      shape: ['rectangle', 'ellipse'].includes(item.shape) ? item.shape : 'rectangle',
      anchor: ANCHORS.has(item.anchor) ? item.anchor : 'center',
      widthPercent: limitar(item.widthPercent, 2, 100, 20),
      heightPercent: limitar(item.heightPercent, 2, 100, 12),
      color: /^#[0-9a-f]{6}$/i.test(String(item.color || '')) ? item.color : '#19e68c',
      opacity: limitar(item.opacity, 0.05, 1, 1),
      rotation: limitar(item.rotation, -180, 180, 0)
    }))
  };
}

function posicaoAncora(anchor, canvas, item, margin) {
  const [vertical, horizontal] = anchor === 'center' ? ['center', 'center']
    : anchor.split('-').length === 2 ? anchor.split('-')
      : anchor.startsWith('center-') ? ['center', anchor.split('-')[1]]
        : [anchor.split('-')[0], 'center'];
  const x = horizontal === 'left' ? margin : horizontal === 'right'
    ? canvas.width - item.width - margin : (canvas.width - item.width) / 2;
  const y = vertical === 'top' ? margin : vertical === 'bottom'
    ? canvas.height - item.height - margin : (canvas.height - item.height) / 2;
  return { left: Math.max(0, Math.round(x)), top: Math.max(0, Math.round(y)) };
}

function svgTexto(bloco, width, height) {
  const fontSize = Math.max(14, Math.round(height * bloco.fontSizePercent / 100));
  const lineHeight = Math.round(fontSize * 1.18);
  const maxChars = Math.max(8, Math.floor(bloco.widthPercent / 100 * width / (fontSize * .58)));
  const palavras = bloco.text.split(/\s+/); const linhas = []; let atual = '';
  for (const palavra of palavras) {
    const candidata = atual ? `${atual} ${palavra}` : palavra;
    if (candidata.length > maxChars && atual) { linhas.push(atual); atual = palavra; }
    else atual = candidata;
  }
  if (atual) linhas.push(atual);
  const boxWidth = Math.round(width * bloco.widthPercent / 100);
  const boxHeight = Math.max(lineHeight + 16, linhas.length * lineHeight + 24);
  const textAnchor = bloco.align === 'left' ? 'start' : bloco.align === 'right' ? 'end' : 'middle';
  const x = bloco.align === 'left' ? 8 : bloco.align === 'right' ? boxWidth - 8 : boxWidth / 2;
  const tspans = linhas.map((linha, i) => `<tspan x="${x}" y="${18 + fontSize + i * lineHeight}">${escaparSvg(linha)}</tspan>`).join('');
  return { width: boxWidth, height: boxHeight, buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${boxWidth}" height="${boxHeight}"><text font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="${bloco.color}" text-anchor="${textAnchor}" paint-order="stroke" stroke="rgba(0,0,0,.32)" stroke-width="2">${tspans}</text></svg>`) };
}

async function comporProjetoImagem({ baseBuffer, spec: entrada, brandProvider }) {
  const spec = normalizarSpecImagem(entrada); const canvas = PRESETS[spec.preset];
  const max = Number(process.env.NEXUS_IMAGE_GENERATION_MAX_BYTES || 20 * 1024 * 1024);
  if (!Buffer.isBuffer(baseBuffer) || !baseBuffer.length || baseBuffer.length > max) {
    throw new ErroProjetoImagem('IMAGE_BASE_INVALID', 'A imagem-base está vazia ou excede o limite permitido.');
  }
  let pipeline = sharp(baseBuffer, { failOn: 'error', limitInputPixels: 40_000_000 })
    .rotate().resize(canvas.width, canvas.height, { fit: 'cover', position: 'centre' });
  const composites = []; const layers = [];
  const brand = brandProvider?.obter?.() || null;
  for (const [indice, bloco] of spec.shapeBlocks.entries()) {
    const width = Math.round(canvas.width * bloco.widthPercent / 100);
    const height = Math.round(canvas.height * bloco.heightPercent / 100);
    let renderWidth = width; let renderHeight = height;
    const shape = bloco.shape === 'ellipse'
      ? `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${bloco.color}" fill-opacity="${bloco.opacity}"/>`
      : `<rect width="${width}" height="${height}" fill="${bloco.color}" fill-opacity="${bloco.opacity}"/>`;
    let buffer = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${shape}</svg>`);
    if (bloco.rotation) {
      buffer = await sharp(buffer).rotate(bloco.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      const meta = await sharp(buffer).metadata(); renderWidth = meta.width; renderHeight = meta.height;
    }
    const position = posicaoAncora(bloco.anchor, canvas, { width: renderWidth, height: renderHeight }, 0);
    composites.push({ input: buffer, ...position });
    layers.push({ id: bloco.id || `shape-${indice + 1}`, type: 'shape', shape: bloco.shape,
      position: { x: position.left / canvas.width, y: position.top / canvas.height },
      size: { width: renderWidth / canvas.width, height: renderHeight / canvas.height },
      rotation: bloco.rotation, opacity: bloco.opacity, zIndex: 10 + indice, locked: false,
      constraints: { safeAreaPercent: 0 } });
  }
  if (spec.logo.enabled) {
    if (!brandProvider || !brand) throw new ErroProjetoImagem('BRAND_PROFILE_UNAVAILABLE', 'O perfil da marca não está configurado.');
    const logoOriginal = await brandProvider.carregarLogo();
    const width = Math.round(canvas.width * Math.max(spec.logo.widthPercent, brand.logoMinWidthPercent) / 100);
    const logo = await sharp(logoOriginal, { failOn: 'error' }).rotate().resize({ width, withoutEnlargement: true }).png().toBuffer();
    const meta = await sharp(logo).metadata(); const margin = Math.round(canvas.width * spec.logo.marginPercent / 100);
    const position = posicaoAncora(spec.logo.anchor, canvas, { width: meta.width, height: meta.height }, margin);
    composites.push({ input: logo, ...position });
    layers.push({ id: 'brand-logo', type: 'logo', assetId: `brand:${brand.versao}`,
      position: { x: position.left / canvas.width, y: position.top / canvas.height },
      size: { width: meta.width / canvas.width, height: meta.height / canvas.height },
      rotation: 0, opacity: 1, zIndex: 100, locked: true,
      constraints: { minWidthPercent: brand.logoMinWidthPercent,
        clearSpacePercent: Math.max(brand.clearSpacePercent, spec.logo.marginPercent) } });
  }
  for (const [indice, bloco] of spec.textBlocks.entries()) {
    const svg = svgTexto(bloco, canvas.width, canvas.height);
    const margin = Math.round(canvas.width * .04);
    const position = posicaoAncora(bloco.anchor, canvas, svg, margin);
    composites.push({ input: svg.buffer, ...position });
    layers.push({ id: bloco.id || `text-${indice + 1}`, type: 'text', text: bloco.text,
      position: { x: position.left / canvas.width, y: position.top / canvas.height },
      size: { width: svg.width / canvas.width, height: svg.height / canvas.height },
      rotation: 0, opacity: 1, zIndex: 50 + indice, locked: false,
      constraints: { safeAreaPercent: 4 } });
  }
  if (composites.length) pipeline = pipeline.composite(composites);
  const finalizador = spec.format === 'jpeg' ? pipeline.jpeg({ quality: 90, mozjpeg: true })
    : spec.format === 'webp' ? pipeline.webp({ quality: 90, effort: 5 })
      : pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
  const buffer = await finalizador.toBuffer();
  const metadata = await sharp(buffer).metadata();
  if (buffer.length > max || metadata.width !== canvas.width || metadata.height !== canvas.height) {
    throw new ErroProjetoImagem('IMAGE_OUTPUT_INVALID', 'A imagem final não passou na validação técnica.');
  }
  const projeto = {
    canvas, baseImage: { sha256: crypto.createHash('sha256').update(baseBuffer).digest('hex') },
    brandMode: spec.brandMode, layers, brandProfileVersion: brand && spec.brandMode !== 'none' ? brand.versao : null,
    preset: spec.preset,
    composition: { logo: spec.logo, textBlocks: spec.textBlocks, shapeBlocks: spec.shapeBlocks }
  };
  return { buffer, spec, projeto, validacao: { width: metadata.width, height: metadata.height,
    format: metadata.format, brandMode: spec.brandMode, layers: layers.length,
    hasLogo: layers.some((x) => x.type === 'logo'), hasText: layers.some((x) => x.type === 'text'),
    draft: true, brandCompliant: spec.brandMode !== 'full_brand' || layers.some((x) => x.type === 'logo') } };
}

module.exports = { ANCHORS, ErroProjetoImagem, PRESETS, comporProjetoImagem, normalizarSpecImagem };
