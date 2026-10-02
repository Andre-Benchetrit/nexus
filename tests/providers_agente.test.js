const test = require('node:test');
const assert = require('node:assert/strict');

const { definicaoConsultarBronze } = require('../tools/consultar_bronze');
const { definicaoAgregarBronze } = require('../tools/agregar_bronze');
const { definicaoAnalisarVendas } = require('../tools/analisar_vendas');
const { definicaoConsultarDocumentacao } = require('../tools/consultar_documentacao');
const { definicaoAnalisarArquivo } = require('../tools/analisar_arquivo');
const { definicaoConsultarEvidenciaAnexo } = require('../tools/consultar_evidencia_anexo');
const { definicaoGerarArquivo } = require('../tools/gerar_arquivo');
const { definicaoGerarImagem } = require('../tools/gerar_imagem');
const { definicaoExportarResultado } = require('../tools/exportar_resultado');
const { criarRegistroFerramentas } = require('../agentes/ferramentas');
const {
  definicaoConsultarNexus,
  definicaoSolicitarRevisaoMemoria,
  definicaoPesquisarWeb,
  definicaoValidarPoliticas
} = require('../agentes/assistente_nexus');
const { definicaoRegistrarDecisaoRota } = require('../agentes/roteador_semantico');
const { definicaoRegistrarAvaliacao } = require('../agentes/revisor_memoria');
const { criarProviderOpenAI, converterToolParaOpenAI,
  serializarSaidaToolOpenAI } = require('../agentes/providers/openai');
const { auditarSchemaEstritoOpenAI } = require('../agentes/providers/schema');
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

test('OpenAI normaliza recursivamente schemas strict sem alterar o contrato interno', () => {
  const original = {
    type: 'function', name: 'teste', strict: true, description: 'teste',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        consulta: { type: 'string' },
        documento_id: { type: 'string' },
        opcoes: { type: 'object', properties: {
          limite: { type: 'integer' }, detalhe: { type: 'string' }
        }, required: ['limite'] }
      },
      required: ['consulta', 'opcoes']
    }
  };
  const convertido = converterToolParaOpenAI(original);
  assert.deepEqual(convertido.parameters.required.sort(), ['consulta', 'documento_id', 'opcoes']);
  assert.deepEqual(convertido.parameters.properties.documento_id.type, ['string', 'null']);
  assert.deepEqual(convertido.parameters.properties.opcoes.required.sort(), ['detalhe', 'limite']);
  assert.deepEqual(convertido.parameters.properties.opcoes.properties.detalhe.type, ['string', 'null']);
  assert.equal(convertido.parameters.properties.opcoes.additionalProperties, false);
  assert.deepEqual(original.parameters.required, ['consulta', 'opcoes']);
  assert.equal(original.parameters.properties.documento_id.type, 'string');
});

test('todas as tools do Nexus possuem contrato compativel com OpenAI strict', () => {
  const definicoesRegistro = [...criarRegistroFerramentas().values()]
    .map((ferramenta) => ferramenta.definicao);
  const definicoesDiretas = [
    definicaoConsultarNexus,
    definicaoSolicitarRevisaoMemoria,
    definicaoPesquisarWeb,
    definicaoValidarPoliticas,
    definicaoRegistrarDecisaoRota,
    definicaoRegistrarAvaliacao,
    definicaoAnalisarArquivo,
    definicaoConsultarEvidenciaAnexo,
    definicaoGerarArquivo,
    definicaoGerarImagem,
    definicaoExportarResultado
  ];
  const definicoes = [...new Map(
    [...definicoesRegistro, ...definicoesDiretas].map((item) => [item.name, item])
  ).values()];

  assert.equal(definicoes.length, 35);
  for (const definicao of definicoes) {
    const convertida = converterToolParaOpenAI(definicao);
    assert.deepEqual(
      auditarSchemaEstritoOpenAI(convertida.parameters), [],
      `Schema OpenAI invalido para ${definicao.name}`
    );
  }
});

