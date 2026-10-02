const OpenAI = require('openai');
const {
  normalizarArgumentosPeloSchema,
  normalizarSchemaEstritoOpenAI,
  removerNulosOpcionaisOpenAI,
  auditarSchemaEstritoOpenAI
} = require('./schema');
const { emitirCheckpoint } = require('./checkpoints');
const { validarToolChoice } = require('./tool_choice');
const {
  estimarComposicaoInput,
  executarChamadaAuditada,
  normalizarUsageOpenAI
} = require('./telemetria');

const MODELO_PADRAO_OPENAI = 'gpt-5.6-luna';
const ESFORCOS_RACIOCINIO_OPENAI = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);

function converterToolParaOpenAI(definicao) {
  if (!definicao?.strict) return definicao;
  if (definicao.type !== 'function' || !/^[A-Za-z0-9_-]{1,64}$/.test(definicao.name || '')) {
    const erro = new Error(`Definicao de function tool invalida: ${definicao.name || 'sem_nome'}.`);
    erro.codigo = 'OPENAI_TOOL_DEFINITION_INVALID';
    throw erro;
  }
  const convertida = {
    ...definicao,
    parameters: normalizarSchemaEstritoOpenAI(definicao.parameters)
  };
  const erros = auditarSchemaEstritoOpenAI(convertida.parameters);
  if (erros.length) {
    const erro = new Error(
      `Tool ${definicao.name || 'sem_nome'} incompativel com OpenAI strict: ${erros.join('; ')}`
    );
    erro.codigo = 'OPENAI_TOOL_SCHEMA_INVALID';
    throw erro;
  }
  return convertida;
}

function serializarSaidaToolOpenAI(valor) {
  if (typeof valor === 'string') return valor;
  if (valor === undefined) return 'null';
  try {
    const serializado = JSON.stringify(valor, (_, item) => (
      typeof item === 'bigint' ? item.toString() : item
    ));
    return typeof serializado === 'string' ? serializado : 'null';
  } catch (_) {
    return JSON.stringify({ erro: 'A tool retornou um resultado que não pôde ser serializado.' });
  }
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
    maxRodadas = 8,
    onEvento,
    onCheckpoint,
    mensagens,
    telemetria,
    stage = 'business_reasoning',
    stageFinal,
    purpose = 'corporate_query',
    parentCallId = null,
    fallbackFromCallId = null,
    returnAfterTerminalTool = false,
    toolChoice = null
  }) {
    const client = obterCliente();
    const input = mensagens?.length
      ? mensagens.map((item) => ({ role: item.role, content: item.content }))
      : [{ role: 'user', content: pergunta }];
    const ferramentas = Array.isArray(tools)
      ? tools
      : definicaoTool
        ? [{ definicao: definicaoTool, executar: executarTool, terminal: true }]
        : [];
    const toolEscolhida = validarToolChoice(toolChoice, ferramentas);
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
            tool_choice: deveFinalizar ? 'none'
              : !houveTool && toolEscolhida
                ? { type: 'function', name: toolEscolhida }
                : 'auto'
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
          const argumentosRecebidos = removerNulosOpcionaisOpenAI(
            JSON.parse(chamada.arguments), ferramenta.definicao.parameters
          );
          const argumentos = normalizarArgumentosPeloSchema(
            argumentosRecebidos, ferramenta.definicao.parameters
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
        const outputSerializado = serializarSaidaToolOpenAI(output);
        input.push({
          type: 'function_call_output',
          call_id: chamada.call_id,
          output: outputSerializado
        });
        resultadosParaAuditoria.push(outputSerializado);
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
  serializarSaidaToolOpenAI,
  ESFORCOS_RACIOCINIO_OPENAI,
  MODELO_PADRAO_OPENAI
};
