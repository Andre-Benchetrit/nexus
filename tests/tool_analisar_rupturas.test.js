const test = require('node:test');
const assert = require('node:assert/strict');

const {
  definicaoAnalisarRupturas,
  executarAnalisarRupturas
} = require('../tools/analisar_rupturas');

function leitorFalso() {
  const chamadas = [];
  let fechado = false;
  return {
    chamadas,
    get fechado() { return fechado; },
    leitor: {
      async agregar(nome, opcoes) {
        chamadas.push(['agregar', nome, opcoes]);
        if (opcoes.agrupamentos[0].campo === 'marca') {
          return {
            dados: [
              { grupo_1: 'PHILCO', calculo_1: 8n, calculo_2: 120.5 },
              { grupo_1: 'ATLAS', calculo_1: 5n, calculo_2: 80 }
            ],
            ultimaConstrucao: 'agora'
          };
        }
        return {
          dados: [
            { grupo_1: 'RUPTURA_ATUAL', calculo_1: 3n },
            { grupo_1: 'CRITICO', calculo_1: 2n }
          ],
          ultimaConstrucao: 'agora'
        };
      },
      async consultar(nome, opcoes) {
        chamadas.push(['consultar', nome, opcoes]);
        return {
          dados: [
            {
              id_produto: 2,
              prioridade_risco: 2,
              saida_venda_30d: 100,
              dias_cobertura: 2
            },
            {
              id_produto: 1,
              prioridade_risco: 1,
              saida_venda_30d: 10,
              dias_cobertura: 0
            },
            {
              id_produto: 3,
              prioridade_risco: 2,
              saida_venda_30d: 200,
              dias_cobertura: 5
            }
          ],
          ultimaConstrucao: 'agora'
        };
      },
      async fechar() { fechado = true; }
    }
  };
}

test('expoe contrato estrito e compacto para rupturas', () => {
  assert.equal(definicaoAnalisarRupturas.name, 'analisar_rupturas');
  assert.equal(definicaoAnalisarRupturas.strict, true);
  assert.deepEqual(
    new Set(definicaoAnalisarRupturas.parameters.required),
    new Set(Object.keys(definicaoAnalisarRupturas.parameters.properties))
  );
});

test('resume as classificacoes de risco', async () => {
  const falso = leitorFalso();
  const saida = JSON.parse(await executarAnalisarRupturas({
    operacao: 'resumir',
    classificacoes: null,
    marca: null,
    produto: null,
    limite: 10
  }, { criarLeitor: () => falso.leitor }));

  assert.deepEqual(saida.classificacoes, [
    { classificacao: 'RUPTURA_ATUAL', quantidade_produtos: '3' },
    { classificacao: 'CRITICO', quantidade_produtos: '2' }
  ]);
  assert.equal(saida.considera_reposicoes_futuras, false);
  assert.equal(falso.fechado, true);
});

test('lista alertas padrao e ordena por urgencia e demanda', async () => {
  const falso = leitorFalso();
  const saida = JSON.parse(await executarAnalisarRupturas({
    operacao: 'listar',
    classificacoes: null,
    marca: 'PHILCO',
    produto: null,
    limite: 2
  }, { criarLeitor: () => falso.leitor }));

  assert.deepEqual(falso.chamadas[0][2].filtros.classificacao_risco.valores, [
    'RUPTURA_ATUAL', 'CRITICO', 'ALTO', 'MEDIO'
  ]);
  assert.deepEqual(falso.chamadas[0][2].filtros.marca, {
    operador: 'contem',
    valor: 'PHILCO'
  });
  assert.deepEqual(saida.dados.map(({ id_produto }) => id_produto), [1, 3]);
  assert.equal(falso.fechado, true);
});

test('ranqueia marcas por quantidade de produtos em alerta', async () => {
  const falso = leitorFalso();
  const saida = JSON.parse(await executarAnalisarRupturas({
    operacao: 'ranquear_marcas',
    classificacoes: null,
    marca: null,
    produto: null,
    limite: 10
  }, { criarLeitor: () => falso.leitor }));

  assert.equal(falso.chamadas[0][2].agrupamentos[0].campo, 'marca');
  assert.deepEqual(falso.chamadas[0][2].filtros.classificacao_risco.valores, [
    'RUPTURA_ATUAL', 'CRITICO', 'ALTO', 'MEDIO'
  ]);
  assert.deepEqual(saida.marcas, [
    { marca: 'PHILCO', produtos_em_alerta: '8', saida_venda_30d: 120.5 },
    { marca: 'ATLAS', produtos_em_alerta: '5', saida_venda_30d: 80 }
  ]);
  assert.equal(falso.fechado, true);
});
