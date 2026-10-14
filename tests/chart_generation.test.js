const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { construirGrafico, montarDadosGrafico,
  prepararLinhasGrafico } = require('../nexus/chart_builder');
const { FAMILIA_FONTE_CANVAS, registrarFontesCanvas } = require('../nexus/canvas_fonts');
const { intencaoGerarGrafico, intencaoCriarImagem,
  resultadoAnteriorDisponivelParaGrafico, executarAssistente } = require('../agentes/assistente_nexus');

const linhas = [
  { periodo: '2026-07', produto: 'Produto A', faturamento: 100 },
  { periodo: '2026-08', produto: 'Produto A', faturamento: 150 },
  { periodo: '2026-09', produto: 'Produto A', faturamento: 120 },
  { periodo: '2026-07', produto: 'Produto B', faturamento: 80 },
  { periodo: '2026-08', produto: 'Produto B', faturamento: 40 },
  { periodo: '2026-09', produto: 'Produto B', faturamento: 160 }
];

test('fonte do gráfico é incorporada e independe das fontes do sistema operacional', () => {
  assert.equal(registrarFontesCanvas(), FAMILIA_FONTE_CANVAS);
  assert.equal(FAMILIA_FONTE_CANVAS, 'Nexus Sans');
});

test('gráfico corporativo preserva séries e períodos do resultado estruturado', async () => {
  const grafico = construirGrafico(linhas, {
    tipo: 'linha', titulo: 'Evolução do faturamento', metrica: 'faturamento',
    dimensao: 'periodo', serie: 'produto', unidade: 'moeda', limite_series: 5
  });
  assert.deepEqual(grafico.dados.categorias, ['07/2026', '08/2026', '09/2026']);
  assert.deepEqual(grafico.dados.series.find((x) => x.nome === 'Produto A').valores, [100, 150, 120]);
  assert.deepEqual(grafico.dados.series.find((x) => x.nome === 'Produto B').valores, [80, 40, 160]);
  assert.equal(grafico.dados.rotuloMetrica, 'Faturamento');
  assert.equal(grafico.dados.periodo, '07/2026 a 09/2026');
  assert.equal(grafico.dados.resumo.total, 650);
  assert.equal(grafico.dados.resumo.primeiro, 180);
  assert.equal(grafico.dados.resumo.ultimo, 280);
  assert.equal(grafico.validacao.deterministic, true);
  assert.equal(grafico.validacao.selfContained, true);
  assert.equal(grafico.validacao.hasDataLabels, true);
  const metadados = await sharp(grafico.buffer).metadata();
  assert.equal(metadados.format, 'png');
  assert.equal(metadados.width, 1536);
  assert.equal(metadados.height, 1024);
});

test('variação é calculada localmente a partir do primeiro e último período', () => {
  const dados = montarDadosGrafico(linhas, {
    tipo: 'variacao', titulo: 'Variação', metrica: 'faturamento', dimensao: 'periodo',
    serie: 'produto', unidade: 'auto', limite_series: 5
  });
  assert.equal(dados.unidade, 'percentual');
  assert.equal(dados.series.find((x) => x.nome === 'Produto A').valores[0], 20);
  assert.equal(dados.series.find((x) => x.nome === 'Produto B').valores[0], 100);
});

