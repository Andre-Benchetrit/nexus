const test = require('node:test');
const assert = require('node:assert/strict');

const { lerManifesto } = require('../nexus/pricing');
const { construirFiltros } = require('../nexus/relatorios_uso');

test('manifesto versionado cobre composicao oficial sem inventar cambio corporativo', () => {
  const manifesto = lerManifesto();
  assert.equal(manifesto.version, '2026-08-17-oficial');
  assert.equal(manifesto.pricingRates.length, 18);
  assert.ok(manifesto.pricingRates.some((item) => (
    item.provider === 'groq' && item.model === 'openai/gpt-oss-120b' &&
    item.metric === 'output_tokens' && item.priceUsd === 0.6
  )));
  assert.ok(manifesto.pricingRates.some((item) => (
    item.provider === 'anthropic' && item.model === 'claude-sonnet-5' &&
    item.metric === 'input_tokens' && item.effectiveFrom === '2026-09-01' &&
    item.priceUsd === 3
  )));
  assert.ok(manifesto.pricingRates.some((item) => (
    item.provider === 'gemini' && item.model === 'gemini-3.5-flash-lite'
  )));
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
