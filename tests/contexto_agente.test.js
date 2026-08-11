const test = require('node:test');
const assert = require('node:assert/strict');

const { medirContexto } = require('../agentes/metricas_contexto');

test('mantem perfis comuns abaixo do orcamento fixo de contexto', () => {
  assert.ok(medirContexto('indicadores').tokensEstimados <= 900);
  assert.ok(medirContexto('estoque').tokensEstimados <= 1100);
  assert.ok(medirContexto('estoque_reposicoes').tokensEstimados <= 1500);
  assert.ok(medirContexto('reposicoes').tokensEstimados <= 1300);
  assert.ok(medirContexto('bloqueios_estoque').tokensEstimados <= 1400);
  assert.ok(medirContexto('desempenho').tokensEstimados <= 1050);
  assert.ok(medirContexto('frete').tokensEstimados <= 900);
  assert.ok(medirContexto('operacao').tokensEstimados <= 850);
  assert.ok(medirContexto('vendas').tokensEstimados <= 1050);
  assert.ok(medirContexto('catalogo').tokensEstimados <= 800);
  assert.ok(medirContexto('pessoas').tokensEstimados <= 700);
  assert.ok(medirContexto('negocio').tokensEstimados <= 1300);
  assert.ok(medirContexto('hibrido').tokensEstimados <= 4700);
});

test('perfis genericos continuam menores que o contrato antigo', () => {
  assert.ok(medirContexto('gold').tokensEstimados <= 1600);
  assert.ok(medirContexto('silver').tokensEstimados <= 1700);
  assert.ok(medirContexto('bronze').tokensEstimados <= 1700);
});
