const FUSO_NEGOCIO = 'America/Sao_Paulo';
const MESES = Object.freeze({
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12
});

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

function deslocarData(valor, dias) {
  const data = new Date(`${valor}T00:00:00.000Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

function dataBrasileiraParaIso(valor) {
  const resultado = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor);
  if (!resultado) return null;
  const [, dia, mes, ano] = resultado;
  const iso = `${ano}-${mes}-${dia}`;
  const data = new Date(`${iso}T00:00:00.000Z`);
  return data.toISOString().slice(0, 10) === iso ? iso : null;
}

function extrairMesNomeado(normalizado, dataReferencia) {
  const nomes = Object.keys(MESES).join('|');
  const encontrado = new RegExp(
    `\\b(${nomes})\\b(?:\\s*(?:de|/|-)\\s*((?:19|20)\\d{2}))?`
  ).exec(normalizado);
  if (!encontrado) return null;
  const mes = MESES[encontrado[1]];
  const anoReferencia = Number(String(dataReferencia).slice(0, 4));
  const mesReferencia = Number(String(dataReferencia).slice(5, 7));
  const anoExplicito = encontrado[2] ? Number(encontrado[2]) : null;
  const ano = anoExplicito || (mes <= mesReferencia ? anoReferencia : anoReferencia - 1);
  const mesTexto = String(mes).padStart(2, '0');
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const mesmoMesAtual = ano === anoReferencia && mes === mesReferencia;
  return {
    tipo: 'periodo_explicito',
    origem: anoExplicito ? 'mes_nomeado_com_ano' : 'mes_nomeado_mais_recente',
    inicio: `${ano}-${mesTexto}-01`,
    fim: mesmoMesAtual
      ? dataReferencia
      : `${ano}-${mesTexto}-${String(ultimoDia).padStart(2, '0')}`
  };
}

function extrairContextoTemporal(pergunta, dataReferencia) {
  const texto = String(pergunta || '');
  const normalizado = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (
    /\b(?:este|deste|nesse|no) mes\b|\bmes atual\b/.test(normalizado) &&
    /\bmes anterior\b|\b(?:com|versus|vs\.?) o anterior\b/.test(normalizado)
  ) {
    const atual = new Date(`${dataReferencia}T00:00:00.000Z`);
    const inicioAtual = `${atual.getUTCFullYear()}-${String(atual.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const anterior = new Date(Date.UTC(atual.getUTCFullYear(), atual.getUTCMonth() - 1, 1));
    const ultimoDiaAnterior = new Date(Date.UTC(
      anterior.getUTCFullYear(), anterior.getUTCMonth() + 1, 0
    )).getUTCDate();
    const diaComparavel = Math.min(atual.getUTCDate(), ultimoDiaAnterior);
    const inicioAnterior = `${anterior.getUTCFullYear()}-${String(anterior.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const fimAnterior = `${anterior.getUTCFullYear()}-${String(anterior.getUTCMonth() + 1).padStart(2, '0')}-${String(diaComparavel).padStart(2, '0')}`;
    return {
      tipo: 'comparacao_periodos', origem: 'mes_atual_vs_anterior_mesma_cobertura',
      inicio: inicioAtual, fim: dataReferencia,
      periodoAnterior: { inicio: inicioAnterior, fim: fimAnterior }
    };
  }
  const mesNomeado = extrairMesNomeado(normalizado, dataReferencia);
  if (mesNomeado) return mesNomeado;
  const relativos = [
    /\banteontem\b/i.test(texto),
    /\bontem\b/i.test(texto),
    /\bhoje\b/i.test(texto)
  ].filter(Boolean).length;
  if (relativos > 1) return null;
  if (/\banteontem\b/i.test(texto)) {
    const data = deslocarData(dataReferencia, -2);
    return { tipo: 'data_explicita', origem: 'anteontem', inicio: data, fim: data };
  }
  if (/\bontem\b/i.test(texto)) {
    const data = deslocarData(dataReferencia, -1);
    return { tipo: 'data_explicita', origem: 'ontem', inicio: data, fim: data };
  }
  if (/\bhoje\b/i.test(texto)) {
    return {
      tipo: 'data_explicita',
      origem: 'hoje',
      inicio: dataReferencia,
      fim: dataReferencia
    };
  }

  const encontradas = [];
  for (const item of texto.matchAll(/\b\d{2}\/\d{2}\/\d{4}\b/g)) {
    const iso = dataBrasileiraParaIso(item[0]);
    if (iso) encontradas.push(iso);
  }
  for (const item of texto.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) {
    const data = new Date(`${item[0]}T00:00:00.000Z`);
    if (!Number.isNaN(data.getTime()) && data.toISOString().slice(0, 10) === item[0]) {
      encontradas.push(item[0]);
    }
  }
  const datas = [...new Set(encontradas)];
  if (!datas.length) return null;
  return {
    tipo: datas.length === 1 ? 'data_explicita' : 'periodo_explicito',
    origem: 'texto',
    inicio: datas[0],
    fim: datas.at(-1)
  };
}

module.exports = {
  FUSO_NEGOCIO,
  completarAnoEmDatas,
  extrairMesNomeado,
  extrairContextoTemporal,
  obterDataReferencia
};
