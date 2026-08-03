const test = require('node:test');
const assert = require('node:assert/strict');

const {
  definicaoConsultarGold,
  executarConsultarGold,
  OBJETOS_GOLD_PERMITIDOS_AGENTE
} = require('../tools/consultar_gold');
const { executarAgregarGold } = require('../tools/agregar_gold');

function argumentos(sobrescritas = {}) {
  return {
    operacao: 'consultar',
    objeto: 'kpi_faturamento_diario',
    visao: 'atual',
    id: null,
    colunas: ['data_referencia', 'faturamento_emitido'],
    filtros: null,
    combinacao_filtros: null,
    ordenacao: null,
    deslocamento: 0,
    limite: 10,
    ...sobrescritas
  };
}

function leitorFalso() {
  const chamadas = [];
  return {
    chamadas,
    async listarObjetos() {
      return [{ objeto: 'kpi_faturamento_diario' }, { objeto: 'interno' }];
    },
    async descreverObjeto() {
      return [
        { nome: 'data_referencia', tipo: 'DATE' },
        { nome: 'faturamento_emitido', tipo: 'DECIMAL' },
        { nome: 'processado_em', tipo: 'TIMESTAMP' }
      ];
    },
    async consultar(nome, opcoes) {
      chamadas.push(['consultar', nome, opcoes]);
      return { dados: [{ data_referencia: '2026-08-03', faturamento_emitido: 100 }] };
    },
    async buscarPorId() { return { dados: [] }; },
    async contar() { return { total: 1n }; },
    async agregar(nome, opcoes) {
      chamadas.push(['agregar', nome, opcoes]);
      return { dados: [{ total: 100 }] };
    },
    async fechar() {}
  };
}

test('expoe objetos Gold aprovados e contrato estrito', () => {
  assert.equal(definicaoConsultarGold.name, 'consultar_gold');
  assert.equal(definicaoConsultarGold.strict, true);
  assert.ok(OBJETOS_GOLD_PERMITIDOS_AGENTE.includes('painel_executivo_diario'));
  assert.ok(OBJETOS_GOLD_PERMITIDOS_AGENTE.includes('risco_ruptura_produto'));
  assert.deepEqual(
    new Set(definicaoConsultarGold.parameters.required),
    new Set(Object.keys(definicaoConsultarGold.parameters.properties))
  );
});

test('consulta e descreve Gold respeitando colunas aprovadas', async () => {
  const leitor = leitorFalso();
  const resultado = JSON.parse(await executarConsultarGold(argumentos(), {
    criarLeitor: () => leitor
  }));
  assert.equal(resultado.dados[0].faturamento_emitido, 100);

  const descricao = JSON.parse(await executarConsultarGold(argumentos({
    operacao: 'descrever_objeto', colunas: null
  }), { criarLeitor: () => leitorFalso() }));
  assert.deepEqual(
    descricao.colunas.map((coluna) => coluna.nome),
    ['data_referencia', 'faturamento_emitido']
  );
});

test('agrega Gold com filtros e campos validados', async () => {
  const leitor = leitorFalso();
  const resultado = JSON.parse(await executarAgregarGold({
    objeto: 'kpi_faturamento_diario',
    visao: 'atual',
    agrupamentos: [{ campo: 'ano', granularidade: 'valor' }],
    calculos: [{ operacao: 'somar', campo: 'faturamento_emitido' }],
    filtros: null,
    combinacao_filtros: null,
    ordenacao: null,
    limite: 10
  }, { criarLeitor: () => leitor }));
  assert.equal(resultado.dados[0].total, 100);
  assert.equal(leitor.chamadas[0][0], 'agregar');
});

