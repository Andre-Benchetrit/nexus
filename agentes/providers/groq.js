const OpenAI = require('openai');
const {
  flexibilizarCamposNulos,
  flexibilizarEnumsNulos,
  flexibilizarTiposPrimitivos,
  normalizarArgumentosPeloSchema
} = require('./schema');
const {
  estimarComposicaoInput,
  executarChamadaAuditada,
  normalizarUsageOpenAI
} = require('./telemetria');
const { emitirCheckpoint } = require('./checkpoints');

const MODELO_PADRAO = 'openai/gpt-oss-120b';

function tolerarEntidadesParciaisDoRoteador(schema, nomeFerramenta) {
  if (nomeFerramenta !== 'registrar_decisao_rota') return schema;
  const copia = structuredClone(schema);
  function visitar(atual) {
    if (!atual || typeof atual !== 'object') return;
    const propriedades = atual.properties || {};
    if (propriedades.tipo && propriedades.valores && propriedades.origem) {
      atual.required = ['tipo'];
    }
    Object.values(propriedades).forEach(visitar);
    if (atual.items) visitar(atual.items);
    for (const combinador of ['anyOf', 'oneOf', 'allOf']) {
      (atual[combinador] || []).forEach(visitar);
    }
  }
  visitar(copia);
  copia.properties.entidades = {
    description: 'Use sempre uma lista. Cada item exige tipo; valores e origem sao opcionais.',
    type: 'array',
    maxItems: 50,
    items: {
      type: 'object',
      properties: {
        tipo: { type: 'string' },
        valores: { type: 'array', items: { type: 'string' }, maxItems: 500 },
        origem: { type: 'string', enum: ['pergunta_atual', 'memoria'] }
      },
      required: ['tipo'],
      additionalProperties: false
    }
  };
  return copia;
}

