const { resolverConfiguracaoThorpe } = require('./configuracao');

const TIMEOUT_PADRAO_MS = 20_000;

class ErroThorpe extends Error {
  constructor(mensagem, status = null) {
    super(mensagem);
    this.name = 'ErroThorpe';
    this.status = status;
  }
}

function obterCampo(objeto, nome) {
  if (!objeto || typeof objeto !== 'object') return undefined;
  const entrada = Object.entries(objeto).find(
    ([chave]) => chave.toLowerCase() === nome.toLowerCase()
  );
  return entrada?.[1];
}

function obterCaminho(objeto, caminhos) {
  for (const caminho of caminhos) {
    let atual = objeto;
    for (const parte of caminho) {
      atual = obterCampo(atual, parte);
      if (atual == null) break;
    }
    if (atual != null) return atual;
  }
  return undefined;
}

function detalheErro(corpo) {
  const valor = obterCaminho(corpo, [
    ['message'], ['mensagem'], ['error', 'message'], ['error_description'], ['error']
  ]);
  if (typeof valor !== 'string') return '';
  const seguro = valor.replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  return seguro ? `: ${seguro}` : '';
}

function numeroQuantidade(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  if (!texto) return null;
  const normalizado = texto.includes(',')
    ? texto.replace(/\./g, '').replace(',', '.')
    : texto;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

function possuiQuantidade(registro) {
  return obterCampo(registro, 'disponivel') !== undefined ||
    obterCampo(registro, 'pulmao') !== undefined;
}

function extrairRegistrosEstoque(origem) {
  if (Array.isArray(origem)) {
    return origem.flatMap((item) => extrairRegistrosEstoque(item));
  }
  if (!origem || typeof origem !== 'object') return [];
  if (possuiQuantidade(origem)) return [origem];

  const preferidos = ['data', 'content', 'lotes', 'estoque', 'items', 'result', 'value'];
  for (const nome of preferidos) {
    const valor = obterCampo(origem, nome);
    if (valor !== undefined) {
      const encontrados = extrairRegistrosEstoque(valor);
      if (encontrados.length) return encontrados;
    }
  }
  for (const valor of Object.values(origem)) {
    const encontrados = extrairRegistrosEstoque(valor);
    if (encontrados.length) return encontrados;
  }
  return [];
}

function normalizarEstoqueThorpe(payload, sku, agora = new Date()) {
  const registros = extrairRegistrosEstoque(payload);
  if (!registros.length) {
    throw new Error('Resposta Thorpe nao contem os campos disponivel e pulmao.');
  }
  let disponivel = 0;
  let pulmao = 0;
  let quantidadesValidas = 0;
  for (const registro of registros) {
    const valorDisponivel = numeroQuantidade(obterCampo(registro, 'disponivel'));
    const valorPulmao = numeroQuantidade(obterCampo(registro, 'pulmao'));
    if (valorDisponivel != null) {
      disponivel += valorDisponivel;
      quantidadesValidas += 1;
    }
    if (valorPulmao != null) {
      pulmao += valorPulmao;
      quantidadesValidas += 1;
    }
  }
  if (!quantidadesValidas) {
    throw new Error('Resposta Thorpe possui estoque sem quantidades numericas validas.');
  }
  return {
    sku,
    disponivel,
    pulmao,
    total_utilizavel: disponivel + pulmao,
    lotes_considerados: registros.length,
    consultado_em: agora.toISOString()
  };
}

async function lerResposta(resposta) {
  const texto = await resposta.text();
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return { message: texto.slice(0, 300) };
  }
}

function criarClienteThorpe(opcoes = {}) {
  const configuracao = opcoes.configuracao || resolverConfiguracaoThorpe(opcoes);
  const fetchImpl = opcoes.fetchImpl || globalThis.fetch;
  const timeoutMs = Number(opcoes.timeoutMs || TIMEOUT_PADRAO_MS);
  if (typeof fetchImpl !== 'function') throw new Error('Cliente HTTP indisponivel.');
  let token = null;

  async function requisitarHttp(url, init) {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
    try {
      const resposta = await fetchImpl(url, { ...init, signal: controlador.signal });
      const corpo = await lerResposta(resposta);
      return { resposta, corpo };
    } catch (erro) {
      if (erro?.name === 'AbortError') {
        throw new ErroThorpe('Tempo limite excedido na API Thorpe.');
      }
      throw erro;
    } finally {
      clearTimeout(temporizador);
    }
  }

  async function autenticar() {
    const { resposta, corpo } = await requisitarHttp(
      `${configuracao.baseUrl}/v2/token`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'api-token': configuracao.apiToken
        },
        body: JSON.stringify({
          usuario: configuracao.usuario,
          senha: configuracao.senha
        })
      }
    );
    if (!resposta.ok) {
      throw new ErroThorpe(
        `Autenticacao Thorpe respondeu HTTP ${resposta.status}${detalheErro(corpo)}.`,
        resposta.status
      );
    }
    const recebido = obterCaminho(corpo, [
      ['token'], ['access_token'], ['data', 'token'], ['data', 'access_token']
    ]);
    if (typeof recebido !== 'string' || recebido.length < 10) {
      throw new ErroThorpe('Resposta de autenticacao Thorpe nao contem token valido.');
    }
    token = recebido;
    return token;
  }

  async function requisitarLeitura(caminho, repetir = true) {
    if (!token) await autenticar();
    const { resposta, corpo } = await requisitarHttp(
      `${configuracao.baseUrl}${caminho}`,
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'api-token': configuracao.apiToken,
          authorization: `Bearer ${token}`
        }
      }
    );
    if (resposta.status === 401 && repetir) {
      token = null;
      return requisitarLeitura(caminho, false);
    }
    if (!resposta.ok) {
      throw new ErroThorpe(
        `API Thorpe respondeu HTTP ${resposta.status}${detalheErro(corpo)}.`,
        resposta.status
      );
    }
    return corpo;
  }

  async function consultarEstoque(sku) {
    const codigoAuxiliar = String(sku || '').trim();
    if (!codigoAuxiliar) throw new Error('SKU (codigo_auxiliar) e obrigatorio.');
    const payload = await requisitarLeitura(
      `/v2/estoque/${encodeURIComponent(codigoAuxiliar)}/lote`
    );
    return normalizarEstoqueThorpe(
      payload,
      codigoAuxiliar,
      opcoes.agora || new Date()
    );
  }

  return { consultarEstoque };
}

module.exports = {
  ErroThorpe,
  criarClienteThorpe,
  detalheErro,
  extrairRegistrosEstoque,
  normalizarEstoqueThorpe,
  numeroQuantidade
};
