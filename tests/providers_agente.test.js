const test = require('node:test');
const assert = require('node:assert/strict');

const { definicaoConsultarBronze } = require('../tools/consultar_bronze');
const { definicaoAgregarBronze } = require('../tools/agregar_bronze');
const { definicaoAnalisarVendas } = require('../tools/analisar_vendas');
const { criarProviderOpenAI } = require('../agentes/providers/openai');
const {
  criarProviderGemini,
  converterToolParaGemini
} = require('../agentes/providers/gemini');
const { criarProvider } = require('../agentes/providers');

function definicaoMinima(name) {
  return {
    type: 'function', name, description: name, strict: true,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }
  };
}

test('provider OpenAI executa a tool e devolve o resultado ao modelo', async () => {
  const requisicoes = [];
  const respostas = [
    {
      id: 'resp_1',
      output_text: '',
      output: [{
        type: 'function_call',
        name: 'consultar_bronze',
        call_id: 'call_1',
        arguments: JSON.stringify({ operacao: 'listar_entidades' })
      }]
    },
    {
      id: 'resp_2',
      output_text: 'Entidades disponíveis.',
      output: []
    }
  ];
  const cliente = {
    responses: {
      async create(requisicao) {
        requisicoes.push(requisicao);
        return respostas.shift();
      }
    }
  };
  const chamadasTool = [];
  const provider = criarProviderOpenAI({ cliente, modelo: 'openai-teste' });

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
  assert.equal(resultado.provider, 'openai');
  assert.deepEqual(chamadasTool, [{ operacao: 'listar_entidades' }]);
  assert.equal(requisicoes[0].tool_choice, 'auto');
  assert.equal(requisicoes[1].tool_choice, 'none');
  assert.ok(requisicoes[1].input.some((item) => (
    item.type === 'function_call_output' && item.call_id === 'call_1'
  )));
});

test('provider Gemini devolve a resposta da tool com o ID correto', async () => {
  const requisicoes = [];
  const respostas = [
    {
      candidates: [{
        content: {
          role: 'model',
          parts: [{ functionCall: { id: 'gem_call_1', name: 'consultar_bronze' } }]
        }
      }],
      functionCalls: [{
        id: 'gem_call_1',
        name: 'consultar_bronze',
        args: { operacao: 'listar_entidades' }
      }],
      text: ''
    },
    {
      candidates: [{ content: { role: 'model', parts: [{ text: 'Entidades disponíveis.' }] } }],
      functionCalls: [],
      text: 'Entidades disponíveis.',
      responseId: 'gem_resp_2'
    }
  ];
  const cliente = {
    models: {
      async generateContent(requisicao) {
        requisicoes.push(requisicao);
        return respostas.shift();
      }
    }
  };
  const provider = criarProviderGemini({ cliente, modelo: 'gemini-teste' });

  const resultado = await provider.executar({
    pergunta: 'Quais dados temos?',
    instrucoes: 'Use a tool.',
    definicaoTool: definicaoConsultarBronze,
    executarTool: async () => '[{"entidade":"cliente"}]',
    maxRodadas: 3
  });

  assert.equal(resultado.texto, 'Entidades disponíveis.');
  assert.equal(resultado.provider, 'gemini');
  const respostaTool = requisicoes[1].contents
    .flatMap((content) => content.parts)
    .find((part) => part.functionResponse);
  assert.equal(respostaTool.functionResponse.id, 'gem_call_1');
  assert.deepEqual(
    respostaTool.functionResponse.response.result,
    [{ entidade: 'cliente' }]
  );
  assert.equal(
    requisicoes[1].config.toolConfig.functionCallingConfig.mode,
    'NONE'
  );
});

test('provider OpenAI roteia múltiplas tools pelo nome', async () => {
  const cliente = {
    responses: {
      async create() {
        return {
          id: 'resp_multi',
          output_text: '',
          output: [{
            type: 'function_call',
            name: 'agregar_bronze',
            call_id: 'call_multi',
            arguments: '{}'
          }]
        };
      }
    }
  };
  let chamada = false;
  const provider = criarProviderOpenAI({ cliente, modelo: 'openai-teste' });
  await assert.rejects(
    provider.executar({
      pergunta: 'Agrupe por UF',
      instrucoes: 'Use tools.',
      tools: [
        { definicao: definicaoConsultarBronze, executar: async () => '{}' },
        {
          definicao: definicaoAgregarBronze,
          executar: async () => {
            chamada = true;
            throw new Error('parar-teste');
          }
        }
      ],
      maxRodadas: 1
    }),
    /excedeu 1 rodadas/
  );
  assert.equal(chamada, true);
});

