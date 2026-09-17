function normalizarTexto(valor) {
  return String(valor || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function novaBuscaDocumental(pergunta) {
  const texto = normalizarTexto(pergunta);
  const acao = /\b(busque|buscar|procure|procurar|pesquise|pesquisar|consulte|consultar|verifique|verificar|tente)\b/.test(texto);
  const alvo = /\b(manual|documento|guia|politica|procedimento|identidade visual|brand guide|brand book)\b/.test(texto);
  return acao && alvo;
}

function continuacaoDocumental(pergunta) {
  const texto = normalizarTexto(pergunta);
  return /\b(isso|esse|essa|estes|estas|nesse|nessa|neste|nesta|o mesmo|a mesma|anterior)\b/.test(texto) ||
    /^(?:ta,?\s*)?(?:mas\s+)?(?:onde|qual (?:e |o )?(?:link|portal|site|sistema)|como (?:eu )?acesso|em qual (?:portal|site|sistema))\b/.test(texto);
}

function consultaDocumentalAncorada(pergunta) {
  const original = String(pergunta || '').trim();
  if (!original || original.length > 1000) return null;
  if (novaBuscaDocumental(original)) return original;
  const texto = normalizarTexto(original);
  const identidadeExplicita = /\b(manual (?:d[ae] )?marca|guia (?:d[ae] )?marca|identidade visual|brand guide|brand book|padrao (?:visual|da marca)|diretrizes? (?:visuais|da marca))\b/.test(texto);
  const aplicacaoNoPadrao = /\b(banner|peca|material|site|post|publicacao)\b/.test(texto) &&
    /\b(padrao da marca|identidade visual|diretrizes? da marca)\b/.test(texto);
  if (!identidadeExplicita && !aplicacaoNoPadrao) return null;
  return `${original}\nTermos de recuperação: manual de marca; identidade visual; diretrizes oficiais da marca.`;
}

function aplicarPoliticaArgumentos(nome, argumentos, contexto = {}) {
  const normalizados = { ...(argumentos || {}) };
  if (/^(consultar|agregar)_(gold|silver|bronze)$/.test(nome)) {
    if (normalizados.combinacao_filtros === 'e') normalizados.combinacao_filtros = 'todos';
    if (normalizados.combinacao_filtros === 'ou') normalizados.combinacao_filtros = 'qualquer';
  }
  if (
    nome === 'consultar_bloqueios_sem_estoque' &&
    contexto.decisao?.intencao === 'enriquecer'
  ) {
    normalizados.operacao = 'listar_itens';
    const pedidos = contexto.referenciasAnteriores?.marketplace_pedido || [];
    if (pedidos.length && !normalizados.marketplace_pedido && !normalizados.marketplace_pedidos?.length) {
      normalizados.marketplace_pedidos = [...pedidos];
    }
  }
  if (nome === 'consultar_documentacao') {
    const documentos = contexto.referenciasAnteriores?.documento_id || [];
    const perguntaAtual = String(contexto.perguntaAtual || contexto.pergunta ||
      contexto.decisao?.perguntaAutonoma || '');
    const novaBusca = novaBuscaDocumental(perguntaAtual);
    if (novaBusca) delete normalizados.documento_id;
    if (!normalizados.documento_id && !novaBusca && documentos.length === 1 &&
        continuacaoDocumental(perguntaAtual)) {
      normalizados.documento_id = documentos[0];
    }
    const consultaAncorada = consultaDocumentalAncorada(perguntaAtual);
    if (consultaAncorada && !normalizados.documento_id) {
      normalizados.consulta = consultaAncorada;
    }
  }
  const temporal = contexto.temporal;
  if (nome === 'analisar_influencias' && temporal?.tipo === 'comparacao_periodos') {
    normalizados.data_inicial = temporal.inicio;
    normalizados.data_final = temporal.fim;
    normalizados.data_inicial_anterior = temporal.periodoAnterior.inicio;
    normalizados.data_final_anterior = temporal.periodoAnterior.fim;
    return normalizados;
  }
  const ferramentasComPeriodo = new Set([
    'analisar_desempenho', 'analisar_frete', 'analisar_giro_estoque',
    'analisar_indicadores', 'analisar_influencias', 'analisar_operacao',
    'analisar_reposicoes', 'analisar_vendas'
  ]);
  if (temporal && ferramentasComPeriodo.has(nome)) {
    normalizados.data_inicial = temporal.inicio;
    normalizados.data_final = temporal.fim;
  }
  if (nome !== 'analisar_indicadores' || !temporal) return normalizados;

  if (temporal.tipo === 'comparacao_periodos') {
    normalizados.data_inicial_anterior = temporal.periodoAnterior.inicio;
    normalizados.data_final_anterior = temporal.periodoAnterior.fim;
  }
  normalizados.recencia = null;
  if (
    temporal.inicio === temporal.fim &&
    !['comparar', 'tendencia'].includes(normalizados.operacao)
  ) {
    normalizados.operacao = 'painel';
  }
  return normalizados;
}

function validarPoliticaExecucao(nome, contexto = {}) {
  if (nome !== 'consultar_bloqueios_sem_estoque' || !contexto.temporal) return;
  const { inicio, fim } = contexto.temporal;
  const referencia = contexto.dataReferencia;
  if (inicio && fim && referencia && (inicio !== referencia || fim !== referencia)) {
    const erro = new Error(
      'A fachada de bloqueios sem estoque comprova somente a visao atual; ' +
      'ela nao pode responder uma data historica como se fosse o estado daquele dia.'
    );
    erro.codigo = 'CAPACIDADE_TEMPORAL_NAO_SUPORTADA';
    throw erro;
  }
}

module.exports = { aplicarPoliticaArgumentos, consultaDocumentalAncorada,
  continuacaoDocumental, novaBuscaDocumental, validarPoliticaExecucao };
