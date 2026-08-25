const test = require('node:test');
const assert = require('node:assert/strict');

const {
  POLITICAS_DOMINIO,
  avaliarFaixaSemantica,
  resolverModoDadosGemini,
  resolverModoEscalonamento,
  selecionarProviderDaFaixa,
  validarProviderParaDados
} = require('../agentes/escalonamento_semantico');
const { obterCapacidade } = require('../agentes/capacidades');
const { normalizarDecisao } = require('../agentes/roteador_semantico');
const { executarAssistente } = require('../agentes/assistente_nexus');
const { lerArgumentos } = require('../agentes/consultor_nexus');
const { avaliarSustentacaoFactual } = require('../agentes/resposta');

function decisao(sobrescrever = {}) {
  return {
    dominioPrimario: 'vendas',
    dominiosSecundarios: [],
    intencao: 'listar',
    confianca: 0.95,
    transformacoesSolicitadas: [],
    riscoSemantico: 'baixo',
    necessidadeIntervencao: false,
    ...sobrescrever
  };
}

test('classifica listagem simples e agrupamento visual na faixa basica', () => {
  assert.ok(POLITICAS_DOMINIO.vendas.basicas.includes('resumir'));
  assert.ok(POLITICAS_DOMINIO.estoque.assistidas.includes('diagnosticar'));
  const simples = avaliarFaixaSemantica({
    decisao: decisao(),
    plano: { ferramentas: ['analisar_vendas'], rejeitadas: [], capacidadesAusentes: [] }
  });
  assert.equal(simples.faixa, 'basica');
  assert.equal(simples.pontos, 0);

  const agrupada = avaliarFaixaSemantica({
    decisao: decisao({ intencao: 'agregar', transformacoesSolicitadas: ['agrupar'] }),
    plano: { ferramentas: ['analisar_vendas'], rejeitadas: [], capacidadesAusentes: [] }
  });
  assert.equal(agrupada.faixa, 'basica');
  assert.equal(agrupada.pontos, 1);
});

test('promove comparacao para assistida e consulta multidominio para avancada', () => {
  const comparacao = avaliarFaixaSemantica({
    decisao: decisao({ intencao: 'comparar' }),
    plano: { ferramentas: ['analisar_vendas'], rejeitadas: [], capacidadesAusentes: [] }
  });
  assert.equal(comparacao.faixa, 'assistida');
  assert.ok(comparacao.motivos.includes('transformacao_assistida'));

  const multidominio = avaliarFaixaSemantica({
    decisao: decisao({ dominiosSecundarios: ['estoque'] }),
    plano: {
      ferramentas: ['analisar_vendas', 'analisar_rupturas'],
      rejeitadas: [], capacidadesAusentes: []
    }
  });
  assert.equal(multidominio.faixa, 'avancada');
  assert.ok(multidominio.motivos.includes('multiplos_dominios'));
  assert.ok(multidominio.motivos.includes('multiplas_tools'));
});

test('capacidade ausente, camada tecnica e risco alto exigem faixa avancada', () => {
  const ausente = avaliarFaixaSemantica({
    decisao: decisao(),
    plano: { ferramentas: ['analisar_vendas'], capacidadesAusentes: ['campo:margem'] }
  });
  assert.equal(ausente.faixa, 'avancada');

  const tecnica = avaliarFaixaSemantica({
    decisao: decisao({ dominioPrimario: 'gold' }),
    plano: { ferramentas: ['consultar_gold'], capacidadesAusentes: [] }
  });
  assert.equal(tecnica.faixa, 'avancada');

  const risco = avaliarFaixaSemantica({
    decisao: decisao({ riscoSemantico: 'alto', necessidadeIntervencao: true }),
    plano: { ferramentas: ['analisar_vendas'], capacidadesAusentes: [] }
  });
  assert.equal(risco.faixa, 'avancada');
});

test('faixa explicita pode elevar mas nunca reduzir a decisao de seguranca', () => {
  const elevada = avaliarFaixaSemantica({
    decisao: decisao(),
    plano: { ferramentas: ['analisar_vendas'], capacidadesAusentes: [] },
    faixaForcada: 'avancada'
  });
  assert.equal(elevada.faixa, 'avancada');

  const naoReduzida = avaliarFaixaSemantica({
    decisao: decisao({ dominioPrimario: 'bronze', intencao: 'auditar' }),
    plano: { ferramentas: ['consultar_bronze'], capacidadesAusentes: [] },
    faixaForcada: 'basica'
  });
  assert.equal(naoReduzida.faixa, 'avancada');
});

test('Gemini permanece desativado e o modo gratuito aceita somente conhecimento publico', () => {
  assert.equal(resolverModoDadosGemini('disabled'), 'disabled');
  assert.equal(
    validarProviderParaDados('gemini', 'conhecimento_geral', { geminiUsageMode: 'disabled' }).permitido,
    false
  );
  assert.equal(
    validarProviderParaDados('gemini', 'conhecimento_geral', { geminiUsageMode: 'free_public' }).permitido,
    true
  );
  assert.equal(
    validarProviderParaDados('gemini', 'dados_corporativos', { geminiUsageMode: 'free_public' }).permitido,
    false
  );
  assert.equal(
    validarProviderParaDados('gemini', 'dados_corporativos', { geminiUsageMode: 'paid' }).permitido,
    true
  );
});

