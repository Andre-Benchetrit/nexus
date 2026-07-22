function aceitaNulo(schema) {
  return schema?.type === 'null'
    || (Array.isArray(schema?.type) && schema.type.includes('null'))
    || schema?.enum?.includes(null)
    || schema?.anyOf?.some(aceitaNulo);
}

function flexibilizarCamposNulos(schema) {
  const copia = structuredClone(schema);

  function visitar(atual) {
    if (!atual || typeof atual !== 'object') return;
    if (atual.required) {
      atual.required = atual.required.filter((campo) => !aceitaNulo(atual.properties?.[campo]));
    }
    Object.values(atual.properties || {}).forEach(visitar);
    if (atual.items) visitar(atual.items);
    for (const combinador of ['anyOf', 'oneOf', 'allOf']) {
      (atual[combinador] || []).forEach(visitar);
    }
  }

  visitar(copia);
  return copia;
}

function flexibilizarTiposPrimitivos(schema) {
  const copia = structuredClone(schema);

  function visitar(atual) {
    if (!atual || typeof atual !== 'object') return;
    const tipos = Array.isArray(atual.type)
      ? [...atual.type]
      : atual.type ? [atual.type] : [];
    if (
      tipos.some((tipo) => ['integer', 'number', 'boolean'].includes(tipo)) &&
      !tipos.includes('string')
    ) {
      atual.type = [...tipos, 'string'];
    }
    Object.values(atual.properties || {}).forEach(visitar);
    if (atual.items) visitar(atual.items);
    for (const combinador of ['anyOf', 'oneOf', 'allOf']) {
      (atual[combinador] || []).forEach(visitar);
    }
  }

  visitar(copia);
  return copia;
}

function normalizarArgumentosPeloSchema(valor, schema) {
  if (valor == null || !schema || typeof schema !== 'object') return valor;
  const tipos = Array.isArray(schema.type) ? schema.type : [schema.type].filter(Boolean);

  if (typeof valor === 'string') {
    if (tipos.includes('integer') && /^-?\d+$/.test(valor)) {
      const numero = Number(valor);
      if (Number.isSafeInteger(numero)) return numero;
    }
    if (tipos.includes('number') && /^-?(?:\d+\.?\d*|\.\d+)$/.test(valor)) {
      const numero = Number(valor);
      if (Number.isFinite(numero)) return numero;
    }
    if (tipos.includes('boolean') && /^(true|false)$/i.test(valor)) {
      return valor.toLowerCase() === 'true';
    }
  }

  if (Array.isArray(valor) && schema.items) {
    return valor.map((item) => normalizarArgumentosPeloSchema(item, schema.items));
  }
  if (typeof valor === 'object' && !Array.isArray(valor)) {
    return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [
      chave,
      normalizarArgumentosPeloSchema(item, schema.properties?.[chave])
    ]));
  }

  for (const alternativa of schema.anyOf || []) {
    const normalizado = normalizarArgumentosPeloSchema(valor, alternativa);
    if (normalizado !== valor) return normalizado;
  }
  return valor;
}

module.exports = {
  aceitaNulo,
  flexibilizarCamposNulos,
  flexibilizarTiposPrimitivos,
  normalizarArgumentosPeloSchema
};
