const BASE_URL_PADRAO = 'https://apiextrema.thorpe.com.br';

function texto(valor) {
  const normalizado = String(valor || '').trim();
  return normalizado || null;
}

function resolverConfiguracaoThorpe(opcoes = {}) {
  const env = opcoes.env || process.env;
  const configuracao = {
    baseUrl: (texto(env.THORPE_BASE_URL) || BASE_URL_PADRAO).replace(/\/+$/, ''),
    apiToken: texto(env.THORPE_API_TOKEN),
    usuario: texto(env.THORPE_USER),
    senha: texto(env.THORPE_PASSWORD)
  };
  if (opcoes.exigirCredenciais !== false) {
    const ausentes = [
      ['THORPE_API_TOKEN', configuracao.apiToken],
      ['THORPE_USER', configuracao.usuario],
      ['THORPE_PASSWORD', configuracao.senha]
    ].filter(([, valor]) => !valor).map(([nome]) => nome);
    if (ausentes.length) {
      throw new Error(`Credenciais Thorpe ausentes: ${ausentes.join(', ')}.`);
    }
  }
  return configuracao;
}

function resumirConfiguracaoThorpe(configuracao) {
  return {
    baseUrl: configuracao.baseUrl,
    apiToken: Boolean(configuracao.apiToken),
    usuario: Boolean(configuracao.usuario),
    senha: Boolean(configuracao.senha),
    pronta: Boolean(
      configuracao.apiToken && configuracao.usuario && configuracao.senha
    )
  };
}

module.exports = {
  BASE_URL_PADRAO,
  resolverConfiguracaoThorpe,
  resumirConfiguracaoThorpe
};
