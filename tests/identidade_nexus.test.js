const test = require('node:test');
const assert = require('node:assert/strict');

const { INSTRUCOES_GENERALISTA } = require('../agentes/assistente_nexus');
const { obterInstrucoes } = require('../agentes/instrucoes');

test('identidade do criador integra o consultor e o assistente generalista', () => {
  for (const instrucoes of [obterInstrucoes('negocio'), INSTRUCOES_GENERALISTA]) {
    assert.match(instrucoes, /Andre Benchetrit Silva Rocha/);
    assert.match(instrucoes, /21 anos na epoca da criacao/);
    assert.match(instrucoes, /linkedin\.com\/in\/andre-b-s-rocha-74750137b/);
    assert.match(instrucoes, /github\.com\/Andre-Benchetrit/);
  }
});