test('seletor deixa a faixa sem override no provider atual e bloqueia Gemini acidental', () => {
  assert.equal(selecionarProviderDaFaixa('basica', {}, 'dados_corporativos').usarAtual, true);
  const bloqueada = selecionarProviderDaFaixa('basica', {
    basicProviderNome: 'gemini', basicModelo: 'gemini-3.5-flash-lite',
    geminiUsageMode: 'disabled'
  }, 'dados_corporativos');
  assert.equal(bloqueada.permitido, false);
  assert.equal(bloqueada.usarAtual, true);
});

test('registro de vendas e estoque declara transformacoes e derivacoes flexiveis', () => {
  const vendas = obterCapacidade('analisar_vendas');
  const estoque = obterCapacidade('analisar_giro_estoque');
  assert.ok(vendas.transformacoesPermitidas.includes('agrupar'));
  assert.ok(vendas.derivacoesPermitidas.includes('variacao_percentual'));
  assert.ok(estoque.granularidades.includes('produto'));
});

test('verificador factual sinaliza identificador corporativo ausente da evidencia', () => {
  const comprovada = avaliarSustentacaoFactual(
    'O pedido 1976859 está bloqueado.',
    [{ resultado: { marketplace_pedido: '1976859' } }]
  );
  assert.equal(comprovada.status, 'comprovada');

  const divergente = avaliarSustentacaoFactual(
    'O pedido 1976999 está bloqueado.',
    [{ resultado: { marketplace_pedido: '1976859' } }]
  );
  assert.equal(divergente.status, 'revisao_necessaria');
  assert.deepEqual(divergente.identificadoresNaoSustentados, ['1976999']);
});

test('RouteDecision normaliza sinais semanticos novos e preserva compatibilidade', () => {
  const normalizada = normalizarDecisao({
    pergunta_autonoma: 'Compare as vendas deste mês.',
    dominio_primario: 'vendas', dominios_secundarios: [], intencao: 'comparar',
    entidades: [], periodo: null, filtros: [], campos_solicitados: ['faturamento'],
    plano_sugerido: [{ ferramenta: 'analisar_vendas', finalidade: 'comparar' }],
    capacidades_ausentes: [], transformacoes_solicitadas: ['comparar_periodos'],
    complexidade_sugerida: 'assistida', risco_semantico: 'medio',
    necessidade_intervencao: true, motivos_intervencao: ['comparacao_temporal'],
    requisitos_resposta: ['informar_periodos'], confianca: 0.9,
    precisa_esclarecimento: false, pergunta_esclarecimento: null, codigos_motivo: []
  });
  assert.deepEqual(normalizada.transformacoesSolicitadas, ['comparar_periodos']);
  assert.equal(normalizada.complexidadeSugerida, 'assistida');
  assert.equal(normalizada.necessidadeIntervencao, true);
});

test('modo v1 entrega resposta corporativa pronta sem segunda sintese generalista', async () => {
  let chamouGeneralista = false;
  const resultado = await executarAssistente('Quais são minhas vendas hoje?', {
    memoria: { obterTarefaAtiva: async () => null, listarPreferencias: async () => [], sessao: 't' },
    auditoriaIA: false,
    governanca: {
      async avaliar() { return { permitida: true }; },
      async iniciarTool() { return {}; },
      async concluirTool() {}
    },
    generalistProvider: {
      nome: 'anthropic', modelo: 'teste',
      async executar() { chamouGeneralista = true; return { texto: 'nao usar' }; }
    },
    executarAgenteCorporativo: async () => ({
      texto: 'Foram vendidos 10 itens.',
      roteamento: {
        perfilInicial: 'vendas', ferramentasExecutadas: ['analisar_vendas'],
        respostaPronta: true, faixaSemantica: { modo: 'v1', final: 'basica' }
      }
    })
  });
  assert.equal(chamouGeneralista, false);
  assert.equal(resultado.texto, 'Foram vendidos 10 itens.');
});

test('CLI aceita configuracao de faixas semanticas e Gemini permanece explicito', () => {
  const lida = lerArgumentos([
    '--semantic-escalation-mode', 'shadow', '--semantic-tier', 'assistida',
    '--basic-provider', 'groq', '--basic-model', 'openai/gpt-oss-120b',
    '--advanced-provider', 'anthropic', '--advanced-model', 'claude-sonnet-5',
    '--gemini-usage-mode', 'disabled', 'pergunta'
  ]);
  assert.equal(lida.opcoes.semanticEscalationMode, 'shadow');
  assert.equal(lida.opcoes.semanticTier, 'assistida');
  assert.equal(lida.opcoes.basicProviderNome, 'groq');
  assert.equal(lida.opcoes.advancedModelo, 'claude-sonnet-5');
  assert.equal(lida.opcoes.geminiUsageMode, 'disabled');
  assert.equal(resolverModoEscalonamento('v1'), 'v1');
});
