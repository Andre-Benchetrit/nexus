const OpenAI = require('openai');
const { normalizarArgumentosPeloSchema, normalizarSchemaEstritoOpenAI } = require('./schema');
const { emitirCheckpoint } = require('./checkpoints');
const {
  estimarComposicaoInput,
  executarChamadaAuditada,
  normalizarUsageOpenAI
} = require('./telemetria');

const MODELO_PADRAO_OPENAI = 'gpt-5.6-luna';
const ESFORCOS_RACIOCINIO_OPENAI = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);

function converterToolParaOpenAI(definicao) {
  if (!definicao?.strict) return definicao;
  return { ...definicao, parameters: normalizarSchemaEstritoOpenAI(definicao.parameters) };
}

function criarProviderOpenAI(opcoes = {}) {
  const modelo = opcoes.modelo || process.env.OPENAI_MODEL || MODELO_PADRAO_OPENAI;
  const timeoutMs = Number(opcoes.timeoutMs || process.env.LLM_REQUEST_TIMEOUT_MS || 20_000);
  const reasoningEffort = String(
    opcoes.reasoningEffort || process.env.OPENAI_REASONING_EFFORT || 'low'
  ).toLowerCase();
  if (!ESFORCOS_RACIOCINIO_OPENAI.has(reasoningEffort)) {
    throw new Error(`OPENAI_REASONING_EFFORT invalido: ${reasoningEffort}.`);
  }
  let cliente = opcoes.cliente;

  function obterCliente() {
    if (cliente) return cliente;
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('Provider openai selecionado, mas OPENAI_API_KEY não foi definida.');
    }
    cliente = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: timeoutMs,
      maxRetries: 0
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
    const client = obterCliente();
    const input = mensagens?.length
      ? mensagens.map((item) => ({ role: item.role, content: item.content }))
      : [{ role: 'user', content: pergunta }];
    const ferramentas = Array.isArray(tools)
      ? tools
      : [{ definicao: definicaoTool, executar: executarTool, terminal: true }];
    let deveFinalizar = false;
    let houveTool = false;
    const resultadosParaAuditoria = [];
    for (let rodada = 0; rodada < maxRodadas; rodada += 1) {
      const ferramentasPorNome = new Map(
        ferramentas.map((ferramenta) => [ferramenta.definicao.name, ferramenta])
      );
      onEvento?.(`OpenAI: aguardando resposta da rodada ${rodada + 1}/${maxRodadas}...`);
      emitirCheckpoint(onCheckpoint, 'modelo_solicitado', {
        etapa: houveTool && stageFinal ? stageFinal : stage,
        provider: 'openai', rodada: rodada + 1
      });
      const auditada = await executarChamadaAuditada({
        telemetria, provider: 'openai', modelo,
        stage: houveTool && stageFinal ? stageFinal : stage,
        purpose, parentCallId: telemetria?.ultimoCallId || parentCallId,
        fallbackFromCallId,
        composicao: estimarComposicaoInput({
          instrucoes, pergunta, mensagens, tools: ferramentas,
          resultadosTools: resultadosParaAuditoria
        }),
        executar: () => client.responses.create({
          model: modelo,
          reasoning: { effort: reasoningEffort },
          instructions: instrucoes,
          ...(ferramentas.length ? {
            tools: ferramentas.map((ferramenta) => converterToolParaOpenAI(ferramenta.definicao)),
            tool_choice: deveFinalizar ? 'none' : 'auto'
          } : {}),
          input,
          store: false
        }),
        normalizarResposta: (resposta) => ({
          usage: normalizarUsageOpenAI(resposta.usage),
          responseId: resposta.id || null,
          stopReason: resposta.status || null
        })
      });
      const resposta = auditada.resposta;
      emitirCheckpoint(onCheckpoint, 'modelo_respondeu', {
        etapa: houveTool && stageFinal ? stageFinal : stage,
        provider: 'openai', rodada: rodada + 1,
        callId: auditada.callId, stopReason: resposta.status || null
      });

      input.push(...resposta.output);
      onEvento?.(`OpenAI: rodada ${rodada + 1} recebida.`);
      const chamadas = resposta.output.filter((item) => item.type === 'function_call');
      if (!chamadas.length) {
        emitirCheckpoint(onCheckpoint, 'provider_concluiu', {
          etapa: houveTool && stageFinal ? stageFinal : stage,
          provider: 'openai', rodada: rodada + 1, callId: auditada.callId
        });
        return {
          texto: resposta.output_text,
          provider: 'openai',
          modelo,
          rodadas: rodada + 1,
          responseId: resposta.id
        };
      }
      if (stage === 'generalist_response') {
        await telemetria?.atualizarEstagio?.(auditada.callId, 'generalist_decision');
      }

      for (const chamada of chamadas) {
        houveTool = true;
        let output;
        emitirCheckpoint(onCheckpoint, 'tool_sugerida', {
          etapa: stage, provider: 'openai', nome: chamada.name, callId: auditada.callId
        });
        try {
          const ferramenta = ferramentasPorNome.get(chamada.name);
          if (!ferramenta) throw new Error(`Tool desconhecida: ${chamada.name}`);
          const argumentos = normalizarArgumentosPeloSchema(
            JSON.parse(chamada.arguments), ferramenta.definicao.parameters
          );
          output = await ferramenta.executar(argumentos);
          emitirCheckpoint(onCheckpoint, 'tool_aceita', {
            etapa: stage, provider: 'openai', nome: chamada.name
          });
          const terminal = typeof ferramenta.terminal === 'function'
            ? ferramenta.terminal(argumentos, output)
            : ferramenta.terminal;
          if (terminal === true) deveFinalizar = true;
        } catch (erro) {
          output = JSON.stringify({ erro: erro.message });
          emitirCheckpoint(onCheckpoint, 'tool_rejeitada', {
            etapa: stage, provider: 'openai', nome: chamada.name,
            codigo: erro.codigo || erro.code || erro.name || 'ERRO_TOOL'
          });
        }
        input.push({
          type: 'function_call_output',
          call_id: chamada.call_id,
          output
        });
        resultadosParaAuditoria.push(output);
      }
      if (returnAfterTerminalTool && deveFinalizar) {
        emitirCheckpoint(onCheckpoint, 'provider_concluiu', {
          etapa: stage, provider: 'openai', rodada: rodada + 1,
          callId: auditada.callId, motivo: 'tool_terminal'
        });
        return {
          texto: resposta.output_text || '', provider: 'openai', modelo,
          rodadas: rodada + 1, responseId: resposta.id
        };
      }
    }

    emitirCheckpoint(onCheckpoint, 'provider_esgotou_rodadas', {
      etapa: stage, provider: 'openai', maxRodadas
    });
    const erro = new Error(`O provider openai excedeu ${maxRodadas} rodadas de tools.`);
    erro.codigo = 'MAX_RODADAS';
    throw erro;
  }

  return { nome: 'openai', modelo, reasoningEffort, executar };
}

module.exports = {
  criarProviderOpenAI,
  converterToolParaOpenAI,
  ESFORCOS_RACIOCINIO_OPENAI,
  MODELO_PADRAO_OPENAI
};
