const MAX_PRODUTOS = 20;

function normalizarTexto(valor) {
  return String(valor || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function referenciaCoorteProdutos(pergunta) {
  const texto = normalizarTexto(pergunta);
  const referencia = /\b(?:ess[ae]s?|estes?|estas?|mesm[oa]s?|deles?|delas?|essa base|esta base|base anterior|resultado anterior)\b/.test(texto);
  const alvo = /\b(?:produtos?|itens?|base|ranking|lista|selecao|coorte)\b/.test(texto);
  const preservacao = /\b(?:mantenha|manter|preserve|preservar|continue|continuar|compare|comparar|evolucao|acompanhe|acompanhar)\b/.test(texto);
  return (referencia && alvo) || (referencia && preservacao);
}

function pedeJanelaAdjacente(pergunta) {
  const texto = normalizarTexto(pergunta);
  const anterior = /\b(?:mes|periodo) anterior\b|\banterior ao (?:mes|periodo|pesquisado|analisado)\b/.test(texto);
  const seguinte = /\b(?:proximo|seguinte) (?:mes|periodo)\b|\b(?:mes|periodo) (?:posterior|seguinte)\b/.test(texto);
  return anterior && seguinte;
}

function inicioMes(data) {
  return `${String(data).slice(0, 7)}-01`;
}

function deslocarMes(inicio, deslocamento) {
  const [ano, mes] = String(inicio).split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1 + deslocamento, 1));
  return data.toISOString().slice(0, 10);
}

function fimMes(inicio) {
  const proximo = deslocarMes(inicioMes(inicio), 1);
  const data = new Date(`${proximo}T00:00:00.000Z`);
  data.setUTCDate(data.getUTCDate() - 1);
  return data.toISOString().slice(0, 10);
}

function periodoValido(periodo) {
  const inicio = periodo?.data_inicial || periodo?.inicio;
  const fim = periodo?.data_final || periodo?.fim;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(inicio || '')) &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(fim || ''))
    ? { inicio, fim } : null;
}

function ultimaInteracaoComProdutos(historico = []) {
  return [...historico].reverse().find((item) => {
    const refs = item?.referencias || item?.entidades || {};
    const possuiProdutos = ['id_produto', 'ids_produtos', 'sku', 'skus']
      .some((chave) => Array.isArray(refs[chave]) && refs[chave].length);
    return possuiProdutos || (item?.ferramentas || []).some((ferramenta) =>
      ['analisar_desempenho', 'analisar_evolucao_produto', 'comparar_canais_produto']
        .includes(ferramenta.nome));
  }) || null;
}

function selecaoDasReferencias(interacao) {
  const refs = interacao?.referencias || interacao?.entidades || {};
  const ids = [...new Set([
    ...(refs.id_produto || []), ...(refs.ids_produtos || [])
  ].map(String).filter((valor) => /^\d+$/.test(valor)))].slice(0, MAX_PRODUTOS);
  if (ids.length) return ids.map((valor) => ({ tipo: 'id_produto', valor }));
  const skus = [...new Set([
    ...(refs.sku || []), ...(refs.skus || [])
  ].map((valor) => String(valor).trim()).filter(Boolean))].slice(0, MAX_PRODUTOS);
  return skus.map((valor) => ({ tipo: 'sku', valor }));
}

function extrairSelecaoProdutosDasLinhas(linhas = []) {
  const unicos = new Map();
  for (const linha of linhas) {
    const id = linha?.id_produto == null ? '' : String(linha.id_produto).trim();
    const sku = String(linha?.sku || linha?.codigo_auxiliar || '').trim();
    const item = /^\d+$/.test(id)
      ? { tipo: 'id_produto', valor: id, ...(sku ? { sku } : {}) }
      : sku ? { tipo: 'sku', valor: sku } : null;
    if (!item) continue;
    unicos.set(`${item.tipo}:${item.valor}`, item);
    if (unicos.size > MAX_PRODUTOS) return null;
  }
  return [...unicos.values()];
}

