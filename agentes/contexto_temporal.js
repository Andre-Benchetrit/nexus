const FUSO_NEGOCIO = 'America/Sao_Paulo';

function obterDataReferencia(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO_NEGOCIO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(agora);
  const valores = Object.fromEntries(partes.map(({ type, value }) => [type, value]));
  return `${valores.year}-${valores.month}-${valores.day}`;
}

function completarAnoEmDatas(pergunta, dataReferencia) {
  const ano = String(dataReferencia).slice(0, 4);
  return String(pergunta).replace(
    /\b(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])(?!\/\d{2,4})\b/g,
    (_, dia, mes) => `${dia.padStart(2, '0')}/${mes.padStart(2, '0')}/${ano}`
  );
}

module.exports = { FUSO_NEGOCIO, completarAnoEmDatas, obterDataReferencia };
