function normalizarTexto(valor) {
  return String(valor || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function solicitaHistoricoTecnico(pergunta, contexto = {}) {
  const texto = normalizarTexto(pergunta);
  if (!texto) return false;
  if (/\b(?:sem (?:usar )?|nao (?:use|usar|considere) )(?:os? )?snapshots?\b/.test(texto)) return false;
  const alvoSnapshot = /\b(?:snapshots?|reprocessament(?:o|os)|execu(?:cao|coes) (?:do|da|de) (?:lake|pipeline)|cargas? (?:do|da|de) lake|historico tecnic(?:o|a)|auditoria (?:do|da|de) (?:lake|carga|snapshot)|vers(?:ao|oes) (?:do|da|de) (?:carga|lake|dataset|gold|silver|bronze)|atualizacoes? (?:do|da|de) lake)\b/.test(texto);
  const auditoriaTecnica = /\b(?:audit|diverg|confer|valid)\w*\b/.test(texto) &&
    /\b(?:registro bruto|dado bruto|origem|resultado modelado|carga|lake|pipeline)\b/.test(texto);
  return alvoSnapshot || auditoriaTecnica || contexto.decisao?.intencao === 'auditar';
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

function solicitaEnderecoDocumental(pergunta) {
  const texto = normalizarTexto(pergunta);
  return /\b(link|url|endereco|portal|site|sistema|painel|onde acess|como acess)\b/.test(texto);
}

function consultaDocumentalContextual(pergunta, contexto = {}) {
  const atual = String(pergunta || '').trim();
  if (!atual || atual.length > 1000) return null;
  if (!continuacaoDocumental(atual)) return atual;

  const anterior = String(contexto.perguntaAnterior || '').trim();
  if (anterior && anterior.length + atual.length + 1 <= 1000) {
    return `${anterior} ${atual}`;
  }

  const autonoma = String(contexto.perguntaAutonoma || '').trim();
  if (autonoma && autonoma.length <= 1000 && normalizarTexto(autonoma) !== normalizarTexto(atual)) {
    return autonoma;
  }
  return atual;
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
    const pergunta = contexto.perguntaAtual || contexto.pergunta ||
      contexto.decisao?.perguntaAutonoma || '';
    if (normalizados.visao === 'historico' && !solicitaHistoricoTecnico(pergunta, contexto)) {
      normalizados.visao = 'atual';
    }
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
    const buscaEndereco = solicitaEnderecoDocumental(perguntaAtual);
    if (novaBusca || buscaEndereco) delete normalizados.documento_id;
    if (!normalizados.documento_id && !novaBusca && !buscaEndereco && documentos.length === 1 &&
        continuacaoDocumental(perguntaAtual)) {
      normalizados.documento_id = documentos[0];
    }
    const consultaAncorada = consultaDocumentalAncorada(perguntaAtual);
    const consultaContextual = consultaDocumentalContextual(perguntaAtual, {
      perguntaAutonoma: contexto.decisao?.perguntaAutonoma,
      perguntaAnterior: contexto.perguntaAnterior
    });
    if (!normalizados.documento_id && (consultaAncorada || consultaContextual)) {
      // A pergunta do usuario e a ancora da recuperacao. A reformulacao livre do
      // modelo nao pode substituir silenciosamente os termos que expressam a
      // intencao real nem prender uma busca de link a um documento incompleto.
      normalizados.consulta = consultaAncorada || consultaContextual;
    }
  }
  if (nome === 'analisar_evolucao_produto' && contexto.contratoAnalitico) {
    const contrato = contexto.contratoAnalitico;
    normalizados.selecao = {
      modo: 'produtos',
      produtos: contrato.produtos.map((produto) => ({
        tipo: produto.tipo,
        valor: String(produto.valor)
      })),
      top_n: null,
      metrica_ranking: null,
      data_referencia_inicial: null,
      data_referencia_final: null
    };
    if (contrato.periodo) {
      normalizados.data_inicial = contrato.periodo.inicio;
      normalizados.data_final = contrato.periodo.fim;
    }
    normalizados.granularidade = contrato.granularidade || normalizados.granularidade || 'mes';
    normalizados.metricas = contrato.metricas;
    normalizados.comparar_periodo_anterior = false;
    return normalizados;
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
    'analisar_reposicoes', 'analisar_vendas', 'analisar_evolucao_produto',
    'diagnosticar_produto_360', 'detectar_excecoes_produto', 'comparar_canais_produto'
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
  consultaDocumentalContextual, continuacaoDocumental, novaBuscaDocumental,
  solicitaEnderecoDocumental, solicitaHistoricoTecnico,
  validarPoliticaExecucao };