function metricasDaInteracao(interacao) {
  const permitidas = new Set([
    'quantidade_pedida', 'valor_pedidos', 'quantidade_faturada', 'faturamento_emitido'
  ]);
  for (const ferramenta of [...(interacao?.ferramentas || [])].reverse()) {
    const argumentos = ferramenta?.argumentos || {};
    const diretas = (argumentos.metricas || []).filter((metrica) => permitidas.has(metrica));
    if (diretas.length) return [...new Set(diretas)];
    const ordenacao = normalizarTexto(argumentos.ordenar_por || '');
    if (/faturamento|receita|valor_total_vendido/.test(ordenacao)) {
      return ['faturamento_emitido', 'quantidade_faturada'];
    }
    if (/quantidade/.test(ordenacao)) return ['quantidade_faturada', 'faturamento_emitido'];
  }
  return ['faturamento_emitido', 'quantidade_faturada'];
}

function criarContratoContinuidadeProduto({ pergunta, historico = [], selecaoAutorizada = null } = {}) {
  if (!referenciaCoorteProdutos(pergunta)) return null;
  const anterior = ultimaInteracaoComProdutos(historico);
  if (!anterior && !selecaoAutorizada?.produtos?.length) return null;
  const produtos = (selecaoAutorizada?.produtos?.length
    ? selecaoAutorizada.produtos : selecaoDasReferencias(anterior)).slice(0, MAX_PRODUTOS);
  if (!produtos.length || produtos.length > MAX_PRODUTOS) return null;
  const periodoBase = periodoValido(anterior?.periodo || anterior?.rota?.periodo);
  let periodo = null;
  if (pedeJanelaAdjacente(pergunta) && periodoBase) {
    const base = inicioMes(periodoBase.inicio);
    const primeiro = deslocarMes(base, -1);
    const ultimo = deslocarMes(base, 1);
    periodo = {
      inicio: primeiro,
      fim: fimMes(ultimo),
      base: { inicio: base, fim: fimMes(base) },
      origem: 'mes_anterior_base_proximo_mes'
    };
  }
  return {
    tipo: 'coorte_produtos',
    produtos,
    quantidadeProdutos: produtos.length,
    periodo,
    granularidade: periodo ? 'mes' : null,
    metricas: metricasDaInteracao(anterior),
    resultRefId: selecaoAutorizada?.resultRefId || null
  };
}

function aplicarContratoNaDecisao(decisao, contrato) {
  if (!decisao || !contrato) return decisao;
  const periodo = contrato.periodo ? {
    data_inicial: contrato.periodo.inicio,
    data_final: contrato.periodo.fim,
    referencia: contrato.periodo.origem
  } : decisao.periodo;
  return {
    ...decisao,
    dominioPrimario: 'inteligencia_produto',
    dominiosSecundarios: (decisao.dominiosSecundarios || [])
      .filter((dominio) => dominio !== 'inteligencia_produto'),
    intencao: 'comparar',
    periodo,
    planoSugerido: [{
      ferramenta: 'analisar_evolucao_produto',
      finalidade: 'comparar uma coorte fixa de produtos entre períodos'
    }],
    capacidadesAusentes: [],
    precisaEsclarecimento: false,
    perguntaEsclarecimento: null,
    transformacoesSolicitadas: [...new Set([
      ...(decisao.transformacoesSolicitadas || []), 'comparar_periodos'
    ])],
    requisitosResposta: [...new Set([
      ...(decisao.requisitosResposta || []), 'campo:sku',
      'preservar_coorte_produtos', 'preservar_janela_temporal'
    ])],
    codigosMotivo: [...new Set([
      ...(decisao.codigosMotivo || []), 'contrato_continuidade_produto'
    ])],
    contratoAnalitico: contrato
  };
}

module.exports = {
  MAX_PRODUTOS,
  aplicarContratoNaDecisao,
  criarContratoContinuidadeProduto,
  extrairSelecaoProdutosDasLinhas,
  pedeJanelaAdjacente,
  referenciaCoorteProdutos
};