test('converte o schema estrito para o formato opcional do Gemini', () => {
  const tool = converterToolParaGemini(definicaoConsultarBronze);
  assert.deepEqual(tool.parameters.required, ['operacao', 'filtros']);
  assert.equal(tool.parameters.type, 'OBJECT');
  assert.equal(tool.parameters.properties.entidade.type, 'STRING');
  assert.ok(!tool.parameters.properties.entidade.enum.includes(null));
  assert.equal(tool.parameters.properties.colunas.type, 'ARRAY');

  const agregacao = converterToolParaGemini(definicaoAgregarBronze);
  assert.deepEqual(agregacao.parameters.required, ['entidade', 'calculos', 'filtros']);

  const vendas = converterToolParaGemini(definicaoAnalisarVendas);
  assert.deepEqual(vendas.parameters.required, ['operacao', 'nivel', 'filtros']);
  assert.deepEqual(vendas.parameters.properties.filtros.items.required, ['campo', 'operador']);
});

test('OpenAI reconhece tools adicionadas durante o loop', async () => {
  const requisicoes = [];
  const respostas = [
    { id: '1', output_text: '', output: [{ type: 'function_call', name: 'gateway', call_id: 'g1', arguments: '{}' }] },
    { id: '2', output_text: '', output: [{ type: 'function_call', name: 'consulta_nova', call_id: 'c1', arguments: '{}' }] },
    { id: '3', output_text: 'ok', output: [] }
  ];
  const cliente = { responses: { async create(req) { requisicoes.push(req); return respostas.shift(); } } };
  const tools = [];
  tools.push({
    definicao: definicaoMinima('gateway'), terminal: false,
    executar: async () => {
      tools.push({ definicao: definicaoMinima('consulta_nova'), terminal: true, executar: async () => '{}' });
      return '{}';
    }
  });
  const resultado = await criarProviderOpenAI({ cliente }).executar({
    pergunta: 'x', instrucoes: 'x', tools, maxRodadas: 4
  });
  assert.equal(resultado.texto, 'ok');
  assert.deepEqual(requisicoes[0].tools.map((item) => item.name), ['gateway']);
  assert.deepEqual(requisicoes[1].tools.map((item) => item.name), ['gateway', 'consulta_nova']);
});

test('Gemini reconhece tools adicionadas durante o loop', async () => {
  const requisicoes = [];
  const respostas = [
    { candidates: [{ content: { role: 'model', parts: [] } }], functionCalls: [{ id: 'g1', name: 'gateway', args: {} }], text: '' },
    { candidates: [{ content: { role: 'model', parts: [] } }], functionCalls: [{ id: 'c1', name: 'consulta_nova', args: {} }], text: '' },
    { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }], functionCalls: [], text: 'ok' }
  ];
  const cliente = { models: { async generateContent(req) {
    requisicoes.push(structuredClone(req));
    return respostas.shift();
  } } };
  const tools = [];
  tools.push({
    definicao: definicaoMinima('gateway'), terminal: false,
    executar: async () => {
      tools.push({ definicao: definicaoMinima('consulta_nova'), terminal: true, executar: async () => '{}' });
      return '{}';
    }
  });
  const resultado = await criarProviderGemini({ cliente }).executar({
    pergunta: 'x', instrucoes: 'x', tools, maxRodadas: 4
  });
  assert.equal(resultado.texto, 'ok');
  assert.deepEqual(
    requisicoes[0].config.tools[0].functionDeclarations.map((item) => item.name),
    ['gateway']
  );
  assert.deepEqual(
    requisicoes[1].config.tools[0].functionDeclarations.map((item) => item.name),
    ['gateway', 'consulta_nova']
  );
});

test('seleciona provider explicitamente e rejeita nome desconhecido', () => {
  assert.equal(criarProvider({ nome: 'gemini', cliente: {} }).nome, 'gemini');
  assert.equal(criarProvider({ nome: 'openai', cliente: {} }).nome, 'openai');
  assert.throws(() => criarProvider({ nome: 'outro' }), /LLM_PROVIDER inválido/);
});
