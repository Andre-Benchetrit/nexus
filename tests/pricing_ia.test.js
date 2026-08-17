const test = require('node:test');
const assert = require('node:assert/strict');

const { lerManifesto } = require('../nexus/pricing');
const { construirFiltros } = require('../nexus/relatorios_uso');

test('manifesto versionado inicial e valido e nao inventa precos', () => {
  const manifesto = lerManifesto();
  assert.equal(manifesto.version, '2026-08-inicial');
  assert.deepEqual(manifesto.pricingRates, []);
  assert.deepEqual(manifesto.exchangeRates, []);
});

test('relatorio aceita somente filtros declarados e parametrizados', () => {
  const filtro = construirFiltros({
    de: '2026-08-01', ate: '2026-09-01', provider: 'anthropic',
    modelo: 'claude-x', desconhecido: "x' OR true"
  });
  assert.match(filtro.sql, /lc\.provider = \$3/);
  assert.match(filtro.sql, /lc\.modelo = \$4/);
  assert.doesNotMatch(filtro.sql, /OR true/);
  assert.deepEqual(filtro.valores, ['2026-08-01', '2026-09-01', 'anthropic', 'claude-x']);
});
