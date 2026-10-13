const { GlobalFonts } = require('@napi-rs/canvas');

const FAMILIA_FONTE_CANVAS = 'Nexus Sans';
let registrada = false;

function registrarFontesCanvas() {
  if (registrada) return FAMILIA_FONTE_CANVAS;
  const fontes = [
    'LiberationSans-Regular.ttf',
    'LiberationSans-Bold.ttf',
    'LiberationSans-Italic.ttf',
    'LiberationSans-BoldItalic.ttf'
  ];
  const resultados = fontes.map((arquivo) => GlobalFonts.registerFromPath(
    require.resolve(`pdfjs-dist/standard_fonts/${arquivo}`), FAMILIA_FONTE_CANVAS
  ));
  if (resultados.some((resultado) => !resultado)) {
    const erro = new Error('Não foi possível registrar a fonte incorporada usada nos gráficos.');
    erro.code = 'CANVAS_FONT_UNAVAILABLE';
    throw erro;
  }
  registrada = true;
  return FAMILIA_FONTE_CANVAS;
}

module.exports = { FAMILIA_FONTE_CANVAS, registrarFontesCanvas };
