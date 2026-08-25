const MODELO_PADRAO_GEMINI = 'gemini-3.5-flash-lite';
const { aceitaNulo, normalizarArgumentosPeloSchema } = require('./schema');
const {
  estimarComposicaoInput,
  executarChamadaAuditada,
  normalizarUsageGemini
} = require('./telemetria');
const { emitirCheckpoint } = require('./checkpoints');

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
  if (schema.required) {
    convertido.required = schema.required.filter((campo) => !aceitaNulo(schema.properties?.[campo]));
  }
  return convertido;
}

function converterToolParaGemini(definicaoTool) {
  const parameters = converterSchemaGemini(definicaoTool.parameters);
  // O schema do Gemini nao representa null da mesma forma que o JSON Schema.
  // Campos anulaveis ficam opcionais; os demais preservam o contrato original.
  parameters.required = (definicaoTool.parameters.required || []).filter((campo) => (
    !aceitaNulo(definicaoTool.parameters.properties?.[campo])
  ));
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
    onEvento,
    onCheckpoint,
    mensagens,
    telemetria,
    stage = 'business_reasoning',
    stageFinal,
    purpose = 'corporate_query',
    parentCallId = null,
    fallbackFromCallId = null,
    returnAfterTerminalTool = false
  }) {
    const client = await obterCliente();
    const ferramentas = Array.isArray(tools)
      ? tools
      : [{ definicao: definicaoTool, executar: executarTool, terminal: true }];
    const contents = mensagens?.length
      ? mensagens.map((item) => ({
          role: item.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: String(item.content) }]
        }))
      : [{ role: 'user', parts: [{ text: pergunta }] }];
    const config = { systemInstruction: instrucoes };
    let deveFinalizar = false;
    let houveTool = false;
    const resultadosParaAuditoria = [];

    for (let rodada = 0; rodada < maxRodadas; rodada += 1) {
      const ferramentasPorNome = new Map(
        ferramentas.map((ferramenta) => [ferramenta.definicao.name, ferramenta])
      );
      if (ferramentas.length) {
        config.tools = [{ functionDeclarations: ferramentas.map((ferramenta) => (
          converterToolParaGemini(ferramenta.definicao)
        )) }];
        config.toolConfig = {
          functionCallingConfig: { mode: deveFinalizar ? 'NONE' : 'VALIDATED' }
        };
      } else {
        delete config.tools;
        delete config.toolConfig;
      }
      onEvento?.(`Gemini: aguardando resposta da rodada ${rodada + 1}/${maxRodadas}...`);
      emitirCheckpoint(onCheckpoint, 'modelo_solicitado', {
        etapa: houveTool && stageFinal ? stageFinal : stage,
        provider: 'gemini', rodada: rodada + 1
      });
      const auditada = await executarChamadaAuditada({
        telemetria, provider: 'gemini', modelo,
        stage: houveTool && stageFinal ? stageFinal : stage,
        purpose, parentCallId: telemetria?.ultimoCallId || parentCallId,
        fallbackFromCallId,
        composicao: estimarComposicaoInput({
          instrucoes, pergunta, mensagens, tools: ferramentas,
          resultadosTools: resultadosParaAuditoria
        }),
        executar: () => client.models.generateContent({ model: modelo, contents, config }),
        normalizarResposta: (resposta) => ({
          usage: normalizarUsageGemini(resposta.usageMetadata),
          responseId: resposta.responseId || null,
          stopReason: resposta.candidates?.[0]?.finishReason || null
        })
      });
      const resposta = auditada.resposta;
      const conteudoModelo = resposta.candidates?.[0]?.content;
      emitirCheckpoint(onCheckpoint, 'modelo_respondeu', {
        etapa: houveTool && stageFinal ? stageFinal : stage,
        provider: 'gemini', rodada: rodada + 1, callId: auditada.callId,
        stopReason: resposta.candidates?.[0]?.finishReason || null
      });
      onEvento?.(`Gemini: rodada ${rodada + 1} recebida.`);
      if (conteudoModelo) contents.push(conteudoModelo);

      const chamadas = resposta.functionCalls || [];
      if (!chamadas.length) {
        emitirCheckpoint(onCheckpoint, 'provider_concluiu', {
          etapa: houveTool && stageFinal ? stageFinal : stage,
          provider: 'gemini', rodada: rodada + 1, callId: auditada.callId
        });
        return {
          texto: resposta.text || '',
          provider: 'gemini',
          modelo,
          rodadas: rodada + 1,
          responseId: resposta.responseId || null
        };
      }
      if (stage === 'generalist_response') {
        await telemetria?.atualizarEstagio?.(auditada.callId, 'generalist_decision');
      }

      const respostasDeFuncao = [];
      houveTool = true;
      for (const chamada of chamadas) {
        let output;
        emitirCheckpoint(onCheckpoint, 'tool_sugerida', {
          etapa: stage, provider: 'gemini', nome: chamada.name, callId: auditada.callId
        });
        try {
          const ferramenta = ferramentasPorNome.get(chamada.name);
          if (!ferramenta) throw new Error(`Tool desconhecida: ${chamada.name}`);
          const argumentos = normalizarArgumentosPeloSchema(
            chamada.args || {}, ferramenta.definicao.parameters
          );
          output = await ferramenta.executar(argumentos);
          emitirCheckpoint(onCheckpoint, 'tool_aceita', {
            etapa: stage, provider: 'gemini', nome: chamada.name
          });
          const terminal = typeof ferramenta.terminal === 'function'
            ? ferramenta.terminal(argumentos, output)
            : ferramenta.terminal;
          if (terminal === true) deveFinalizar = true;
        } catch (erro) {
          output = JSON.stringify({ erro: erro.message });
          emitirCheckpoint(onCheckpoint, 'tool_rejeitada', {
            etapa: stage, provider: 'gemini', nome: chamada.name,
            codigo: erro.codigo || erro.code || erro.name || 'ERRO_TOOL'
          });
        }
        respostasDeFuncao.push({
          functionResponse: {
            name: chamada.name,
            id: chamada.id,
            response: { result: interpretarResultadoTool(output) }
          }
        });
        resultadosParaAuditoria.push(output);
      }
      contents.push({ role: 'user', parts: respostasDeFuncao });
      if (returnAfterTerminalTool && deveFinalizar) {
        emitirCheckpoint(onCheckpoint, 'provider_concluiu', {
          etapa: stage, provider: 'gemini', rodada: rodada + 1,
          callId: auditada.callId, motivo: 'tool_terminal'
        });
        return {
          texto: resposta.text || '', provider: 'gemini', modelo,
          rodadas: rodada + 1, responseId: resposta.responseId || null
        };
      }
    }

    emitirCheckpoint(onCheckpoint, 'provider_esgotou_rodadas', {
      etapa: stage, provider: 'gemini', maxRodadas
    });
    const erro = new Error(`O provider gemini excedeu ${maxRodadas} rodadas de tools.`);
    erro.codigo = 'MAX_RODADAS';
    throw erro;
  }

  return { nome: 'gemini', modelo, executar };
}

module.exports = {
  criarProviderGemini,
  converterToolParaGemini,
  MODELO_PADRAO_GEMINI
};
