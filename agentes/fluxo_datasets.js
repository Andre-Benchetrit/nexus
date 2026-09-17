const { completarAnoEmDatas, extrairContextoTemporal, obterDataReferencia } = require('./contexto_temporal');

function normalizar(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function intencaoExportar(pergunta) {
  const texto = normalizar(pergunta);
  return /\b(?:gere|gerar|crie|criar|monte|montar|produza|produzir|exporte|exportar|faca|fazer|quero|preciso|forneca|disponibilize|dar|transforme|transformar|converta|converter|coloque|colocar|organize|organizar|envie|enviar|entregue|entregar|salve|salvar)\b[\s\S]{0,100}\b(?:arquivo|planilha|excel|xlsx|word|docx|pdf|relatorio|documento)\b/.test(texto) ||
    /\bme\s+de\b[\s\S]{0,100}\b(?:arquivo|planilha|excel|xlsx|word|docx|pdf|relatorio|documento)\b/.test(texto) ||
    /^(?:uma\s+)?(?:planilha|excel|xlsx|word|docx|pdf|relatorio|documento)\b[\s\S]{0,100}\b(?:com|dos|das|sobre|contendo|incluindo)\b/.test(texto) ||
    /\b(?:arquivo|planilha|excel|xlsx|word|docx|pdf)\b[\s\S]{0,80}\b(?:baixar|download|pronto)\b/.test(texto);
}

function limiteRankingSolicitado(pergunta) {
  const texto = normalizar(pergunta);
  const encontrado = /\btop\s+(\d{1,4})\b|\b(?:os|as)\s+(\d{1,4})\s+(?:produtos|itens)\b/.exec(texto);
  if (!encontrado) return null;
  const limite = Number(encontrado[1] || encontrado[2]);
  return Number.isInteger(limite) && limite > 0 ? limite : null;
}

function dominioDaReferencia(referencia) {
  const ferramenta = String(referencia?.origem?.ferramenta || '');
  if (ferramenta === 'analisar_vendas') return { dominio: 'vendas', operacao: 'ranquear' };
  if (ferramenta === 'analisar_giro_estoque') return { dominio: 'estoque', operacao: 'filtrar' };
  return null;
}

function referenciaConjunto(pergunta) {
  const texto = normalizar(pergunta);
  return /\b(?:deste|desta|desse|dessa|destes|destas|desses|dessas|deles|delas|nesses|nessas|da planilha|do arquivo|na planilha|no arquivo|itens da|produtos da|produtos anexados|itens anexados|esta lista|essa lista|esses produtos|essas informacoes)\b/.test(texto);
}

function solicitaConsultaSysemp(pergunta, dominio = null) {
  const texto = normalizar(pergunta);
  const fonteExplicita = /\b(?:sysemp|dados internos|base interna|base corporativa|dados corporativos|sistema da empresa|cadastro da empresa|no nexus|do nexus)\b/.test(texto);
  if (fonteExplicita) return true;
  const acaoExterna = /\b(?:consulte|consultar|busque|buscar|puxe|puxar|traga|trazer|adicione|adicionar|inclua|incluir|enrique[cç]a|enriquecer|cruze|cruzar)\b/.test(texto);
  if (acaoExterna && /\b(?:estoque|saldo|vendas?|faturamento|receita|catalogo|cadastro|sku|ean|codigo auxiliar|codigo de barras)\b/.test(texto)) return true;
  if (dominio?.dominio === 'estoque' && /\b(?:estoque atual|saldo atual|sem estoque|ruptura)\b/.test(texto)) return true;
  if (dominio?.dominio === 'vendas' && /\b(?:este|neste|ultimo|ultimos|mes atual|hoje|agora)\b/.test(texto) &&
      /\b(?:mais vendeu|mais vendido|vendas?|faturamento|receita)\b/.test(texto)) return true;
  return false;
}

function classificarDominio(pergunta) {
  const texto = normalizar(pergunta);
  if (/\b(?:estoque|sem estoque|saldo|reservad|ruptura)\b/.test(texto)) return { dominio: 'estoque', operacao: /sem estoque|zerad|falta/.test(texto) ? 'filtrar' : 'enriquecer' };
  if (/\b(?:venda|vendeu|vendido|vendidos|vendas|fatur|receita|mais vendeu|mais vendido)\b/.test(texto)) return { dominio: 'vendas', operacao: /mais vend|ranking|ranque|maior/.test(texto) ? 'ranquear' : 'enriquecer' };
  if (/\b(?:catalogo|ean|codigo de barras|sku|codigo auxiliar|marca|categoria|cadastro)\b/.test(texto)) return { dominio: 'catalogo', operacao: 'enriquecer' };
  return null;
}

function extrairPeriodo(pergunta, dataReferencia = obterDataReferencia()) {
  const completa = completarAnoEmDatas(pergunta, dataReferencia);
  const contexto = extrairContextoTemporal(completa, dataReferencia);
  if (contexto?.inicio) return { inicio: contexto.inicio, fim: contexto.fim || contexto.inicio };
  const texto = normalizar(pergunta);
  const ultimos = /ultim(?:os|as)?\s+(\d{1,4})\s+dias/.exec(texto);
  if (ultimos) {
    const fim = new Date(`${dataReferencia}T00:00:00.000Z`);
    fim.setUTCDate(fim.getUTCDate() - Math.max(0, Number(ultimos[1]) - 1));
    return { inicio: fim.toISOString().slice(0, 10), fim: dataReferencia };
  }
  if (/\b(?:este|neste|desse|deste) mes\b|\bmes atual\b/.test(texto)) {
    return { inicio: `${dataReferencia.slice(0, 7)}-01`, fim: dataReferencia };
  }
  return null;
}

function classificarFluxoDatasets(pergunta, {
  possuiXlsx = false, possuiRefAnterior = false, referenciaAnterior = null
} = {}) {
  const exportar = intencaoExportar(pergunta);
  const dominio = classificarDominio(pergunta) || dominioDaReferencia(referenciaAnterior);
  const relacionaArquivo = possuiXlsx && referenciaConjunto(pergunta) && Boolean(dominio) &&
    solicitaConsultaSysemp(pergunta, dominio);
  if (relacionaArquivo) return { fluxo: exportar ? 'misto_e_exportar' : 'misto', exportar,
    ...dominio, periodo: dominio.dominio === 'vendas' ? extrairPeriodo(pergunta) : null };
  const enriquecerCatalogo = possuiRefAnterior &&
    /\b(?:inclua|incluir|adicione|adicionar|acrescente|complemente)\b[\s\S]{0,100}\b(?:ean|codigo de barras|sku|codigo auxiliar|marca|categoria)\b/.test(normalizar(pergunta));
  const limiteSolicitado = limiteRankingSolicitado(pergunta);
  const quantidadeAnterior = Number(referenciaAnterior?.quantidadeLinhas || 0);
  const precisaRefazerRanking = exportar && limiteSolicitado && quantidadeAnterior > 0 &&
    limiteSolicitado !== quantidadeAnterior && dominio;
  if (precisaRefazerRanking) return {
    fluxo: 'consultar_e_exportar', exportar: true, ...dominio,
    limite: limiteSolicitado,
    periodo: dominio.dominio === 'vendas' ? extrairPeriodo(pergunta) : null
  };
  if (possuiRefAnterior && (exportar || enriquecerCatalogo)) return {
    fluxo: exportar ? 'exportar_resultado' : 'enriquecer_resultado', exportar,
    enriquecerCatalogo
  };
  if (exportar && dominio) return { fluxo: 'consultar_e_exportar', exportar: true,
    ...dominio, periodo: dominio.dominio === 'vendas' ? extrairPeriodo(pergunta) : null };
  return { fluxo: possuiXlsx ? 'somente_arquivo' : 'padrao', exportar };
}

module.exports = { classificarDominio, classificarFluxoDatasets, dominioDaReferencia,
  extrairPeriodo, intencaoExportar, limiteRankingSolicitado, referenciaConjunto,
  solicitaConsultaSysemp };
