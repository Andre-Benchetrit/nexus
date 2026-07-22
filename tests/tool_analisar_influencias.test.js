const test = require('node:test');
const assert = require('node:assert/strict');
const {
  definicaoAnalisarInfluencias,
  executarAnalisarInfluencias
} = require('../tools/analisar_influencias');

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
