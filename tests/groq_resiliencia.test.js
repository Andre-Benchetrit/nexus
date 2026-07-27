const test = require('node:test');
const assert = require('node:assert/strict');

const { definicaoConsultarBronze } = require('../tools/consultar_bronze');
const { definicaoAnalisarVendas } = require('../tools/analisar_vendas');
const { definicaoAnalisarIndicadores } = require('../tools/analisar_indicadores');
const { definicaoAnalisarFrete } = require('../tools/analisar_frete');
const { criarProvider } = require('../agentes/providers');
const { criarProviderGroq, converterTools } = require('../agentes/providers/groq');
const { criarProviderResiliente } = require('../agentes/providers/resiliente');
const { normalizarArgumentosPeloSchema } = require('../agentes/providers/schema');
const { lerArgumentos } = require('../agentes/consultor_nexus');

test('provider Groq executa uma tool pelo Chat Completions', async () => {
  const requisicoes = [];
  const respostas = [
    {
      id: 'groq_1',
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_groq_1',
            type: 'function',
            function: {
              name: 'consultar_bronze',
              arguments: JSON.stringify({ operacao: 'listar_entidades' })
            }
          }]
        }
      }]
    },
    {
      id: 'groq_2',
      choices: [{ message: { role: 'assistant', content: 'Entidades disponíveis.' } }]
    }
  ];
  const cliente = {
    chat: {
      completions: {
        async create(requisicao) {
          requisicoes.push(requisicao);
          return respostas.shift();
        }
      }
    }
  };
  const chamadasTool = [];
  const provider = criarProviderGroq({ cliente, modelo: 'groq-teste' });

  const resultado = await provider.executar({
    pergunta: 'Quais dados temos?',
    instrucoes: 'Use a tool.',
    definicaoTool: definicaoConsultarBronze,
    executarTool: async (args) => {
      chamadasTool.push(args);
      return '[{"entidade":"cliente"}]';
    },
    maxRodadas: 3
  });

  assert.equal(resultado.texto, 'Entidades disponíveis.');
  assert.equal(resultado.provider, 'groq');
  assert.deepEqual(chamadasTool, [{ operacao: 'listar_entidades' }]);
  assert.equal(requisicoes[0].tools[0].function.name, 'consultar_bronze');
  assert.equal(requisicoes[0].tool_choice, 'auto');
  assert.equal(requisicoes[1].tool_choice, 'none');
  assert.equal(requisicoes[1].messages.at(-1).tool_call_id, 'call_groq_1');
});

test('converte tools para o formato Chat Completions do Groq', () => {
  const [tool, vendas, indicadores, frete] = converterTools([
    definicaoConsultarBronze,
    definicaoAnalisarVendas,
    definicaoAnalisarIndicadores,
    definicaoAnalisarFrete
  ]);
  assert.equal(tool.type, 'function');
  assert.equal(tool.function.name, 'consultar_bronze');
  assert.equal(tool.function.parameters.type, 'object');
  assert.deepEqual(tool.function.parameters.required, ['operacao', 'filtros']);
  assert.deepEqual(vendas.function.parameters.required, ['operacao', 'nivel', 'filtros']);
  assert.deepEqual(
    vendas.function.parameters.properties.filtros.items.required,
    ['campo', 'operador']
  );
  assert.deepEqual(
    indicadores.function.parameters.properties.limite.type,
    ['integer', 'string']
  );
  assert.deepEqual(
    indicadores.function.parameters.properties.metricas.anyOf[0].type,
    ['array', 'string']
  );
  assert.deepEqual(
    frete.function.parameters.properties.agrupar_por.type,
    ['string', 'null']
  );
  assert.equal(frete.function.parameters.properties.agrupar_por.enum, undefined);
  assert.ok(!frete.function.parameters.required.includes('agrupar_por'));
});

test('normaliza numero textual do Groq antes de executar a tool', async () => {
  const respostas = [
    {
      id: 'groq_tipo_1',
      choices: [{
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_tipo_1',
            type: 'function',
            function: {
              name: 'analisar_indicadores',
              arguments: JSON.stringify({
                operacao: 'comparar',
                metricas: ['faturamento_emitido'],
                data_inicial: '2026-06-22',
                data_final: '2026-07-21',
                limite: '31'
              })
            }
          }]
        }
      }]
    },
    {
      id: 'groq_tipo_2',
      choices: [{ message: { role: 'assistant', content: 'Comparacao concluida.' } }]
    }
  ];
  const cliente = {
    chat: { completions: { async create() { return respostas.shift(); } } }
  };
  let argumentosExecutados;
  const provider = criarProviderGroq({ cliente, modelo: 'groq-teste' });
  await provider.executar({
    pergunta: 'Compare os periodos.',
    instrucoes: 'Use a tool.',
    definicaoTool: definicaoAnalisarIndicadores,
    executarTool: async (argumentos) => {
      argumentosExecutados = argumentos;
      return '{}';
    },
    maxRodadas: 2
  });

  assert.equal(argumentosExecutados.limite, 31);
  assert.equal(typeof argumentosExecutados.limite, 'number');
});

test('normaliza texto null do Groq em campos opcionais', () => {
  assert.equal(
    normalizarArgumentosPeloSchema(
      'null',
      definicaoAnalisarFrete.parameters.properties.id_empresa
    ),
    null
  );
});

test('normaliza lista textual ou sentinela do Groq', () => {
  const schema = definicaoAnalisarIndicadores.parameters.properties.metricas;
  assert.deepEqual(
    normalizarArgumentosPeloSchema('faturamento_emitido', schema),
    ['faturamento_emitido']
  );
  assert.equal(normalizarArgumentosPeloSchema('todas', schema), null);
});

