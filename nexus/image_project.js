const crypto = require('node:crypto');
const sharp = require('sharp');
const { createCanvas } = require('@napi-rs/canvas');
const { familiaFonteImagem, normalizarFonteImagem,
  registrarFontesImagem } = require('./image_fonts');

registrarFontesImagem();

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
      fontFamily: normalizarFonteImagem(item.fontFamily),
      fontWeight: [400, 500, 600, 700, 800].includes(Number(item.fontWeight))
        ? Number(item.fontWeight) : 700,
      treatment: ['none', 'shadow', 'dark-panel', 'light-panel'].includes(item.treatment)
        ? item.treatment : 'shadow',
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

function quebrarLinhaLonga(ctx, valor, larguraMaxima) {
  const partes = [];
  let atual = '';
  for (const caractere of [...valor]) {
    const candidato = `${atual}${caractere}`;
    if (atual && ctx.measureText(candidato).width > larguraMaxima) {
      partes.push(atual); atual = caractere;
    } else atual = candidato;
  }
  if (atual) partes.push(atual);
  return partes;
}

function quebrarTexto(ctx, valor, larguraMaxima) {
  const linhas = [];
  for (const paragrafo of String(valor || '').split(/\r?\n/)) {
    const palavras = paragrafo.trim().split(/\s+/).filter(Boolean);
    if (!palavras.length) { linhas.push(''); continue; }
    let atual = '';
    for (const palavra of palavras) {
      const fragmentos = ctx.measureText(palavra).width > larguraMaxima
        ? quebrarLinhaLonga(ctx, palavra, larguraMaxima) : [palavra];
      for (const fragmento of fragmentos) {
        const candidato = atual ? `${atual} ${fragmento}` : fragmento;
        if (atual && ctx.measureText(candidato).width > larguraMaxima) {
          linhas.push(atual); atual = fragmento;
        } else atual = candidato;
      }
    }
    if (atual) linhas.push(atual);
  }
  return linhas.length ? linhas : [''];
}

function renderizarTexto(bloco, width, height) {
  const fontSize = Math.max(14, Math.round(height * bloco.fontSizePercent / 100));
  const lineHeight = Math.round(fontSize * 1.18);
  const boxWidth = Math.round(width * bloco.widthPercent / 100);
  const familia = `"${familiaFonteImagem(bloco.fontFamily)}"`;
  const peso = bloco.fontWeight || 700;
  const medicao = createCanvas(1, 1).getContext('2d');
  medicao.font = `${peso} ${fontSize}px ${familia}`;
  const linhas = quebrarTexto(medicao, bloco.text, Math.max(1, boxWidth - 16));
  const boxHeight = Math.max(lineHeight + 16, linhas.length * lineHeight + 24);
  const canvas = createCanvas(boxWidth, boxHeight);
  const ctx = canvas.getContext('2d');
  if (bloco.treatment === 'dark-panel' || bloco.treatment === 'light-panel') {
    ctx.fillStyle = bloco.treatment === 'dark-panel' ? 'rgba(20,24,29,0.72)' : 'rgba(255,255,255,0.78)';
    ctx.beginPath(); ctx.roundRect(0, 0, boxWidth, boxHeight, Math.max(8, Math.round(fontSize * .22))); ctx.fill();
  }
  ctx.font = `${peso} ${fontSize}px ${familia}`;
  ctx.textAlign = bloco.align;
  ctx.textBaseline = 'top';
  if (bloco.treatment === 'shadow') {
    ctx.shadowColor = 'rgba(0,0,0,0.58)';
    ctx.shadowBlur = Math.max(3, Math.round(fontSize * .1));
    ctx.shadowOffsetX = Math.max(1, Math.round(fontSize * .025));
    ctx.shadowOffsetY = Math.max(1, Math.round(fontSize * .04));
  }
  ctx.fillStyle = bloco.color;
  const x = bloco.align === 'left' ? 8 : bloco.align === 'right' ? boxWidth - 8 : boxWidth / 2;
  linhas.forEach((linha, indice) => {
    const y = 12 + indice * lineHeight;
    ctx.fillText(linha, x, y);
  });
  return { width: boxWidth, height: boxHeight, buffer: canvas.toBuffer('image/png') };
}

function posicionarTextos(renderizados, canvas, margin, gap = 12) {
  const grupos = new Map();
  renderizados.forEach((item, indice) => {
    const lista = grupos.get(item.bloco.anchor) || [];
    lista.push({ ...item, indice }); grupos.set(item.bloco.anchor, lista);
  });
  const posicoes = new Array(renderizados.length);
  for (const [anchor, itens] of grupos.entries()) {
    const alturaTotal = itens.reduce((soma, item) => soma + item.render.height, 0) +
      Math.max(0, itens.length - 1) * gap;
    const vertical = anchor === 'center' ? 'center' : anchor.split('-')[0];
    let top = vertical === 'top' ? margin : vertical === 'bottom'
      ? canvas.height - margin - alturaTotal : (canvas.height - alturaTotal) / 2;
    top = Math.max(0, top);
    for (const item of itens) {
      const base = posicaoAncora(anchor, canvas, item.render, margin);
      posicoes[item.indice] = { left: base.left, top: Math.round(top) };
      top += item.render.height + gap;
    }
  }
  return posicoes;
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
  const marginTexto = Math.round(canvas.width * .04);
  const textosRenderizados = spec.textBlocks.map((bloco) => ({ bloco,
    render: renderizarTexto(bloco, canvas.width, canvas.height) }));
  const posicoesTexto = posicionarTextos(textosRenderizados, canvas, marginTexto);
  for (const [indice, item] of textosRenderizados.entries()) {
    const { bloco, render } = item;
    const position = posicoesTexto[indice];
    composites.push({ input: render.buffer, ...position });
    layers.push({ id: bloco.id || `text-${indice + 1}`, type: 'text', text: bloco.text,
      fontFamily: bloco.fontFamily, fontWeight: bloco.fontWeight, treatment: bloco.treatment,
      position: { x: position.left / canvas.width, y: position.top / canvas.height },
      size: { width: render.width / canvas.width, height: render.height / canvas.height },
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
    textRenderer: layers.some((x) => x.type === 'text') ? 'embedded-font' : null,
    fontFamilies: [...new Set(layers.filter((x) => x.type === 'text').map((x) => x.fontFamily))],
    draft: true, brandCompliant: spec.brandMode !== 'full_brand' || layers.some((x) => x.type === 'logo') } };
}

module.exports = { ANCHORS, ErroProjetoImagem, PRESETS, comporProjetoImagem,
  normalizarSpecImagem, posicionarTextos, renderizarTexto };
