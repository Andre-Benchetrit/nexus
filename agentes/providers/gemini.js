const MODELO_PADRAO_GEMINI = 'gemini-3.1-flash-lite';

function converterSchemaGemini(schema) {
  if (!schema || typeof schema !== 'object') return schema;

  if (schema.anyOf) {
    const opcao = schema.anyOf.find((item) => item.type !== 'null');
    return converterSchemaGemini({ ...opcao, description: schema.description || opcao?.description });
  }

  const convertido = {};
  if (schema.type) {

    const tipo = Array.isArray(schema.type)
      ? schema.type.find((tipo) => tipo !== 'null')
      : schema.type;
    convertido.type = String(tipo).toUpperCase();
  }
  if (schema.description) convertido.description = schema.description;
  if (schema.enum) convertido.enum = schema.enum.filter((valor) => valor !== null);
  if (schema.minimum !== undefined) convertido.minimum = schema.minimum;
  if (schema.maximum !== undefined) convertido.maximum = schema.maximum;
  if (schema.items) convertido.items = converterSchemaGemini(schema.items);
  if (schema.properties) {
    convertido.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([nome, valor]) => [nome, converterSchemaGemini(valor)])
    );
  }
  if (schema.required) convertido.required = schema.required;
  return convertido;
}

function converterToolParaGemini(definicaoTool) {
  const parameters = converterSchemaGemini(definicaoTool.parameters);
  // No Gemini, campos opcionais podem ser omitidos. Mantemos somente os campos
  // essenciais que realmente existem no contrato de cada tool.
  parameters.required = parameters.properties?.operacao
    ? ['operacao']
    : ['entidade', 'calculos'].filter((campo) => parameters.properties?.[campo]);
  return {
    name: definicaoTool.name,
    description: definicaoTool.description,
    parameters
  };
}

function interpretarResultadoTool(output) {
  try {
    return JSON.parse(output);
  } catch (_) {
    return { texto: String(output) };
  }
}

function criarProviderGemini(opcoes = {}) {
  const modelo = opcoes.modelo || process.env.GEMINI_MODEL || MODELO_PADRAO_GEMINI;
  const timeoutMs = Number(opcoes.timeoutMs || process.env.LLM_REQUEST_TIMEOUT_MS || 20_000);
  let cliente = opcoes.cliente;

  async function obterCliente() {
    if (cliente) return cliente;
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('Provider gemini selecionado, mas GEMINI_API_KEY não foi definida.');
    }
    const { GoogleGenAI } = await import('@google/genai');
    cliente = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        timeout: timeoutMs,
        retryOptions: { attempts: 1 }
      }
    });
    return cliente;
  }

  async function executar({
    pergunta,
    instrucoes,
    tools,
    definicaoTool,
    executarTool,
    maxRodadas,
    onEvento
  }) {
    const client = await obterCliente();
    const ferramentas = tools?.length
      ? tools
      : [{ definicao: definicaoTool, executar: executarTool }];
    const ferramentasPorNome = new Map(
      ferramentas.map((ferramenta) => [ferramenta.definicao.name, ferramenta])
    );
    const declaracoes = ferramentas.map((ferramenta) => (
      converterToolParaGemini(ferramenta.definicao)
    ));
    const contents = [{ role: 'user', parts: [{ text: pergunta }] }];
    const config = {
      systemInstruction: instrucoes,
      tools: [{ functionDeclarations: declaracoes }],
      toolConfig: {
        functionCallingConfig: { mode: 'VALIDATED' }
      }
    };

    for (let rodada = 0; rodada < maxRodadas; rodada += 1) {
      onEvento?.(`Gemini: aguardando resposta da rodada ${rodada + 1}/${maxRodadas}...`);
      const resposta = await client.models.generateContent({
        model: modelo,
        contents,
        config
      });
      const conteudoModelo = resposta.candidates?.[0]?.content;
      onEvento?.(`Gemini: rodada ${rodada + 1} recebida.`);
      if (conteudoModelo) contents.push(conteudoModelo);

      const chamadas = resposta.functionCalls || [];
      if (!chamadas.length) {
        return {
          texto: resposta.text || '',
          provider: 'gemini',
          modelo,
          rodadas: rodada + 1,
          responseId: resposta.responseId || null
        };
      }

      const respostasDeFuncao = [];
      for (const chamada of chamadas) {
        let output;
        try {
          const ferramenta = ferramentasPorNome.get(chamada.name);
          if (!ferramenta) throw new Error(`Tool desconhecida: ${chamada.name}`);
          output = await ferramenta.executar(chamada.args || {});
        } catch (erro) {
          output = JSON.stringify({ erro: erro.message });
        }
        respostasDeFuncao.push({
          functionResponse: {
            name: chamada.name,
            id: chamada.id,
            response: { result: interpretarResultadoTool(output) }
          }
        });
      }
      contents.push({ role: 'user', parts: respostasDeFuncao });
    }

    throw new Error(`O provider gemini excedeu ${maxRodadas} rodadas de tools.`);
  }

  return { nome: 'gemini', modelo, executar };
}

module.exports = {
  criarProviderGemini,
  converterToolParaGemini,
  MODELO_PADRAO_GEMINI
};
