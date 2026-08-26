const test = require('node:test');
const assert = require('node:assert/strict');

const { lerManifesto } = require('../nexus/pricing');
const { construirFiltros } = require('../nexus/relatorios_uso');

test('manifesto versionado cobre composicao oficial e cambio de agosto configurado', () => {
  const manifesto = lerManifesto();
  assert.equal(manifesto.version, '2026-08-24-teste-ptax');
  assert.equal(manifesto.pricingRates.length, 20);
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
  assert.ok(manifesto.pricingRates.some((item) => (
    item.provider === 'tavily' && item.service === 'tavily_search' &&
    item.model === 'basic' && item.metric === 'credits' && item.priceUsd === 0.008
  )));
  assert.deepEqual(manifesto.exchangeRates, [{
    from: 'USD', to: 'BRL', competence: '2026-08-01', rate: 5.1625,
    source: 'BCB PTAX venda 2026-08-21 - referencia de teste'
  }]);
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
