const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classificarEvidencia,
  criarEnvelopeEvidencia,
  validarSinteseCorporativa
} = require('../agentes/resposta');
const { instrumentarFerramentas, normalizarControlesVolume } = require('../agentes/ferramentas');
const { validarPlanoSugerido, obterCapacidade } = require('../agentes/capacidades');
const { extrairContextoTemporal } = require('../agentes/contexto_temporal');
const {
  aplicarPoliticaArgumentos,
  validarPoliticaExecucao
} = require('../agentes/politicas_tools');
const { avaliarFaixaSemantica } = require('../agentes/escalonamento_semantico');
const { detectarSinaisAprendizado } = require('../agentes/revisor_memoria');
const { criarEstadoExecucao } = require('../agentes/execucao_turno');
const { executarAssistente } = require('../agentes/assistente_nexus');
const {
  aplicarContextoTemporalNaDecisao,
  resolverContextoTemporalDaSolicitacao
} = require('../agentes/consultor_nexus');
const {
  definicaoConsultarBloqueiosSemEstoque
} = require('../tools/consultar_bloqueios_sem_estoque');

test('evidencia diferencia sucesso, resultado vazio, parcial e erro', () => {
  assert.equal(classificarEvidencia([]), 'error');
  assert.equal(classificarEvidencia([{ resultado: { dados: [] } }]), 'empty');
  assert.equal(classificarEvidencia([{ resultado: { dados: [{ id: 1 }], truncado: true } }]), 'partial');
  assert.equal(classificarEvidencia([{ resultado: { dados: [{ id: 1 }] } }]), 'complete');
});

test('envelope registra campos comprovados e sintese nao pode omitir identificador obrigatorio', () => {
  const envelope = criarEnvelopeEvidencia([{
    nome: 'consultar_bloqueios_sem_estoque',
    resultado: { dados: [{ marketplace_pedido: '260815CRCF2M1Y', sku: 'VX7551INX' }] },
    referencias: { marketplace_pedido: ['260815CRCF2M1Y'] }
  }], { camposSolicitados: ['marketplace_pedido', 'sku'] });
  assert.deepEqual(envelope.manifesto.camposObrigatorios, []);
  assert.deepEqual(envelope.manifesto.camposSolicitados, ['marketplace_pedido', 'sku']);
  const envelopeObrigatorio = criarEnvelopeEvidencia([{
    nome: 'consultar_bloqueios_sem_estoque',
    resultado: { dados: [{ marketplace_pedido: '260815CRCF2M1Y', sku: 'VX7551INX' }] },
    referencias: { marketplace_pedido: ['260815CRCF2M1Y'] }
  }], {
    perguntaAutonoma: 'Liste os pedidos com marketplace_pedido e SKU.',
    camposSolicitados: ['marketplace_pedido', 'sku', 'descricao_produto']
  });
  assert.equal(envelope.status, 'complete');
  assert.equal(envelopeObrigatorio.status, 'complete');
  const invalida = validarSinteseCorporativa('Há um pedido bloqueado.', envelopeObrigatorio);
  assert.equal(invalida.valida, false);
  assert.ok(invalida.motivos.includes('campo_obrigatorio_ausente:marketplace_pedido'));
  assert.equal(
    validarSinteseCorporativa(
      'O pedido 260815CRCF2M1Y está bloqueado para o SKU VX7551INX.', envelopeObrigatorio
    ).valida,
    true
  );
});

test('limites de volume sao ajustados sem alterar filtros ou enums', async () => {
  const schema = {
    properties: {
      limite: { type: 'integer', minimum: 1, maximum: 50 },
      operacao: { type: 'string', enum: ['listar'] }
    }
  };
  assert.deepEqual(normalizarControlesVolume({ limite: 500, operacao: 'inventada' }, schema), {
    argumentos: { limite: 50, operacao: 'inventada' },
    ajustes: [{ campo: 'limite', recebido: 500, aplicado: 50 }]
  });
  let chamadas = 0;
  let recebido;
  const [tool] = instrumentarFerramentas([{
    definicao: { type: 'function', name: 'teste_volume', parameters: schema },
    executar: async (argumentos) => { chamadas += 1; recebido = argumentos; return { ok: true }; }
  }]);
  await tool.executar({ limite: 100, operacao: 'listar' });
  assert.equal(chamadas, 1);
  assert.equal(recebido.limite, 50);
});

