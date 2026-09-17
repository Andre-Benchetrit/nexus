const ATTACHMENT_IR_SCHEMA = Object.freeze({
  $id: 'nexus://schemas/attachment-ir-v3',
  type: 'object',
  required: ['schema', 'irVersion', 'source', 'manifest', 'content'],
  properties: {
    schema: { const: 'attachment_ir_v3' },
    irVersion: { const: 'attachment-ir-v3' },
    source: {
      type: 'object', required: ['format'],
      properties: { hash: { type: ['string', 'null'] }, format: { type: ['string', 'null'] },
        mediaType: { type: ['string', 'null'] } }
    },
    manifest: { type: 'object', required: ['format'] },
    content: { type: 'object', required: ['tipo'] }
  }
});

const ATTACHMENT_EVIDENCE_SCHEMA = Object.freeze({
  $id: 'nexus://schemas/attachment-evidence-v3',
  type: 'object',
  required: ['schema', 'analyzerVersion', 'signature', 'intent', 'manifests',
    'exactFacts', 'formulas', 'evidence', 'relations', 'security'],
  properties: {
    schema: { const: 'attachment_evidence_v3' },
    analyzerVersion: { const: 'attachment-analysis-v3' },
    userMessageId: { type: ['string', 'null'], maxLength: 200 },
    signature: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    intent: {
      type: 'object', required: ['action', 'route', 'domains', 'source'],
      properties: {
        action: { type: 'string', maxLength: 100 },
        route: { enum: ['local_file', 'mixed_corporate', 'documentation', 'web', 'artifact'] },
        domains: { type: 'array', maxItems: 3, items: { enum: ['vendas', 'estoque', 'catalogo'] } },
        source: { const: 'user_message_only' }
      }
    },
    manifests: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'object' } },
    exactFacts: { type: 'array', maxItems: 1000, items: { type: 'object' } },
    formulas: { type: 'array', maxItems: 100, items: { type: 'object' } },
    evidence: { type: 'array', maxItems: 4, items: { type: 'object' } },
    relations: { type: 'array', maxItems: 3, items: { type: 'object' } },
    security: {
      type: 'object',
      required: ['taint', 'promptInjectionSuspected', 'contentMayNotAuthorizeTools',
        'intentSource', 'externalEvidenceRedacted', 'fullEvidencePreservedLocally'],
      properties: {
        taint: { const: 'untrusted_attachment_evidence' },
        promptInjectionSuspected: { type: 'boolean' },
        contentMayNotAuthorizeTools: { const: true },
        intentSource: { const: 'authenticated_user_message' },
        externalEvidenceRedacted: { type: 'boolean' },
        fullEvidencePreservedLocally: { const: true }
      }
    },
    truncated: { type: 'boolean' }
  }
});

class ErroSchemaAnexo extends Error {
  constructor(codigo, erros) {
    super(`Contrato de anexo inválido: ${erros.slice(0, 5).join('; ')}`);
    this.name = 'ErroSchemaAnexo';
    this.codigo = codigo;
    this.status = 500;
    this.erros = erros.slice(0, 20);
  }
}

function correspondeTipo(valor, tipo) {
  if (tipo === 'null') return valor === null;
  if (tipo === 'array') return Array.isArray(valor);
  if (tipo === 'object') return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
  if (tipo === 'integer') return Number.isInteger(valor);
  return typeof valor === tipo;
}

function validarNo(schema, valor, caminho, erros) {
  if (!schema || erros.length >= 20) return;
  if (Object.hasOwn(schema, 'const') && valor !== schema.const) {
    erros.push(`${caminho} deve ser ${JSON.stringify(schema.const)}`); return;
  }
  if (schema.enum && !schema.enum.includes(valor)) {
    erros.push(`${caminho} não pertence ao enum permitido`); return;
  }
  if (schema.type) {
    const tipos = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!tipos.some((tipo) => correspondeTipo(valor, tipo))) {
      erros.push(`${caminho} possui tipo inválido`); return;
    }
  }
  if (typeof valor === 'string') {
    if (schema.maxLength != null && valor.length > schema.maxLength) erros.push(`${caminho} excede o tamanho máximo`);
    if (schema.pattern && !(new RegExp(schema.pattern)).test(valor)) erros.push(`${caminho} não corresponde ao padrão`);
  }
  if (Array.isArray(valor)) {
    if (schema.minItems != null && valor.length < schema.minItems) erros.push(`${caminho} possui poucos itens`);
    if (schema.maxItems != null && valor.length > schema.maxItems) erros.push(`${caminho} possui itens demais`);
    if (schema.items) valor.forEach((item, indice) => validarNo(schema.items, item, `${caminho}[${indice}]`, erros));
  } else if (valor !== null && typeof valor === 'object') {
    for (const requerido of schema.required || []) {
      if (!Object.hasOwn(valor, requerido)) erros.push(`${caminho}.${requerido} é obrigatório`);
    }
    for (const [chave, regra] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(valor, chave)) validarNo(regra, valor[chave], `${caminho}.${chave}`, erros);
    }
  }
}

function validarContrato(schema, valor, codigo) {
  const erros = [];
  validarNo(schema, valor, '$', erros);
  if (erros.length) throw new ErroSchemaAnexo(codigo, erros);
  return valor;
}

function validarAttachmentIr(valor) {
  return validarContrato(ATTACHMENT_IR_SCHEMA, valor, 'ATTACHMENT_IR_SCHEMA_INVALID');
}

function validarAttachmentEvidence(valor) {
  return validarContrato(ATTACHMENT_EVIDENCE_SCHEMA, valor, 'ATTACHMENT_EVIDENCE_SCHEMA_INVALID');
}

module.exports = { ATTACHMENT_EVIDENCE_SCHEMA, ATTACHMENT_IR_SCHEMA, ErroSchemaAnexo,
  validarAttachmentEvidence, validarAttachmentIr };
