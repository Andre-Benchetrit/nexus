const test = require('node:test');
const assert = require('node:assert/strict');

const {
  definicaoAnalisarFrete,
  executarAnalisarFrete
} = require('../tools/analisar_frete');
const {
  definicaoAnalisarOperacao,
  executarAnalisarOperacao
} = require('../tools/analisar_operacao');

function leitorFalso(dados) {
  const chamadas = [];
  return {
    chamadas,
    leitor: {
      async agregar(nome, opcoes) {
        chamadas.push([nome, opcoes]);
        return {
          dados,
          ultimaConstrucao: '2026-07-24T12:00:00.000Z'
        };
      },
      async fechar() {}
    }
  };
}

test('expoe contratos estritos para operacao e frete', () => {
  for (const definicao of [definicaoAnalisarOperacao, definicaoAnalisarFrete]) {
    assert.equal(definicao.strict, true);
    assert.deepEqual(
      new Set(definicao.parameters.required),
      new Set(Object.keys(definicao.parameters.properties))
    );
  }
});

test('funil operacional ranqueia plataformas no grao de pedido', async () => {
  const falso = leitorFalso([{
    grupo_1: 'AMAZON',
    calculo_1: 120,
    calculo_2: 8
  }]);
  const resposta = JSON.parse(await executarAnalisarOperacao({
    operacao: 'ranquear_plataformas',
    metricas: ['pedidos_validos', 'pedidos_devolvidos'],
    ordenar_por: 'pedidos_devolvidos',
    plataforma: 'AMAZON',
    data_inicial: '2026-07-01',
    data_final: '2026-07-31',
    id_empresa: 10,
    limite: 10
  }, { criarLeitor: () => falso.leitor }));

  assert.equal(falso.chamadas[0][0], 'kpi_plataforma_diario');
  assert.deepEqual(resposta.dados, [{
    plataforma: 'AMAZON',
    pedidos_validos: 120,
    pedidos_devolvidos: 8
  }]);
  assert.equal(falso.chamadas[0][1].ordenacao.indice, 1);
  assert.deepEqual(falso.chamadas[0][1].filtros.plataforma, {
    operador: 'contem',
    valor: 'AMAZON'
  });
});

test('omite resultado de frete quando algum pedido nao possui custo', async () => {
  const falso = leitorFalso([{
    grupo_1: 'MERCADO LIVRE',
    calculo_1: 1500,
    calculo_2: 12
  }]);
  const resposta = JSON.parse(await executarAnalisarFrete({
    operacao: 'ranquear',
    agrupar_por: 'plataforma',
    metricas: ['resultado_frete'],
    ordenar_por: 'resultado_frete',
    plataforma: null,
    transporte_regra: null,
    data_inicial: '2026-07-17',
    data_final: null,
    id_empresa: 10,
    limite: 10
  }, { criarLeitor: () => falso.leitor }));

  assert.equal(falso.chamadas[0][0], 'kpi_frete_diario');
  assert.deepEqual(
    falso.chamadas[0][1].calculos.map(({ campo }) => campo),
    ['resultado_frete', 'pedidos_sem_custo_frete']
  );
  assert.equal(resposta.dados[0].resultado_frete, null);
  assert.equal(resposta.dados[0].pedidos_sem_custo_frete, 12);
  assert.equal(resposta.custo_frete_disponivel, false);
  assert.match(resposta.aviso_custo, /nao cobre todos/);
});
