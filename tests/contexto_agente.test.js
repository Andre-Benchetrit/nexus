const test = require('node:test');
const assert = require('node:assert/strict');

const { medirContexto } = require('../agentes/metricas_contexto');

test('mede contexto como telemetria sem impor orçamento agressivo', () => {
  const perfis = [
    'indicadores', 'estoque', 'estoque_reposicoes', 'reposicoes',
    'bloqueios_estoque', 'desempenho', 'frete', 'operacao', 'vendas',
    'catalogo', 'pessoas', 'negocio', 'hibrido', 'gold', 'silver', 'bronze'
  ];
  for (const perfil of perfis) {
    const medicao = medirContexto(perfil);
    assert.ok(Number.isInteger(medicao.tokensEstimados));
    assert.ok(medicao.tokensEstimados > 0);
    assert.ok(medicao.tokensEstimados < 20_000, `${perfil} cresceu de forma patologica`);
  }
});
