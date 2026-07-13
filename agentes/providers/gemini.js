const MODELO_PADRAO_GEMINI = 'gemini-3.5-flash';

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
  // No Gemini, os campos opcionais podem simplesmente ser omitidos. Somente a
  // operação é universalmente obrigatória para esta tool.
  parameters.required = ['operacao'];
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
  let cliente = opcoes.cliente;

  async function obterCliente() {
    if (cliente) return cliente;
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('Provider gemini selecionado, mas GEMINI_API_KEY não foi definida.');
    }
    const { GoogleGenAI } = await import('@google/genai');
    cliente = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    return cliente;
  }

  async function executar({
    pergunta,
    instrucoes,
    definicaoTool,
    executarTool,
    maxRodadas
  }) {
    const client = await obterCliente();
    const declaracao = converterToolParaGemini(definicaoTool);
    const contents = [{ role: 'user', parts: [{ text: pergunta }] }];
    const config = {
      systemInstruction: instrucoes,
      tools: [{ functionDeclarations: [declaracao] }],
      toolConfig: {
        functionCallingConfig: { mode: 'VALIDATED' }
      }
    };

    for (let rodada = 0; rodada < maxRodadas; rodada += 1) {
      const resposta = await client.models.generateContent({
        model: modelo,
        contents,
        config
      });
      const conteudoModelo = resposta.candidates?.[0]?.content;
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
          if (chamada.name !== definicaoTool.name) {
            throw new Error(`Tool desconhecida: ${chamada.name}`);
          }
          output = await executarTool(chamada.args || {});
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
