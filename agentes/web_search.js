const { randomUUID } = require('node:crypto');
const catalogoEntidadesWeb = require('../config/web-entities.json');

const CONSULTA_SENSIVEL = /(?:postgres(?:ql)?:\/\/|api[_ -]?key|senha|password|secret|bearer\s+[a-z0-9._-]+|\b(?:select|insert|update|delete)\s+.+\bfrom\b|\b\d{7,}\b|@[a-z0-9.-]+\.[a-z]{2,})/i;
const PEDIDO_EXPLICITO = /\b(pesquis(?:e|ar)|busque? (?:na|a )?internet|procure? (?:na|a )?web|fontes? (?:na|da )?internet|consulte? (?:a|na) web)\b/i;
const PEDIDO_PUBLICO_IMPLICITO = /\b(?:ultim(?:a|as|o|os)\s+not[ií]cias?|not[ií]cias?\s+(?:recentes?\s+)?(?:de|da|do|sobre)|cota[cç][aã]o\s+(?:atual\s+)?(?:de|do|da)|pre[cç]o\s+atual\s+(?:de|do|da)|vers[aã]o\s+atual\s+(?:de|do|da)|mudan[cç]as?\s+mais\s+recentes?\s+(?:de|do|da|em)|lan[cç]amentos?\s+mais\s+recentes?\s+(?:de|do|da))\b/i;
const CONTINUACAO_WEB = /\b(?:mais fontes|outras fontes|continue (?:a|essa) pesquisa|aprofunde (?:a|essa) pesquisa|pesquise novamente|busque novamente|procure novamente|tente (?:pesquisar|buscar) novamente|sobre (?:isso|esse assunto)|e quanto a|e sobre)\b/i;
const INFORMACAO_INSTAVEL = /\b(hoje|agora|atual|atualmente|recente|ultim[oa]s?|noticia|preco|cotacao|legislacao|lei|regulamento|versao|lancamento|agenda|previsao|presidente|ceo)\b/i;
const DOMINIOS_OFICIAIS_BRASIL = Object.freeze([
  'gov.br', 'planalto.gov.br', 'confaz.fazenda.gov.br', 'fazenda.mg.gov.br'
]);
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

function requisitosPesquisaFactual(pergunta = '', contexto = {}) {
  const contextoVisivel = [contexto.ultimaPergunta, contexto.ultimaResposta, pergunta]
    .filter(Boolean).join(' ');
  const texto = normalizarIntencao(contextoVisivel);
  const eleitoral = /\b(?:eleic(?:ao|oes)|eleitoral|candidat[oa]s?|intencao de voto)\b/.test(texto);
  const pedeIndice = /\b(?:aprovacao|rejeicao|intencao de voto|percentua(?:l|is)|indices?|taxas?|maior|menor|mais votad[oa]|menos votad[oa]|pesquisa mais recente|pesquisa eleitoral)\b/.test(texto);
  if (!eleitoral || !pedeIndice) return {
    precisaEsclarecer: false, lacunas: [], requiredEvidenceGroups: [], minimumEvidenceSources: 1
  };

  const possuiLocal = /\b(?:brasil|brasileir[oa]|argentina|chile|uruguai|paraguai|estados unidos|eua|portugal|\w+\s*[-/]\s*(?:sp|mg|rj|es|ba|pr|sc|rs|go|df|pe|ce|pa|am))\b/.test(texto);
  const possuiCargo = /\b(?:presidencial|presidente|governador|prefeito|senador|deputad[oa]|vereador|cargo|municipal|estadual|federal|segundo turno|primeiro turno)\b/.test(texto);
  const possuiPeriodo = /\b(?:20\d{2}|hoje|atual|mais recente|ultima pesquisa|primeiro turno|segundo turno|datafolha|quaest|ipec|parana pesquisas|atlasintel)\b/.test(texto);
  const lacunas = [];
  if (!possuiLocal) lacunas.push('local');
  if (!possuiCargo) lacunas.push('cargo');
  if (!possuiPeriodo) lacunas.push('periodo_ou_instituto');
  return {
    precisaEsclarecer: lacunas.length > 0,
    lacunas,
    perguntaEsclarecimento: lacunas.length
      ? 'De qual eleição você está falando? Informe o país/estado/cidade, o cargo e o ano ou a pesquisa/período que deseja comparar.'
      : null,
    requiredEvidenceGroups: [[
      '%', 'percentual', 'intenção de voto', 'aprovacao', 'rejeicao', 'pesquisa eleitoral'
    ]],
    minimumEvidenceSources: 1,
    tipo: 'indicadores_eleitorais'
  };
}

