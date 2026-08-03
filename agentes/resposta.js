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
  ticket_medio_faturado: 'Ticket médio faturado',
  prazo_medio_emissao_dias: 'Prazo médio de emissão em dias'
});

const METRICAS_MONETARIAS = new Set([
  'valor_pedidos_validos',
  'valor_pedidos_pagos',
  'ticket_medio_pedido',
  'faturamento_emitido',
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

function aplicarGarantiasResposta(texto, resultadosTools = []) {
  const painelFocado = [...resultadosTools].reverse().find((item) => (
    item.nome === 'analisar_indicadores' &&
    item.resultado?.operacao === 'painel' &&
    (
      item.resultado?.modo === 'focado' ||
      item.resultado?.dados_disponiveis === false
    )
  ));
  let resposta = formatarPainelFocado(painelFocado?.resultado)
    || formatarDatasResposta(texto);
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

module.exports = {
  aplicarGarantiasResposta,
  formatarDatasResposta,
  formatarPainelFocado,
  normalizarResultadoTool
};