test('fachada de bloqueios anuncia o mesmo limite seguro validado pela listagem', () => {
  assert.equal(
    definicaoConsultarBloqueiosSemEstoque.parameters.properties.limite.maximum,
    50
  );
  assert.equal(normalizarControlesVolume(
    { limite: 500, operacao: 'listar' },
    definicaoConsultarBloqueiosSemEstoque.parameters
  ).argumentos.limite, 50);
});

test('continuidade de bloqueios força enriquecimento em lote com referencias anteriores', () => {
  const argumentos = aplicarPoliticaArgumentos(
    'consultar_bloqueios_sem_estoque',
    {
      operacao: 'listar', marketplace_pedido: null, marketplace_pedidos: null,
      id_nota_saida: null, ids_notas_saida: null, limite: 50
    },
    {
      decisao: { intencao: 'enriquecer' },
      referenciasAnteriores: { marketplace_pedido: ['PED-1', 'PED-2'] }
    }
  );
  assert.equal(argumentos.operacao, 'listar_itens');
  assert.deepEqual(argumentos.marketplace_pedidos, ['PED-1', 'PED-2']);
});

test('fachada atual de bloqueios rejeita data historica em vez de responder com o estado atual', () => {
  assert.throws(() => validarPoliticaExecucao('consultar_bloqueios_sem_estoque', {
    temporal: { inicio: '2026-08-17', fim: '2026-08-17' },
    dataReferencia: '2026-08-24'
  }), (erro) => erro.codigo === 'CAPACIDADE_TEMPORAL_NAO_SUPORTADA');
  assert.doesNotThrow(() => validarPoliticaExecucao('consultar_bloqueios_sem_estoque', {
    temporal: { inicio: '2026-08-24', fim: '2026-08-24' },
    dataReferencia: '2026-08-24'
  }));
});

test('comparacao de faturamento por marketplace usa uma unica fachada de influencias', () => {
  const plano = validarPlanoSugerido({
    perguntaAutonoma: 'Compare o faturamento deste mês com o anterior por marketplace.',
    dominioPrimario: 'indicadores', dominiosSecundarios: ['vendas'], intencao: 'comparar',
    camposSolicitados: ['faturamento', 'plataforma'], filtros: [
      { campo: 'periodo_comparacao_data_inicial', operador: '=', valor: '2026-07-01' },
      { campo: 'periodo_comparacao_data_final', operador: '=', valor: '2026-07-18' }
    ], requisitosResposta: [],
    planoSugerido: [{ ferramenta: 'analisar_indicadores', finalidade: 'comparar totais' }],
    capacidadesAusentes: []
  });
  assert.deepEqual(plano.ferramentas, ['analisar_influencias']);
  assert.deepEqual(plano.rejeitadas, []);
  assert.equal(plano.filtrosRejeitados.length, 0);
  assert.deepEqual(plano.capacidadesAusentes, []);
});

test('ranking de pedidos pagos usa vendas mesmo se o router sugerir desempenho faturado', () => {
  const plano = validarPlanoSugerido({
    perguntaAutonoma: 'Top 15 produtos por receita dos pedidos pagos de 01/08 a 25/08.',
    dominioPrimario: 'desempenho', dominiosSecundarios: [], intencao: 'ranquear',
    camposSolicitados: ['produto', 'sku', 'valor_total_vendido'], filtros: [],
    requisitosResposta: [], capacidadesAusentes: [],
    planoSugerido: [{ ferramenta: 'analisar_desempenho', finalidade: 'ranking faturado' }]
  });
  assert.deepEqual(plano.ferramentas, ['analisar_vendas']);
});

test('resumo simples de vendas reconhece quantidade de pedidos e valor total', () => {
  const decisao = {
    perguntaAutonoma: 'Qual foi o total de vendas hoje?',
    dominioPrimario: 'vendas', dominiosSecundarios: [], intencao: 'resumir',
    camposSolicitados: ['quantidade_pedidos', 'valor_total'], filtros: [],
    requisitosResposta: [], planoSugerido: [], capacidadesAusentes: [],
    transformacoesSolicitadas: [], confianca: 1
  };
  const plano = validarPlanoSugerido(decisao);
  assert.deepEqual(plano.ferramentas, ['analisar_vendas']);
  assert.deepEqual(plano.capacidadesAusentes, []);
  assert.equal(avaliarFaixaSemantica({ decisao, plano }).faixa, 'basica');
});

