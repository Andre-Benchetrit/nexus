const test = require('node:test');
const assert = require('node:assert/strict');

const {
  definicaoAnalisarDesempenho,
  executarAnalisarDesempenho
} = require('../tools/analisar_desempenho');

function leitorFalso() {
  const chamadas = [];
  return {
    chamadas,
    leitor: {
      async agregar(nome, opcoes) {
        chamadas.push([nome, opcoes]);
        return {
          dados: [{
            grupo_1: 'PHILCO',
            calculo_1: 50,
            calculo_2: 10000,
            calculo_3: 2500
          }],
          ultimaConstrucao: '2026-07-24T12:00:00.000Z'
        };
      },
      async fechar() {}
    }
  };
}

test('expoe contrato estrito para desempenho Gold', () => {
  assert.equal(definicaoAnalisarDesempenho.name, 'analisar_desempenho');
  assert.equal(definicaoAnalisarDesempenho.strict, true);
  assert.deepEqual(
    new Set(definicaoAnalisarDesempenho.parameters.required),
    new Set(Object.keys(definicaoAnalisarDesempenho.parameters.properties))
  );
});

test('ranqueia marca e calcula margem percentual pelos totais', async () => {
  const falso = leitorFalso();
  const resposta = JSON.parse(await executarAnalisarDesempenho({
    operacao: 'ranquear',
    agrupar_por: 'marca',
    metricas: ['quantidade', 'faturamento', 'margem_bruta_pct'],
    ordenar_por: 'faturamento',
    filtros: [{ campo: 'marca', operador: 'contem', valor: 'PHILCO' }],
    data_inicial: '2026-07-17',
    data_final: '2026-07-17',
    id_empresa: 10,
    limite: 10
  }, { criarLeitor: () => falso.leitor }));

  assert.equal(falso.chamadas[0][0], 'desempenho_produto_diario');
  assert.deepEqual(resposta.dados, [{
    marca: 'PHILCO',
    quantidade_faturada: 50,
    faturamento_emitido: 10000,
    margem_bruta_pct: 25
  }]);
  assert.deepEqual(falso.chamadas[0][1].filtros.id_empresa, {
    operador: 'igual',
    valor: 10
  });
  assert.deepEqual(falso.chamadas[0][1].filtros.marca, {
    operador: 'contem',
    valor: 'PHILCO'
  });
  assert.equal(falso.chamadas[0][1].ordenacao.indice, 1);
  assert.match(resposta.conceito_margem, /nao e lucro liquido/);
});
