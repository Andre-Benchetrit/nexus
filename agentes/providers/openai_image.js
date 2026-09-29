const OpenAI = require('openai');

class ErroProviderImagem extends Error {
  constructor(codigo, mensagem, status = 502) {
    super(mensagem); this.name = 'ErroProviderImagem'; this.codigo = codigo; this.status = status;
  }
}

function normalizarUsage(usage = {}) {
  return {
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
    raw: usage
  };
}

function resolverTimeoutImagem(opcoes = {}) {
  const configurado = Number(opcoes.timeoutMs ?? process.env.NEXUS_IMAGE_REQUEST_TIMEOUT_MS ??
    process.env.LLM_REQUEST_TIMEOUT_MS ?? 120_000);
  return Number.isFinite(configurado) && configurado > 0 ? configurado : 120_000;
}

function criarProviderImagemOpenAI(opcoes = {}) {
  let cliente = opcoes.cliente;
  const timeoutMs = resolverTimeoutImagem(opcoes);
  const mainlineModel = opcoes.mainlineModel || process.env.OPENAI_MODEL || 'gpt-5.6-luna';
  const generationModel = opcoes.generationModel || process.env.NEXUS_IMAGE_GENERATION_MODEL || 'gpt-image-2.5-flare';
  const editModel = opcoes.editModel || process.env.NEXUS_IMAGE_EDIT_MODEL || 'gpt-image-2.5-sunburst';
  function obterCliente() {
    if (cliente) return cliente;
    if (!process.env.OPENAI_API_KEY) {
      throw new ErroProviderImagem('OPENAI_API_KEY_REQUIRED', 'A chave do provider de imagens não foi configurada.', 503);
    }
    cliente = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: timeoutMs, maxRetries: 0 });
    return cliente;
  }

  async function executar({ prompt, action = 'generate', inputImage = null, size = '1024x1024', quality = 'medium' }) {
    const model = action === 'edit' ? editModel : generationModel;
    const content = [{ type: 'input_text', text: String(prompt || '') }];
    if (inputImage) content.push({ type: 'input_image', image_url: `data:image/png;base64,${inputImage.toString('base64')}` });
    let resposta;
    try {
      resposta = await obterCliente().responses.create({
        model: mainlineModel,
        input: [{ role: 'user', content }],
        tools: [{ type: 'image_generation', model, action, size, quality, output_format: 'png' }],
        tool_choice: { type: 'image_generation' },
        store: false
      });
    } catch (cause) {
      const erro = new ErroProviderImagem('IMAGE_PROVIDER_ERROR', 'O provider não conseguiu gerar a imagem.');
      erro.cause = cause; throw erro;
    }
    const chamada = (resposta.output || []).find((item) => item.type === 'image_generation_call' && item.result);
    if (!chamada) throw new ErroProviderImagem('IMAGE_PROVIDER_EMPTY', 'O provider não retornou uma imagem válida.');
    const buffer = Buffer.from(chamada.result, 'base64');
    if (!buffer.length) throw new ErroProviderImagem('IMAGE_PROVIDER_EMPTY', 'O provider retornou uma imagem vazia.');
    return { buffer, provider: 'openai', model, responseId: resposta.id || null,
      revisedPrompt: chamada.revised_prompt || null, usage: normalizarUsage(resposta.usage) };
  }

  return { nome: 'openai', mainlineModel, generationModel, editModel, timeoutMs, executar };
}

module.exports = { ErroProviderImagem, criarProviderImagemOpenAI, normalizarUsage,
  resolverTimeoutImagem };
