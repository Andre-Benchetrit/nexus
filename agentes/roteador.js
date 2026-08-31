const PERFIS = Object.freeze([
  'automatico', 'indicadores', 'influencias', 'estoque', 'estoque_reposicoes',
  'bloqueios_estoque',
  'desempenho', 'frete', 'operacao', 'reposicoes',
  'vendas', 'catalogo', 'pessoas', 'produto',
  'documentacao',
  'sql', 'negocio', 'hibrido', 'gold', 'silver', 'bronze', 'completo'
]);

function normalizarTexto(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function classificarPorRegras(pergunta) {
  const texto = normalizarTexto(pergunta);
  const orientacaoOperacional = /\b(?:como|onde)\b.{0,60}\b(?:desbloque|liber|cadast|solicit|abr|alter|corrij|resolv|execut|realiz|acess)\w*/.test(texto) &&
    /\b(?:pedidos?|produtos?|clientes?|notas?|bloqueios?|sistema|erp|processo|empresa|setor)\b/.test(texto);
  const consultaDocumentalExplicita =
    /\b(?:consult|verific|confir|busc)\w*.{0,60}\b(?:politica|manual|documentacao|procedimento)\b/.test(texto) ||
    /\b(?:politica|manual|documentacao|procedimento)\b.{0,60}\b(?:diz|preve|orient|determina|permite|proibe)\w*/.test(texto);
  const documentacao = (/\b(procedimento|politica interna|manual|instrucao de trabalho|passo a passo|processo interno|como devo|como faco|qual o processo)\b/.test(texto) ||
    orientacaoOperacional || consultaDocumentalExplicita) &&
    !/\b(sql|query|select)\b/.test(texto);
  if (documentacao) return 'documentacao';
  if (/\b(sql|query|select)\b|(?:crie|gere|monte|construa).{0,25}(?:consulta|relatorio)/.test(texto)) return 'sql';
  const auditoria = /\bbronze\b|dado[s]? bruto[s]?|auditori|versoes do registro|alteracoes do registro/.test(texto);
  if (auditoria) return 'bronze';

  const resumoAdministrativo = /(?:resumo|painel).{0,30}(?:administrativo|executivo)|(?:administrativo|executivo).{0,30}(?:resumo|painel)/.test(texto);
  const resumoMultidominio = /\bresumo\b|painel|visao geral/.test(texto) &&
    /vend|fatur|receita/.test(texto) &&
    /ruptur|risco.{0,20}estoque|sem estoque/.test(texto);
  if (resumoAdministrativo || resumoMultidominio) return 'indicadores';

  const bloqueiosEstoque =
    /(?:pedidos?|notas?).{0,35}(?:sem estoque|falta de estoque|bloqueio.{0,12}estoque)/.test(texto) ||
    /(?:bloqueio.{0,12}estoque|falta de estoque).{0,35}(?:pedidos?|notas?)/.test(texto) ||
    /por que.{0,25}(?:pedido|nota).{0,25}(?:sem estoque|falta de estoque|bloquead)/.test(texto);
  if (bloqueiosEstoque) return 'bloqueios_estoque';

  const giroEstoque = /(?:menor|baixo|pouco|sem).{0,15}giro|encalhad/.test(texto) &&
    /produto|sku|estoque|venda/.test(texto);
  if (giroEstoque) return 'estoque';

  const estoque = /ruptur|\bcobertura\b|risco.{0,20}estoque|sem estoque|(?:podem?|vai|irao).{0,15}(?:acabar|faltar)|estoque.{0,30}(acabar|dura|dias|critico|faltar|disponivel|atual|produto|sku)|(?:quanto|quantas?|qual).{0,25}\bestoque\b/.test(texto);
  const reposicoes = /pedidos? de compra|compras? agendadas?|\bagendament|nfs? de entrada|reposi[cç][aã]o|(?:produto|mercadoria).{0,30}(?:chegar|recebid)|(?:chegar|recebid).{0,30}(?:produto|mercadoria|fornecedor)/.test(texto);
  if (estoque && reposicoes) return 'estoque_reposicoes';
  if (estoque) return 'estoque';
  if (reposicoes) return 'reposicoes';

  const influencias = /influenci|contribui|fatores?.{0,45}(respons|explic|caus|por tras|levar|motiv|origin|gerar|provoc)|(?:caus|levou|levaram|motiv).{0,30}(queda|alta|crescimento|variacao|diferenca)|respons.vel.{0,25}(queda|alta|crescimento|variacao|diferenca)/.test(texto);
  if (influencias) return 'influencias';

  if (/frete|custo de entrega|custo logistico/.test(texto)) return 'frete';

  const listagemPedidos = /(?:liste|ultimos?|mais recentes).{0,35}pedidos|pedidos.{0,35}(?:mais recentes|ultimos?)/.test(texto);
  if (listagemPedidos) return 'vendas';

  const rankingPedidosPagos = /pedidos?.{0,15}pagos?/.test(texto) &&
    /(?:top|ranking|ranque|mais vend|maior receita)/.test(texto) &&
    /produto|marca|plataforma|transportadora|cliente|grupo|categoria/.test(texto);
  if (rankingPedidosPagos) return 'vendas';

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

  if (/funcionari|colaborador|transportadoras?/.test(texto)) return 'pessoas';

  const cadastroSilver = /cliente|regras? de transporte|tipos? de pedido|plataformas? disponiveis/.test(texto);
  if (cadastroSilver) return 'silver';

  if (/\bpedidos?\b/.test(texto)) return 'vendas';

  const catalogo = /catalog|produto|marca|grupo|subgrupo|categoria|sku|\bean\b|linha branca|composicao/.test(texto);
  if (catalogo) return 'catalogo';

  return 'hibrido';
}

function analisarRoteamento(pergunta) {
  const perfil = classificarPorRegras(pergunta);
  return {
    perfil,
    confianca: perfil === 'hibrido' ? 'baixa' : 'alta',
    origem: perfil === 'hibrido' ? 'fallback_hibrido' : 'regra_deterministica'
  };
}

function classificarPergunta(pergunta) {
  return analisarRoteamento(pergunta).perfil;
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

function referenciaContextual(pergunta) {
  const texto = normalizarTexto(pergunta);
  return /^(e |agora |tambem |nesse|nessa|nesses|nessas|desses|dessas|deles|delas|pode me passar|passe|repita|inclua|adicione|acrescente)/.test(texto)
    || /^(?:ta,?\s*)?(?:mas\s+)?(?:onde|qual (?:e |o )?(?:link|portal|site|sistema)|como (?:eu )?acesso|em qual (?:portal|site|sistema))\b/.test(texto)
    || /\b(esses|essas|estes|estas|os mesmos|as mesmas|novamente|resultado anterior|dados anteriores)\b/.test(texto)
    || /\b(?:outros?|outras?)\s+(?:bloqueios?|pedidos?|produtos?|resultados?|registros?)\b/.test(texto)
    || /\btambem\s*[?.!]*$/.test(texto);
}

function obterPerfilAnterior(historico = []) {
  for (let indice = historico.length - 1; indice >= 0; indice -= 1) {
    const item = historico[indice];
    if (item.perfil && PERFIS.includes(item.perfil) && item.perfil !== 'automatico') {
      return item.perfil;
    }
    const pergunta = normalizarTexto(item.pergunta);
    if (!referenciaContextual(pergunta)) {
      return classificarPergunta(pergunta);
    }
  }
  return null;
}

function resolverPerfilComContexto(pergunta, historico = [], solicitado = 'automatico') {
  return resolverRoteamentoComContexto(pergunta, historico, solicitado).perfil;
}

function resolverRoteamentoComContexto(
  pergunta,
  historico = [],
  solicitado = 'automatico'
) {
  if (solicitado !== 'automatico') {
    return {
      perfil: resolverPerfil(pergunta, solicitado),
      confianca: 'explicita',
      origem: 'perfil_solicitado'
    };
  }
  if (pedeMesmaCobertura(pergunta)) {
    const anterior = obterPerfilAnterior(historico);
    if (anterior) {
      return {
        perfil: anterior,
        confianca: 'contextual',
        origem: 'mesma_cobertura'
      };
    }
  }
  const ultimaPergunta = historico.at(-1)?.pergunta;
  const texto = ultimaPergunta && referenciaContextual(pergunta)
    ? `${ultimaPergunta} ${pergunta}`
    : pergunta;
  const roteamento = analisarRoteamento(texto);
  return {
    ...roteamento,
    origem: texto === pergunta
      ? roteamento.origem
      : 'continuacao_contextual'
  };
}

module.exports = {
  PERFIS,
  analisarRoteamento,
  classificarPergunta,
  normalizarTexto,
  obterPerfilAnterior,
  pedeMesmaCobertura,
  referenciaContextual,
  resolverPerfil,
  resolverPerfilComContexto,
  resolverRoteamentoComContexto
};
