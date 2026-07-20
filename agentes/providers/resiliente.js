const CODIGOS_TRANSITORIOS = new Set([
  '408', '429', '499', '500', '502', '503', '504',
  'ABORT_ERR', 'ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT',
  'UNAVAILABLE', 'RESOURCE_EXHAUSTED'
]);

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
          if (!erroTransitorio(erro)) throw erro;
          ultimoErro = erro;

          const podeRepetir = !erroDeQuota(erro) && tentativa < tentativasExtras;
          if (!podeRepetir) break;
          contexto.onEvento?.(
            `${primario.nome}: falha temporária; nova tentativa em ${atrasoMs * (2 ** tentativa)} ms.`
          );
          await aguardar(atrasoMs * (2 ** tentativa));
        }
      }

      if (!fallback) throw ultimoErro;

      try {
        contexto.onEvento?.(
          `${primario.nome}: indisponível; acionando fallback ${fallback.nome}.`
        );
        const resultado = await fallback.executar(contexto);
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
  erroTransitorio,
  obterCodigoErro
};
