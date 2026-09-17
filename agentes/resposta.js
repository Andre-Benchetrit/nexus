const { formatarInstanteParaUsuario } = require('../tools/core/tempo');

function formatarDatasResposta(texto) {
  return String(texto || '')
    .replace(
      /\b(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.000)?Z\b/g,
      '$3/$2/$1'
    )
    .replace(
      /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})\b/g,
      (valor) => formatarInstanteParaUsuario(valor)
    )
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1');
}

const ROTULOS_METRICAS = Object.freeze({
  pedidos_validos: 'Pedidos válidos',
  pedidos_cancelados: 'Pedidos cancelados',
  pedidos_pendentes: 'Pedidos pendentes',
  pedidos_faturados: 'Pedidos faturados',
  pedidos_devolvidos: 'Pedidos devolvidos',
  pedidos_status_conflitante: 'Pedidos com status conflitante',
  valor_pedidos_validos: 'Valor dos pedidos válidos',
  valor_pedidos_pagos: 'Valor dos pedidos pagos',
  pedidos_pagos: 'Pedidos pagos',
  ticket_medio_pedido: 'Ticket médio do pedido',
  taxa_cancelamento_pct: 'Taxa de cancelamento',
  taxa_emissao_pct: 'Taxa de emissão',
  notas_emitidas: 'Notas emitidas',
  faturamento_emitido: 'Faturamento emitido',
  faturamento_total: 'Faturamento total',
  valor_devolucoes: 'Valor das devoluções vinculadas',
  faturamento_liquido: 'Faturamento líquido',
  ticket_medio_faturado: 'Ticket médio faturado',
  prazo_medio_emissao_dias: 'Prazo médio de emissão em dias'
});

const METRICAS_MONETARIAS = new Set([
  'valor_pedidos_validos',
  'valor_pedidos_pagos',
  'ticket_medio_pedido',
  'faturamento_emitido',
  'faturamento_total',
  'valor_devolucoes',
  'faturamento_liquido',
  'ticket_medio_faturado'
]);
const METRICAS_PERCENTUAIS = new Set(['taxa_cancelamento_pct', 'taxa_emissao_pct']);
const METRICAS_INTEIRAS = new Set([
  'pedidos_validos', 'pedidos_cancelados', 'pedidos_pendentes',
  'pedidos_faturados', 'pedidos_devolvidos', 'pedidos_status_conflitante',
  'pedidos_pagos', 'notas_emitidas'
]);

function dataCurta(valor) {
  return formatarDatasResposta(String(valor || '').slice(0, 10));
}

