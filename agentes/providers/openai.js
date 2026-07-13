const OpenAI = require('openai');

const MODELO_PADRAO_OPENAI = 'gpt-5.6-luna';

function criarProviderOpenAI(opcoes = {}) {
  const modelo = opcoes.modelo || process.env.OPENAI_MODEL || MODELO_PADRAO_OPENAI;
  let cliente = opcoes.cliente;

  function obterCliente() {
    if (cliente) return cliente;
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('Provider openai selecionado, mas OPENAI_API_KEY não foi definida.');
    }
    cliente = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return cliente;
  }

  async function executar({
    pergunta,
    instrucoes,
    definicaoTool,
    executarTool,
    maxRodadas
  }) {
    const client = obterCliente();
    const input = [{ role: 'user', content: pergunta }];

    for (let rodada = 0; rodada < maxRodadas; rodada += 1) {
      const resposta = await client.responses.create({
        model: modelo,
        reasoning: { effort: 'low' },
        instructions: instrucoes,
        tools: [definicaoTool],
        input,
        store: false
      });

      input.push(...resposta.output);
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
          if (chamada.name !== definicaoTool.name) {
            throw new Error(`Tool desconhecida: ${chamada.name}`);
          }
          output = await executarTool(JSON.parse(chamada.arguments));
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
