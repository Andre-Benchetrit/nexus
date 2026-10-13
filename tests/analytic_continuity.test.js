const test = require('node:test');
const assert = require('node:assert/strict');

const {
  aplicarContratoNaDecisao,
  criarContratoContinuidadeProduto,
  extrairSelecaoProdutosDasLinhas
} = require('../agentes/continuidade_analitica');
const { aplicarPoliticaArgumentos } = require('../agentes/politicas_tools');
const { validarPlanoSugerido } = require('../agentes/capacidades');
const {
  aplicarGarantiasResposta,
  criarEnvelopeEvidencia,
  formatarRespostaCorporativaDeterministica,
  validarSinteseCorporativa
} = require('../agentes/resposta');

function historicoAgosto() {
  return [{
    pergunta: 'Ranqueie os produtos de agosto por receita',
    periodo: { data_inicial: '2026-08-01', data_final: '2026-08-31' },
    referencias: { id_produto: ['10', '20'], sku: ['SKU-A', 'SKU-B'] },
    ferramentas: [{ nome: 'analisar_desempenho', argumentos: {
      ordenar_por: 'faturamento_emitido', metricas: ['faturamento_emitido']
    } }]
  }];
}

test('continuidade congela produtos autorizados e resolve mês anterior e seguinte sobre a base', () => {
  const produtos = extrairSelecaoProdutosDasLinhas([
    { id_produto: 10, sku: 'SKU-A' },
    { id_produto: 20, sku: 'SKU-B' }
  ]);
  const contrato = criarContratoContinuidadeProduto({
    pergunta: 'Mantenha essa base de produtos e compare o mês anterior e o próximo mês.',
    historico: historicoAgosto(),
    selecaoAutorizada: { produtos, resultRefId: 'resultado-anterior' }
  });
  assert.deepEqual(contrato.periodo, {
    inicio: '2026-07-01', fim: '2026-09-30',
    base: { inicio: '2026-08-01', fim: '2026-08-31' },
    origem: 'mes_anterior_base_proximo_mes'
  });
  assert.deepEqual(contrato.produtos, [
    { tipo: 'id_produto', valor: '10', sku: 'SKU-A' },
    { tipo: 'id_produto', valor: '20', sku: 'SKU-B' }
  ]);
  assert.deepEqual(contrato.metricas, ['faturamento_emitido']);
  assert.equal(contrato.granularidade, 'mes');
  assert.equal(contrato.resultRefId, 'resultado-anterior');
});

test('contrato analítico substitui plano amplo por uma única fachada compatível', () => {
  const contrato = criarContratoContinuidadeProduto({
    pergunta: 'Mantenha esses produtos no mês anterior e no próximo mês.',
    historico: historicoAgosto()
  });
  const decisao = aplicarContratoNaDecisao({
    perguntaAutonoma: 'consulta ampla', dominioPrimario: 'desempenho',
    dominiosSecundarios: ['gold'], intencao: 'comparar', filtros: [],
    camposSolicitados: ['faturamento_emitido'], planoSugerido: [
      { ferramenta: 'analisar_desempenho', finalidade: 'ranking' },
      { ferramenta: 'agregar_gold', finalidade: 'aprofundar' }
    ], capacidadesAusentes: ['campo:serie'], transformacoesSolicitadas: [],
    requisitosResposta: [], codigosMotivo: [], precisaEsclarecimento: false,
    perguntaEsclarecimento: null
  }, contrato);
  const plano = validarPlanoSugerido(decisao);
  assert.equal(decisao.dominioPrimario, 'inteligencia_produto');
  assert.deepEqual(plano.ferramentas, ['analisar_evolucao_produto']);
  assert.deepEqual(plano.capacidadesAusentes, []);
});

