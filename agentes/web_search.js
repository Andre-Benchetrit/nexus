const { randomUUID } = require('node:crypto');
const catalogoEntidadesWeb = require('../config/web-entities.json');

const CONSULTA_SENSIVEL = /(?:postgres(?:ql)?:\/\/|api[_ -]?key|senha|password|secret|bearer\s+[a-z0-9._-]+|\b(?:select|insert|update|delete)\s+.+\bfrom\b|\b\d{7,}\b|@[a-z0-9.-]+\.[a-z]{2,})/i;
const PEDIDO_EXPLICITO = /\b(pesquis(?:e|ar)|busque? (?:na|a )?internet|procure? (?:na|a )?web|fontes? (?:na|da )?internet|consulte? (?:a|na) web)\b/i;
const INFORMACAO_INSTAVEL = /\b(hoje|agora|atual|atualmente|recente|ultim[oa]s?|noticia|preco|cotacao|legislacao|lei|regulamento|versao|lancamento|agenda|previsao|presidente|ceo)\b/i;
const TERMOS_GENERICOS = new Set([
  'a', 'as', 'algo', 'alguma', 'coisa', 'com', 'como', 'da', 'das', 'de', 'do', 'dos',
  'e', 'em', 'esta', 'estao', 'eu', 'internet', 'mais', 'me', 'mim', 'na', 'nas', 'nexus',
  'no', 'nos', 'noticia', 'noticias', 'o', 'os', 'ou', 'para', 'pode', 'poderia',
  'por', 'favor', 'procure', 'quero', 'que', 'qual', 'quais', 'quem', 'recente',
  'recentes', 'sobre', 'ultima', 'ultimas', 'ultimo', 'ultimos', 'voce', 'web',
  'pesquise', 'pesquisar', 'busque', 'versao', 'atual', 'atualmente', 'preco',
  'cotacao', 'lancamento', 'agenda', 'previsao', 'presidente', 'ceo'
]);

