function formatarDatasResposta(texto) {
  return String(texto || '')
    .replace(
      /\b(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.000)?Z\b/g,
      '$3/$2/$1'
    )
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3/$2/$1');
}

function aplicarGarantiasResposta(texto, resultadosTools = []) {
  let resposta = formatarDatasResposta(texto);
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
  normalizarResultadoTool
};