function classificarIntencaoRegulatoria(pergunta = '') {
  const texto = normalizarIntencao(pergunta);
  const fiscal = /\b(?:fiscal|nota fiscal|nf-?e|nfc-?e|cpf|cnpj|tribut|imposto|devolu[cç][aã]o|cancelamento fiscal|carta de corre[cç][aã]o|sefaz|confaz)\b/.test(texto);
  const juridica = /\b(?:lei|legisla[cç][aã]o|jur[ií]dic|regulamento|direito do consumidor|procon|contrato)\b/.test(texto);
  const pedeRegra = /\b(?:pode dar problema|[eé] permitido|[eé] obrigat[oó]rio|qual (?:a )?regra|verifi\w*.{0,30}regra|regra (?:fiscal|juridica|legal)|o que (?:a )?(?:lei|legisla[cç][aã]o) diz|como corrigir|como regularizar|quais? (?:os )?riscos?|consequ[eê]ncias?|validade|responsabilidade)\b/.test(texto);
  const consultaCorporativaExplicita = /\b(?:consulte|consultar|localize|localizar|busque|buscar|verifique|verificar)\b.{0,80}\b(?:venda|pedido|nota|nf-?e|cliente|registro)\b/.test(texto) ||
    /\b(?:venda|pedido|nota|nf-?e)\s*(?:n[ºo°.]|numero|id|c[oó]digo)?\s*\d{3,}\b/.test(texto);
  const regulatoria = (fiscal || juridica) && (pedeRegra || juridica);
  return {
    regulatoria,
    dominio: fiscal ? 'fiscal' : juridica ? 'juridico' : null,
    consultaCorporativaExplicita
  };
}

function construirConsultaRegulatoriaOficial(pergunta = '') {
  const texto = normalizarIntencao(pergunta);
  const termos = [];
  if (/diverg|diferent|incorret|errad/.test(texto)) termos.push('divergência cadastral');
  if (/\bnome\b/.test(texto)) termos.push('nome');
  if (/\bcpf\b/.test(texto)) termos.push('CPF');
  if (/\bcnpj\b/.test(texto)) termos.push('CNPJ');
  if (/nota fiscal|nf-?e|nfc-?e/.test(texto)) termos.push('nota fiscal eletrônica');
  if (/devolu/.test(texto)) termos.push('devolução');
  if (/cancel/.test(texto)) termos.push('cancelamento');
  if (/carta de corre/.test(texto)) termos.push('carta de correção');
  if (/consumidor|procon/.test(texto)) termos.push('direito do consumidor');
  if (/contrato/.test(texto)) termos.push('contrato');
  if (!termos.length) termos.push('regra fiscal ou jurídica aplicável');
  return `${[...new Set(termos)].join(' ')} orientação oficial legislação Brasil`.slice(0, 500);
}