test('seleciona Groq explicitamente', () => {
  assert.equal(criarProvider({ nome: 'groq', cliente: {}, semFallback: true }).nome, 'groq');
});

test('quota troca imediatamente para o fallback sem insistir no provider primário', async () => {
  let chamadasPrimario = 0;
  const primario = {
    nome: 'gemini',
    modelo: 'gemini-teste',
    async executar() {
      chamadasPrimario += 1;
      const erro = new Error('quota exceeded');
      erro.status = 429;
      throw erro;
    }
  };
  const fallback = {
    nome: 'groq',
    modelo: 'groq-teste',
    async executar() {
      return { texto: 'Resposta alternativa', provider: 'groq', modelo: 'groq-teste' };
    }
  };
  const provider = criarProviderResiliente(primario, fallback, {
    tentativasExtras: 2,
    esperar: async () => {}
  });

  const resultado = await provider.executar({ pergunta: 'teste' });

  assert.equal(chamadasPrimario, 1);
  assert.equal(resultado.provider, 'groq');
  assert.equal(resultado.fallbackDe, 'gemini');
  assert.equal(resultado.fallbackMotivo, '429');
});

test('erro 503 tenta novamente antes de acionar o fallback', async () => {
  let chamadasPrimario = 0;
  let esperas = 0;
  const primario = {
    nome: 'gemini',
    modelo: 'gemini-teste',
    async executar() {
      chamadasPrimario += 1;
      const erro = new Error('high demand');
      erro.status = 503;
      throw erro;
    }
  };
  const fallback = {
    nome: 'groq',
    modelo: 'groq-teste',
    async executar() {
      return { texto: 'Resposta alternativa', provider: 'groq', modelo: 'groq-teste' };
    }
  };
  const provider = criarProviderResiliente(primario, fallback, {
    tentativasExtras: 1,
    atrasoMs: 0,
    esperar: async () => { esperas += 1; }
  });

  const resultado = await provider.executar({ pergunta: 'teste' });

  assert.equal(chamadasPrimario, 2);
  assert.equal(esperas, 1);
  assert.equal(resultado.provider, 'groq');
});

test('mensagem Service Unavailable aciona o fallback mesmo sem codigo HTTP', async () => {
  let chamadasPrimario = 0;
  let chamadasFallback = 0;
  const provider = criarProviderResiliente(
    {
      nome: 'gemini',
      modelo: 'gemini-teste',
      async executar() {
        chamadasPrimario += 1;
        throw new Error('Retryable HTTP Error: Service Unavailable');
      }
    },
    {
      nome: 'groq',
      modelo: 'groq-teste',
      async executar() {
        chamadasFallback += 1;
        return { texto: 'Resposta Groq', provider: 'groq', modelo: 'groq-teste' };
      }
    },
    { tentativasExtras: 1, atrasoMs: 0, esperar: async () => {} }
  );

  const resultado = await provider.executar({ pergunta: 'teste' });

  assert.equal(chamadasPrimario, 2);
  assert.equal(chamadasFallback, 1);
  assert.equal(resultado.provider, 'groq');
  assert.equal(resultado.fallbackDe, 'gemini');
});

test('Client Closed Request do Gemini aciona o fallback', async () => {
  let chamadasFallback = 0;
  const provider = criarProviderResiliente(
    {
      nome: 'gemini',
      modelo: 'gemini-teste',
      async executar() {
        throw new Error('Non-retryable exception Client Closed Request sending request');
      }
    },
    {
      nome: 'groq',
      modelo: 'groq-teste',
      async executar() {
        chamadasFallback += 1;
        return { texto: 'Resposta Groq', provider: 'groq', modelo: 'groq-teste' };
      }
    },
    { tentativasExtras: 0 }
  );

  const resultado = await provider.executar({ pergunta: 'teste' });

  assert.equal(chamadasFallback, 1);
  assert.equal(resultado.provider, 'groq');
  assert.equal(resultado.fallbackDe, 'gemini');
});

test('erro de configuração não é escondido pelo fallback', async () => {
  let fallbackChamado = false;
  const provider = criarProviderResiliente(
    {
      nome: 'gemini',
      modelo: 'gemini-teste',
      async executar() {
        const erro = new Error('API key inválida');
        erro.status = 401;
        throw erro;
      }
    },
    {
      nome: 'groq',
      modelo: 'groq-teste',
      async executar() { fallbackChamado = true; }
    }
  );

  await assert.rejects(provider.executar({ pergunta: 'teste' }), /API key inválida/);
  assert.equal(fallbackChamado, false);
});

test('lê as opções de fallback pela linha de comando', () => {
  assert.deepEqual(
    lerArgumentos([
      '--provider', 'gemini',
      '--fallback-provider', 'groq',
      '--fallback-model', 'llama-teste',
      '--no-fallback',
      'Pergunta'
    ]),
    {
      pergunta: 'Pergunta',
      opcoes: {
        providerNome: 'gemini',
        fallbackNome: 'groq',
        modeloFallback: 'llama-teste',
        semFallback: true
      }
    }
  );
});

test('lê e valida o timeout pela linha de comando', () => {
  assert.deepEqual(
    lerArgumentos(['--timeout', '30000', 'Pergunta']),
    { pergunta: 'Pergunta', opcoes: { timeoutMs: 30000 } }
  );
  assert.throws(
    () => lerArgumentos(['--timeout', 'zero', 'Pergunta']),
    /--timeout deve ser um inteiro/
  );
});