test('mes atual versus anterior usa os mesmos dias de cobertura', () => {
  const temporal = extrairContextoTemporal(
    'Compare o faturamento deste mês com o mês anterior por marketplace.',
    '2026-08-17'
  );
  assert.deepEqual(temporal, {
    tipo: 'comparacao_periodos', origem: 'mes_atual_vs_anterior_mesma_cobertura',
    inicio: '2026-08-01', fim: '2026-08-17',
    periodoAnterior: { inicio: '2026-07-01', fim: '2026-07-17' }
  });
  const args = aplicarPoliticaArgumentos('analisar_influencias', {
    data_inicial: null, data_final: null,
    data_inicial_anterior: null, data_final_anterior: null
  }, { temporal });
  assert.deepEqual(args, {
    data_inicial: '2026-08-01', data_final: '2026-08-17',
    data_inicial_anterior: '2026-07-01', data_final_anterior: '2026-07-17'
  });
});

test('periodo deterministico prevalece sobre ano inventado pelo roteador e pela tool', () => {
  const temporal = resolverContextoTemporalDaSolicitacao(
    'Quais foram os produtos que mais venderam no mês de julho?',
    [], '2026-09-03'
  );
  const decisao = aplicarContextoTemporalNaDecisao({
    periodo: { data_inicial: '2023-07-01', data_final: '2023-07-31' },
    codigosMotivo: []
  }, temporal);
  assert.deepEqual(decisao.periodo, {
    data_inicial: '2026-07-01', data_final: '2026-07-31',
    referencia: 'mes_nomeado_mais_recente'
  });
  const argumentos = aplicarPoliticaArgumentos('analisar_vendas', {
    data_inicial: '2023-07-01', data_final: '2023-07-31', operacao: 'ranquear'
  }, { temporal });
  assert.equal(argumentos.data_inicial, '2026-07-01');
  assert.equal(argumentos.data_final, '2026-07-31');
});

test('ano curto corrige o mes da consulta corporativa anterior', () => {
  assert.deepEqual(resolverContextoTemporalDaSolicitacao(
    'e de fato 2025.',
    [{ pergunta: 'Quais foram os produtos que mais venderam no mês de julho?' }],
    '2026-09-03'
  ), {
    tipo: 'periodo_explicito', origem: 'correcao_ano_continuacao',
    inicio: '2025-07-01', fim: '2025-07-31'
  });
});

test('resposta anterior em texto livre nao injeta datas na continuacao', () => {
  assert.equal(resolverContextoTemporalDaSolicitacao(
    'tente novamente',
    [{ pergunta: 'Consulta sem período', resposta: 'Tente o intervalo 01/07/2023 a 31/07/2023.' }],
    '2026-09-03'
  ), null);
  assert.deepEqual(resolverContextoTemporalDaSolicitacao(
    'agora por marca',
    [{ pergunta: 'Ranking anterior', periodo: {
      data_inicial: '2026-07-01', data_final: '2026-07-31'
    } }],
    '2026-09-03'
  ), {
    tipo: 'periodo_explicito', origem: 'periodo_anterior_estruturado',
    inicio: '2026-07-01', fim: '2026-07-31'
  });
});

test('reposicao simples possui cobertura completa e nao exige EAN', () => {
  const reposicao = obterCapacidade('analisar_reposicoes');
  assert.equal(reposicao.entidades.includes('ean'), false);
  for (const campo of [
    'produto', 'fornecedor', 'marca', 'data_prevista', 'numero_pedido_compra',
    'quantidade_pedida', 'quantidade_recebida', 'quantidade_pendente', 'status_logistico'
  ]) assert.ok(reposicao.campos.includes(campo), campo);

  const faixa = avaliarFaixaSemantica({
    decisao: {
      dominioPrimario: 'reposicoes', dominiosSecundarios: ['catalogo'],
      intencao: 'listar', confianca: 0.62, transformacoesSolicitadas: [],
      riscoSemantico: 'baixo', necessidadeIntervencao: true
    },
    plano: { ferramentas: ['analisar_reposicoes'], rejeitadas: [], capacidadesAusentes: [] }
  });
  assert.equal(faixa.faixa, 'basica');
  assert.deepEqual(faixa.dominios, ['reposicoes']);
});

