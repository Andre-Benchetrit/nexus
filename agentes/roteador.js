const PERFIS = Object.freeze([
  'automatico', 'indicadores', 'influencias', 'vendas', 'catalogo', 'negocio', 'silver', 'bronze', 'completo'
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

  const influencias = /influenci|contribui|caus.{0,20}(queda|alta)|respons.vel.{0,20}(queda|alta)/.test(texto);
  if (influencias) return 'influencias';

  const dimensaoVenda = /produto|marca|plataforma|transportadora|cliente|tipo de pedido|grupo|subgrupo|categoria/.test(texto);
  const comparacaoDimensional = dimensaoVenda && /compar|variacao|queda|crescimento|evolu/.test(texto);
  if (comparacaoDimensional && /produto|marca|plataforma/.test(texto)) return 'influencias';
  if (dimensaoVenda && /vend|fatur|receita|pedidos?|notas?/.test(texto)) return 'vendas';

  const indicadores = /compar|crescimento|cresceu|variacao|queda|evolu|tendencia|acumulad|painel|resumo executivo|ticket medio|taxa de (cancelamento|emissao)|pedidos?.{0,20}pendentes?|pedidos?.{0,15}pagos?|quanto fatur|qual.{0,25}faturamento|faturamento.{0,20}(entre|de \d|no periodo|do periodo|de hoje|do dia|da semana|do mes|no dia|no mes)/.test(texto);
  if (indicadores) return 'indicadores';

  const vendasDiretas = /vend|fatur|receita|notas? fiscais?|\bnotas?\b|\bnf\b|marketplace|ticket medio|mais compr|devolu|quantos? pedidos|pedidos? (por|do|da|de|em|entre)|ultimos? pedidos/.test(texto);
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

module.exports = { PERFIS, classificarPergunta, normalizarTexto, resolverPerfil };
