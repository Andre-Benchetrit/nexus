const crypto = require('node:crypto');
const path = require('node:path');

function jsonCanonico(valor) {
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`;
  if (valor && typeof valor === 'object') {
    return `{${Object.keys(valor).sort().map((chave) => (
      `${JSON.stringify(chave)}:${jsonCanonico(valor[chave])}`
    )).join(',')}}`;
  }
  return JSON.stringify(valor);
}

function hashSchema(schema) {
  if (schema == null) return null;
  return crypto.createHash('sha256').update(jsonCanonico(schema)).digest('hex');
}

// Metadados de dialeto fazem parte do hash remoto, mas nao do contrato de
// function calling entregue aos providers. Referencias externas nao sao
// aceitas: todo binding homologado precisa ter schema autocontido.
function schemaParaModelo(schema) {
  if (Array.isArray(schema)) return schema.map(schemaParaModelo);
  if (!schema || typeof schema !== 'object') return schema;
  return Object.fromEntries(Object.entries(schema)
    .filter(([chave]) => !['$schema', '$id'].includes(chave))
    .map(([chave, valor]) => [chave, schemaParaModelo(valor)]));
}

const LAB_INPUT_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    codigo: {
      type: 'string',
      enum: ['LAB-001', 'LAB-002', 'LAB-003']
    }
  },
  required: ['codigo'],
  additionalProperties: false
});

const LAB_OUTPUT_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    codigo: { type: 'string' },
    nome: { type: 'string' },
    categoria: { type: 'string' },
    ativo: { type: 'boolean' }
  },
  required: ['codigo', 'nome', 'categoria', 'ativo'],
  additionalProperties: false
});

const MCP_MANIFEST = Object.freeze({
  version: '1',
  servers: Object.freeze([
    Object.freeze({
      key: 'laboratorio',
      name: 'Laboratorio MCP Nexus',
      description: 'Servidor deterministico e sem dados corporativos para validar a fundacao MCP.',
      transport: 'streamable_http',
      networkScope: 'public',
      allowedPrivateHosts: ['nexus-mcp-lab.railway.internal'],
      allowedProtocols: ['2026-07-28'],
      allowedServerNames: ['nexus-mcp-lab'],
      allowedServerVersions: ['1.0.0'],
      credentialEnv: 'NEXUS_MCP_LAB_TOKEN',
      devStdio: Object.freeze({
        command: process.execPath,
        args: [path.join(__dirname, '..', 'services', 'nexus-mcp-lab', 'stdio.js')]
      }),
      tools: Object.freeze([
        Object.freeze({
          remoteToolName: 'consultar_item_laboratorio',
          nexusToolName: 'mcp_consultar_item_laboratorio',
          capabilityCode: 'mcp_laboratorio',
          permissionCode: 'mcp.laboratorio.testar',
          description: 'Consulta um item estatico do laboratorio MCP por codigo.',
          inputSchema: LAB_INPUT_SCHEMA,
          outputSchema: LAB_OUTPUT_SCHEMA,
          inputSchemaHash: hashSchema(LAB_INPUT_SCHEMA),
          outputSchemaHash: hashSchema(LAB_OUTPUT_SCHEMA),
          effect: 'read',
          exposure: 'admin_lab',
          timeoutMs: 15_000,
          maxResultBytes: 64 * 1024
        })
      ])
    })
  ])
});

function obterServidorManifesto(chave) {
  return MCP_MANIFEST.servers.find((item) => item.key === chave) || null;
}

module.exports = {
  LAB_INPUT_SCHEMA,
  LAB_OUTPUT_SCHEMA,
  MCP_MANIFEST,
  hashSchema,
  jsonCanonico,
  obterServidorManifesto,
  schemaParaModelo
};