function classificarIntencaoPesquisa(pergunta = '', contexto = {}) {
  const texto = normalizarIntencao(pergunta);
  const explicita = PEDIDO_EXPLICITO.test(texto);
  const regulatoria = classificarIntencaoRegulatoria(pergunta);
  const requisitos = requisitosPesquisaFactual(pergunta, contexto);
  const publicaImplicita = PEDIDO_PUBLICO_IMPLICITO.test(texto) || regulatoria.regulatoria ||
    Boolean(requisitos.tipo);
  const continuacao = contexto.ultimaProveniencia === 'web' && CONTINUACAO_WEB.test(texto);
  const instavel = INFORMACAO_INSTAVEL.test(texto);
  if (!explicita && !publicaImplicita && !continuacao) {
    return { modo: 'nenhuma', explicita: false, publicaImplicita: false,
      continuacao: false, instavel, assunto: null, ...regulatoria };
  }
  const assunto = extrairAssuntoPesquisa(pergunta);
  if (!assunto) {
    return { modo: 'esclarecer', explicita, publicaImplicita, continuacao,
      instavel, assunto: null, ...regulatoria };
  }
  if (requisitos.precisaEsclarecer) {
    return { modo: 'esclarecer', explicita, publicaImplicita, continuacao,
      instavel: true, assunto, ...regulatoria, ...requisitos };
  }
  if (regulatoria.regulatoria) {
    const consultaSugerida = construirConsultaRegulatoriaOficial(pergunta);
    return {
      modo: 'delegada', explicita, publicaImplicita: true, continuacao,
      instavel: true, assunto: consultaSugerida, consultaSugerida,
      officialDomains: [...DOMINIOS_OFICIAIS_BRASIL], requiredSourceCount: 2,
      ...regulatoria, ...requisitos
    };
  }
  return {
    modo: 'delegada',
    explicita, publicaImplicita, continuacao, instavel, assunto,
    consultaSugerida: explicita || continuacao
      ? sugerirConsultaPesquisa(pergunta) : String(pergunta).trim(),
    ...requisitos
  };
}

function precisaPesquisaWeb(pergunta = '', contexto = {}) {
  return classificarIntencaoPesquisa(pergunta, contexto).modo !== 'nenhuma';
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
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\b(?:skip to content|donate now|sign in|log in|minha folha|artigos salvos|newsletters?|assinatura|editar perfil|senha e conta|atendimento)\b/gi, ' ')
    .replace(/\b(?:ignore|disregard|forget) (?:all )?(?:previous|prior|system) instructions?\b/gi, '[conteudo removido]')
    .replace(/\s+/g, ' ').trim().slice(0, limite);
}

