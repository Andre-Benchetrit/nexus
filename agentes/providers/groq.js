const OpenAI = require('openai');
const { flexibilizarCamposNulos } = require('./schema');

const MODELO_PADRAO = 'llama-3.3-70b-versatile';

function converterTools(definicoes = []) {
  return definicoes.map((definicao) => ({
    type: 'function',
    function: {
      name: definicao.name,
      description: definicao.description,
      parameters: flexibilizarCamposNulos(definicao.parameters)
    }
  }));
}

function criarProviderGroq(opcoes = {}) {
  const modelo = opcoes.modelo || process.env.GROQ_MODEL || MODELO_PADRAO;
  const timeoutMs = Number(opcoes.timeoutMs || process.env.LLM_REQUEST_TIMEOUT_MS || 20_000);
  let cliente = opcoes.cliente;

  function obterCliente() {
    if (cliente) return cliente;
    if (!process.env.GROQ_API_KEY) {
      throw new Error('Provider groq selecionado, mas GROQ_API_KEY não foi definida.');
    }
    cliente = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
      timeout: timeoutMs,
      maxRetries: 0
    });
    return cliente;
  }

  return {
    nome: 'groq',
    modelo,

    async executar({
      instrucoes,
      pergunta,
      tools,
      definicaoTool,
      executarTool,
      maxRodadas = 8,
      onEvento
    }) {
      const client = obterCliente();
      const ferramentas = tools?.length
        ? tools
        : [{ definicao: definicaoTool, executar: executarTool }];
      const definicoes = ferramentas.map((tool) => tool.definicao);
      const executores = new Map(
        ferramentas.map((tool) => [tool.definicao.name, tool.executar])
      );
      const messages = [
        { role: 'system', content: instrucoes },
        { role: 'user', content: pergunta }
      ];

      for (let rodada = 0; rodada < maxRodadas; rodada += 1) {
        onEvento?.(`Groq: aguardando resposta da rodada ${rodada + 1}/${maxRodadas}...`);
        const resposta = await client.chat.completions.create({
          model: modelo,
          messages,
          tools: converterTools(definicoes),
          tool_choice: 'auto',
          temperature: 0.1
        });
        const mensagem = resposta.choices?.[0]?.message;
        onEvento?.(`Groq: rodada ${rodada + 1} recebida.`);

        if (!mensagem) throw new Error('O Groq não retornou uma mensagem válida.');

        const chamadas = mensagem.tool_calls || [];
        if (chamadas.length === 0) {
          return {
            texto: mensagem.content || 'O Groq não retornou texto.',
            provider: 'groq',
            modelo,
            rodadas: rodada + 1,
            responseId: resposta.id || null
          };
        }

        messages.push({
          role: 'assistant',
          content: mensagem.content || null,
          tool_calls: chamadas
        });

        for (const chamada of chamadas) {
          const nome = chamada.function?.name;
          const executar = executores.get(nome);
          let resultado;

          try {
            if (!executar) throw new Error(`Ferramenta desconhecida solicitada pelo Groq: ${nome}`);
            const argumentos = JSON.parse(chamada.function?.arguments || '{}');
            resultado = await executar(argumentos);
          } catch (erro) {
            resultado = JSON.stringify({ erro: erro.message });
          }

          messages.push({
            role: 'tool',
            tool_call_id: chamada.id,
            content: typeof resultado === 'string' ? resultado : JSON.stringify(resultado)
          });
        }
      }

      throw new Error(`O Groq excedeu o limite de ${maxRodadas} rodadas de tools.`);
    }
  };
}

module.exports = {
  MODELO_PADRAO,
  converterTools,
  criarProviderGroq
};
