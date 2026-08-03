const test = require('node:test');
const assert = require('node:assert/strict');

const {
  completarAnoEmDatas,
  extrairContextoTemporal,
  obterDataReferencia
} = require('../agentes/contexto_temporal');
const { formatarDatasResposta } = require('../agentes/resposta');
const { serializar } = require('../tools/core/validacao');
const { converterInstanteParaFuso } = require('../tools/core/tempo');

test('calcula a data de referencia no fuso do negocio', () => {
  assert.equal(obterDataReferencia(new Date('2026-07-21T01:30:00Z')), '2026-07-20');
});

test('resolve hoje e ontem como datas literais do negocio', () => {
  assert.deepEqual(extrairContextoTemporal('pedidos pagos de hoje', '2026-08-03'), {
    tipo: 'data_explicita',
    origem: 'hoje',
    inicio: '2026-08-03',
    fim: '2026-08-03'
  });
  assert.equal(
    extrairContextoTemporal('compare hoje com ontem', '2026-08-03'),
    null
  );
});

test('completa somente datas brasileiras que nao possuem ano', () => {
  assert.equal(
    completarAnoEmDatas('Compare 7/7 com 17/07/2025.', '2026-07-20'),
    'Compare 07/07/2026 com 17/07/2025.'
  );
});

test('converte timestamps tecnicos para Sao Paulo sem alterar datas comerciais', () => {
  assert.equal(
    converterInstanteParaFuso('2026-08-03T12:32:29.487Z'),
    '2026-08-03T09:32:29.487-03:00'
  );
  assert.deepEqual(JSON.parse(serializar({
    atualizado_em: '2026-08-03T12:32:29.487Z',
    inicio: '2026-08-03T12:30:00.000Z',
    data_referencia: new Date('2026-08-03T00:00:00.000Z')
  })), {
    atualizado_em: '2026-08-03T09:32:29.487-03:00',
    inicio: '2026-08-03T09:30:00.000-03:00',
    data_referencia: '2026-08-03T00:00:00.000Z'
  });
});

test('apresenta timestamps tecnicos no horario brasileiro', () => {
  assert.equal(
    formatarDatasResposta('Atualizado em 2026-08-03T12:32:29.487Z.'),
    'Atualizado em 03/08/2026 às 09:32.'
  );
  assert.equal(
    formatarDatasResposta('Atualizado em 2026-08-03T09:32:29.487-03:00.'),
    'Atualizado em 03/08/2026 às 09:32.'
  );
});
