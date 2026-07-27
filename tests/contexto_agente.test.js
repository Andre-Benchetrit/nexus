const test = require('node:test');
const assert = require('node:assert/strict');

const { medirContexto } = require('../agentes/metricas_contexto');

test('mantem perfis comuns abaixo do orcamento fixo de contexto', () => {
  assert.ok(medirContexto('indicadores').tokensEstimados <= 650);
  assert.ok(medirContexto('estoque').tokensEstimados <= 550);
  assert.ok(medirContexto('desempenho').tokensEstimados <= 850);
  assert.ok(medirContexto('frete').tokensEstimados <= 700);
  assert.ok(medirContexto('operacao').tokensEstimados <= 650);
  assert.ok(medirContexto('vendas').tokensEstimados <= 850);
  assert.ok(medirContexto('catalogo').tokensEstimados <= 600);
  assert.ok(medirContexto('negocio').tokensEstimados <= 1100);
});

test('perfis genericos continuam menores que o contrato antigo', () => {
  assert.ok(medirContexto('silver').tokensEstimados <= 1600);
  assert.ok(medirContexto('bronze').tokensEstimados <= 1700);
});
