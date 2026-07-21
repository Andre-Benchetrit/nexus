const test = require('node:test');
const assert = require('node:assert/strict');

const {
  completarAnoEmDatas,
  obterDataReferencia
} = require('../agentes/contexto_temporal');

test('calcula a data de referencia no fuso do negocio', () => {
  assert.equal(obterDataReferencia(new Date('2026-07-21T01:30:00Z')), '2026-07-20');
});

test('completa somente datas brasileiras que nao possuem ano', () => {
  assert.equal(
    completarAnoEmDatas('Compare 7/7 com 17/07/2025.', '2026-07-20'),
    'Compare 07/07/2026 com 17/07/2025.'
  );
});