test('OpenAI rejeita localmente schema livre antes de chamar a API', () => {
  assert.throws(() => converterToolParaOpenAI({
    type: 'function', name: 'schema_livre', description: 'invalida', strict: true,
    parameters: {
      type: 'object', properties: { valor: {} }, required: ['valor'],
      additionalProperties: false
    }
  }), (erro) => erro.codigo === 'OPENAI_TOOL_SCHEMA_INVALID' && /schema_livre/.test(erro.message));
  assert.throws(() => converterToolParaOpenAI({
    type: 'function', name: 'schema_allof', description: 'invalida', strict: true,
    parameters: {
      type: 'object', properties: {
        valor: { allOf: [{ type: 'string' }] }
      }, required: ['valor'], additionalProperties: false
    }
  }), (erro) => erro.codigo === 'OPENAI_TOOL_SCHEMA_INVALID' && /allOf/.test(erro.message));
});

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
  assert.equal(requisicoes[0].reasoning.effort, 'low');
  assert.equal(requisicoes[1].tool_choice, 'none');
  assert.ok(requisicoes[1].input.some((item) => (
    item.type === 'function_call_output' && item.call_id === 'call_1'
  )));
});

test('provider OpenAI força uma tool nomeada somente na primeira rodada', async () => {
  const requisicoes = [];
  const respostas = [
    { id: 'resp_forced_1', output_text: '', output: [{ type: 'function_call',
      name: 'gerar_imagem', call_id: 'call_forced_1', arguments: '{}' }] },
    { id: 'resp_forced_2', output_text: 'Imagem gerada.', output: [] }
  ];
  const provider = criarProviderOpenAI({ modelo: 'openai-teste', cliente: {
    responses: { async create(requisicao) { requisicoes.push(requisicao); return respostas.shift(); } }
  } });
  await provider.executar({ pergunta: 'Gere a imagem.', instrucoes: 'Use a tool.',
    tools: [{ definicao: definicaoMinima('gerar_imagem'), terminal: true,
      executar: async () => ({ id: 'imagem-1' }) }],
    toolChoice: 'gerar_imagem', maxRodadas: 3 });
  assert.deepEqual(requisicoes[0].tool_choice, { type: 'function', name: 'gerar_imagem' });
  assert.equal(requisicoes[1].tool_choice, 'none');
});

test('provider OpenAI rejeita escolha de tool que nao foi disponibilizada', async () => {
  const provider = criarProviderOpenAI({ modelo: 'openai-teste', cliente: {
    responses: { async create() { throw new Error('nao deveria chamar'); } }
  } });
  await assert.rejects(provider.executar({ pergunta: 'x', instrucoes: 'x', tools: [],
    toolChoice: 'gerar_imagem' }), (erro) => erro.codigo === 'TOOL_CHOICE_INVALID');
});

test('provider OpenAI serializa resultados estruturados antes de devolvê-los à Responses API', async () => {
  const requisicoes = [];
  const respostas = [
    { id: 'resp_obj_1', output_text: '', output: [{ type: 'function_call',
      name: 'consulta_objeto', call_id: 'call_obj_1', arguments: '{}' }] },
    { id: 'resp_obj_2', output_text: 'Documento encontrado.', output: [] }
  ];
  const cliente = { responses: { async create(requisicao) {
    requisicoes.push(requisicao); return respostas.shift();
  } } };
  const provider = criarProviderOpenAI({ cliente, modelo: 'openai-teste' });
  const resultado = await provider.executar({ pergunta: 'Consulte o documento.',
    instrucoes: 'Use a tool.', tools: [{ definicao: definicaoMinima('consulta_objeto'),
      terminal: true, executar: async () => ({ status: 'sucesso', resultados: [{ titulo: 'API' }] }) }],
    maxRodadas: 3 });
  const retornoTool = requisicoes[1].input.find((item) => item.type === 'function_call_output');
  assert.equal(typeof retornoTool.output, 'string');
  assert.deepEqual(JSON.parse(retornoTool.output), {
    status: 'sucesso', resultados: [{ titulo: 'API' }]
  });
  assert.equal(resultado.texto, 'Documento encontrado.');
  assert.equal(serializarSaidaToolOpenAI(undefined), 'null');
  assert.equal(serializarSaidaToolOpenAI({ total: 12n }), '{"total":"12"}');
});

