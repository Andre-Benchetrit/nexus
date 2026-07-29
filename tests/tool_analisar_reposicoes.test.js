const test = require('node:test');
const assert = require('node:assert/strict');

const {
  definicaoAnalisarReposicoes,
  executarAnalisarReposicoes,
  normalizarArgumentos
} = require('../tools/analisar_reposicoes');

function leitorFalso() {
  const chamadas = [];
  let fechado = false;
  return {
    chamadas,
    get fechado() { return fechado; },
    leitor: {
      async consultar(nome, opcoes) {
        chamadas.push(['consultar', nome, opcoes]);
        return {
          dados: [{
            id_agendamento_compra: 1,
            descricao_produto: 'Produto A',
            quantidade_pendente: 10
          }],
          ultimaConstrucao: 'agora'
        };
      },
      async agregar(nome, opcoes) {
        chamadas.push(['agregar', nome, opcoes]);
        return {
          dados: opcoes.agrupamentos.length
            ? [{
              grupo_1: 10,
              grupo_2: 'Produto A',
              grupo_3: 'SKU-A',
              calculo_1: 15,
              calculo_2: 2
            }]
            : [{ calculo_1: 15, calculo_2: 2 }],
          ultimaConstrucao: 'agora'
        };
      },
      async fechar() { fechado = true; }
    }
  };
}

function leitorUltimoRecebimento() {
  const chamadas = [];
  let fechado = false;
  return {
    chamadas,
    get fechado() { return fechado; },
    leitor: {
      async consultar(nome, opcoes) {
        chamadas.push(['consultar', nome, opcoes]);
        if (opcoes.colunas.length === 1) {
          return {
            dados: [{ data_entrada: new Date('2026-03-31T00:00:00.000Z') }],
            ultimaConstrucao: 'agora'
          };
        }
        return {
          dados: [
            {
              numero_pedido_compra: '399278',
              data_entrada: '2026-03-31',
              descricao_produto: 'Produto A',
              sku: 'SKU-A',
              quantidade_pedida: 25,
              quantidade_recebida: 25,
              quantidade_pendente: 0,
              numero_nf_entrada: '1001',
              recebido_com_atraso: false
            },
            {
              numero_pedido_compra: '399279',
              data_entrada: '2026-03-31',
              descricao_produto: 'Produto A',
              sku: 'SKU-A',
              quantidade_pedida: 15,
              quantidade_recebida: 10,
              quantidade_pendente: 5,
              numero_nf_entrada: '1002',
              recebido_com_atraso: true
            }
          ],
          ultimaConstrucao: 'agora'
        };
      },
      async fechar() { fechado = true; }
    }
  };
}

function argumentosBase(sobrescritas = {}) {
  return {
    operacao: 'listar',
    metrica_quantidade: null,
    data_inicial: null,
    data_final: null,
    status_logistico: null,
    produto: null,
    sku: null,
    fornecedor: null,
    marca: null,
    recebido_com_atraso: null,
    marcacao_manual_divergente: null,
    limite: 10,
    ...sobrescritas
  };
}

test('expoe contrato estrito para reposicoes', () => {
  assert.equal(definicaoAnalisarReposicoes.name, 'analisar_reposicoes');
  assert.equal(definicaoAnalisarReposicoes.strict, true);
  assert.deepEqual(
    new Set(definicaoAnalisarReposicoes.parameters.required),
    new Set(Object.keys(definicaoAnalisarReposicoes.parameters.properties))
  );
});

test('lista parcelas sem soma-las', async () => {
  const falso = leitorFalso();
  const saida = JSON.parse(await executarAnalisarReposicoes(argumentosBase({
    data_inicial: '2026-07-30',
    status_logistico: 'PREVISTO'
  }), { criarLeitor: () => falso.leitor }));

  assert.equal(falso.chamadas[0][0], 'consultar');
  assert.deepEqual(falso.chamadas[0][2].filtros.data_prevista, {
    operador: 'igual',
    valor: '2026-07-30'
  });
  assert.equal(saida.parcelas_somadas, false);
  assert.equal(saida.estoque_oficial_alterado, false);
  assert.equal(falso.fechado, true);
});

test('soma quantidade pendente somente na operacao explicita', async () => {
  const falso = leitorFalso();
  const saida = JSON.parse(await executarAnalisarReposicoes(argumentosBase({
    operacao: 'somar_quantidade',
    metrica_quantidade: 'pendente',
    data_inicial: '2026-07-30',
    status_logistico: 'PREVISTO'
  }), { criarLeitor: () => falso.leitor }));

  assert.equal(falso.chamadas[0][0], 'agregar');
  assert.equal(falso.chamadas[0][2].calculos[0].campo, 'quantidade_pendente');
  assert.equal(saida.parcelas_somadas, true);
  assert.equal(saida.quantidade_total, 15);
  assert.equal(saida.quantidade_total_inclui_sem_produto_identificado, true);
  assert.equal(saida.quantidade_produtos_identificados, 0);
  assert.equal(saida.quantidade_sem_produto_identificado, 15);
  assert.deepEqual(saida.totais, [{
    id_produto: 10,
    produto: 'Produto A',
    sku: 'SKU-A',
    quantidade: 15,
    parcelas: 2
  }]);
  assert.equal(saida.estoque_oficial_alterado, false);
});

test('normaliza dialeto do Groq para um unico dia e quantidade pendente', () => {
  const argumentos = normalizarArgumentos({
    operacao: 'listar',
    metrica_quantidade: 'quantidade_prevista',
    data_final: '2026-07-30',
    limite: 30
  });
  assert.equal(argumentos.operacao, 'somar_quantidade');
  assert.equal(argumentos.metrica_quantidade, 'pendente');
  assert.equal(argumentos.data_inicial, '2026-07-30');
  assert.equal(argumentos.data_final, null);
  assert.equal(argumentos.status_logistico, null);
});

test('consolida o ultimo recebimento pelo dia e apresenta todas as notas', async () => {
  const falso = leitorUltimoRecebimento();
  const saida = JSON.parse(await executarAnalisarReposicoes(argumentosBase({
    operacao: 'ultimo_recebimento',
    produto: 'Produto A'
  }), { criarLeitor: () => falso.leitor }));

  assert.equal(falso.chamadas.length, 2);
  assert.equal(falso.chamadas[0][2].ordenacao.campo, 'data_entrada');
  assert.deepEqual(falso.chamadas[1][2].filtros.data_entrada, {
    operador: 'igual',
    valor: '2026-03-31'
  });
  assert.equal(saida.data_ultimo_recebimento, '2026-03-31');
  assert.equal(saida.quantidade_pedida_total, 40);
  assert.equal(saida.quantidade_recebida_total, 35);
  assert.equal(saida.quantidade_pendente_total, 5);
  assert.deepEqual(saida.pedidos_compra, ['399278', '399279']);
  assert.deepEqual(saida.notas_fiscais_entrada, ['1001', '1002']);
  assert.equal(saida.notas_coincidem_com_pedidos, false);
  assert.equal(saida.recebido_com_atraso, true);
  assert.equal(falso.fechado, true);
});