test('manifesto converte grupo e cálculo genéricos em série mensal e preenche lacunas comprovadas', () => {
  const genericas = [
    { grupo_1: '2026-03-01T00:00:00.000Z', calculo_1: '4' },
    { grupo_1: '2026-04-01T00:00:00.000Z', calculo_1: '117' },
    { grupo_1: '2026-05-01T00:00:00.000Z', calculo_1: '449' },
    { grupo_1: '2026-06-01T00:00:00.000Z', calculo_1: '572' },
    { grupo_1: '2026-07-01T00:00:00.000Z', calculo_1: '1091' },
    { grupo_1: '2026-08-01T00:00:00.000Z', calculo_1: '1127' }
  ];
  const manifesto = { argumentos: {
    agrupamentos: [{ campo: 'data_referencia', granularidade: 'mes' }],
    calculos: [{ campo: 'quantidade_faturada', operacao: 'somar' }],
    filtros: [{ campo: 'data_referencia', operador: 'entre', valor: '2026-01-01',
      valor_final: '2026-08-31' }]
  } };
  const preparadas = prepararLinhasGrafico(genericas, manifesto);
  const dados = montarDadosGrafico(preparadas, { tipo: 'linha', metrica: 'quantidade_faturada',
    dimensao: 'periodo', serie: 'nenhuma', unidade: 'numero', titulo: 'Quantidade faturada' });
  assert.deepEqual(dados.categorias,
    ['01/2026', '02/2026', '03/2026', '04/2026', '05/2026', '06/2026', '07/2026', '08/2026']);
  assert.deepEqual(dados.series[0].valores, [0, 0, 4, 117, 449, 572, 1091, 1127]);
  assert.equal(dados.metrica, 'quantidade_faturada');
  assert.equal(dados.resumo.total, 3360);
});

test('pedido de gráfico corporativo não é confundido com imagem criativa', () => {
  const pedido = 'Gere um gráfico de linha comparando julho, agosto e setembro.';
  assert.equal(intencaoGerarGrafico(pedido), true);
  assert.equal(intencaoCriarImagem(pedido), false);
});

test('gráfico no automático reutiliza result_ref pronto sem abrir uma nova consulta corporativa', () => {
  const contexto = {
    pergunta: 'Agora gere um gráfico representando essa tabela.',
    modoFonte: 'automatico',
    modoDatasets: 'v1',
    referencia: { id: 'resultado-1', tipo: 'result_ref', status: 'ready' }
  };
  assert.equal(resultadoAnteriorDisponivelParaGrafico(contexto), true);
  assert.equal(resultadoAnteriorDisponivelParaGrafico({
    ...contexto, referencia: { ...contexto.referencia, status: 'expired' }
  }), false);
  assert.equal(resultadoAnteriorDisponivelParaGrafico({ ...contexto, modoFonte: 'dados' }), false);
  assert.equal(resultadoAnteriorDisponivelParaGrafico({
    ...contexto, pergunta: 'Qual foi a quantidade faturada?'
  }), false);
});

test('assistente força gerar_grafico antes do roteador corporativo quando já existe result_ref', async () => {
  let consultasCorporativas = 0;
  const resultado = await executarAssistente('Agora gere um gráfico representando essa tabela.', {
    memoria: { obterTarefaAtiva: async () => null, sessao: 'teste' },
    auditoriaIA: false,
    datasetsMode: 'v1',
    artifactsMode: 'v1',
    conversationId: 'conversa-1',
    servicoDatasets: {
      async listarRecentes() {
        return [
          { id: 'resultado-expirado', tipo: 'result_ref', status: 'expired' },
          { id: 'resultado-1', tipo: 'result_ref', status: 'ready',
            classificacao: 'dados_corporativos' }
        ];
      }
    },
    generalistProvider: {
      nome: 'mock', modelo: 'mock',
      async executar({ tools, toolChoice }) {
        assert.equal(toolChoice, 'gerar_grafico');
        assert.equal(tools.some((item) => item.definicao.name === 'gerar_grafico'), true);
        return { texto: 'Gráfico preparado.', provider: 'mock', modelo: 'mock' };
      }
    },
    async executarAgenteCorporativo() {
      consultasCorporativas += 1;
      return { texto: 'Não deveria ser chamado.' };
    }
  });
  assert.equal(consultasCorporativas, 0);
  assert.equal(resultado.proveniencia, 'dados_nexus');
});