function converterTools(definicoes = []) {
  return definicoes.map((definicao) => ({
    type: 'function',
    function: {
      name: definicao.name,
      description: definicao.description,
      parameters: tolerarEntidadesParciaisDoRoteador(
        flexibilizarTiposPrimitivos(
          flexibilizarEnumsNulos(
            flexibilizarCamposNulos(definicao.parameters)
          )
        ),
        definicao.name
      )
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
      const ferramentas = Array.isArray(tools)
        ? tools
        : [{ definicao: definicaoTool, executar: executarTool, terminal: true }];
      const messages = [
        { role: 'system', content: instrucoes },
        ...(mensagens?.length ? mensagens.map((item) => ({ role: item.role, content: item.content })) : [
          { role: 'user', content: pergunta }
        ])
      ];
      let deveFinalizar = false;
      let houveTool = false;
      const resultadosParaAuditoria = [];

      for (let rodada = 0; rodada < maxRodadas; rodada += 1) {
        const definicoes = ferramentas.map((tool) => tool.definicao);
        const ferramentasPorNome = new Map(
          ferramentas.map((tool) => [tool.definicao.name, tool])
        );
        const definicoesPorNome = new Map(
          ferramentas.map((tool) => [tool.definicao.name, tool.definicao])
        );
        onEvento?.(`Groq: aguardando resposta da rodada ${rodada + 1}/${maxRodadas}...`);
        emitirCheckpoint(onCheckpoint, 'modelo_solicitado', {
          etapa: houveTool && stageFinal ? stageFinal : stage,
          provider: 'groq', rodada: rodada + 1
        });
        const auditada = await executarChamadaAuditada({
          telemetria, provider: 'groq', modelo,
          stage: houveTool && stageFinal ? stageFinal : stage,
          purpose, parentCallId: telemetria?.ultimoCallId || parentCallId,
          fallbackFromCallId,
          composicao: estimarComposicaoInput({
            instrucoes, pergunta, mensagens, tools: ferramentas,
            resultadosTools: resultadosParaAuditoria
          }),
          executar: () => client.chat.completions.create({
            model: modelo,
            messages,
            ...(definicoes.length ? {
              tools: converterTools(definicoes),
              parallel_tool_calls: false,
              tool_choice: deveFinalizar ? 'none' : 'auto'
            } : {}),
            temperature: 0.1
          }),
          normalizarResposta: (resposta) => ({
            usage: normalizarUsageOpenAI(resposta.usage),
            responseId: resposta.id || null,
            stopReason: resposta.choices?.[0]?.finish_reason || null
          })
        });
        const resposta = auditada.resposta;
        const mensagem = resposta.choices?.[0]?.message;
        emitirCheckpoint(onCheckpoint, 'modelo_respondeu', {
          etapa: houveTool && stageFinal ? stageFinal : stage,
          provider: 'groq', rodada: rodada + 1, callId: auditada.callId,
          stopReason: resposta.choices?.[0]?.finish_reason || null
        });
        onEvento?.(`Groq: rodada ${rodada + 1} recebida.`);

        if (!mensagem) throw new Error('O Groq não retornou uma mensagem válida.');

        const chamadas = mensagem.tool_calls || [];
        if (chamadas.length === 0) {
          emitirCheckpoint(onCheckpoint, 'provider_concluiu', {
            etapa: houveTool && stageFinal ? stageFinal : stage,
            provider: 'groq', rodada: rodada + 1, callId: auditada.callId
          });
          return {
            texto: mensagem.content || 'O Groq não retornou texto.',
            provider: 'groq',
            modelo,
            rodadas: rodada + 1,
            responseId: resposta.id || null
          };
        }
        if (stage === 'generalist_response') {
          await telemetria?.atualizarEstagio?.(auditada.callId, 'generalist_decision');
        }

        messages.push({
          role: 'assistant',
          content: mensagem.content || null,
          tool_calls: chamadas
        });
        houveTool = true;

        for (const chamada of chamadas) {
          const nome = chamada.function?.name;
          const ferramenta = ferramentasPorNome.get(nome);
          let resultado;
          emitirCheckpoint(onCheckpoint, 'tool_sugerida', {
            etapa: stage, provider: 'groq', nome, callId: auditada.callId
          });

          try {
            if (!ferramenta) throw new Error(`Ferramenta desconhecida solicitada pelo Groq: ${nome}`);
            const argumentosRecebidos = JSON.parse(chamada.function?.arguments || '{}');
            const argumentos = normalizarArgumentosPeloSchema(
              argumentosRecebidos,
              definicoesPorNome.get(nome)?.parameters
            );
            resultado = await ferramenta.executar(argumentos);
            emitirCheckpoint(onCheckpoint, 'tool_aceita', {
              etapa: stage, provider: 'groq', nome
            });
            const terminal = typeof ferramenta.terminal === 'function'
              ? ferramenta.terminal(argumentos, resultado)
              : ferramenta.terminal;
            if (terminal === true) deveFinalizar = true;
          } catch (erro) {
            resultado = JSON.stringify({ erro: erro.message });
            emitirCheckpoint(onCheckpoint, 'tool_rejeitada', {
              etapa: stage, provider: 'groq', nome,
              codigo: erro.codigo || erro.code || erro.name || 'ERRO_TOOL'
            });
          }
          resultadosParaAuditoria.push(resultado);

          messages.push({
            role: 'tool',
            tool_call_id: chamada.id,
            content: typeof resultado === 'string' ? resultado : JSON.stringify(resultado)
          });
        }
        if (returnAfterTerminalTool && deveFinalizar) {
          emitirCheckpoint(onCheckpoint, 'provider_concluiu', {
            etapa: stage, provider: 'groq', rodada: rodada + 1,
            callId: auditada.callId, motivo: 'tool_terminal'
          });
          return {
            texto: mensagem.content || '', provider: 'groq', modelo,
            rodadas: rodada + 1, responseId: resposta.id || null
          };
        }
      }

      emitirCheckpoint(onCheckpoint, 'provider_esgotou_rodadas', {
        etapa: stage, provider: 'groq', maxRodadas
      });
      const erro = new Error(`O Groq excedeu o limite de ${maxRodadas} rodadas de tools.`);
      erro.codigo = 'MAX_RODADAS';
      throw erro;
    }
  };
}

module.exports = {
  MODELO_PADRAO,
  converterTools,
  criarProviderGroq,
  tolerarEntidadesParciaisDoRoteador
};
