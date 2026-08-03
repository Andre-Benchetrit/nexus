const test = require('node:test');
const assert = require('node:assert/strict');

const {
  definicaoSolicitarAprofundamento,
  executarSolicitarAprofundamento,
  validarSolicitacaoAprofundamento
} = require('../tools/solicitar_aprofundamento');

test('expoe contrato compacto e estrito de aprofundamento', () => {
  assert.equal(definicaoSolicitarAprofundamento.name, 'solicitar_aprofundamento');
  assert.equal(definicaoSolicitarAprofundamento.strict, true);
  assert.deepEqual(definicaoSolicitarAprofundamento.parameters.required, [
    'camada', 'finalidade', 'justificativa'
  ]);
});

test('Bronze aceita somente finalidade de auditoria', () => {
  assert.throws(() => validarSolicitacaoAprofundamento({
    camada: 'bronze', finalidade: 'consultar',
    justificativa: 'Preciso conferir os dados de origem.'
  }), /Bronze so pode/);
  assert.equal(validarSolicitacaoAprofundamento({
    camada: 'bronze', finalidade: 'auditar',
    justificativa: 'Preciso conferir os dados de origem.'
  }).camada, 'bronze');
});

test('delega a liberacao ao orquestrador', async () => {
  const resultado = JSON.parse(await executarSolicitarAprofundamento({
    camada: 'silver', finalidade: 'descrever',
    justificativa: 'Preciso conhecer as colunas disponiveis.'
  }, {
    liberar: async (solicitacao) => ({ liberado: true, camada: solicitacao.camada })
  }));
  assert.deepEqual(resultado, { liberado: true, camada: 'silver' });
});
