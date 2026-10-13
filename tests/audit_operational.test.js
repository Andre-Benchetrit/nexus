const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { activity, glossary, rotuloCapability, trace } = require('../nexus/auditoria_operacional');

test('glossário usa catálogo versionado e aceita capability desconhecida sem conteúdo inventado', () => {
  const resultado = glossary();
  assert.match(resultado.version, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(resultado.capabilities.some((item) => item.codigo === 'diagnosticar_produto_360'));
  assert.ok(resultado.terms.some((item) => item.codigo === 'fallback'));
  assert.equal(rotuloCapability('consultar_nexus').nome, 'Consultar dados do Sysemp');
  assert.equal(rotuloCapability('agregar_gold').nome, 'Calcular dados analíticos');
  assert.deepEqual(rotuloCapability('capability_futura'), {
    nome: 'Operação técnica (capability_futura)',
    finalidade: 'Operação ainda sem descrição amigável no catálogo desta versão.',
    conhecida: false
  });
});

test('atividade aplica obrigatoriamente o escopo setorial no SQL', async () => {
  const consultas = [];
  const pool = { async query(sql, parametros) {
    consultas.push({ sql, parametros });
    return { rows: [{ id: 'turno-1', trace_id: 'trace-1', criado_em: '2026-10-02T12:00:00Z',
      capabilities: ['analisar_vendas'], department_id: '00000000-0000-0000-0000-000000000010' }] };
  } };
  const resultado = await activity(pool, { limit: 50 }, {
    global: false, departmentIds: ['00000000-0000-0000-0000-000000000010']
  });
  assert.match(consultas[0].sql, /department_id = ANY\(/);
  assert.deepEqual(consultas[0].parametros[2], ['00000000-0000-0000-0000-000000000010']);
  assert.deepEqual(resultado.items[0].capabilityLabels, ['Consultar vendas']);
});

test('trace fora do setor permitido falha fechado', async () => {
  const pool = { async query() { return { rows: [] }; } };
  await assert.rejects(trace(pool, 'trace-alheio', {
    global: false, departmentIds: ['00000000-0000-0000-0000-000000000010']
  }), (erro) => erro.codigo === 'TRACE_NOT_ALLOWED' && erro.status === 403);
});

test('migration remove auditor, concede gestor setorial e separa Lake da auditoria', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'nexus', 'migrations',
    '024_product_intelligence_audit.sql'), 'utf8');
  const hub = fs.readFileSync(path.join(__dirname, '..', 'nexus', 'hub.js'), 'utf8');
  assert.match(migration, /auditoria\.consultar\.setor/);
  assert.match(migration, /r\.slug = 'gestor'/);
  assert.match(migration, /r\.slug = 'auditor'/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS source_mode/);
  assert.match(hub, /'governanca\.administrar'.*hub_lake_status/);
});
