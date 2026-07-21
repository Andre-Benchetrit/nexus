const test = require('node:test');
const assert = require('node:assert/strict');

const { medirContexto } = require('../agentes/metricas_contexto');

test('mantem perfis comuns abaixo do orcamento fixo de contexto', () => {
  assert.ok(medirContexto('vendas').tokensEstimados <= 800);
  assert.ok(medirContexto('catalogo').tokensEstimados <= 600);
  assert.ok(medirContexto('negocio').tokensEstimados <= 1000);
});

test('perfis genericos continuam menores que o contrato antigo', () => {
  assert.ok(medirContexto('silver').tokensEstimados <= 1600);
  assert.ok(medirContexto('bronze').tokensEstimados <= 1700);
});
