const OpenAI = require('openai');
const { normalizarArgumentosPeloSchema } = require('./schema');
const {
  estimarComposicaoInput,
  executarChamadaAuditada,
  normalizarUsageOpenAI
} = require('./telemetria');

const MODELO_PADRAO_OPENAI = 'gpt-5.6-luna';

function criarProviderOpenAI(opcoes = {}) {
  const modelo = opcoes.modelo || process.env.OPENAI_MODEL || MODELO_PADRAO_OPENAI;
  const timeoutMs = Number(opcoes.timeoutMs || process.env.LLM_REQUEST_TIMEOUT_MS || 20_000);
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
    mensagens,
    telemetria,
    stage = 'business_reasoning',
    stageFinal,
    purpose = 'corporate_query',
    parentCallId = null,
    fallbackFromCallId = null
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
          reasoning: { effort: 'low' },
          instructions: instrucoes,
          ...(ferramentas.length ? {
            tools: ferramentas.map((ferramenta) => ferramenta.definicao),
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

      input.push(...resposta.output);
      onEvento?.(`OpenAI: rodada ${rodada + 1} recebida.`);
      const chamadas = resposta.output.filter((item) => item.type === 'function_call');
      if (!chamadas.length) {
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
        try {
          const ferramenta = ferramentasPorNome.get(chamada.name);
          if (!ferramenta) throw new Error(`Tool desconhecida: ${chamada.name}`);
          const argumentos = normalizarArgumentosPeloSchema(
            JSON.parse(chamada.arguments), ferramenta.definicao.parameters
          );
          output = await ferramenta.executar(argumentos);
          const terminal = typeof ferramenta.terminal === 'function'
            ? ferramenta.terminal(argumentos, output)
            : ferramenta.terminal;
          if (terminal === true) deveFinalizar = true;
        } catch (erro) {
          output = JSON.stringify({ erro: erro.message });
        }
        input.push({
          type: 'function_call_output',
          call_id: chamada.call_id,
          output
        });
        resultadosParaAuditoria.push(output);
      }
    }

    throw new Error(`O provider openai excedeu ${maxRodadas} rodadas de tools.`);
  }

  return { nome: 'openai', modelo, executar };
}

module.exports = {
  criarProviderOpenAI,
  MODELO_PADRAO_OPENAI
};
