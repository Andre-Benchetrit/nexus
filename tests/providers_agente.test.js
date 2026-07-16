const test = require('node:test');
const assert = require('node:assert/strict');

const { definicaoConsultarBronze } = require('../tools/consultar_bronze');
const { definicaoAgregarBronze } = require('../tools/agregar_bronze');
const { criarProviderOpenAI } = require('../agentes/providers/openai');
const {
  criarProviderGemini,
  converterToolParaGemini
} = require('../agentes/providers/gemini');
const { criarProvider } = require('../agentes/providers');

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
  assert.deepEqual(tool.parameters.required, ['operacao']);
  assert.equal(tool.parameters.type, 'OBJECT');
  assert.equal(tool.parameters.properties.entidade.type, 'STRING');
  assert.ok(!tool.parameters.properties.entidade.enum.includes(null));
  assert.equal(tool.parameters.properties.colunas.type, 'ARRAY');

  const agregacao = converterToolParaGemini(definicaoAgregarBronze);
  assert.deepEqual(agregacao.parameters.required, ['entidade', 'calculos']);
});

test('seleciona provider explicitamente e rejeita nome desconhecido', () => {
  assert.equal(criarProvider({ nome: 'gemini', cliente: {} }).nome, 'gemini');
  assert.equal(criarProvider({ nome: 'openai', cliente: {} }).nome, 'openai');
  assert.throws(() => criarProvider({ nome: 'outro' }), /LLM_PROVIDER inválido/);
});
