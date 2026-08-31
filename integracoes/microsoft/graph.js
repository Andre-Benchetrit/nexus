const { obterTokenAplicacao } = require('./autenticacao');

const ORIGEM_GRAPH = 'https://graph.microsoft.com';
const BASE_GRAPH = `${ORIGEM_GRAPH}/v1.0`;

function codificarCaminho(caminho) {
  return String(caminho || '')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

function validarUrlGraph(url) {
  const texto = String(url);
  const analisada = texto.startsWith('http')
    ? new URL(texto)
    : new URL(`${BASE_GRAPH}/${texto.replace(/^\/+/, '')}`);
  if (analisada.origin !== ORIGEM_GRAPH) {
    throw new Error('O Microsoft Graph retornou uma URL de paginacao inesperada.');
  }
  return analisada.toString();
}

function mensagemErroGraph(resposta, corpo) {
  const detalhe = corpo?.error?.message || corpo?.error_description || resposta.statusText;
  return `Microsoft Graph respondeu ${resposta.status}: ${detalhe}.`;
}

function criarClienteGraph(conexao, opcoes = {}) {
  const fetchImpl = opcoes.fetchImpl || globalThis.fetch;
  const obterToken = opcoes.obterToken || obterTokenAplicacao;
  if (typeof fetchImpl !== 'function') throw new Error('Cliente HTTP indisponivel.');

  async function requisitar(caminhoOuUrl, configuracao = {}) {
    const metodo = String(configuracao.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD'].includes(metodo)) {
      throw new Error(
        `Operacao ${metodo} bloqueada: a integracao Nexus com Microsoft Graph e somente leitura.`
      );
    }
    const token = await obterToken(conexao.credenciais, {
      fetchImpl,
      agoraMs: opcoes.agoraMs
    });
    const url = validarUrlGraph(caminhoOuUrl);
    const resposta = await fetchImpl(url, {
      ...configuracao,
      method: metodo,
      headers: {
        accept: 'application/json',
        ...configuracao.headers,
        authorization: `Bearer ${token}`
      }
    });
    if (configuracao.respostaBinaria) {
      if (!resposta.ok) {
        const corpo = await resposta.json().catch(() => ({}));
        throw new Error(mensagemErroGraph(resposta, corpo));
      }
      return {
        buffer: Buffer.from(await resposta.arrayBuffer()),
        contentType: resposta.headers.get('content-type'),
        contentLength: Number(resposta.headers.get('content-length') || 0)
      };
    }
    const corpo = resposta.status === 204 ? null : await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(mensagemErroGraph(resposta, corpo));
    return corpo;
  }

  async function listarPaginado(caminhoOuUrl) {
    const itens = [];
    let proxima = caminhoOuUrl;
    while (proxima) {
      const pagina = await requisitar(proxima);
      itens.push(...(pagina.value || []));
      proxima = pagina['@odata.nextLink'] || null;
    }
    return itens;
  }

  async function resolverDrive() {
    if (conexao.driveId) return obterDrive(conexao.driveId);
    if (conexao.usuario) {
      return requisitar(`/users/${encodeURIComponent(conexao.usuario)}/drive`);
    }
    throw new Error(
      `A conexao ${conexao.nome} precisa de ${conexao.driveIdEnv}` +
      (conexao.usuarioEnv ? ` ou ${conexao.usuarioEnv}` : '') +
      '.'
    );
  }

  async function resolverSite(host = conexao.siteHost, caminho = conexao.sitePath) {
    if (conexao.siteId && !host && !caminho) return requisitar(`/sites/${conexao.siteId}`);
    if (!host || !caminho) {
      throw new Error(
        `Informe ${conexao.siteHostEnv} e ${conexao.sitePathEnv}, ou ${conexao.siteIdEnv}.`
      );
    }
    return requisitar(`/sites/${encodeURIComponent(host)}:/${codificarCaminho(caminho)}`);
  }

  function obterDrive(driveId = conexao.driveId) {
    if (!driveId) throw new Error(`Drive nao configurado para ${conexao.nome}.`);
    return requisitar(`/drives/${encodeURIComponent(driveId)}`);
  }

  function listarDrivesDoSite(siteId = conexao.siteId) {
    if (!siteId) throw new Error(`Site nao configurado para ${conexao.nome}.`);
    return listarPaginado(`/sites/${encodeURIComponent(siteId)}/drives`);
  }

  function obterItem(itemId, driveId = conexao.driveId) {
    if (!driveId) throw new Error(`Drive nao configurado para ${conexao.nome}.`);
    if (!itemId) throw new Error('itemId e obrigatorio.');
    return requisitar(
      `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`
    );
  }

  function listarFilhos({ driveId = conexao.driveId, itemId, caminho } = {}) {
    if (!driveId) throw new Error(`Drive nao configurado para ${conexao.nome}.`);
    const drive = encodeURIComponent(driveId);
    if (itemId) {
      return listarPaginado(`/drives/${drive}/items/${encodeURIComponent(itemId)}/children`);
    }
    if (caminho) {
      return listarPaginado(`/drives/${drive}/root:/${codificarCaminho(caminho)}:/children`);
    }
    return listarPaginado(`/drives/${drive}/root/children`);
  }

  function buscar(termo, driveId = conexao.driveId) {
    if (!driveId) throw new Error(`Drive nao configurado para ${conexao.nome}.`);
    if (!String(termo || '').trim()) throw new Error('Termo de busca e obrigatorio.');
    const seguro = String(termo).replace(/'/g, "''");
    return listarPaginado(
      `/drives/${encodeURIComponent(driveId)}/root/search(q='${encodeURIComponent(seguro)}')`
    );
  }

  function baixarItem(itemId, driveId = conexao.driveId) {
    if (!driveId) throw new Error(`Drive nao configurado para ${conexao.nome}.`);
    if (!itemId) throw new Error('itemId e obrigatorio.');
    return requisitar(
      `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`,
      { respostaBinaria: true }
    );
  }

  return {
    baixarItem,
    buscar,
    listarDrivesDoSite,
    listarFilhos,
    obterDrive,
    obterItem,
    requisitar,
    resolverDrive,
    resolverSite
  };
}

function caminhoRelativoSeguro(caminho) {
  const partes = String(caminho || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (!partes.length || partes.some((parte) => parte === '.' || parte === '..' || /[\x00-\x1f:*?"<>|]/.test(parte))) {
    throw new Error('Caminho de publicacao invalido.');
  }
  return partes.join('/');
}

function criarClienteGraphEscrita(conexao, opcoes = {}) {
  const fetchImpl = opcoes.fetchImpl || globalThis.fetch;
  const obterToken = opcoes.obterToken || obterTokenAplicacao;
  const raiz = caminhoRelativoSeguro(opcoes.rootPath || process.env.NEXUS_KNOWLEDGE_ONEDRIVE_PUBLISH_ROOT_PATH);
  if (typeof fetchImpl !== 'function') throw new Error('Cliente HTTP indisponivel.');

  async function enviarArquivo({ driveId = conexao.driveId, caminho, buffer, contentType }) {
    if (!driveId) throw new Error('Drive de publicacao documental nao configurado.');
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Arquivo de publicacao vazio.');
    if (buffer.length > 4 * 1024 * 1024) {
      throw new Error('Arquivo excede 4 MB; sessao de upload documental ainda nao esta habilitada.');
    }
    const relativo = caminhoRelativoSeguro(caminho);
    const destino = `${raiz}/${relativo}`;
    const token = await obterToken(conexao.credenciais, { fetchImpl, agoraMs: opcoes.agoraMs });
    const url = validarUrlGraph(`/drives/${encodeURIComponent(driveId)}/root:/${codificarCaminho(destino)}:/content`);
    const resposta = await fetchImpl(url, {
      method: 'PUT', body: buffer,
      headers: { authorization: `Bearer ${token}`, 'content-type': contentType || 'application/octet-stream' }
    });
    const corpo = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(mensagemErroGraph(resposta, corpo));
    return { id: corpo.id, name: corpo.name, webUrl: corpo.webUrl,
      lastModifiedDateTime: corpo.lastModifiedDateTime };
  }

  return Object.freeze({ enviarArquivo, rootPath: raiz });
}

module.exports = {
  BASE_GRAPH,
  codificarCaminho,
  criarClienteGraph,
  criarClienteGraphEscrita,
  caminhoRelativoSeguro,
  validarUrlGraph
};
