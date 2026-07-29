const test = require('node:test');
const assert = require('node:assert/strict');

const {
  definicaoAnalisarPessoas,
  executarAnalisarPessoas
} = require('../tools/analisar_pessoas');

function criarLeitorFalso() {
  const chamadas = [];
  let fechado = false;
  return {
    chamadas,
    get fechado() { return fechado; },
    leitor: {
      async contar(objeto, opcoes) {
        chamadas.push(['contar', objeto, opcoes]);
        return { total: 43n, ultimaConstrucao: '2026-07-27T12:00:00.000Z' };
      },
      async consultar(objeto, opcoes) {
        chamadas.push(['consultar', objeto, opcoes]);
        return {
          dados: [{
            id_transportadora: 1,
            transportadora: 'TRANSPORTADORA A',
            id_empresa: 10,
            transportadora_cidade: 'Barueri',
            transportadora_ativa: true
          }],
          ultimaConstrucao: '2026-07-27T12:00:00.000Z'
        };
      },
      async fechar() { fechado = true; }
    }
  };
}

test('expoe contrato compacto para pessoas operacionais', () => {
  assert.equal(definicaoAnalisarPessoas.name, 'analisar_pessoas');
  assert.equal(definicaoAnalisarPessoas.strict, true);
  assert.deepEqual(
    definicaoAnalisarPessoas.parameters.properties.cadastro.enum,
    ['funcionarios', 'transportadoras']
  );
});

test('resume funcionarios ativos de todas as empresas', async () => {
  const falso = criarLeitorFalso();
  const resultado = JSON.parse(await executarAnalisarPessoas({
    cadastro: 'funcionarios',
    operacao: 'resumir',
    status: 'ativos',
    id_empresa: null,
    busca: null,
    limite: 20
  }, { criarLeitor: () => falso.leitor }));

  assert.equal(resultado.total, '43');
  assert.deepEqual(falso.chamadas, [[
    'contar',
    'dim_funcionario',
    { filtros: { funcionario_ativo: { operador: 'igual', valor: 'true' } } }
  ]]);
  assert.equal(falso.fechado, true);
});

test('lista transportadoras ativas e informa truncamento', async () => {
  const falso = criarLeitorFalso();
  const resultado = JSON.parse(await executarAnalisarPessoas({
    cadastro: 'transportadoras',
    operacao: 'listar',
    status: 'ativos',
    id_empresa: null,
    busca: null,
    limite: 1
  }, { criarLeitor: () => falso.leitor }));

  assert.equal(resultado.total, '43');
  assert.equal(resultado.total_retornado, 1);
  assert.equal(resultado.resultado_truncado, true);
  assert.equal(falso.chamadas[1][1], 'dim_transportadora');
  assert.deepEqual(falso.chamadas[1][2].ordenacao, {
    campo: 'transportadora',
    direcao: 'asc'
  });
  assert.equal(falso.fechado, true);
});