test('assistente expõe result_ref como capability e força continuação analítica exata', async () => {
  let argumentosExecutados = null;
  const resultado = await executarAssistente(
    'Pode fazer a listagem desses pedidos separando por produto?', {
      memoria: { obterTarefaAtiva: async () => null, sessao: 'teste' },
      auditoriaIA: false,
      datasetsMode: 'v1',
      conversationId: 'conversa-1',
      servicoDatasets: {
        async listarRecentes() {
          return [{
            id: 'resultado-bloqueios', tipo: 'result_ref', status: 'ready',
            quantidadeLinhas: 30, classificacao: 'dados_corporativos',
            colunas: [
              { nome: 'marketplace_pedido' }, { nome: 'sku' },
              { nome: 'descricao_produto' }, { nome: 'quantidade_pedida' }
            ]
          }];
        }
      },
      generalistProvider: {
        nome: 'mock', modelo: 'mock',
        async executar({ tools, toolChoice, mensagens }) {
          assert.equal(toolChoice, 'consultar_resultado_nexus');
          const ferramenta = tools.find((item) =>
            item.definicao.name === 'consultar_resultado_nexus');
          assert.ok(ferramenta);
          assert.match(String(mensagens.at(-1).content), /resultado-bloqueios/);
          await ferramenta.executar({
            result_ref: 'inventado-pelo-modelo',
            operacao: 'agrupar', colunas: [],
            agrupar_por: ['sku', 'descricao_produto'],
            metricas: [{ operacao: 'contar_distintos', campo: 'marketplace_pedido' }],
            filtros: [], ordenar_por: 'contagem_distinta_marketplace_pedido',
            direcao: 'desc', limite: 50
          });
          return { texto: 'Agrupamento concluído com os cálculos locais.',
            provider: 'mock', modelo: 'mock' };
        }
      },
      async executarConsultarResultadoNexusTool(argumentos) {
        argumentosExecutados = argumentos;
        return {
          status: 'sucesso', operacao: 'agrupar', quantidade_linhas: 9,
          previa: [{ sku: 'SKU-A', contagem_distinta_marketplace_pedido: 12 }],
          result_ref: { id: 'resultado-agrupado', tipo: 'result_ref', status: 'ready' }
        };
      }
    }
  );
  assert.equal(argumentosExecutados.result_ref, 'resultado-bloqueios');
  assert.equal(resultado.proveniencia, 'dados_nexus');
  assert.equal(resultado.dataRefs.some((item) => item.id === 'resultado-agrupado'), true);
});

test('continuação preserva o agrupamento local quando somente a síntese do modelo falha', async () => {
  const resultado = await executarAssistente('Agrupe essa lista por produto, por favor.', {
    memoria: { obterTarefaAtiva: async () => null, sessao: 'teste' },
    auditoriaIA: false,
    datasetsMode: 'v1',
    conversationId: 'conversa-1',
    servicoDatasets: {
      async listarRecentes() {
        return [{ id: 'resultado-bloqueios', tipo: 'result_ref', status: 'ready',
          quantidadeLinhas: 32, classificacao: 'dados_corporativos',
          colunas: [{ nome: 'marketplace_pedido' }, { nome: 'descricao_produto' }] }];
      }
    },
    generalistProvider: {
      nome: 'mock', modelo: 'mock',
      async executar({ tools }) {
        const ferramenta = tools.find((item) => item.definicao.name === 'consultar_resultado_nexus');
        await ferramenta.executar({
          result_ref: 'ignorado', operacao: 'agrupar', colunas: [],
          agrupar_por: ['descricao_produto'],
          metricas: [{ operacao: 'contar_distintos', campo: 'marketplace_pedido' }],
          filtros: [], ordenar_por: 'contagem_distinta_marketplace_pedido',
          direcao: 'desc', limite: 50
        });
        const erro = new Error('créditos insuficientes durante a síntese');
        erro.codigo = 'PROVIDER_CREDITS_EXHAUSTED';
        throw erro;
      }
    },
    async executarConsultarResultadoNexusTool() {
      return {
        status: 'sucesso', operacao: 'agrupar', quantidade_linhas: 2,
        previa: [
          { descricao_produto: 'Produto A', contagem_distinta_marketplace_pedido: 20 },
          { descricao_produto: 'Produto B', contagem_distinta_marketplace_pedido: 12 }
        ],
        result_ref: { id: 'resultado-agrupado', tipo: 'result_ref', status: 'ready' }
      };
    }
  });
  assert.match(resultado.texto, /Produto A/);
  assert.match(resultado.texto, /20/);
  assert.doesNotMatch(resultado.texto, /undefined/);
  assert.equal(resultado.proveniencia, 'dados_nexus');
});
