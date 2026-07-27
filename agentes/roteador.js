const PERFIS = Object.freeze([
  'automatico', 'indicadores', 'influencias', 'estoque', 'desempenho', 'frete',
  'operacao',
  'vendas', 'catalogo',
  'negocio', 'silver', 'bronze', 'completo'
]);

function normalizarTexto(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function classificarPergunta(pergunta) {
  const texto = normalizarTexto(pergunta);
  const auditoria = /\bbronze\b|dado[s]? bruto[s]?|auditori|versoes do registro|alteracoes do registro/.test(texto);
  if (auditoria) return 'bronze';

  const resumoAdministrativo = /(?:resumo|painel).{0,30}(?:administrativo|executivo)|(?:administrativo|executivo).{0,30}(?:resumo|painel)/.test(texto);
  const resumoMultidominio = /\bresumo\b|painel|visao geral/.test(texto) &&
    /vend|fatur|receita/.test(texto) &&
    /ruptur|risco.{0,20}estoque|sem estoque/.test(texto);
  if (resumoAdministrativo || resumoMultidominio) return 'indicadores';

  const estoque = /ruptur|\bcobertura\b|risco.{0,20}estoque|sem estoque|reposi|(?:podem?|vai|irao).{0,15}(?:acabar|faltar)|estoque.{0,30}(acabar|dura|dias|critico|faltar)/.test(texto);
  if (estoque) return 'estoque';

  const influencias = /influenci|contribui|fatores?.{0,35}(respons|explic|caus|por tras)|caus.{0,25}(queda|alta|crescimento|variacao)|respons.vel.{0,25}(queda|alta|crescimento|variacao|diferenca)/.test(texto);
  if (influencias) return 'influencias';

  if (/frete|custo de entrega|custo logistico/.test(texto)) return 'frete';

  const listagemPedidos = /(?:liste|ultimos?|mais recentes).{0,35}pedidos|pedidos.{0,35}(?:mais recentes|ultimos?)/.test(texto);
  if (listagemPedidos) return 'vendas';

  if (
    /\bfunil\b/.test(texto) ||
    (
      /plataforma/.test(texto) &&
      /cancel|penden|devol|taxa|status/.test(texto)
    )
  ) return 'operacao';

  const desempenho = /margem|custo|rentab|lucrativ|comissao/.test(texto) ||
    /(?:produto|marca|grupo|subgrupo|categoria|plataforma).{0,35}(?:mais vend|vend.{0,10}mais|mais fatur|maior fatur|desempenho)/.test(texto) ||
    /(?:mais vend|mais fatur|maior fatur).{0,35}(?:produto|marca|grupo|subgrupo|categoria|plataforma)/.test(texto);
  if (desempenho) return 'desempenho';

  const dimensaoVenda = /produto|marca|plataforma|transportadora|cliente|tipo de pedido|grupo|subgrupo|categoria/.test(texto);
  const comparacaoDimensional = dimensaoVenda && /compar|variacao|queda|crescimento|evolu/.test(texto);
  if (comparacaoDimensional && /produto|marca|plataforma/.test(texto)) return 'influencias';
  if (dimensaoVenda && /vend|fatur|receita|pedidos?|notas?/.test(texto)) return 'vendas';

  const indicadores = /compar|crescimento|cresceu|variacao|queda|evolu|tendencia|acumulad|painel|resumo executivo|ticket medio|taxa de (cancelamento|emissao)|pedidos?.{0,20}pendentes?|pedidos?.{0,15}pagos?|quanto fatur|qual.{0,25}faturamento|faturamento.{0,20}(entre|de \d|no periodo|do periodo|de hoje|do dia|da semana|do mes|no dia|no mes)/.test(texto);
  if (indicadores) return 'indicadores';

  const vendasDiretas = /vend|fatur|receita|notas? fiscais?|\bnotas?\b|\bnf\b|marketplace|ticket medio|mais compr|devol|quantos? pedidos|pedidos? (por|do|da|de|em|entre)|ultimos? pedidos/.test(texto);
  if (vendasDiretas) return 'vendas';

  const cadastroSilver = /cliente|regras? de transporte|tipos? de pedido|plataformas? disponiveis/.test(texto);
  if (cadastroSilver) return 'silver';

  if (/\bpedidos?\b/.test(texto)) return 'vendas';

  const catalogo = /catalog|estoque|produto|marca|grupo|subgrupo|categoria|sku|\bean\b|linha branca|composicao/.test(texto);
  if (catalogo) return 'catalogo';

  return 'negocio';
}

function resolverPerfil(pergunta, solicitado = 'automatico') {
  const perfil = String(solicitado || 'automatico').toLowerCase();
  if (!PERFIS.includes(perfil)) {
    throw new Error(`Perfil invalido: ${perfil}. Use ${PERFIS.join(', ')}.`);
  }
  return perfil === 'automatico' ? classificarPergunta(pergunta) : perfil;
}

function pedeMesmaCobertura(pergunta) {
  const texto = normalizarTexto(pergunta);
  return /\b(mesma|igual).{0,12}cobertura\b|\bmesmo.{0,12}(corte|limite de dados)\b/.test(texto);
}

function obterPerfilAnterior(historico = []) {
  for (let indice = historico.length - 1; indice >= 0; indice -= 1) {
    const item = historico[indice];
    if (item.perfil && PERFIS.includes(item.perfil) && item.perfil !== 'automatico') {
      return item.perfil;
    }
    const pergunta = normalizarTexto(item.pergunta);
    if (!/^(e |agora |tambem |nesse|nessa|desses|dessas)/.test(pergunta)) {
      return classificarPergunta(pergunta);
    }
  }
  return null;
}

function resolverPerfilComContexto(pergunta, historico = [], solicitado = 'automatico') {
  if (solicitado !== 'automatico') return resolverPerfil(pergunta, solicitado);
  if (pedeMesmaCobertura(pergunta)) {
    const anterior = obterPerfilAnterior(historico);
    if (anterior) return anterior;
  }
  const ultimaPergunta = historico.at(-1)?.pergunta;
  const texto = ultimaPergunta && /^(e |agora |tambem |nesse|nessa|desses|dessas)/.test(
    normalizarTexto(pergunta)
  )
    ? `${ultimaPergunta} ${pergunta}`
    : pergunta;
  return resolverPerfil(texto);
}

module.exports = {
  PERFIS,
  classificarPergunta,
  normalizarTexto,
  obterPerfilAnterior,
  pedeMesmaCobertura,
  resolverPerfil,
  resolverPerfilComContexto
};