test('bloqueios e menor giro permanecem basicos e comparacao por marketplace e assistida', () => {
  const bloqueios = avaliarFaixaSemantica({
    decisao: {
      dominioPrimario: 'bloqueios_estoque', dominiosSecundarios: ['estoque', 'vendas'],
      intencao: 'agregar', confianca: 0.95, transformacoesSolicitadas: ['agrupar'],
      riscoSemantico: 'baixo', necessidadeIntervencao: false
    },
    plano: { ferramentas: ['consultar_bloqueios_sem_estoque'], rejeitadas: [], capacidadesAusentes: [] }
  });
  assert.equal(bloqueios.faixa, 'basica');
  const giro = avaliarFaixaSemantica({
    decisao: {
      dominioPrimario: 'estoque', dominiosSecundarios: [], intencao: 'ranquear',
      confianca: 0.9, transformacoesSolicitadas: ['ordenar'], riscoSemantico: 'baixo'
    },
    plano: { ferramentas: ['analisar_giro_estoque'], rejeitadas: [], capacidadesAusentes: [] }
  });
  assert.equal(giro.faixa, 'basica');
  const comparacao = avaliarFaixaSemantica({
    decisao: {
      dominioPrimario: 'influencias', dominiosSecundarios: [], intencao: 'comparar',
      confianca: 0.95, transformacoesSolicitadas: ['comparar_periodos'], riscoSemantico: 'baixo'
    },
    plano: { ferramentas: ['analisar_influencias'], rejeitadas: [], capacidadesAusentes: [] }
  });
  assert.equal(comparacao.faixa, 'assistida');
});

test('revisor ignora fallback, tarefa isolada, quota e validacao de argumento', () => {
  assert.equal(detectarSinaisAprendizado({ houveFallback: true }).elegivel, false);
  assert.equal(detectarSinaisAprendizado({ tarefaConcluida: true }).elegivel, false);
  const estadoQuota = criarEstadoExecucao({ modo: 'shadow' });
  const erroQuota = new Error('Rate limit'); erroQuota.code = 429;
  estadoQuota.falharTool('consulta_a', {}, erroQuota, { transitorio: true });
  estadoQuota.prepararTool('consulta_b', {});
  estadoQuota.concluirTool('consulta_b', {}, { ok: true });
  assert.equal(detectarSinaisAprendizado({ estadoExecucao: estadoQuota }).elegivel, false);

  const estadoValidacao = criarEstadoExecucao({ modo: 'shadow' });
  const erroArgumento = new Error('limite invalido'); erroArgumento.code = 'ARGUMENTO_INVALIDO';
  estadoValidacao.falharTool('consulta_a', {}, erroArgumento, { validacao: true });
  estadoValidacao.prepararTool('consulta_b', {});
  estadoValidacao.concluirTool('consulta_b', {}, { ok: true });
  assert.equal(detectarSinaisAprendizado({ estadoExecucao: estadoValidacao }).elegivel, false);
});

test('sintese que contradiz tool bem-sucedida cai na resposta corporativa preservada', async () => {
  const resultado = await executarAssistente('Compare meu faturamento por marketplace.', {
    auditoriaIA: false,
    memoria: { obterTarefaAtiva: async () => null, listarPreferencias: async () => [], sessao: 't' },
    generalistProvider: {
      nome: 'anthropic', modelo: 'mock',
      executar: async () => ({ texto: 'Não consegui consultar: a base está indisponível.' })
    },
    executarAgenteCorporativo: async () => ({
      texto: 'Marketplace A: R$ 100; Marketplace B: R$ 80.',
      roteamento: {
        perfilInicial: 'influencias', perfilEfetivo: 'influencias',
        ferramentasExecutadas: ['analisar_influencias'], respostaPronta: false,
        evidenciaFactual: {
          status: 'complete', manifesto: {
            identificadores: [], referencias: {}, datas: [], camposObrigatorios: [],
            valoresPorCampo: {}
          }
        }
      }
    })
  });
  assert.equal(resultado.texto, 'Marketplace A: R$ 100; Marketplace B: R$ 80.');
  assert.equal(resultado.corporateFallbackUsed, true);
  assert.equal(resultado.validacaoSintese.valida, false);
});
