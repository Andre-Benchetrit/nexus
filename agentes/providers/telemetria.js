const CHAVES_USAGE_PERMITIDAS = new Set([
  'input_tokens', 'output_tokens', 'cache_read_input_tokens',
  'cache_creation_input_tokens', 'prompt_tokens', 'completion_tokens',
  'total_tokens', 'cached_tokens', 'promptTokenCount', 'candidatesTokenCount',
  'cachedContentTokenCount', 'thoughtsTokenCount', 'toolUsePromptTokenCount',
  'server_tool_use', 'input_tokens_details', 'output_tokens_details',
  'prompt_tokens_details', 'completion_tokens_details', 'reasoning_tokens'
]);

function inteiroOuNulo(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? Math.round(numero) : null;
}

function sanitizarUsageBruto(usage, permitirNumericos = false) {
  if (!usage || typeof usage !== 'object') return {};
  return Object.fromEntries(Object.entries(usage)
    .filter(([chave, valor]) => CHAVES_USAGE_PERMITIDAS.has(chave) || (
      permitirNumericos && (typeof valor === 'number' || (valor && typeof valor === 'object'))
    ))
    .map(([chave, valor]) => [chave, valor && typeof valor === 'object'
      ? sanitizarUsageBruto(valor, true)
      : valor]));
}

function normalizarUsageAnthropic(usage = {}) {
  const input = inteiroOuNulo(usage.input_tokens);
  return {
    inputTokens: input,
    uncachedInputTokens: input,
    outputTokens: inteiroOuNulo(usage.output_tokens),
    cacheReadTokens: inteiroOuNulo(usage.cache_read_input_tokens),
    cacheWriteTokens: inteiroOuNulo(usage.cache_creation_input_tokens),
    serviceUsage: usage.server_tool_use || {},
    raw: sanitizarUsageBruto(usage)
  };
}

function normalizarUsageOpenAI(usage = {}) {
  const input = inteiroOuNulo(usage.input_tokens ?? usage.prompt_tokens);
  const cached = inteiroOuNulo(
    usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens
  );
  return {
    inputTokens: input,
    uncachedInputTokens: input == null ? null : Math.max(0, input - (cached || 0)),
    outputTokens: inteiroOuNulo(usage.output_tokens ?? usage.completion_tokens),
    cacheReadTokens: cached,
    cacheWriteTokens: null,
    serviceUsage: {},
    raw: sanitizarUsageBruto(usage)
  };
}

function normalizarUsageGemini(usage = {}) {
  const input = inteiroOuNulo(usage.promptTokenCount);
  const cached = inteiroOuNulo(usage.cachedContentTokenCount);
  return {
    inputTokens: input,
    uncachedInputTokens: input == null ? null : Math.max(0, input - (cached || 0)),
    outputTokens: inteiroOuNulo(usage.candidatesTokenCount),
    cacheReadTokens: cached,
    cacheWriteTokens: null,
    serviceUsage: {},
    raw: sanitizarUsageBruto(usage)
  };
}

function estimarTokens(valor) {
  if (valor == null) return 0;
  const texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
  return Math.ceil(Buffer.byteLength(texto || '', 'utf8') / 4);
}

function estimarComposicaoInput({ instrucoes, pergunta, mensagens, tools, resultadosTools } = {}) {
  const historico = Array.isArray(mensagens) ? [...mensagens] : mensagens;
  if (Array.isArray(historico) && historico.length) {
    const ultima = historico.at(-1);
    if (ultima?.role === 'user' && String(ultima.content) === String(pergunta)) historico.pop();
  }
  return {
    instrucoes: estimarTokens(instrucoes),
    historico: estimarTokens(historico),
    usuario: estimarTokens(pergunta),
    schemas_capabilities: estimarTokens((tools || []).map((item) => item.definicao || item)),
    resultados_tools: estimarTokens(resultadosTools),
    metodo: 'bytes_utf8_divididos_por_4'
  };
}

async function executarChamadaAuditada({
  telemetria,
  provider,
  modelo,
  stage,
  purpose,
  parentCallId,
  fallbackFromCallId,
  composicao,
  executar,
  normalizarResposta
}) {
  async function concluirComTentativas(id, resultado) {
    let ultimoErro;
    for (let tentativa = 0; tentativa < 3; tentativa += 1) {
      try { return await telemetria.concluirChamada(id, resultado); }
      catch (erro) { ultimoErro = erro; }
    }
    const erro = new Error('Nao foi possivel concluir a auditoria da chamada LLM.', { cause: ultimoErro });
    erro.codigo = 'AUDITORIA_LLM_INCOMPLETA';
    throw erro;
  }
  const inicio = Date.now();
  let chamada = null;
  if (telemetria) {
    chamada = await telemetria.iniciarChamada({
      provider, modelo, stage, purpose, parentCallId, fallbackFromCallId, composicao
    });
  }
  let resposta;
  try {
    resposta = await executar();
  } catch (erro) {
    if (telemetria && chamada) {
      await concluirComTentativas(chamada.id, {
        duracaoMs: Date.now() - inicio,
        sucesso: false,
        erro
      });
      telemetria.ultimoCallId = chamada.id;
    }
    throw erro;
  }
  const normalizada = normalizarResposta(resposta);
  if (telemetria && chamada) {
    await concluirComTentativas(chamada.id, {
      ...normalizada,
      duracaoMs: Date.now() - inicio,
      sucesso: true
    });
    telemetria.ultimoCallId = chamada.id;
  }
  return { resposta, callId: chamada?.id || null, normalizada };
}

module.exports = {
  estimarComposicaoInput,
  executarChamadaAuditada,
  normalizarUsageAnthropic,
  normalizarUsageGemini,
  normalizarUsageOpenAI,
  sanitizarUsageBruto
};
