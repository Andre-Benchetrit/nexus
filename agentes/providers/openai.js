const OpenAI = require('openai');
const { normalizarArgumentosPeloSchema } = require('./schema');

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
    onEvento
  }) {
    const client = obterCliente();
    const input = [{ role: 'user', content: pergunta }];
    const ferramentas = tools?.length
      ? tools
      : [{ definicao: definicaoTool, executar: executarTool, terminal: true }];
    let deveFinalizar = false;
    for (let rodada = 0; rodada < maxRodadas; rodada += 1) {
      const ferramentasPorNome = new Map(
        ferramentas.map((ferramenta) => [ferramenta.definicao.name, ferramenta])
      );
      onEvento?.(`OpenAI: aguardando resposta da rodada ${rodada + 1}/${maxRodadas}...`);
      const resposta = await client.responses.create({
        model: modelo,
        reasoning: { effort: 'low' },
        instructions: instrucoes,
        tools: ferramentas.map((ferramenta) => ferramenta.definicao),
        tool_choice: deveFinalizar ? 'none' : 'auto',
        input,
        store: false
      });

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

      for (const chamada of chamadas) {
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
