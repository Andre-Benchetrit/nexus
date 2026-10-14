const { GlobalFonts } = require('@napi-rs/canvas');
const { FAMILIA_FONTE_CANVAS, registrarFontesCanvas } = require('./canvas_fonts');

const FONTES_IMAGEM = Object.freeze({
  montserrat: Object.freeze({
    id: 'montserrat', nome: 'Montserrat', rotulo: 'Montserrat (FID)',
    // O pacote Fontsource preserva este nome interno nos binários WOFF2.
    // Não use alias no registro: o Skia aceita o arquivo, mas renderiza tofu
    // quando a família é sobrescrita artificialmente.
    family: 'Montserrat Thin', oficialFID: true,
    package: '@fontsource/montserrat', weights: [400, 500, 600, 700, 800]
  }),
  oswald: Object.freeze({
    id: 'oswald', nome: 'Oswald', rotulo: 'Oswald (impacto)',
    family: 'Oswald', oficialFID: false,
    package: '@fontsource/oswald', weights: [400, 500, 600, 700]
  }),
  playfair: Object.freeze({
    id: 'playfair', nome: 'Playfair Display', rotulo: 'Playfair Display (editorial)',
    family: 'Playfair Display', oficialFID: false,
    package: '@fontsource/playfair-display', weights: [400, 500, 600, 700, 800]
  }),
  'nexus-sans': Object.freeze({
    id: 'nexus-sans', nome: 'Nexus Sans', rotulo: 'Nexus Sans (neutra)',
    family: FAMILIA_FONTE_CANVAS, oficialFID: false, weights: [400, 700]
  })
});

let registradas = false;

function normalizarFonteImagem(valor, fallback = 'montserrat') {
  const id = String(valor || '').trim().toLowerCase();
  return FONTES_IMAGEM[id] ? id : fallback;
}

function registrarFontesImagem() {
  if (registradas) return FONTES_IMAGEM;
  registrarFontesCanvas();
  for (const fonte of Object.values(FONTES_IMAGEM)) {
    if (!fonte.package) continue;
    for (const weight of fonte.weights) {
      for (const subset of ['latin', 'latin-ext']) {
        const arquivo = `${fonte.package}/files/${fonte.id === 'playfair'
          ? 'playfair-display' : fonte.id}-${subset}-${weight}-normal.woff2`;
        const registrada = GlobalFonts.registerFromPath(require.resolve(arquivo));
        if (!registrada) {
          const erro = new Error(`Não foi possível registrar a fonte incorporada ${fonte.nome}.`);
          erro.code = 'IMAGE_FONT_UNAVAILABLE'; throw erro;
        }
      }
    }
  }
  registradas = true;
  return FONTES_IMAGEM;
}

function familiaFonteImagem(valor) {
  registrarFontesImagem();
  return FONTES_IMAGEM[normalizarFonteImagem(valor)].family;
}

function catalogoFontesImagem() {
  return Object.values(FONTES_IMAGEM).map(({ id, nome, rotulo, oficialFID }) => ({
    id, nome, rotulo, oficialFID
  }));
}

module.exports = { FONTES_IMAGEM, catalogoFontesImagem, familiaFonteImagem,
  normalizarFonteImagem, registrarFontesImagem };