test('política local prevalece sobre argumentos do modelo no contrato de continuidade', () => {
  const contrato = criarContratoContinuidadeProduto({
    pergunta: 'Mantenha essa base de produtos no mês anterior e próximo mês.',
    historico: historicoAgosto()
  });
  const argumentos = aplicarPoliticaArgumentos('analisar_evolucao_produto', {
    selecao: { modo: 'top_periodo', produtos: null, top_n: 20,
      metrica_ranking: 'quantidade_faturada', data_referencia_inicial: '2026-10-01',
      data_referencia_final: '2026-10-06' },
    data_inicial: '2026-10-01', data_final: '2026-10-06', granularidade: 'dia',
    metricas: ['quantidade_faturada'], comparar_periodo_anterior: true
  }, { contratoAnalitico: contrato });
  assert.deepEqual(argumentos.selecao.produtos, [
    { tipo: 'id_produto', valor: '10' },
    { tipo: 'id_produto', valor: '20' }
  ]);
  assert.equal(argumentos.data_inicial, '2026-07-01');
  assert.equal(argumentos.data_final, '2026-09-30');
  assert.equal(argumentos.granularidade, 'mes');
  assert.equal(argumentos.comparar_periodo_anterior, false);
});

test('fallback estruturado prefere evolução e valida coorte e janela completas', () => {
  const contrato = criarContratoContinuidadeProduto({
    pergunta: 'Mantenha essa base de produtos no mês anterior e próximo mês.',
    historico: historicoAgosto(),
    selecaoAutorizada: { produtos: [
      { tipo: 'id_produto', valor: '10', sku: 'SKU-A' },
      { tipo: 'id_produto', valor: '20', sku: 'SKU-B' }
    ] }
  });
  const decisao = aplicarContratoNaDecisao({
    dominioPrimario: 'desempenho', dominiosSecundarios: [], intencao: 'comparar',
    camposSolicitados: [], filtros: [], planoSugerido: [], capacidadesAusentes: [],
    transformacoesSolicitadas: [], requisitosResposta: [], codigosMotivo: []
  }, contrato);
  const evolucao = { nome: 'analisar_evolucao_produto', resultado: {
    periodo: { inicio: '2026-07-01', fim: '2026-09-30' },
    granularidade: 'mes', metricas: ['faturamento_emitido'],
    definicoes_metricas: { faturamento_emitido: { rotulo: 'Faturamento emitido' } },
    dados: [
      { periodo: '2026-07-01', id_produto: 10, descricao_produto: 'A', sku: 'SKU-A', faturamento_emitido: 10 },
      { periodo: '2026-07-01', id_produto: 20, descricao_produto: 'B', sku: 'SKU-B', faturamento_emitido: 20 },
      { periodo: '2026-09-01', id_produto: 10, descricao_produto: 'A', sku: 'SKU-A', faturamento_emitido: 30 },
      { periodo: '2026-09-01', id_produto: 20, descricao_produto: 'B', sku: 'SKU-B', faturamento_emitido: 40 }
    ]
  } };
  const rankingPosterior = { nome: 'analisar_desempenho', resultado: {
    agrupado_por: 'produto', periodo: { inicio: '2026-10-01', fim: '2026-10-06' },
    dados: [{ descricao_produto: 'Outro', sku: 'SKU-X', faturamento_emitido: 999 }]
  } };
  const resultados = [evolucao, rankingPosterior];
  const texto = formatarRespostaCorporativaDeterministica(resultados);
  assert.match(texto, /Evolução dos produtos/);
  assert.match(texto, /01\/07\/2026 a 30\/09\/2026/);
  assert.doesNotMatch(texto, /SKU-X/);
  assert.equal(aplicarGarantiasResposta('síntese livre', resultados), texto);
  const envelope = criarEnvelopeEvidencia(resultados, decisao);
  assert.equal(validarSinteseCorporativa(texto, envelope).valida, true);
  const invalida = validarSinteseCorporativa(
    'Ranking de outubro com SKU-X.', envelope
  );
  assert.equal(invalida.valida, false);
  assert.ok(invalida.motivos.includes('coorte_produtos_incompleta'));
  assert.ok(invalida.motivos.includes('janela_temporal_incompleta'));
});

test('referência vaga sem histórico de produto não cria contrato', () => {
  assert.equal(criarContratoContinuidadeProduto({
    pergunta: 'Compare esses produtos no mês anterior e próximo mês.',
    historico: []
  }), null);
});
