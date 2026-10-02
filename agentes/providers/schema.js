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
    } else if (tipos.includes('array') && !tipos.includes('string')) {
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

function removerNulosDoSchema(schema) {
  const copia = structuredClone(schema);

  function visitar(atual) {
    if (!atual || typeof atual !== 'object') return;
    if (Array.isArray(atual.type) && atual.type.includes('null')) {
      const tipos = atual.type.filter((tipo) => tipo !== 'null');
      atual.type = tipos.length === 1 ? tipos[0] : tipos;
    }
    if (Array.isArray(atual.enum) && atual.enum.includes(null)) {
      atual.enum = atual.enum.filter((valor) => valor !== null);
    }
    if (Array.isArray(atual.anyOf)) {
      atual.anyOf = atual.anyOf.filter((alternativa) => !aceitaNulo(alternativa));
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

function flexibilizarEnumsNulos(schema) {
  const copia = structuredClone(schema);

  function visitar(atual) {
    if (!atual || typeof atual !== 'object') return;
    if (Array.isArray(atual.enum) && atual.enum.includes(null)) {
      delete atual.enum;
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
    const texto = valor.trim();
    const textoNormalizado = texto.toLowerCase();
    if (
      aceitaNulo(schema) &&
      ['null', 'all', 'todos', 'todas', 'default', 'padrao', 'completo'].includes(textoNormalizado)
    ) {
      return null;
    }
    if (tipos.includes('array')) {
      let itens;
      if (texto.startsWith('[')) {
        try {
          const recebido = JSON.parse(texto);
          if (Array.isArray(recebido)) itens = recebido;
        } catch (_) {
          // A lista textual simples e tratada abaixo.
        }
      }
      itens ||= texto.split(',').map((item) => item.trim()).filter(Boolean);
      return itens.map((item) => normalizarArgumentosPeloSchema(item, schema.items));
    }
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

// A Responses API exige que todos os campos de uma tool strict sejam enviados.
// Para representar um campo opcional, o schema entregue ao provider o torna
// anulavel. Antes de executar a tool interna, removemos somente esses nulls
// artificiais, preservando null quando ele ja fazia parte do contrato original.
function removerNulosOpcionaisOpenAI(valor, schema) {
  if (valor == null || !schema || typeof schema !== 'object') return valor;

  if (Array.isArray(valor)) {
    return valor.map((item) => removerNulosOpcionaisOpenAI(item, schema.items));
  }

  if (typeof valor === 'object') {
    const obrigatorios = new Set(schema.required || []);
    const resultado = {};
    for (const [chave, item] of Object.entries(valor)) {
      const propriedade = schema.properties?.[chave];
      if (
        item === null && propriedade && !obrigatorios.has(chave) &&
        !aceitaNulo(propriedade)
      ) {
        continue;
      }
      resultado[chave] = removerNulosOpcionaisOpenAI(item, propriedade);
    }
    return resultado;
  }

  return valor;
}

function tornarSchemaAnulavel(schema) {
  if (!schema || typeof schema !== 'object' || aceitaNulo(schema)) return schema;
  if (Array.isArray(schema.anyOf)) {
    schema.anyOf.push({ type: 'null' });
    return schema;
  }
  if (Array.isArray(schema.type)) schema.type = [...schema.type, 'null'];
  else if (schema.type) schema.type = [schema.type, 'null'];
  else schema.anyOf = [{ ...schema }, { type: 'null' }];
  if (Array.isArray(schema.enum) && !schema.enum.includes(null)) schema.enum.push(null);
  return schema;
}

// A Responses API exige que tools strict incluam em required todas as chaves
// declaradas em properties. O envelope do provider torna anulaveis apenas os
// campos opcionais do contrato interno, sem modificar a definicao original.
function normalizarSchemaEstritoOpenAI(schema) {
  const copia = structuredClone(schema);

  function visitar(atual) {
    if (!atual || typeof atual !== 'object') return;
    if (atual.properties && typeof atual.properties === 'object') {
      const obrigatoriosOriginais = new Set(atual.required || []);
      for (const [nome, propriedade] of Object.entries(atual.properties)) {
        visitar(propriedade);
        if (!obrigatoriosOriginais.has(nome)) tornarSchemaAnulavel(propriedade);
      }
      atual.required = Object.keys(atual.properties);
      atual.additionalProperties = false;
    }
    if (atual.items) visitar(atual.items);
    for (const combinador of ['anyOf', 'oneOf', 'allOf']) {
      (atual[combinador] || []).forEach(visitar);
    }
  }

  visitar(copia);
  return copia;
}

function auditarSchemaEstritoOpenAI(schema) {
  const erros = [];
  const palavrasPermitidas = new Set([
    'type', 'description', 'enum', 'properties', 'required', 'additionalProperties',
    'items', 'anyOf', 'minItems', 'maxItems', 'minLength', 'maxLength', 'minimum',
    'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'pattern', 'format'
  ]);

  function visitar(atual, caminho) {
    if (!atual || typeof atual !== 'object' || Array.isArray(atual)) {
      erros.push(`${caminho}: schema ausente ou invalido`);
      return;
    }
    if (Object.keys(atual).length === 0) {
      erros.push(`${caminho}: schema livre nao e aceito em tools strict`);
      return;
    }
    for (const palavra of Object.keys(atual)) {
      if (!palavrasPermitidas.has(palavra)) {
        erros.push(`${caminho}: palavra de schema nao suportada ${palavra}`);
      }
    }
    if (atual.properties && typeof atual.properties === 'object') {
      const propriedades = Object.keys(atual.properties);
      const obrigatorios = Array.isArray(atual.required) ? atual.required : [];
      if (atual.additionalProperties !== false) {
        erros.push(`${caminho}: additionalProperties deve ser false`);
      }
      for (const nome of propriedades) {
        if (!obrigatorios.includes(nome)) {
          erros.push(`${caminho}: required nao inclui ${nome}`);
        }
        visitar(atual.properties[nome], `${caminho}.${nome}`);
      }
      for (const nome of obrigatorios) {
        if (!Object.hasOwn(atual.properties, nome)) {
          erros.push(`${caminho}: required referencia propriedade inexistente ${nome}`);
        }
      }
    }
    const tipos = Array.isArray(atual.type) ? atual.type : [atual.type].filter(Boolean);
    if (tipos.includes('array') && !atual.items) {
      erros.push(`${caminho}: array deve declarar items`);
    }
    if (atual.items) visitar(atual.items, `${caminho}[]`);
    for (const combinador of ['anyOf']) {
      (atual[combinador] || []).forEach((item, indice) => (
        visitar(item, `${caminho}.${combinador}[${indice}]`)
      ));
    }
  }

  visitar(schema, '$');
  if (!schema || schema.type !== 'object') {
    erros.push('$: parameters de uma function tool deve ter type object');
  }
  return erros;
}

module.exports = {
  aceitaNulo,
  flexibilizarCamposNulos,
  flexibilizarEnumsNulos,
  flexibilizarTiposPrimitivos,
  removerNulosDoSchema,
  normalizarSchemaEstritoOpenAI,
  normalizarArgumentosPeloSchema,
  removerNulosOpcionaisOpenAI,
  auditarSchemaEstritoOpenAI
};
