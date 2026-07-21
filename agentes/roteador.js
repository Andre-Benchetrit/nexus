const PERFIS = Object.freeze([
  'automatico', 'vendas', 'catalogo', 'negocio', 'silver', 'bronze', 'completo'
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
