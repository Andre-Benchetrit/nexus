const test = require('node:test');
const assert = require('node:assert/strict');
const { executarAnalisarIndicadores } = require('../tools/analisar_indicadores');

test('indicadores por empresa consultam os objetos Gold dimensionais governados', async () => {
  const chamadas = [];
  const leitor = {
    async consultar(nome) {
      if (nome === 'painel_executivo_diario') {
        return { dados: [{ data_referencia: '2026-08-01', dados_parciais: false }], ultimaConstrucao: 'agora' };
      }
      return { dados: [] };
    },
    async agregar(nome, opcoes) {
      chamadas.push([nome, opcoes]);
      return { dados: [{ calculo_1: 25, calculo_2: 1000 }] };
    },
    async fechar() {}
  };
  const resultado = JSON.parse(await executarAnalisarIndicadores({
    operacao: 'resumir', metricas: ['pedidos_pagos', 'valor_pedidos_pagos'],
    data_inicial: '2026-08-01', data_final: '2026-08-01',
    data_inicial_anterior: null, data_final_anterior: null,
    recencia: null, id_empresa: 10, limite: 1
  }, { criarLeitor: () => leitor }));
  assert.equal(resultado.id_empresa, 10);
  assert.equal(chamadas[0][0], 'kpi_pedidos_pagos_diario_por_empresa');
  assert.deepEqual(chamadas[0][1].filtros.id_empresa, { operador: 'igual', valor: 10 });
});

test('indicadores rejeitam empresa fora da lista governada', async () => {
  await assert.rejects(
    executarAnalisarIndicadores({
      operacao: 'resumir', metricas: ['faturamento_emitido'],
      data_inicial: '2026-08-01', data_final: '2026-08-01',
      data_inicial_anterior: null, data_final_anterior: null,
      recencia: null, id_empresa: 11, limite: 1
    }),
    /empresas permitidas/
  );
});
