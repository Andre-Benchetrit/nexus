const { exportarOneDrive } = require('./onedrive/exportar');
const { exportarPostgres } = require('./postgres/exportar');

const ADAPTADORES_FONTE = Object.freeze({
  onedrive: exportarOneDrive,
  postgres: exportarPostgres
});

function obterAdaptadorFonte(fonte) {
  const adaptador = ADAPTADORES_FONTE[fonte];
  if (!adaptador) throw new Error(`Fonte sem adaptador de extracao: ${fonte}.`);
  return adaptador;
}

module.exports = {
  ADAPTADORES_FONTE,
  obterAdaptadorFonte
};
