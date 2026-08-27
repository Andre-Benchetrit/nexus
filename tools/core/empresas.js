const IDS_EMPRESAS_PERMITIDAS = Object.freeze([
  1, 7, 8, 9, 10, 12, 13, 17, 19, 20
]);

function validarIdEmpresa(valor, nome = 'id_empresa') {
  if (valor == null) return null;
  const idEmpresa = typeof valor === 'number'
    ? valor
    : Number(String(valor).trim());
  if (!Number.isInteger(idEmpresa) || !IDS_EMPRESAS_PERMITIDAS.includes(idEmpresa)) {
    throw new Error(
      `${nome} deve ser uma das empresas permitidas: ${IDS_EMPRESAS_PERMITIDAS.join(', ')}.`
    );
  }
  return idEmpresa;
}

module.exports = { IDS_EMPRESAS_PERMITIDAS, validarIdEmpresa };
