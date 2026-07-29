const ESCOPO_GRAPH = 'https://graph.microsoft.com/.default';
const MARGEM_EXPIRACAO_MS = 60_000;
const cacheTokens = new Map();

function chaveCache(credenciais) {
  return `${credenciais.tenantId}:${credenciais.clientId}`;
}

function mensagemErroOAuth(resposta, corpo) {
  const detalhe = corpo?.error_description || corpo?.error?.message || corpo?.error || resposta.statusText;
  return `Falha na autenticacao Microsoft (${resposta.status}): ${detalhe}.`;
}

async function obterTokenAplicacao(credenciais, opcoes = {}) {
  const fetchImpl = opcoes.fetchImpl || globalThis.fetch;
  const agoraMs = opcoes.agoraMs ?? Date.now();
  if (typeof fetchImpl !== 'function') throw new Error('Cliente HTTP indisponivel.');

  for (const campo of ['tenantId', 'clientId', 'clientSecret']) {
    if (!credenciais?.[campo]) throw new Error(`Credencial Microsoft ausente: ${campo}.`);
  }

  const chave = chaveCache(credenciais);
  const armazenado = cacheTokens.get(chave);
  if (
    !opcoes.forcar &&
    armazenado &&
    armazenado.expiraEmMs - MARGEM_EXPIRACAO_MS > agoraMs
  ) {
    return armazenado.accessToken;
  }

  const url =
    `https://login.microsoftonline.com/${encodeURIComponent(credenciais.tenantId)}` +
    '/oauth2/v2.0/token';
  const corpo = new URLSearchParams({
    client_id: credenciais.clientId,
    client_secret: credenciais.clientSecret,
    scope: ESCOPO_GRAPH,
    grant_type: 'client_credentials'
  });
  const resposta = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: corpo
  });
  const json = await resposta.json().catch(() => ({}));
  if (!resposta.ok || !json.access_token) {
    throw new Error(mensagemErroOAuth(resposta, json));
  }

  cacheTokens.set(chave, {
    accessToken: json.access_token,
    expiraEmMs: agoraMs + Number(json.expires_in || 3600) * 1000
  });
  return json.access_token;
}

function limparCacheTokens() {
  cacheTokens.clear();
}

module.exports = {
  ESCOPO_GRAPH,
  limparCacheTokens,
  obterTokenAplicacao
};
