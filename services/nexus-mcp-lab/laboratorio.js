const { McpServer } = require('@modelcontextprotocol/server');
const { z } = require('zod');

const CATALOGO = Object.freeze({
  'LAB-001': Object.freeze({ codigo: 'LAB-001', nome: 'Item demonstrativo verde', categoria: 'laboratorio', ativo: true }),
  'LAB-002': Object.freeze({ codigo: 'LAB-002', nome: 'Item demonstrativo azul', categoria: 'laboratorio', ativo: true }),
  'LAB-003': Object.freeze({ codigo: 'LAB-003', nome: 'Item demonstrativo arquivado', categoria: 'laboratorio', ativo: false })
});

function criarServidorLaboratorio() {
  const servidor = new McpServer({ name: 'nexus-mcp-lab', version: '1.0.0' }, {
    capabilities: { tools: {} }
  });
  servidor.registerTool('consultar_item_laboratorio', {
    title: 'Consultar item do laboratorio',
    description: 'Consulta um item estatico e sem dados corporativos por codigo.',
    inputSchema: z.object({ codigo: z.enum(['LAB-001', 'LAB-002', 'LAB-003']) }).strict(),
    outputSchema: z.object({
      codigo: z.string(), nome: z.string(), categoria: z.string(), ativo: z.boolean()
    }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ codigo }) => {
    const item = CATALOGO[codigo];
    return {
      content: [{ type: 'text', text: JSON.stringify(item) }],
      structuredContent: item
    };
  });
  return servidor;
}

module.exports = { CATALOGO, criarServidorLaboratorio };
