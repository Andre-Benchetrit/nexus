const test = require('node:test');
const assert = require('node:assert/strict');

const {
  definicaoAgregarSilver,
  executarAgregarSilver
} = require('../tools/agregar_silver');

function argumentos(sobrescritas = {}) {
  return {
    objeto: 'dim_produto',
    visao: 'atual',
    agrupamentos: [{ campo: 'grupo', granularidade: 'valor' }],
    calculos: [{ operacao: 'contar', campo: null }],
    filtros: [{
      campo: 'produto_ativo',
      operador: 'igual',
      valor: 'true',
      valor_final: null,
      valores: null
    }],
    combinacao_filtros: 'todos',
    ordenacao: { tipo: 'calculo', indice: 0, direcao: 'desc' },
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
        return { dados: [{ grupo_1: 'BEBES', calculo_1: 5n }] };
      },
      async fechar() { fechado = true; }
    }
  };
}

test('expoe agregacao Silver estrita', () => {
  assert.equal(definicaoAgregarSilver.name, 'agregar_silver');
  assert.equal(definicaoAgregarSilver.strict, true);
  assert.deepEqual(
    new Set(definicaoAgregarSilver.parameters.required),
    new Set(Object.keys(definicaoAgregarSilver.parameters.properties))
  );
});

test('encaminha agrupamento de negocio e filtro aprovado', async () => {
  const falso = criarLeitorFalso();
  const saida = JSON.parse(await executarAgregarSilver(argumentos(), {
    criarLeitor: () => falso.leitor
  }));
  assert.deepEqual(saida.dados, [{ grupo_1: 'BEBES', calculo_1: '5' }]);
  assert.deepEqual(falso.chamadas[0][1].filtros.produto_ativo, {
    operador: 'igual',
    valor: 'true',
    valorFinal: null,
    valores: null
  });
  assert.equal(falso.fechado, true);
});

test('bloqueia agrupamento Silver nao permitido', async () => {
  await assert.rejects(
    executarAgregarSilver(argumentos({
      agrupamentos: [{ campo: 'processado_em', granularidade: 'valor' }]
    })),
    /Campo Silver de agrupamento nao permitido/
  );
});

test('permite analisar vendas por marca na fato de itens', async () => {
  const falso = criarLeitorFalso();
  await executarAgregarSilver(argumentos({
    objeto: 'fato_venda_item',
    agrupamentos: [{ campo: 'marca', granularidade: 'valor' }],
    calculos: [
      { operacao: 'somar', campo: 'quantidade' },
      { operacao: 'somar', campo: 'valor_total_item' }
    ],
    filtros: [{
      campo: 'data_pedido',
      operador: 'igual',
      valor: '2026-07-17',
      valor_final: null,
      valores: null
    }]
  }), { criarLeitor: () => falso.leitor });

  assert.equal(falso.chamadas[0][0], 'fato_venda_item');
  assert.deepEqual(falso.chamadas[0][1].agrupamentos, [
    { campo: 'marca', granularidade: 'valor' }
  ]);
});