function normalizarIntencao(valor = '') {
  return String(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function resolverModoWeb(valor = process.env.NEXUS_WEB_MODE || 'off') {
  const modo = String(valor).toLowerCase();
  if (!['off', 'shadow', 'v1'].includes(modo)) throw new Error(`NEXUS_WEB_MODE invalido: ${modo}.`);
  return modo;
}

function extrairAssuntoPesquisa(pergunta = '') {
  const texto = normalizarIntencao(pergunta)
    .replace(/\b(?:ola|oi|bom dia|boa tarde|boa noite|como vai|como esta)\b/g, ' ')
    .replace(PEDIDO_EXPLICITO, ' ')
    .replace(/[^a-z0-9]+/g, ' ');
  const termos = texto.split(/\s+/).filter((item) => item.length >= 2 && !TERMOS_GENERICOS.has(item));
  return termos.join(' ').trim();
}

function sugerirConsultaPesquisa(pergunta = '') {
  return normalizarIntencao(pergunta)
    .replace(/\b(?:ola|oi|bom dia|boa tarde|boa noite|como vai|como esta)\b/g, ' ')
    .replace(PEDIDO_EXPLICITO, ' ')
    .replace(/\b(?:pode|poderia|quero que|para mim|por favor|nexus)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function classificarIntencaoPesquisa(pergunta = '') {
  const texto = normalizarIntencao(pergunta);
  const explicita = PEDIDO_EXPLICITO.test(texto);
  const instavel = INFORMACAO_INSTAVEL.test(texto);
  if (!explicita && !instavel) {
    return { modo: 'nenhuma', explicita: false, instavel: false, assunto: null };
  }
  const assunto = extrairAssuntoPesquisa(pergunta);
  if (!assunto) {
    return { modo: 'esclarecer', explicita, instavel, assunto: null };
  }
  return {
    modo: explicita ? 'delegada' : 'obrigatoria',
    explicita, instavel, assunto,
    consultaSugerida: explicita ? sugerirConsultaPesquisa(pergunta) : String(pergunta).trim()
  };
}

function precisaPesquisaWeb(pergunta = '') {
  return classificarIntencaoPesquisa(pergunta).modo !== 'nenhuma';
}

function pedidoExplicitoPesquisaWeb(pergunta = '') {
  return PEDIDO_EXPLICITO.test(normalizarIntencao(pergunta));
}

function extrairConsultaPublica(pergunta = '') {
  const internas = /\b(fid|nexus|noss[oa]s?|meu|minha|faturamento|estoque|pedidos?|vendas?|sku|ean|marketplace_pedido)\b/i;
  const partes = String(pergunta).split(/[?.;]|\b(?:e compare|comparando|em relação a|versus|vs\.?|com nossos?|com minhas?)\b/i)
    .map((item) => item.replace(PEDIDO_EXPLICITO, ' ').replace(/\s+/g, ' ').trim())
    .filter((item) => item.length >= 3 && !internas.test(item) && !CONSULTA_SENSIVEL.test(item));
  if (!partes.length) {
    const erro = new Error('Não foi possível separar uma consulta pública dos dados internos. Reformule a parte que deve ser pesquisada.');
    erro.codigo = 'WEB_QUERY_REFORMULACAO'; throw erro;
  }
  return partes.sort((a, b) => b.length - a.length)[0].slice(0, 500);
}

function validarConsultaExterna(query) {
  const texto = String(query || '').trim();
  if (texto.length < 3 || texto.length > 500) {
    const erro = new Error('A consulta web deve ter entre 3 e 500 caracteres.');
    erro.codigo = 'WEB_QUERY_INVALIDA';
    throw erro;
  }
  if (CONSULTA_SENSIVEL.test(texto)) {
    const erro = new Error('A pesquisa contém dados internos ou sensíveis. Reformule usando apenas informações públicas.');
    erro.codigo = 'WEB_QUERY_SENSIVEL';
    throw erro;
  }
  return texto;
}

function urlPublica(valor) {
  try {
    const url = new URL(valor);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) ? url : null;
  } catch (_) { return null; }
}

function limparTrecho(valor, limite = 1800) {
  return String(valor || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\b(?:ignore|disregard|forget) (?:all )?(?:previous|prior|system) instructions?\b/gi, '[conteudo removido]')
    .replace(/\s+/g, ' ').trim().slice(0, limite);
}

function termosDeEntidade(query = '') {
  return normalizarIntencao(query).split(/[^a-z0-9]+/)
    .filter((item) => item.length >= 2 && !TERMOS_GENERICOS.has(item));
}

function encontrarEntidadePublica(query = '') {
  const normalizada = ` ${normalizarIntencao(query).replace(/[^a-z0-9]+/g, ' ')} `;
  return (catalogoEntidadesWeb.entities || []).find((entidade) =>
    (entidade.aliases || []).some((alias) => normalizada.includes(` ${normalizarIntencao(alias)} `))) || null;
}

function prepararSpecPesquisa(spec = {}) {
  const entidade = encontrarEntidadePublica(spec.query);
  if (!entidade) return { ...spec, requiredTerms: spec.requiredTerms || [] };
  let query = String(spec.query || '');
  const aliases = [...(entidade.aliases || [])].sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    const padrao = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (padrao.test(query)) {
      query = query.replace(padrao, entidade.publicQuery);
      break;
    }
  }
  return {
    ...spec,
    query: query.replace(/\s+/g, ' ').trim(),
    entityId: entidade.id,
    officialDomains: entidade.officialDomains || [],
    requiredTerms: [...new Set([...(spec.requiredTerms || []), ...(entidade.requiredTerms || [])])]
  };
}

function validarAderenciaConsulta(query, assunto) {
  const termos = termosDeEntidade(assunto);
  const consulta = normalizarIntencao(query);
  if (termos.length && !termos.some((termo) => consulta.includes(termo))) {
    const erro = new Error('A consulta sugerida não corresponde ao assunto solicitado pelo usuário.');
    erro.codigo = 'WEB_QUERY_FORA_ESCOPO';
    throw erro;
  }
  return query;
}

function fonteRelevante(fonte, query, minimo = Number(process.env.NEXUS_WEB_MIN_SCORE || 0.2), requiredTerms = []) {
  const termos = termosDeEntidade(query);
  const corpus = normalizarIntencao(`${fonte.titulo} ${fonte.dominio} ${fonte.trecho}`);
  const correspondeEntidade = !termos.length || termos.some((termo) => corpus.includes(termo));
  const correspondeObrigatorios = requiredTerms.every((termo) =>
    corpus.includes(normalizarIntencao(termo).replace(/[^a-z0-9]+/g, ' ').trim()));
  const scoreAceitavel = fonte.score == null || fonte.score >= minimo;
  return correspondeEntidade && correspondeObrigatorios && scoreAceitavel;
}

function normalizarResultadoTavily(resposta = {}, spec = {}) {
  const fontesRecebidas = [];
  for (const item of resposta.results || []) {
    const url = urlPublica(item.url);
    if (!url) continue;
    fontesRecebidas.push({
      id: `fonte-${fontesRecebidas.length + 1}`,
      titulo: limparTrecho(item.title, 240) || url.hostname,
      url: url.toString(),
      dominio: url.hostname.toLowerCase(),
      publicadoEm: item.published_date || item.publishedDate || null,
      trecho: limparTrecho(item.content || item.snippet),
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : null
    });
  }
  const fontes = spec.query
    ? fontesRecebidas.filter((item) => fonteRelevante(item, spec.query,
      Number(process.env.NEXUS_WEB_MIN_SCORE || 0.2), spec.requiredTerms || []))
    : fontesRecebidas;
  return {
    status: fontes.length ? 'complete' : 'empty',
    provider: 'tavily', profundidade: spec.searchDepth || 'basic',
    creditos: (spec.searchDepth || 'basic') === 'advanced' ? 2 : 1,
    fontes, respostaProvider: limparTrecho(resposta.answer, 1200) || null,
    avaliacaoRelevancia: {
      recebidas: fontesRecebidas.length,
      aceitas: fontes.length,
      descartadas: fontesRecebidas.length - fontes.length
    },
    atualizadoEm: new Date().toISOString()
  };
}

function criarTavilyWebSearchProvider(opcoes = {}) {
  const apiKey = opcoes.apiKey || process.env.TAVILY_API_KEY;
  const timeoutMs = Number(opcoes.timeoutMs || process.env.NEXUS_WEB_TIMEOUT_MS || 10_000);
  const fetchImpl = opcoes.fetchImpl || globalThis.fetch;
  async function pesquisar(spec = {}) {
    if (!apiKey) {
      const erro = new Error('TAVILY_API_KEY não foi definida.');
      erro.codigo = 'WEB_PROVIDER_INDISPONIVEL';
      throw erro;
    }
    const specPreparada = prepararSpecPesquisa(spec);
    const query = validarConsultaExterna(specPreparada.query);
    const searchDepth = spec.searchDepth === 'advanced' ? 'advanced' : 'basic';
    const maxResults = Math.min(8, Math.max(1, Number(spec.maxResults || process.env.NEXUS_WEB_MAX_RESULTS || 5)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resposta = await fetchImpl('https://api.tavily.com/search', {
        method: 'POST', signal: controller.signal,
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          query, search_depth: searchDepth, max_results: maxResults,
          include_answer: false, include_raw_content: false,
          ...(specPreparada.recency ? { time_range: specPreparada.recency } : {}),
          ...(specPreparada.includeDomains?.length ? { include_domains: specPreparada.includeDomains } : {}),
          ...(specPreparada.excludeDomains?.length ? { exclude_domains: specPreparada.excludeDomains } : {})
        })
      });
      if (!resposta.ok) {
        const erro = new Error(`Pesquisa web indisponível (${resposta.status}).`);
        erro.codigo = resposta.status === 429 ? 'WEB_RATE_LIMIT' : 'WEB_PROVIDER_ERRO';
        throw erro;
      }
      return normalizarResultadoTavily(await resposta.json(), { ...specPreparada, query, searchDepth });
    } catch (erro) {
      if (erro.name === 'AbortError') {
        const timeout = new Error('A pesquisa web excedeu o tempo limite.');
        timeout.codigo = 'WEB_TIMEOUT';
        throw timeout;
      }
      throw erro;
    } finally { clearTimeout(timer); }
  }
  return { nome: 'tavily', pesquisar };
}

function criarWebSearchProvider(opcoes = {}) {
  if (opcoes.provider) return opcoes.provider;
  const nome = String(opcoes.nome || process.env.NEXUS_WEB_PROVIDER || 'tavily').toLowerCase();
  if (nome === 'tavily') return criarTavilyWebSearchProvider(opcoes);
  throw new Error(`Provider de pesquisa web não suportado: ${nome}.`);
}

function criarOrcamentoPesquisa({ compositionLevel = 'medio', maximo } = {}) {
  const tetoConfigurado = Math.min(3, Math.max(1, Number(maximo || process.env.NEXUS_WEB_MAX_SEARCHES_PER_TURN || 3)));
  const tetoNivel = ['alto', 'extra_alto'].includes(compositionLevel) ? tetoConfigurado : Math.min(2, tetoConfigurado);
  let usadas = 0;
  return {
    consumir() {
      if (usadas >= tetoNivel) {
        const erro = new Error('O orçamento de pesquisas web deste turno foi atingido.');
        erro.codigo = 'WEB_BUDGET_EXCEEDED';
        throw erro;
      }
      usadas += 1;
      return { usadas, restantes: tetoNivel - usadas };
    },
    estado: () => ({ usadas, maximo: tetoNivel })
  };
}

function fontesPermitidas(resultado) {
  return new Set((resultado?.fontes || []).map((item) => item.url));
}

function validarCitacoesWeb(texto, resultados = []) {
  const permitidas = new Set(resultados.flatMap((item) => [...fontesPermitidas(item)]));
  const urls = [...String(texto || '').matchAll(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/g)].map((item) => item[1]);
  return {
    valida: permitidas.size > 0 && urls.length > 0 && urls.every((url) => permitidas.has(url)),
    urls, permitidas: [...permitidas]
  };
}

function respostaWebDeterministica(resultados = [], evidenciaPreservada = '') {
  const fontes = resultados.flatMap((item) => item.fontes || []);
  const prefixo = String(evidenciaPreservada || '').trim();
  if (!fontes.length) return prefixo || 'Não encontrei fontes suficientes para responder com segurança.';
  return [...(prefixo ? [prefixo, ''] : []),
    'Encontrei fontes relacionadas, mas não consegui confirmar uma resposta suficientemente precisa:', '',
    ...fontes.slice(0, 3).map((item) => `- [${item.titulo}](${item.url}) — ${item.dominio}`),
    '', 'Se quiser, reformule com um nome mais específico, domínio oficial ou período.'].join('\n');
}

module.exports = {
  classificarIntencaoPesquisa, criarOrcamentoPesquisa, criarTavilyWebSearchProvider, criarWebSearchProvider,
  extrairAssuntoPesquisa, prepararSpecPesquisa,
  extrairConsultaPublica, normalizarResultadoTavily, pedidoExplicitoPesquisaWeb,
  precisaPesquisaWeb, resolverModoWeb,
  respostaWebDeterministica, validarAderenciaConsulta, validarCitacoesWeb, validarConsultaExterna
};