function formatarMetrica(nome, valor) {
  if (valor == null || valor === '') return 'não disponível';
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return String(valor);
  if (METRICAS_MONETARIAS.has(nome)) {
    return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  if (METRICAS_PERCENTUAIS.has(nome)) {
    return `${numero.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  }
  if (METRICAS_INTEIRAS.has(nome)) {
    return numero.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  }
  return numero.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function formatarPainelFocado(resultado) {
  if (
    !resultado ||
    resultado.operacao !== 'painel' ||
    (resultado.modo !== 'focado' && resultado.dados_disponiveis !== false)
  ) {
    return null;
  }
  if (resultado.dados_disponiveis !== true) {
    const linhas = [
      `Não há dados disponíveis para ${dataCurta(resultado.data_solicitada)}.`
    ];
    if (resultado.ultima_data_disponivel) {
      const parcial = resultado.cobertura?.ultima_data_parcial ? ' (parcial)' : '';
      linhas.push(
        `Última data disponível: ${dataCurta(resultado.ultima_data_disponivel)}${parcial}.`
      );
    }
    if (resultado.ultimo_dia_completo) {
      linhas.push(`Último dia completo: ${dataCurta(resultado.ultimo_dia_completo)}.`);
    }
    if (resultado.cobertura?.atualizado_em) {
      linhas.push(
        `Indicadores atualizados em ${formatarInstanteParaUsuario(resultado.cobertura.atualizado_em)}.`
      );
    }
    return linhas.join('\n');
  }

  const parcial = resultado.dados_parciais ? ' (dados parciais)' : ' (dados completos)';
  const linhas = [`Data analisada: ${dataCurta(resultado.data_analisada)}${parcial}.`];
  for (const [nome, valor] of Object.entries(resultado.metricas || {})) {
    linhas.push(`${ROTULOS_METRICAS[nome] || nome}: ${formatarMetrica(nome, valor)}.`);
  }
  if (resultado.cobertura?.atualizado_em) {
    linhas.push(
      `Indicadores atualizados em ${formatarInstanteParaUsuario(resultado.cobertura.atualizado_em)}.`
    );
  }
  return linhas.join('\n');
}

function escaparCelula(valor) {
  return String(valor ?? '—').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim() || '—';
}

function formatarRankingProdutos(resultadosTools = []) {
  const item = [...resultadosTools].reverse().find((entrada) => {
    const resultado = entrada.resultado;
    return ['analisar_vendas', 'analisar_desempenho'].includes(entrada.nome) &&
      resultado?.agrupado_por === 'produto' && Array.isArray(resultado.dados);
  });
  const resultado = item?.resultado;
  if (!resultado?.dados?.length) return null;
  const possuiReceita = resultado.dados.some((linha) => (
    linha.valor_total_vendido != null || linha.faturamento_emitido != null
  ));
  const linhas = [
    possuiReceita ? 'Ranking de produtos por receita' : 'Ranking de produtos',
    ''
  ];
  if (resultado.periodo?.inicio) {
    linhas.push(
      `Período: ${dataCurta(resultado.periodo.inicio)} a ${dataCurta(resultado.periodo.fim || resultado.periodo.inicio)}.`,
      ''
    );
  }
  const possuiEan = resultado.dados.some((linha) => linha.ean != null);
  linhas.push(`| # | Produto | Código auxiliar (SKU) | ${possuiEan ? 'EAN | ' : ''}Receita | Quantidade |`);
  linhas.push(`|---:|---|---|${possuiEan ? '---|' : ''}---:|---:|`);
  resultado.dados.forEach((linha, indice) => {
    const receita = linha.valor_total_vendido ?? linha.faturamento_emitido;
    const quantidade = linha.quantidade_vendida ?? linha.quantidade_faturada;
    linhas.push(`| ${indice + 1} | ${escaparCelula(linha.descricao_produto || linha.produto)} | ` +
      `${escaparCelula(linha.sku)} | ${possuiEan ? `${escaparCelula(linha.ean)} | ` : ''}` +
      `${receita == null ? '—' : formatarMetrica('faturamento_total', receita)} | ` +
      `${quantidade == null ? '—' : formatarMetrica('notas_emitidas', quantidade)} |`);
  });
  linhas.push('', 'SKU corresponde ao código auxiliar cadastrado; o identificador interno do produto não é usado como SKU.');
  return linhas.join('\n');
}

function corrigirAlegacaoAusenciaDocumental(texto, resultadosTools = []) {
  const consultouDocumentacao = resultadosTools.some((item) =>
    item.nome === 'consultar_documentacao');
  const original = String(texto || '');
  if (!consultouDocumentacao || !original.trim()) return original;
  const normalizar = (valor) => String(valor || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const sentencas = original.split(/(?<=[.!?])\s+/u);
  let removeuAlegacao = false;
  const preservadas = sentencas.filter((sentenca) => {
    const normalizada = normalizar(sentenca);
    const ausenciaAbsoluta = /\b(?:nao existe|nao ha)\b/.test(normalizada);
    const contextoDocumental = /\b(?:base|documentacao|documento|manual|guia|procedimento|politica|identidade visual)\b/.test(normalizada);
    if (!ausenciaAbsoluta || !contextoDocumental) return true;
    removeuAlegacao = true;
    return false;
  });
  if (!removeuAlegacao) return original;
  const ressalva = 'A busca realizada não localizou esse conteúdo com relevância suficiente nos resultados retornados. Isso não comprova que o documento não exista na base autorizada.';
  const restante = preservadas.join(' ').trim();
  return restante ? `${ressalva}\n\n${restante}` : ressalva;
}

function aplicarGarantiasResposta(texto, resultadosTools = []) {
  const painelFocado = [...resultadosTools].reverse().find((item) => (
    item.nome === 'analisar_indicadores' &&
    item.resultado?.operacao === 'painel' &&
    (
      item.resultado?.modo === 'focado' ||
      item.resultado?.dados_disponiveis === false
    )
  ));
  let resposta = formatarRankingProdutos(resultadosTools)
    || formatarPainelFocado(painelFocado?.resultado)
    || formatarDatasResposta(texto);
  resposta = corrigirAlegacaoAusenciaDocumental(resposta, resultadosTools);
  const ultimoRecebimento = [...resultadosTools].reverse().find((item) => (
    item.nome === 'analisar_reposicoes' &&
    item.resultado?.operacao === 'ultimo_recebimento' &&
    item.resultado?.encontrado === true
  ));
  const notas = ultimoRecebimento?.resultado?.notas_fiscais_entrada || [];
  if (
    notas.length &&
    !/\b(?:nfs?|notas? fiscais?)(?: de entrada)?\b/i.test(resposta)
  ) {
    resposta += `\n\nNotas fiscais de entrada: ${notas.join(', ')}.`;
  }
  return resposta;
}

function normalizarResultadoTool(resultado) {
  if (typeof resultado !== 'string') return resultado;
  try {
    return JSON.parse(resultado);
  } catch (_) {
    return resultado;
  }
}

function extrairIdentificadoresNegocio(texto) {
  const valor = String(texto || '');
  const padroes = [
    /\b\d{3}-\d{7}-\d{7}\b/g,
    /\b\d{13,14}\b/g,
    /\b\d{7}\b/g,
    /\b(?=[A-Z0-9_-]{8,}\b)(?=[A-Z0-9_-]*\d)[A-Z0-9_-]+\b/g
  ];
  const encontrados = padroes.flatMap((padrao) => valor.match(padrao) || []);
  return [...new Set(encontrados)].filter((item) => (
    !/^20\d{2}[01]\d[0-3]\d$/.test(item) &&
    !/^\d{8}T\d/.test(item)
  ));
}

function avaliarSustentacaoFactual(texto, resultadosTools = []) {
  if (!resultadosTools.length) {
    return { status: 'sem_evidencia', identificadoresNaoSustentados: [] };
  }
  const evidencia = JSON.stringify(resultadosTools.map((item) => item.resultado ?? item));
  const identificadores = extrairIdentificadoresNegocio(texto);
  const naoSustentados = identificadores.filter((item) => !evidencia.includes(item));
  return {
    status: naoSustentados.length ? 'revisao_necessaria' : 'comprovada',
    identificadoresNaoSustentados: naoSustentados,
    identificadoresVerificados: identificadores.length - naoSustentados.length
  };
}

function possuiSinalParcial(valor) {
  if (!valor || typeof valor !== 'object') return false;
  if (Array.isArray(valor)) return valor.some(possuiSinalParcial);
  if (
    valor.resultado_truncado === true || valor.truncado === true ||
    valor.dados_parciais === true || valor.status_conflitante === true
  ) return true;
  return Object.values(valor).some(possuiSinalParcial);
}

function possuiColecaoVazia(valor) {
  if (!valor || typeof valor !== 'object') return false;
  const chavesColecao = [
    'dados', 'itens', 'pedidos', 'parcelas', 'resultados', 'bloqueios',
    'agendamentos', 'linhas'
  ];
  return chavesColecao.some((chave) => Array.isArray(valor[chave]) && valor[chave].length === 0);
}

function resultadoExplicitamenteVazio(valor) {
  if (!valor || typeof valor !== 'object') return false;
  if (Array.isArray(valor)) return valor.length === 0;
  return valor.dados_disponiveis === false || valor.encontrado === false ||
    valor.total === 0 || possuiColecaoVazia(valor);
}

function extrairCamposValores(valor, acumulado = {}) {
  if (Array.isArray(valor)) {
    valor.forEach((item) => extrairCamposValores(item, acumulado));
    return acumulado;
  }
  if (!valor || typeof valor !== 'object') return acumulado;
  for (const [chave, item] of Object.entries(valor)) {
    if (item == null) continue;
    if (!acumulado[chave]) acumulado[chave] = [];
    if (['string', 'number', 'boolean', 'bigint'].includes(typeof item)) {
      acumulado[chave].push(String(item));
    } else if (Array.isArray(item) && item.every((subitem) => (
      subitem == null || ['string', 'number', 'boolean', 'bigint'].includes(typeof subitem)
    ))) {
      acumulado[chave].push(...item.filter((subitem) => subitem != null).map(String));
    }
    extrairCamposValores(item, acumulado);
  }
  return acumulado;
}

function extrairDatasEValores(valor, acumulado = { datas: new Set(), numeros: new Set() }) {
  if (Array.isArray(valor)) {
    valor.forEach((item) => extrairDatasEValores(item, acumulado));
    return acumulado;
  }
  if (valor && typeof valor === 'object') {
    Object.values(valor).forEach((item) => extrairDatasEValores(item, acumulado));
    return acumulado;
  }
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    acumulado.numeros.add(String(valor));
  }
  if (typeof valor === 'string') {
    for (const data of valor.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []) acumulado.datas.add(data);
    const numero = Number(valor.replace(',', '.'));
    if (Number.isFinite(numero) && valor.trim() !== '') acumulado.numeros.add(String(numero));
  }
  return acumulado;
}

function classificarEvidencia(resultadosTools = []) {
  if (!resultadosTools.length) return 'error';
  const resultados = resultadosTools.map((item) => item.resultado ?? item);
  if (resultados.every(resultadoExplicitamenteVazio)) return 'empty';
  if (resultados.some(possuiSinalParcial) || resultados.some(resultadoExplicitamenteVazio)) {
    return 'partial';
  }
  return 'complete';
}

function normalizarTextoBusca(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function inferirCamposObrigatorios(decisao = {}) {
  const obrigatorios = new Set();
  const pergunta = normalizarTextoBusca(decisao.perguntaAutonoma);
  for (const requisito of decisao.requisitosResposta || []) {
    const correspondencia = String(requisito).match(/^campo:([a-z0-9_]+)$/i);
    if (correspondencia) obrigatorios.add(correspondencia[1].toLowerCase());
  }

  // Campos sugeridos pelo roteador ajudam no planejamento, mas somente uma
  // exigencia identificavel na pergunta ou no contrato torna o campo obrigatorio.
  const regras = [
    ['marketplace_pedido', /\bmarketplace[_ ]pedido\b|\bnumero(?:s)? (?:do )?pedido(?:s)?\b/],
    ['ean', /\bean\b|codigo(?:s)? de barra(?:s)?/],
    ['sku', /\bsku(?:s)?\b/],
    ['fornecedor', /\bfornecedor(?:es)?\b/],
    ['marca', /\bmarca(?:s)?\b/],
    ['data_prevista', /data prevista|previsao de chegada/],
    ['numero_pedido_compra', /pedido(?:s)? de compra/],
    ['quantidade_pedida', /quantidade(?:s)? pedida(?:s)?/],
    ['quantidade_recebida', /quantidade(?:s)? recebida(?:s)?/],
    ['quantidade_pendente', /quantidade(?:s)? pendente(?:s)?/]
  ];
  for (const [campo, padrao] of regras) {
    if (padrao.test(pergunta)) obrigatorios.add(campo);
  }
  return [...obrigatorios];
}

function criarManifestoFactual(resultadosTools = [], decisao = {}) {
  const resultados = resultadosTools.map((item) => item.resultado ?? item);
  const referencias = {};
  for (const item of resultadosTools) {
    for (const [chave, valores] of Object.entries(item.referencias || {})) {
      referencias[chave] ||= [];
      referencias[chave].push(...(Array.isArray(valores) ? valores : [valores]));
    }
  }
  for (const [chave, valores] of Object.entries(referencias)) {
    referencias[chave] = [...new Set(valores.map(String))];
  }
  const extraidos = extrairDatasEValores(resultados);
  const camposValores = Object.fromEntries(Object.entries(extrairCamposValores(resultados))
    .map(([campo, valores]) => [campo, [...new Set(valores)]]));
  const camposSolicitados = [...new Set((decisao.camposSolicitados || []).map(String))];
  const camposObrigatorios = inferirCamposObrigatorios(decisao);
  return {
    referencias,
    identificadores: extrairIdentificadoresNegocio(JSON.stringify(resultados)),
    datas: [...extraidos.datas],
    numeros: [...extraidos.numeros],
    camposSolicitados,
    camposObrigatorios,
    camposComprovados: Object.keys(camposValores),
    camposAusentes: camposObrigatorios.filter((campo) => !Object.hasOwn(camposValores, campo)),
    valoresPorCampo: camposValores,
    ferramentas: resultadosTools.map((item) => item.nome),
    resultados: resultados.length
  };
}

function criarEnvelopeEvidencia(resultadosTools = [], decisao = {}) {
  const manifesto = criarManifestoFactual(resultadosTools, decisao);
  const statusBase = classificarEvidencia(resultadosTools);
  const status = statusBase === 'complete' && manifesto.camposAusentes.length
    ? 'partial' : statusBase;
  return {
    status,
    manifesto,
    comprovada: status === 'complete' || status === 'partial' || status === 'empty'
  };
}

function textoIndicaIndisponibilidade(texto) {
  return /(?:nao|não) (?:consegui|consigo|foi possivel|foi possível).{0,80}(?:acessar|consultar|obter)|consulta (?:esta|está|ficou) indisponivel|base.{0,30}indisponivel/i
    .test(String(texto || ''));
}

function validarSinteseCorporativa(texto, envelope) {
  const motivos = [];
  const status = envelope?.evidence?.status || envelope?.status;
  const manifesto = envelope?.evidence?.manifest || envelope?.manifesto || {};
  if (['complete', 'partial', 'empty'].includes(status) && textoIndicaIndisponibilidade(texto)) {
    motivos.push('contradicao_disponibilidade');
  }
  const identificadoresPermitidos = new Set(manifesto.identifiers || manifesto.identificadores || []);
  const referencias = manifesto.references || manifesto.referencias || {};
  Object.values(referencias).flat().forEach((item) => identificadoresPermitidos.add(String(item)));
  const inventados = extrairIdentificadoresNegocio(texto)
    .filter((item) => !identificadoresPermitidos.has(item));
  if (inventados.length) motivos.push('identificador_sem_evidencia');
  const datasPermitidas = new Set(manifesto.dates || manifesto.datas || []);
  const datasTexto = String(texto || '').match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
  if (datasTexto.some((data) => !datasPermitidas.has(data))) motivos.push('cobertura_temporal_alterada');
  const camposIdentificadores = new Set([
    'marketplace_pedido', 'id_nota_saida', 'nota_fiscal', 'sku', 'ean',
    'numero_pedido_compra'
  ]);
  for (const campo of manifesto.camposObrigatorios || []) {
    if (!camposIdentificadores.has(campo)) continue;
    const valores = manifesto.valoresPorCampo?.[campo] || [];
    if (valores.length && !valores.some((valor) => String(texto || '').includes(valor))) {
      motivos.push(`campo_obrigatorio_ausente:${campo}`);
    }
  }
  return { valida: motivos.length === 0, motivos: [...new Set(motivos)] };
}

module.exports = {
  aplicarGarantiasResposta,
  avaliarSustentacaoFactual,
  classificarEvidencia,
  criarEnvelopeEvidencia,
  criarManifestoFactual,
  corrigirAlegacaoAusenciaDocumental,
  extrairIdentificadoresNegocio,
  formatarDatasResposta,
  formatarPainelFocado,
  formatarRankingProdutos,
  normalizarResultadoTool,
  textoIndicaIndisponibilidade,
  validarSinteseCorporativa
};