function limitarConteudoPrincipal(valor, limite = 4_000) {
  const linhas = String(valor || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .split(/\r?\n/)
    .map((linha) => linha.replace(/^\s{0,3}#{1,6}\s*/, '').replace(/\s+/g, ' ').trim())
    .filter((linha) => linha && !/^(?:skip to (?:content|main)|entrar|sair|login|sign in|log in|menu|donate now|minha (?:folha|conta)|editar perfil|senha e conta|atendimento|newsletters?|assinatura|cookies?)\b/i.test(linha));
  return limparTrecho(linhas.join(' '), limite) || null;
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
  if (!String(assunto || '').trim()) return query;
  const termos = termosDeEntidade(assunto);
  const consulta = normalizarIntencao(query);
  if (termos.length && !termos.some((termo) => consulta.includes(termo))) {
    const erro = new Error('A consulta sugerida não corresponde ao assunto solicitado pelo usuário.');
    erro.codigo = 'WEB_QUERY_FORA_ESCOPO';
    throw erro;
  }
  return query;
}

function fonteRelevante(fonte, query, minimo = Number(process.env.NEXUS_WEB_MIN_SCORE || 0.2), requiredTerms = [], requiredEvidenceGroups = []) {
  const termos = termosDeEntidade(query);
  const corpus = normalizarIntencao(`${fonte.titulo} ${fonte.dominio} ${fonte.trecho} ${fonte.conteudo || ''}`);
  const correspondeEntidade = !termos.length || termos.some((termo) => corpus.includes(termo));
  const correspondeObrigatorios = requiredTerms.every((termo) =>
    corpus.includes(normalizarIntencao(termo).replace(/[^a-z0-9]+/g, ' ').trim()));
  const possuiEvidenciaExigida = requiredEvidenceGroups.every((grupo) =>
    grupo.some((termo) => corpus.includes(normalizarIntencao(termo))));
  const scoreAceitavel = fonte.score == null || fonte.score >= minimo;
  return correspondeEntidade && correspondeObrigatorios && possuiEvidenciaExigida && scoreAceitavel;
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
      conteudo: limitarConteudoPrincipal(item.raw_content || item.rawContent),
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : null
    });
  }
  const dominiosPermitidos = (spec.includeDomains || []).map((item) => String(item).toLowerCase());
  const fontesNoDominio = dominiosPermitidos.length
    ? fontesRecebidas.filter((item) => dominiosPermitidos.some((dominio) =>
      item.dominio === dominio || item.dominio.endsWith(`.${dominio}`)))
    : fontesRecebidas;
  const fontesFiltradas = spec.query
    ? fontesNoDominio.filter((item) => fonteRelevante(item, spec.query,
      Number(process.env.NEXUS_WEB_MIN_SCORE || 0.2), spec.requiredTerms || [],
      spec.requiredEvidenceGroups || []))
    : fontesNoDominio;
  let bytesConteudo = 0;
  const fontes = fontesFiltradas.map((item, indice) => {
    if (indice >= 3 || !item.conteudo || bytesConteudo >= 12_000) {
      const { conteudo: _omitido, ...fonte } = item;
      return fonte;
    }
    const restante = Math.max(0, 12_000 - bytesConteudo);
    const conteudo = item.conteudo.slice(0, restante);
    bytesConteudo += conteudo.length;
    return { ...item, conteudo };
  });
  const minimoFontes = Math.max(1, Number(spec.minimumEvidenceSources || 1));
  const evidenciaSuficiente = fontes.length >= minimoFontes;
  return {
    status: evidenciaSuficiente ? 'complete' : fontes.length ? 'partial' : 'empty',
    provider: 'tavily', profundidade: spec.searchDepth || 'basic',
    creditos: (spec.searchDepth || 'basic') === 'advanced' ? 2 : 1,
    fontes, respostaProvider: limparTrecho(resposta.answer, 1200) || null,
    avaliacaoRelevancia: {
      recebidas: fontesRecebidas.length,
      aceitas: fontes.length,
      descartadas: fontesRecebidas.length - fontes.length,
      evidenciaSuficiente,
      minimoFontes,
      motivo: evidenciaSuficiente ? 'evidencia_suficiente'
        : fontes.length ? 'fontes_insuficientes' : 'sem_fonte_aderente'
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
          include_answer: false,
          // Conteudo integral sanitizado e limitado permite ao generalista sintetizar
          // as fontes principais sem fazer fetch direto em URLs arbitrarias.
          include_raw_content: specPreparada.readTopSources === false ? false : 'markdown',
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

function respostaWebDeterministica(resultados = [], evidenciaPreservada = '', opcoes = {}) {
  const fontes = [...new Map(resultados.flatMap((item) => item.fontes || [])
    .map((item) => [item.url, item])).values()];
  const prefixo = String(evidenciaPreservada || '').trim();
  if (!fontes.length) return prefixo || 'Não encontrei fontes suficientes para responder com segurança.';
  const evidencias = fontes.slice(0, 3).map((item) => {
    const trecho = limparTrecho(item.trecho || item.conteudo, 240);
    return `- [${item.titulo}](${item.url})${trecho ? `: ${trecho}` : ` — ${item.dominio}`}`;
  });
  return [...(prefixo ? [prefixo, ''] : []),
    'As fontes encontradas não trouxeram evidência suficiente para eu concluir a resposta com segurança:', '',
    ...evidencias,
    ...(opcoes.regulatoria && fontes.length < 2
      ? ['', 'A cobertura oficial ficou limitada a uma fonte; confirme o caso com a área fiscal responsável, especialmente se houver regra estadual.']
      : []),
    '', 'Informe mais contexto — por exemplo, entidade, local, período ou indicador — para eu refazer a pesquisa de forma mais específica.'].join('\n');
}

module.exports = {
  DOMINIOS_OFICIAIS_BRASIL, classificarIntencaoPesquisa, classificarIntencaoRegulatoria,
  construirConsultaRegulatoriaOficial, criarOrcamentoPesquisa, criarTavilyWebSearchProvider, criarWebSearchProvider,
  extrairAssuntoPesquisa, prepararSpecPesquisa, requisitosPesquisaFactual,
  extrairConsultaPublica, normalizarResultadoTavily, pedidoExplicitoPesquisaWeb,
  precisaPesquisaWeb, resolverModoWeb,
  respostaWebDeterministica, validarAderenciaConsulta, validarCitacoesWeb, validarConsultaExterna
};
