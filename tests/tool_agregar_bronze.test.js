const test = require('node:test');
const assert = require('node:assert/strict');

const {
  definicaoAgregarBronze,
  executarAgregarBronze
} = require('../tools/agregar_bronze');

function argumentos(sobrescritas = {}) {
  return {
    entidade: 'nota_saida',
    visao: 'atual',
    agrupamentos: [{ campo: 'entrega_uf', granularidade: 'valor' }],
    calculos: [{ operacao: 'contar', campo: null }],
    filtros: null,
    combinacao_filtros: null,
    ordenacao: null,
    limite: 10,
    ...sobrescritas
  };
}

function criarLeitorFalso() {
  const chamadas = [];
  let fechado = false;
  return {
    chamadas,
    get fechado() { return fechado; },
    leitor: {
      async agregar(nome, opcoes) {
        chamadas.push([nome, opcoes]);
        return { dados: [{ grupo_1: 'SP', calculo_1: 2n }] };
      },
      async fechar() { fechado = true; }
    }
  };
}

test('expõe schema estrito para agregações seguras', () => {
  assert.equal(definicaoAgregarBronze.name, 'agregar_bronze');
  assert.equal(definicaoAgregarBronze.strict, true);
  assert.deepEqual(
    new Set(definicaoAgregarBronze.parameters.required),
    new Set(Object.keys(definicaoAgregarBronze.parameters.properties))
  );
});

test('encaminha agrupamentos, cálculos e filtros aprovados', async () => {
  const falso = criarLeitorFalso();
  const saida = await executarAgregarBronze(argumentos({
    filtros: [{
      campo: 'data_pedido',
      operador: 'entre',
      valor: '01/07/2026',
      valor_final: '31/07/2026'
    }]
  }), { criarLeitor: () => falso.leitor });

  assert.deepEqual(JSON.parse(saida).dados, [{ grupo_1: 'SP', calculo_1: '2' }]);
  assert.deepEqual(falso.chamadas[0][1].filtros, {
    data_pedido: {
      operador: 'entre',
      valor: '01/07/2026',
      valorFinal: '31/07/2026'
    }
  });
  assert.equal(falso.fechado, true);
});

test('bloqueia agrupamento por campo não permitido', async () => {
  await assert.rejects(
    executarAgregarBronze(argumentos({
      agrupamentos: [{ campo: 'cpf', granularidade: 'valor' }]
    })),
    /Campo de agrupamento não permitido/
  );
});
