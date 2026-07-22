function aceitaNulo(schema) {
  return schema?.type === 'null'
    || (Array.isArray(schema?.type) && schema.type.includes('null'))
    || schema?.enum?.includes(null)
    || schema?.anyOf?.some(aceitaNulo);
}

function flexibilizarCamposNulos(schema) {
  const copia = structuredClone(schema);
  copia.required = (schema.required || []).filter((campo) => (
    !aceitaNulo(schema.properties?.[campo])
  ));
  return copia;
}

module.exports = { aceitaNulo, flexibilizarCamposNulos };
