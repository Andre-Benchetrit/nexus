const CODIGOS_TRANSITORIOS = new Set([
  '408', '429', '499', '500', '502', '503', '504',
  'ABORT_ERR', 'ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT',
  'UNAVAILABLE', 'RESOURCE_EXHAUSTED'
]);
const CODIGOS_FALLBACK_CONTROLADO = new Set([
  ...CODIGOS_TRANSITORIOS,
  'MAX_RODADAS', 'RESPOSTA_INVALIDA', 'SCHEMA_INVALIDO', 'TOOL_CALL_INVALIDO',
  'TOOL_USE_FAILED'
]);

const { aplicarHandoffAoContexto, resolverModoHandoff } = require('../execucao_turno');

function obterCodigoErro(erro) {
  const candidatos = [
    erro?.status,
    erro?.statusCode,
    erro?.code,
    erro?.error?.code,
    erro?.error?.status,
    erro?.cause?.code
  ];
  const codigo = candidatos.find((valor) => valor !== undefined && valor !== null);
  return codigo === undefined ? null : String(codigo).toUpperCase();
}

function erroTransitorio(erro) {
  const codigo = obterCodigoErro(erro);
  if (codigo && CODIGOS_TRANSITORIOS.has(codigo)) return true;
  const mensagem = String(erro?.message || '').toLowerCase();
  return /high demand|service unavailable|retryable http error|client closed request|request aborted|fetch failed|network error|temporar|timeout|timed out|rate limit|quota|resource exhausted|connection reset/.test(mensagem);
}

function erroElegivelFallback(erro) {
  const codigo = obterCodigoErro(erro);
  if (codigo === '401' || codigo === '403') return false;
  if (codigo && CODIGOS_FALLBACK_CONTROLADO.has(codigo)) return true;
  if (erroTransitorio(erro)) return true;
  return /excedeu .*rodadas|resposta (invalida|inválida)|tool call validation failed/i
    .test(String(erro?.message || ''));
}

function erroDeQuota(erro) {
  const codigo = obterCodigoErro(erro);
  if (codigo === '429' || codigo === 'RESOURCE_EXHAUSTED') return true;
  return /quota|rate limit|resource exhausted/.test(String(erro?.message || '').toLowerCase());
}

function esperar(ms) {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

function numeroSeguro(valor, padrao, minimo, maximo) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return padrao;
  return Math.max(minimo, Math.min(maximo, numero));
}

function criarProviderResiliente(primario, fallback, opcoes = {}) {
  const tentativasExtras = numeroSeguro(
    opcoes.tentativasExtras ?? process.env.LLM_RETRY_ATTEMPTS,
    1,
    0,
    3
  );
  const atrasoMs = numeroSeguro(
    opcoes.atrasoMs ?? process.env.LLM_RETRY_DELAY_MS,
    500,
    0,
    10_000
  );
  const aguardar = opcoes.esperar || esperar;

  return {
    nome: primario.nome,
    modelo: primario.modelo,
    fallback: fallback ? { nome: fallback.nome, modelo: fallback.modelo } : null,

    async executar(contexto) {
      let ultimoErro;

      for (let tentativa = 0; tentativa <= tentativasExtras; tentativa += 1) {
        try {
          return await primario.executar(contexto);
        } catch (erro) {
          if (!erroElegivelFallback(erro)) throw erro;
          ultimoErro = erro;

          const codigo = obterCodigoErro(erro);
          const podeRepetir = !erroDeQuota(erro) && codigo !== 'TOOL_USE_FAILED' &&
            tentativa < tentativasExtras;
          if (!podeRepetir) break;
          contexto.onEvento?.(
            `${primario.nome}: falha temporária; nova tentativa em ${atrasoMs * (2 ** tentativa)} ms.`
          );
          await aguardar(atrasoMs * (2 ** tentativa));
        }
      }

      if (!fallback) throw ultimoErro;

      try {
        if (contexto.debugFallback === true) {
          contexto.onEvento?.(
            `${primario.nome}: indisponível; acionando fallback ${fallback.nome}.`
          );
        }
        const contextoPreparado = contexto.prepararFallback
          ? await contexto.prepararFallback()
          : contexto;
        const modoHandoff = resolverModoHandoff(contexto.handoffMode);
        const handoff = contexto.estadoExecucao?.criarHandoff({
          providerAnterior: primario.nome,
          providerDestino: fallback.nome,
          erro: ultimoErro
        }) || null;
        const preparadoComHandoff = handoff && modoHandoff === 'v1'
          ? aplicarHandoffAoContexto(contextoPreparado, handoff)
          : contextoPreparado;
        await contexto.onHandoff?.({
          modo: modoHandoff,
          providerAnterior: primario.nome,
          providerDestino: fallback.nome,
          motivo: obterCodigoErro(ultimoErro) || 'erro_transitorio',
          handoff
        });
        const contextoFallback = {
          ...preparadoComHandoff,
          fallbackFromCallId: contexto.telemetria?.ultimoCallId || null
        };
        const resultado = await fallback.executar(contextoFallback);
        return {
          ...resultado,
          fallbackDe: primario.nome,
          fallbackMotivo: obterCodigoErro(ultimoErro) || 'erro_transitorio'
        };
      } catch (erroFallback) {
        const erro = new Error(
          `${primario.nome} falhou temporariamente e o fallback ${fallback.nome} também falhou: ${erroFallback.message}`,
          { cause: erroFallback }
        );
        erro.erroPrimario = ultimoErro;
        throw erro;
      }
    }
  };
}

module.exports = {
  criarProviderResiliente,
  erroDeQuota,
  erroElegivelFallback,
  erroTransitorio,
  obterCodigoErro
};
