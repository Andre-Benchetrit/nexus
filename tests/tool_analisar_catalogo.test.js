const test = require('node:test');
const assert = require('node:assert/strict');

const {
  definicaoAnalisarCatalogo,
  executarAnalisarCatalogo
} = require('../tools/analisar_catalogo');

function leitorFalso() {
  const chamadas = [];
  let fechado = false;
  return {
    chamadas,
    get fechado() { return fechado; },
    leitor: {
      async agregar(nome, opcoes) {
        chamadas.push(['agregar', nome, opcoes]);
        return {
          dados: [{ grupo_1: 'ELETRODOMESTICO', calculo_1: 100n, calculo_2: 250n }],
          ultimaConstrucao: 'agora'
        };
      },
      async consultar(nome, opcoes) {
        chamadas.push(['consultar', nome, opcoes]);
        return { dados: [], ultimaConstrucao: 'agora' };
      },
      async fechar() { fechado = true; }
    }
  };
}

test('expoe contrato compacto e estrito para catalogo', () => {
  assert.equal(definicaoAnalisarCatalogo.name, 'analisar_catalogo');
  assert.equal(definicaoAnalisarCatalogo.strict, true);
  assert.deepEqual(
    new Set(definicaoAnalisarCatalogo.parameters.required),
    new Set(Object.keys(definicaoAnalisarCatalogo.parameters.properties))
  );
});

test('resume catalogo ativo com nomes de saida claros', async () => {
  const falso = leitorFalso();
  const saida = JSON.parse(await executarAnalisarCatalogo({
    operacao: 'ranquear',
    agrupar_por: 'grupo',
    status: 'ativos',
    filtros: [],
    incluir_estoque: true,
    limite: 10
  }, { criarLeitor: () => falso.leitor }));

  assert.deepEqual(saida.dados, [{
    grupo: 'ELETRODOMESTICO',
    quantidade_produtos: '100',
    estoque_total: '250'
  }]);
  assert.deepEqual(falso.chamadas[0][2].filtros.produto_ativo, {
    operador: 'igual',
    valor: 'true'
  });
  assert.equal(falso.fechado, true);
});

test('resumo de catalogo ignora agrupamento e retorna o total geral', async () => {
  const falso = leitorFalso();
  const saida = JSON.parse(await executarAnalisarCatalogo({
    operacao: 'resumir',
    agrupar_por: 'grupo',
    status: 'todos',
    filtros: [],
    incluir_estoque: false,
    limite: 10
  }, { criarLeitor: () => falso.leitor }));

  assert.deepEqual(falso.chamadas[0][2].agrupamentos, []);
  assert.equal(saida.agrupado_por, null);
});

test('rejeita dimensao invalida antes de abrir o leitor', async () => {
  let abriuLeitor = false;
  await assert.rejects(
    executarAnalisarCatalogo({
      operacao: 'ranquear',
      agrupar_por: 'fornecedor',
      status: 'todos',
      filtros: [],
      incluir_estoque: false,
      limite: 10
    }, {
      criarLeitor() {
        abriuLeitor = true;
        return leitorFalso().leitor;
      }
    }),
    /Dimensao de catalogo invalida/
  );
  assert.equal(abriuLeitor, false);
});