test('provider OpenAI remove null artificial de campo opcional antes de executar a tool', async () => {
  const requisicoes = [];
  const respostas = [
    { id: 'resp_null_1', output_text: '', output: [{
      type: 'function_call', name: 'consultar_documentacao', call_id: 'call_null_1',
      arguments: JSON.stringify({
        consulta: 'endpoint de etiquetas', documento_id: null, limite: 5,
        analisar_visual: false
      })
    }] },
    { id: 'resp_null_2', output_text: 'Endpoint encontrado.', output: [] }
  ];
  const cliente = { responses: { async create(requisicao) {
    requisicoes.push(requisicao); return respostas.shift();
  } } };
  let argumentosExecutados;
  const provider = criarProviderOpenAI({ cliente, modelo: 'openai-teste' });
  await provider.executar({
    pergunta: 'Consulte.', instrucoes: 'Use a tool.',
    definicaoTool: definicaoConsultarDocumentacao,
    executarTool: async (argumentos) => {
      argumentosExecutados = argumentos;
      return { status: 'sucesso' };
    }
  });

  assert.deepEqual(argumentosExecutados, {
    consulta: 'endpoint de etiquetas', limite: 5, analisar_visual: false
  });
  assert.ok(requisicoes[0].tools[0].parameters.required.includes('documento_id'));
  assert.deepEqual(
    requisicoes[0].tools[0].parameters.properties.documento_id.type,
    ['string', 'null']
  );
});

test('provider OpenAI funciona sem tools e usa limite padrao de rodadas', async () => {
  const requisicoes = [];
  const provider = criarProviderOpenAI({
    cliente: { responses: { async create(requisicao) {
      requisicoes.push(requisicao);
      return { id: 'resp_sem_tools', output_text: 'Resposta direta.', output: [] };
    } } },
    modelo: 'openai-teste'
  });
  const resultado = await provider.executar({ pergunta: 'Oi', instrucoes: 'Responda.' });
  assert.equal(resultado.texto, 'Resposta direta.');
  assert.equal('tools' in requisicoes[0], false);
});

test('provider OpenAI aceita esforco de raciocinio especifico por funcao', async () => {
  const requisicoes = [];
  const cliente = { responses: { async create(requisicao) {
    requisicoes.push(requisicao);
    return { id: 'resp_medium', output_text: 'ok', output: [], status: 'completed' };
  } } };
  const provider = criarProviderOpenAI({
    cliente, modelo: 'openai-teste', reasoningEffort: 'medium'
  });

  const resultado = await provider.executar({
    pergunta: 'Explique de forma completa.', instrucoes: 'Responda.', tools: [], maxRodadas: 1
  });

  assert.equal(resultado.texto, 'ok');
  assert.equal(provider.reasoningEffort, 'medium');
  assert.equal(requisicoes[0].reasoning.effort, 'medium');
  assert.throws(() => criarProviderOpenAI({ cliente, reasoningEffort: 'invalido' }),
    /OPENAI_REASONING_EFFORT invalido/);
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
        requisicoes.push(structuredClone(requisicao));
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
    toolChoice: 'consultar_bronze', maxRodadas: 3
  });

  assert.equal(resultado.texto, 'Entidades disponíveis.');
  assert.equal(resultado.provider, 'gemini');
  assert.equal(requisicoes[0].config.toolConfig.functionCallingConfig.mode, 'ANY');
  assert.deepEqual(
    requisicoes[0].config.toolConfig.functionCallingConfig.allowedFunctionNames,
    ['consultar_bronze']
  );
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
