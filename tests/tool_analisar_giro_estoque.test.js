const test = require('node:test');
const assert = require('node:assert/strict');

const {
  definicaoAnalisarGiroEstoque,
  executarAnalisarGiroEstoque
} = require('../tools/analisar_giro_estoque');

function dependenciasFalsas() {
  const estado = { consultas: [], leitorFechado: false, conexaoFechada: false };
  const conexao = {};
  return {
    estado,
    dependencias: {
      criarConexao: () => conexao,
      fecharConexao: async (recebida) => {
        assert.equal(recebida, conexao);
        estado.conexaoFechada = true;
      },
      criarLeitor: ({ conexao: recebida }) => {
        assert.equal(recebida, conexao);
        return {
          async prepararObjeto(nome) {
            return {
              viewAtual: nome === 'risco_ruptura_produto' ? 'estoque_atual' : 'vendas_diarias',
              execucoes: [{ manifesto: { fim: `2026-08-${nome === 'risco_ruptura_produto' ? '17' : '16'}T12:00:00Z` } }]
            };
          },
          async fechar() { estado.leitorFechado = true; }
        };
      },
      executarConsulta: async (_conexao, sql, parametros) => {
        estado.consultas.push({ sql, parametros });
        return [{
          id_produto: 10,
          descricao_produto: 'Produto parado',
          sku: 'SKU-10',
          ean: '7890000000010',
          marca: 'Marca X',
          estoque_total: 120,
          quantidade_reservada: 2,
          quantidade_vendida_periodo: 3,
          faturamento_periodo: 900,
          indice_baixo_giro: 40,
          sem_venda_periodo: false
        }];
      }
    }
  };
}

test('tool de menor giro cruza estoque e vendas com filtros parametrizados', async () => {
  const falso = dependenciasFalsas();
  const saida = JSON.parse(await executarAnalisarGiroEstoque({
    data_inicial: '2026-08-01', data_final: '2026-08-17',
    marca: "Marca d'Agua", produto: 'Fogao', limite: 10
  }, falso.dependencias));

  assert.equal(definicaoAnalisarGiroEstoque.name, 'analisar_giro_estoque');
  assert.equal(saida.dados[0].indice_baixo_giro, 40);
  assert.equal(saida.criterio.includes('estoque_total'), true);
  assert.deepEqual(falso.estado.consultas[0].parametros, [
    '2026-08-01', '2026-08-17', "%Marca d'Agua%", '%Fogao%', 10
  ]);
  assert.doesNotMatch(falso.estado.consultas[0].sql, /Marca d'Agua/);
  assert.match(falso.estado.consultas[0].sql, /ORDER BY indice_baixo_giro DESC/);
  assert.match(falso.estado.consultas[0].sql, /composicao_estoque IN \(0, 6, 50\)/);
  assert.match(saida.regra_elegibilidade, /kits participam/);
  assert.match(saida.regra_elegibilidade, /embalagens/);
  assert.equal(falso.estado.leitorFechado, true);
  assert.equal(falso.estado.conexaoFechada, true);
});

test('tool de menor giro valida periodo antes de consultar', async () => {
  const falso = dependenciasFalsas();
  await assert.rejects(executarAnalisarGiroEstoque({
    data_inicial: '2026-08-18', data_final: '2026-08-17',
    marca: null, produto: null, limite: 10
  }, falso.dependencias), /posterior/);
  assert.equal(falso.estado.consultas.length, 0);
});
