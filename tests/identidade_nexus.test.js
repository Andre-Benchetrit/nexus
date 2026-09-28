const test = require('node:test');
const assert = require('node:assert/strict');

const { INSTRUCOES_GENERALISTA } = require('../agentes/assistente_nexus');
const { obterInstrucoes } = require('../agentes/instrucoes');

test('identidade do criador integra o consultor e o assistente generalista', () => {
  for (const instrucoes of [obterInstrucoes('negocio'), INSTRUCOES_GENERALISTA]) {
    assert.match(instrucoes, /Andr[eé] Benchetrit Silva Rocha/);
    assert.match(instrucoes, /linkedin\.com\/in\/andre-benchetrit-rocha/);
    assert.match(instrucoes, /github\.com\/Andre-Benchetrit/);
  }
});
