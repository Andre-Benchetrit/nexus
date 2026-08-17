const {
  estimarComposicaoInput,
  executarChamadaAuditada,
  normalizarUsageAnthropic
} = require('./telemetria');
const { normalizarArgumentosPeloSchema } = require('./schema');

function converterToolAnthropic(definicao) {
  return {
    name: definicao.name,
    description: definicao.description,
    input_schema: definicao.parameters
  };
}

function criarProviderAnthropic(opcoes = {}) {
  const modelo = opcoes.modelo || process.env.ANTHROPIC_MODEL || null;
  const timeoutMs = Number(opcoes.timeoutMs || process.env.LLM_REQUEST_TIMEOUT_MS || 20_000);
  const maxTokens = Number(opcoes.maxTokens || process.env.ANTHROPIC_MAX_OUTPUT_TOKENS || 4096);
  let cliente = opcoes.cliente;

  function obterCliente() {
    if (!modelo) throw new Error('Provider anthropic exige um modelo configurado.');
    if (cliente) return cliente;
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('Provider anthropic selecionado, mas ANTHROPIC_API_KEY nao foi definida.');
    }
    const Anthropic = require('@anthropic-ai/sdk');
    cliente = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: timeoutMs,
      maxRetries: 0
    });
    return cliente;
  }

  async function executar({
    pergunta,
    mensagens,
    instrucoes,
    tools,
    definicaoTool,
    executarTool,
    maxRodadas = 8,
    onEvento,
    telemetria,
    stage = 'business_reasoning',
    stageFinal,
    purpose = 'corporate_query',
    parentCallId = null,
    fallbackFromCallId = null
  }) {
    const client = obterCliente();
    const ferramentas = tools?.length
      ? tools
      : definicaoTool ? [{ definicao: definicaoTool, executar: executarTool, terminal: true }] : [];
    const messages = mensagens?.length
      ? mensagens.map((item) => ({ role: item.role, content: item.content }))
      : [{ role: 'user', content: pergunta }];
    let deveFinalizar = false;
    let houveTool = false;
    const resultadosParaAuditoria = [];

    for (let rodada = 0; rodada < maxRodadas; rodada += 1) {
      const ferramentasPorNome = new Map(ferramentas.map((item) => [item.definicao.name, item]));
      const definicoes = ferramentas.map((item) => converterToolAnthropic(item.definicao));
      const estagioAtual = houveTool && stageFinal ? stageFinal : stage;
      onEvento?.(`Anthropic: aguardando resposta da rodada ${rodada + 1}/${maxRodadas}...`);
      const auditada = await executarChamadaAuditada({
        telemetria,
        provider: 'anthropic',
        modelo,
        stage: estagioAtual,
        purpose,
        parentCallId: telemetria?.ultimoCallId || parentCallId,
        fallbackFromCallId,
        composicao: estimarComposicaoInput({
          instrucoes,
          pergunta: rodada === 0 ? pergunta : null,
          mensagens,
          tools: ferramentas,
          resultadosTools: resultadosParaAuditoria
        }),
        executar: () => client.messages.create({
          model: modelo,
          max_tokens: maxTokens,
          system: instrucoes,
          messages: structuredClone(messages),
          ...(definicoes.length ? {
            tools: definicoes,
            tool_choice: deveFinalizar ? { type: 'none' } : { type: 'auto' }
          } : {})
        }),
        normalizarResposta: (resposta) => ({
          usage: normalizarUsageAnthropic(resposta.usage),
          responseId: resposta.id || null,
          stopReason: resposta.stop_reason || null
        })
      });
      const resposta = auditada.resposta;
      onEvento?.(`Anthropic: rodada ${rodada + 1} recebida.`);
      const chamadas = (resposta.content || []).filter((item) => item.type === 'tool_use');
      messages.push({ role: 'assistant', content: resposta.content || [] });
      if (!chamadas.length) {
        return {
          texto: (resposta.content || []).filter((item) => item.type === 'text')
            .map((item) => item.text).join('\n'),
          provider: 'anthropic', modelo, rodadas: rodada + 1,
          responseId: resposta.id || null, stopReason: resposta.stop_reason || null
        };
      }
      if (stage === 'generalist_response') {
        await telemetria?.atualizarEstagio?.(auditada.callId, 'generalist_decision');
      }
      houveTool = true;
      const resultados = [];
      for (const chamada of chamadas) {
        let output;
        let isError = false;
        try {
          const ferramenta = ferramentasPorNome.get(chamada.name);
          if (!ferramenta) throw new Error(`Tool desconhecida: ${chamada.name}`);
          const argumentos = normalizarArgumentosPeloSchema(
            chamada.input || {}, ferramenta.definicao.parameters
          );
          output = await ferramenta.executar(argumentos);
          const terminal = typeof ferramenta.terminal === 'function'
            ? ferramenta.terminal(argumentos, output) : ferramenta.terminal;
          if (terminal === true) deveFinalizar = true;
        } catch (erro) {
          output = JSON.stringify({ erro: erro.message });
          isError = true;
        }
        resultados.push({
          type: 'tool_result', tool_use_id: chamada.id,
          content: typeof output === 'string' ? output : JSON.stringify(output),
          ...(isError ? { is_error: true } : {})
        });
        resultadosParaAuditoria.push(output);
      }
      messages.push({ role: 'user', content: resultados });
    }
    throw new Error(`O provider anthropic excedeu ${maxRodadas} rodadas de tools.`);
  }

  return { nome: 'anthropic', modelo, executar };
}

module.exports = { converterToolAnthropic, criarProviderAnthropic };
