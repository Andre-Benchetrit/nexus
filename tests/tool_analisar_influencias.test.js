const test = require('node:test');
const assert = require('node:assert/strict');
const {
  definicaoAnalisarInfluencias,
  executarAnalisarInfluencias,
  resumirVariacao
} = require('../tools/analisar_influencias');

test('resume crescimento absoluto e percentual entre faturamentos', () => {
  assert.deepEqual(
    resumirVariacao(18899467.93, 17873839.42),
    {
      atual: 18899467.93,
      anterior: 17873839.42,
      diferenca: 1025628.51,
      variacao_pct: 5.7382
    }
  );
});

test('compara grupos e destaca quedas e altas de faturamento', async () => {
  let chamadas = 0;
  const leitor = {
    async agregar() {
      chamadas += 1;
      return chamadas === 1
        ? { dados: [{ grupo_1: 'A', calculo_1: 80 }, { grupo_1: 'B', calculo_1: 70 }] }
        : { dados: [{ grupo_1: 'A', calculo_1: 100 }, { grupo_1: 'B', calculo_1: 50 }] };
    },
    async fechar() {}
  };
  const resposta = JSON.parse(await executarAnalisarInfluencias({
    data_inicial: '2026-06-22', data_final: '2026-07-21',
    dimensoes: ['marca'], limite_por_dimensao: 3
  }, { criarLeitor: () => leitor }));
  assert.deepEqual(resposta.periodo_anterior, { inicio: '2026-05-23', fim: '2026-06-21' });
  assert.equal(resposta.influencias.marca.maiores_quedas[0].nome, 'A');
  assert.equal(resposta.influencias.marca.maiores_quedas[0].diferenca, -20);
  assert.equal(resposta.influencias.marca.maiores_altas[0].nome, 'B');
  assert.deepEqual(
    definicaoAnalisarInfluencias.parameters.properties.dimensoes.items.enum,
    ['marca', 'produto', 'plataforma']
  );
  assert.equal(definicaoAnalisarInfluencias.parameters.properties.dimensoes.maxItems, 3);
});

test('compara dois periodos explicitamente informados pela conversa', async () => {
  const filtros = [];
  const leitor = {
    async agregar(_objeto, opcoes) {
      filtros.push(opcoes.filtros.data_emissao);
      return { dados: [] };
    },
    async fechar() {}
  };

  const resposta = JSON.parse(await executarAnalisarInfluencias({
    data_inicial: '2026-07-01',
    data_final: '2026-07-21',
    data_inicial_anterior: '2026-06-01',
    data_final_anterior: '2026-06-21',
    dimensoes: ['marca'],
    limite_por_dimensao: 3
  }, { criarLeitor: () => leitor }));

  assert.equal(resposta.modo_comparacao, 'periodos_informados');
  assert.deepEqual(resposta.periodo_anterior, {
    inicio: '2026-06-01',
    fim: '2026-06-21'
  });
  assert.deepEqual(filtros, [
    { operador: 'entre', valor: '2026-07-01', valorFinal: '2026-07-21' },
    { operador: 'entre', valor: '2026-06-01', valorFinal: '2026-06-21' },
    { operador: 'entre', valor: '2026-07-01', valorFinal: '2026-07-21' },
    { operador: 'entre', valor: '2026-06-01', valorFinal: '2026-06-21' }
  ]);
});

test('exige as duas datas do periodo anterior juntas', async () => {
  await assert.rejects(
    executarAnalisarInfluencias({
      data_inicial: '2026-07-01',
      data_final: '2026-07-21',
      data_inicial_anterior: '2026-06-01',
      data_final_anterior: null,
      dimensoes: ['marca'],
      limite_por_dimensao: 3
    }),
    /devem ser informadas juntas/
  );
});
