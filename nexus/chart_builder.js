const { createCanvas } = require('@napi-rs/canvas');
const { FAMILIA_FONTE_CANVAS, registrarFontesCanvas } = require('./canvas_fonts');

registrarFontesCanvas();
const FONTE = `"${FAMILIA_FONTE_CANVAS}"`;

const CORES = ['#31f28b', '#62b6ff', '#ffcf5a', '#b889ff', '#ff7f73', '#67ded0', '#f39ad7', '#a9d36e'];
const ROTULOS_METRICAS = Object.freeze({
  faturamento: 'Faturamento',
  faturamento_emitido: 'Faturamento emitido',
  valor_faturado: 'Valor faturado',
  receita: 'Receita',
  valor_pedidos: 'Valor dos pedidos',
  valor_vendido: 'Valor vendido',
  vendas: 'Vendas',
  quantidade_faturada: 'Quantidade faturada',
  qtd_faturada: 'Quantidade faturada',
  quantidade_pedida: 'Quantidade pedida',
  qtd_pedida: 'Quantidade pedida',
  quantidade: 'Quantidade',
  pedidos: 'Pedidos',
  quantidade_pedidos: 'Pedidos',
  margem_bruta: 'Margem bruta',
  margem_bruta_produtos: 'Margem bruta',
  contribuicao_apos_comissao: 'Contribuição após comissão',
  contribuicao: 'Contribuição após comissão',
  comissao: 'Comissão',
  comissao_marketplace: 'Comissão de marketplace'
});
const CANDIDATOS = Object.freeze({
  periodo: ['periodo', 'data', 'mes', 'semana', 'dia'],
  produto: ['descricao_produto', 'produto', 'nome_produto', 'sku', 'ean', 'id_produto'],
  canal: ['plataforma', 'canal'],
  metricas: {
    faturamento: ['faturamento', 'faturamento_emitido', 'valor_faturado', 'receita'],
    valor_pedidos: ['valor_pedidos', 'valor_vendido', 'vendas'],
    quantidade_faturada: ['quantidade_faturada', 'qtd_faturada'],
    quantidade_pedida: ['quantidade_pedida', 'qtd_pedida', 'quantidade'],
    pedidos: ['pedidos', 'quantidade_pedidos'],
    margem_bruta: ['margem_bruta', 'margem_bruta_produtos'],
    contribuicao: ['contribuicao_apos_comissao', 'contribuicao'],
    comissao: ['comissao', 'comissao_marketplace']
  }
});

class ErroGrafico extends Error {
  constructor(codigo, mensagem) { super(mensagem); this.name = 'ErroGrafico'; this.codigo = codigo; }
}

function normalizar(valor) {
  return String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function numero(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor === 'bigint') return Number(valor);
  if (valor == null || valor === '') return null;
  const texto = String(valor).trim().replace(/\s/g, '');
  const convertido = texto.includes(',')
    ? Number(texto.replace(/\./g, '').replace(',', '.').replace(/[^0-9+\-.]/g, ''))
    : Number(texto.replace(/[^0-9+\-.]/g, ''));
  return Number.isFinite(convertido) ? convertido : null;
}

function colunaPorAlias(colunas, aliases) {
  const mapa = new Map(colunas.map((nome) => [normalizar(nome), nome]));
  for (const alias of aliases) if (mapa.has(normalizar(alias))) return mapa.get(normalizar(alias));
  return null;
}

function resolverMetrica(linhas, solicitada = 'auto') {
  const colunas = [...new Set(linhas.flatMap((linha) => Object.keys(linha || {})))];
  const chave = normalizar(solicitada);
  if (chave && chave !== 'auto') {
    const direta = colunaPorAlias(colunas, [solicitada]);
    if (direta && linhas.some((linha) => numero(linha[direta]) != null)) return direta;
    const semantica = CANDIDATOS.metricas[chave];
    const encontrada = semantica && colunaPorAlias(colunas, semantica);
    if (encontrada && linhas.some((linha) => numero(linha[encontrada]) != null)) return encontrada;
  }
  for (const aliases of Object.values(CANDIDATOS.metricas)) {
    const encontrada = colunaPorAlias(colunas, aliases);
    if (encontrada && linhas.some((linha) => numero(linha[encontrada]) != null)) return encontrada;
  }
  const tecnica = new Set(['__nexus_row_number', 'id', 'id_produto', 'ano', 'mes_numero']);
  return colunas.find((nome) => !tecnica.has(normalizar(nome)) &&
    linhas.some((linha) => numero(linha[nome]) != null)) || null;
}

function resolverDimensao(linhas, solicitada, aliasesPadrao) {
  const colunas = [...new Set(linhas.flatMap((linha) => Object.keys(linha || {})))];
  const pedida = normalizar(solicitada);
  if (pedida && !['auto', 'nenhuma'].includes(pedida)) {
    const aliases = CANDIDATOS[pedida] || [solicitada];
    const encontrada = colunaPorAlias(colunas, aliases);
    if (encontrada) return encontrada;
  }
  return colunaPorAlias(colunas, aliasesPadrao);
}

function periodoCanonico(valor, granularidade) {
  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return valor;
  const ano = data.getUTCFullYear();
  const mes = String(data.getUTCMonth() + 1).padStart(2, '0');
  const dia = String(data.getUTCDate()).padStart(2, '0');
  if (normalizar(granularidade) === 'mes') return `${ano}-${mes}`;
  return `${ano}-${mes}-${dia}`;
}

function inicioPeriodo(valor, granularidade) {
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  const tipo = normalizar(granularidade);
  data.setUTCHours(0, 0, 0, 0);
  if (tipo === 'mes') data.setUTCDate(1);
  if (tipo === 'semana') data.setUTCDate(data.getUTCDate() - ((data.getUTCDay() + 6) % 7));
  return data;
}

function avancarPeriodo(data, granularidade) {
  const proxima = new Date(data);
  const tipo = normalizar(granularidade);
  if (tipo === 'mes') proxima.setUTCMonth(proxima.getUTCMonth() + 1);
  else proxima.setUTCDate(proxima.getUTCDate() + (tipo === 'semana' ? 7 : 1));
  return proxima;
}

function prepararLinhasGrafico(linhas, queryManifest = {}) {
  if (!Array.isArray(linhas) || !linhas.length) return linhas;
  const argumentos = queryManifest?.argumentos || {};
  const agrupamentos = Array.isArray(argumentos.agrupamentos) ? argumentos.agrupamentos : [];
  const calculos = Array.isArray(argumentos.calculos) ? argumentos.calculos : [];
  if (!agrupamentos.length && !calculos.length) return linhas;

  const grupos = agrupamentos.map((grupo, indice) => {
    const campo = String(grupo?.campo || `grupo_${indice + 1}`);
    const temporal = Boolean(grupo?.granularidade) &&
      /(?:data|periodo|mes|semana|dia)/.test(normalizar(campo));
    return { origem: `grupo_${indice + 1}`, destino: temporal ? 'periodo' : campo,
      granularidade: grupo?.granularidade || null, campo, temporal };
  });
  const medidas = calculos.map((calculo, indice) => ({
    origem: `calculo_${indice + 1}`,
    destino: String(calculo?.campo || `calculo_${indice + 1}`)
  }));
  const preparadas = linhas.map((linha) => {
    const saida = { ...linha };
    for (const grupo of grupos) if (Object.hasOwn(linha, grupo.origem) &&
        !Object.hasOwn(saida, grupo.destino)) {
      saida[grupo.destino] = grupo.temporal
        ? periodoCanonico(linha[grupo.origem], grupo.granularidade) : linha[grupo.origem];
    }
    for (const medida of medidas) if (Object.hasOwn(linha, medida.origem) &&
        !Object.hasOwn(saida, medida.destino)) {
      saida[medida.destino] = linha[medida.origem];
    }
    return saida;
  });

  // Só sintetizamos lacunas quando existe uma única dimensão temporal. Com
  // produto/canal adicionais, preencher combinações exigiria inferir séries
  // ausentes e poderia criar números que a consulta não comprovou.
  const grupoTemporal = grupos.length === 1 && grupos[0].temporal ? grupos[0] : null;
  const filtroPeriodo = grupoTemporal && (Array.isArray(argumentos.filtros) ? argumentos.filtros : [])
    .find((filtro) => normalizar(filtro?.campo) === normalizar(grupoTemporal.campo) &&
      normalizar(filtro?.operador) === 'entre' && filtro?.valor != null && filtro?.valor_final != null);
  if (!grupoTemporal || !filtroPeriodo || !medidas.length) return preparadas;

  let cursor = inicioPeriodo(filtroPeriodo.valor, grupoTemporal.granularidade);
  const fim = inicioPeriodo(filtroPeriodo.valor_final, grupoTemporal.granularidade);
  if (!cursor || !fim || cursor > fim) return preparadas;
  const existentes = new Set(preparadas.map((linha) => String(linha.periodo)));
  let numeroLinha = preparadas.length;
  for (let limite = 0; cursor <= fim && limite < 5000; limite += 1) {
    const periodo = periodoCanonico(cursor, grupoTemporal.granularidade);
    if (!existentes.has(String(periodo))) {
      const linha = { __nexus_row_number: ++numeroLinha, periodo };
      for (const medida of medidas) linha[medida.destino] = 0;
      preparadas.push(linha);
    }
    cursor = avancarPeriodo(cursor, grupoTemporal.granularidade);
  }
  return preparadas.sort((a, b) => String(a.periodo).localeCompare(String(b.periodo)));
}

function rotuloPeriodo(valor) {
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  const texto = String(valor ?? 'Não identificado');
  const iso = texto.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!iso) return texto;
  return iso[3] ? `${iso[3]}/${iso[2]}/${iso[1]}` : `${iso[2]}/${iso[1]}`;
}

function rotuloHumano(valor) {
  const chave = normalizar(valor);
  if (ROTULOS_METRICAS[chave]) return ROTULOS_METRICAS[chave];
  const texto = String(valor || '').replace(/_/g, ' ').trim();
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : 'Métrica';
}

function periodoDoGrafico(categorias) {
  if (!categorias.length) return 'Período não identificado';
  if (categorias.length === 1) return String(categorias[0]);
  return `${categorias[0]} a ${categorias.at(-1)}`;
}

function resumirSeries(categorias, series) {
  const totais = categorias.map((_, indice) => series.reduce((soma, item) => {
    const valor = item.valores[indice];
    return soma + (Number.isFinite(valor) ? valor : 0);
  }, 0));
  const primeiro = totais[0] || 0;
  const ultimo = totais.at(-1) || 0;
  return {
    total: totais.reduce((soma, valor) => soma + valor, 0),
    primeiro,
    ultimo,
    variacaoPercentual: primeiro === 0 ? null : ((ultimo - primeiro) / Math.abs(primeiro)) * 100,
    maior: totais.length ? Math.max(...totais) : 0,
    menor: totais.length ? Math.min(...totais) : 0
  };
}

function montarDadosGrafico(linhas, spec = {}) {
  if (!Array.isArray(linhas) || !linhas.length) throw new ErroGrafico('CHART_DATA_EMPTY', 'O resultado não possui linhas para o gráfico.');
  const metrica = resolverMetrica(linhas, spec.metrica);
  if (!metrica) throw new ErroGrafico('CHART_METRIC_NOT_FOUND', 'Não encontrei uma métrica numérica autorizada neste resultado.');
  const periodo = resolverDimensao(linhas, spec.dimensao, CANDIDATOS.periodo);
  const produto = resolverDimensao(linhas, 'produto', CANDIDATOS.produto);
  const canal = resolverDimensao(linhas, 'canal', CANDIDATOS.canal);
  const serieSolicitada = normalizar(spec.serie);
  const serie = serieSolicitada === 'produto' ? produto : serieSolicitada === 'canal' ? canal
    : serieSolicitada === 'nenhuma' ? null : produto || canal;
  const categoria = periodo || (serie === produto ? canal : produto) || canal;
  if (!categoria) throw new ErroGrafico('CHART_DIMENSION_NOT_FOUND', 'Não encontrei uma dimensão adequada para organizar o gráfico.');

  const agregados = new Map();
  const totaisSerie = new Map();
  for (const linha of linhas) {
    const valor = numero(linha[metrica]);
    if (valor == null) continue;
    const categoriaValor = rotuloPeriodo(linha[categoria]);
    const serieValor = serie ? String(linha[serie] ?? 'Não identificado') : 'Total';
    const chave = `${categoriaValor}\u0000${serieValor}`;
    agregados.set(chave, (agregados.get(chave) || 0) + valor);
    totaisSerie.set(serieValor, (totaisSerie.get(serieValor) || 0) + Math.abs(valor));
  }
  if (!agregados.size) throw new ErroGrafico('CHART_VALUES_EMPTY', 'A métrica escolhida não possui valores numéricos utilizáveis.');
  const limiteSeries = Math.min(10, Math.max(1, Number(spec.limite_series || 8)));
  const seriesNomes = [...totaisSerie.entries()].sort((a, b) => b[1] - a[1]).slice(0, limiteSeries).map(([nome]) => nome);
  const categorias = [...new Set([...agregados.keys()].map((chave) => chave.split('\u0000')[0]))].slice(0, 40);
  const series = seriesNomes.map((nome) => ({ nome,
    valores: categorias.map((cat) => agregados.get(`${cat}\u0000${nome}`) || 0) }));

  if (spec.tipo === 'variacao') {
    const variacoes = series.map((item) => {
      const inicial = item.valores[0] || 0; const final = item.valores[item.valores.length - 1] || 0;
      return { nome: item.nome, valores: [inicial === 0 ? null : ((final - inicial) / Math.abs(inicial)) * 100] };
    });
    const valoresVariacao = variacoes.flatMap((item) => item.valores).filter(Number.isFinite);
    return { tipo: 'barra', metrica, rotuloMetrica: rotuloHumano(metrica), categoria, serie,
      categorias: [`${categorias[0]} → ${categorias.at(-1)}`], series: variacoes,
      periodo: periodoDoGrafico(categorias), unidade: 'percentual',
      resumo: { maior: Math.max(...valoresVariacao), menor: Math.min(...valoresVariacao),
        total: valoresVariacao.length, primeiro: null, ultimo: null, variacaoPercentual: null },
      titulo: spec.titulo || `Variação de ${rotuloHumano(metrica).toLowerCase()}`,
      atualizadoEm: spec.atualizado_em || spec.atualizadoEm || null };
  }
  return { tipo: spec.tipo === 'barra' ? 'barra' : 'linha', metrica,
    rotuloMetrica: rotuloHumano(metrica), categoria, serie, categorias, series,
    periodo: periodoDoGrafico(categorias), resumo: resumirSeries(categorias, series),
    unidade: spec.unidade || 'auto', titulo: spec.titulo || rotuloHumano(metrica),
    atualizadoEm: spec.atualizado_em || spec.atualizadoEm || null };
}

function formatarValor(valor, unidade) {
  if (valor == null) return 'n/a';
  if (unidade === 'percentual') return `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  if (unidade === 'moeda') return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  return valor.toLocaleString('pt-BR', { notation: Math.abs(valor) >= 1_000_000 ? 'compact' : 'standard', maximumFractionDigits: 1 });
}

function inferirUnidade(dados) {
  if (dados.unidade && dados.unidade !== 'auto') return dados.unidade;
  return /faturamento|valor|receita|margem|contribuicao|comissao/.test(normalizar(dados.metrica)) ? 'moeda' : 'numero';
}

function caminhoArredondado(ctx, x, y, largura, altura, raio = 18) {
  const r = Math.min(raio, largura / 2, altura / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + largura, y, x + largura, y + altura, r);
  ctx.arcTo(x + largura, y + altura, x, y + altura, r);
  ctx.arcTo(x, y + altura, x, y, r);
  ctx.arcTo(x, y, x + largura, y, r);
  ctx.closePath();
}

function quebrarTexto(ctx, texto, larguraMaxima, maxLinhas = 2) {
  const palavras = String(texto || '').split(/\s+/).filter(Boolean);
  const linhas = [];
  let atual = '';
  for (const palavra of palavras) {
    const candidata = atual ? `${atual} ${palavra}` : palavra;
    if (!atual || ctx.measureText(candidata).width <= larguraMaxima) atual = candidata;
    else { linhas.push(atual); atual = palavra; }
    if (linhas.length === maxLinhas) break;
  }
  if (linhas.length < maxLinhas && atual) linhas.push(atual);
  const consumido = linhas.join(' ').split(/\s+/).length;
  if (consumido < palavras.length && linhas.length) {
    let ultima = linhas.at(-1);
    while (ultima.length > 1 && ctx.measureText(`${ultima}…`).width > larguraMaxima) ultima = ultima.slice(0, -1);
    linhas[linhas.length - 1] = `${ultima.trim()}…`;
  }
  return linhas;
}

function limitarTexto(ctx, texto, larguraMaxima) {
  const original = String(texto || '');
  if (ctx.measureText(original).width <= larguraMaxima) return original;
  let reduzido = original;
  while (reduzido.length > 1 && ctx.measureText(`${reduzido}…`).width > larguraMaxima) reduzido = reduzido.slice(0, -1);
  return `${reduzido.trim()}…`;
}

function formatarAtualizacao(valor) {
  if (!valor) return null;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return String(valor);
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short',
    timeZone: 'America/Sao_Paulo' }).format(data);
}

function desenharCartaoKpi(ctx, x, y, largura, titulo, valor, destaque = false) {
  caminhoArredondado(ctx, x, y, largura, 108, 18);
  ctx.fillStyle = destaque ? 'rgba(49,242,139,.13)' : 'rgba(13,31,21,.88)'; ctx.fill();
  ctx.strokeStyle = destaque ? 'rgba(49,242,139,.48)' : 'rgba(129,164,145,.20)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#8fa79a'; ctx.font = `600 18px ${FONTE}`; ctx.textAlign = 'left'; ctx.fillText(titulo.toUpperCase(), x + 22, y + 34);
  ctx.fillStyle = destaque ? '#31f28b' : '#f4f7f5'; ctx.font = `700 31px ${FONTE}`;
  ctx.fillText(limitarTexto(ctx, valor, largura - 44), x + 22, y + 78);
}

function desenharRotuloValor(ctx, x, y, texto, cor, limites) {
  ctx.font = `700 18px ${FONTE}`;
  const largura = ctx.measureText(texto).width + 24;
  const altura = 34;
  const px = Math.max(limites.esquerda, Math.min(x - largura / 2, limites.direita - largura));
  const py = Math.max(limites.topo, Math.min(y - 49, limites.baixo - altura));
  caminhoArredondado(ctx, px, py, largura, altura, 10);
  ctx.fillStyle = 'rgba(4,12,8,.92)'; ctx.fill();
  ctx.strokeStyle = cor; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#eef6f1'; ctx.textAlign = 'center'; ctx.fillText(texto, px + largura / 2, py + 23);
}

function desenharGrafico(dados, opcoes = {}) {
  const width = Number(opcoes.width || 1536); const height = Number(opcoes.height || 1024);
  const canvas = createCanvas(width, height); const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#061009'; ctx.fillRect(0, 0, width, height);
  const grd = ctx.createRadialGradient(width * .12, 0, 0, width * .12, 0, width * .9);
  grd.addColorStop(0, 'rgba(49,242,139,.14)'); grd.addColorStop(.55, 'rgba(21,87,52,.05)'); grd.addColorStop(1, 'rgba(49,242,139,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, width, height);

  caminhoArredondado(ctx, 70, 42, 300, 42, 21); ctx.fillStyle = 'rgba(49,242,139,.12)'; ctx.fill();
  ctx.strokeStyle = 'rgba(49,242,139,.32)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#31f28b'; ctx.font = `700 19px ${FONTE}`; ctx.textAlign = 'left';
  ctx.fillText('NEXUS  |  DADOS DO SYSEMP', 91, 70);

  ctx.fillStyle = '#f4f7f5'; ctx.font = `700 50px ${FONTE}`;
  const linhasTitulo = quebrarTexto(ctx, dados.titulo, width - 140, 2);
  linhasTitulo.forEach((linha, indice) => ctx.fillText(linha, 70, 132 + indice * 56));
  const fimTitulo = 132 + Math.max(0, linhasTitulo.length - 1) * 56;
  ctx.fillStyle = '#a4b7ac'; ctx.font = `22px ${FONTE}`;
  ctx.fillText(`${dados.rotuloMetrica || rotuloHumano(dados.metrica)} · ${dados.periodo} · cálculo local`, 70, fimTitulo + 42);

  const unidade = inferirUnidade(dados);
  const resumo = dados.resumo || resumirSeries(dados.categorias, dados.series);
  const kpiY = fimTitulo + 70;
  const espaco = 16; const larguraKpi = (width - 140 - espaco * 3) / 4;
  if (unidade === 'percentual' && dados.categorias.length === 1) {
    desenharCartaoKpi(ctx, 70, kpiY, larguraKpi, 'Maior alta', formatarValor(resumo.maior, 'percentual'), true);
    desenharCartaoKpi(ctx, 70 + (larguraKpi + espaco), kpiY, larguraKpi, 'Menor variação', formatarValor(resumo.menor, 'percentual'));
    desenharCartaoKpi(ctx, 70 + (larguraKpi + espaco) * 2, kpiY, larguraKpi, 'Séries comparadas', String(dados.series.length));
    desenharCartaoKpi(ctx, 70 + (larguraKpi + espaco) * 3, kpiY, larguraKpi, 'Período', dados.periodo);
  } else {
    desenharCartaoKpi(ctx, 70, kpiY, larguraKpi, 'Total no período', formatarValor(resumo.total, unidade), true);
    desenharCartaoKpi(ctx, 70 + (larguraKpi + espaco), kpiY, larguraKpi, 'Primeiro período', formatarValor(resumo.primeiro, unidade));
    desenharCartaoKpi(ctx, 70 + (larguraKpi + espaco) * 2, kpiY, larguraKpi, 'Último período', formatarValor(resumo.ultimo, unidade));
    desenharCartaoKpi(ctx, 70 + (larguraKpi + espaco) * 3, kpiY, larguraKpi, 'Variação', resumo.variacaoPercentual == null ? 'Sem base comparável' : formatarValor(resumo.variacaoPercentual, 'percentual'));
  }

  const left = 175, right = 70, top = kpiY + 166, bottom = 190;
  const w = width - left - right, h = height - top - bottom;
  const valores = dados.series.flatMap((s) => s.valores).filter((v) => Number.isFinite(v));
  let min = Math.min(0, ...valores), max = Math.max(0, ...valores);
  if (min === max) max = min + 1;
  const amplitude = max - min;
  if (max > 0) max += amplitude * .1;
  if (min < 0) min -= amplitude * .1;
  const escalaY = (v) => top + h - ((v - min) / (max - min)) * h;

  caminhoArredondado(ctx, left - 24, top - 24, w + 48, h + 70, 22);
  ctx.fillStyle = 'rgba(4,14,8,.50)'; ctx.fill(); ctx.strokeStyle = 'rgba(129,164,145,.12)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#8fa79a'; ctx.font = `700 17px ${FONTE}`; ctx.textAlign = 'left';
  ctx.fillText((dados.rotuloMetrica || rotuloHumano(dados.metrica)).toUpperCase(), left, top - 38);
  ctx.lineWidth = 1; ctx.font = `20px ${FONTE}`; ctx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const valor = min + ((max - min) * i / 5); const y = escalaY(valor);
    ctx.strokeStyle = i === 0 ? 'rgba(180,208,193,.34)' : 'rgba(165,190,177,.14)';
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + w, y); ctx.stroke();
    ctx.fillStyle = '#a8bbb0'; ctx.fillText(formatarValor(valor, unidade), left - 22, y + 7);
  }
  ctx.textAlign = 'center'; ctx.font = `700 18px ${FONTE}`;
  const passo = w / Math.max(1, dados.categorias.length);
  dados.categorias.forEach((cat, i) => {
    if (dados.categorias.length > 12 && i % Math.ceil(dados.categorias.length / 12) !== 0 && i !== dados.categorias.length - 1) return;
    ctx.fillStyle = '#c2d0c8'; const label = String(cat).length > 18 ? `${String(cat).slice(0, 16)}…` : String(cat);
    ctx.save(); ctx.translate(left + passo * (i + .5), top + h + 37); if (dados.categorias.length > 10) ctx.rotate(-.38); ctx.fillText(label, 0, 0); ctx.restore();
  });

  if (dados.tipo === 'barra') {
    const larguraGrupo = passo * .76; const larguraBarra = larguraGrupo / Math.max(1, dados.series.length);
    dados.series.forEach((serie, s) => serie.valores.forEach((valor, i) => {
      if (!Number.isFinite(valor)) return;
      const x = left + passo * i + (passo - larguraGrupo) / 2 + s * larguraBarra;
      const y0 = escalaY(0), y = escalaY(valor); const cor = CORES[s % CORES.length];
      const gradienteBarra = ctx.createLinearGradient(0, y, 0, y0); gradienteBarra.addColorStop(0, cor); gradienteBarra.addColorStop(1, `${cor}88`);
      ctx.fillStyle = gradienteBarra; caminhoArredondado(ctx, x, Math.min(y, y0), Math.max(4, larguraBarra - 6), Math.max(3, Math.abs(y0 - y)), 6); ctx.fill();
      if (dados.series.length <= 8 && dados.categorias.length <= 12) desenharRotuloValor(ctx,
        x + (larguraBarra - 6) / 2, y, formatarValor(valor, unidade), cor,
        { esquerda: left, direita: left + w, topo: top, baixo: top + h });
    }));
  } else {
    dados.series.forEach((serie, s) => {
      const cor = CORES[s % CORES.length];
      if (dados.series.length === 1) {
        const area = ctx.createLinearGradient(0, top, 0, top + h); area.addColorStop(0, 'rgba(49,242,139,.23)'); area.addColorStop(1, 'rgba(49,242,139,0)');
        ctx.beginPath(); let inicioArea = null; let fimArea = null;
        serie.valores.forEach((valor, i) => { if (!Number.isFinite(valor)) return; const x = left + passo * (i + .5), y = escalaY(valor); if (!inicioArea) { inicioArea = { x, y }; ctx.moveTo(x, y); } else ctx.lineTo(x, y); fimArea = { x, y }; });
        if (inicioArea && fimArea) { ctx.lineTo(fimArea.x, top + h); ctx.lineTo(inicioArea.x, top + h); ctx.closePath(); ctx.fillStyle = area; ctx.fill(); }
      }
      ctx.strokeStyle = cor; ctx.fillStyle = cor; ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); let iniciou = false;
      serie.valores.forEach((valor, i) => { if (!Number.isFinite(valor)) return; const x = left + passo * (i + .5), y = escalaY(valor); iniciou ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), iniciou = true); });
      ctx.stroke();
      serie.valores.forEach((valor, i) => {
        if (!Number.isFinite(valor)) return;
        const x = left + passo * (i + .5), y = escalaY(valor);
        ctx.fillStyle = '#061009'; ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = cor; ctx.lineWidth = 5; ctx.stroke();
        const rotularTodos = dados.series.length === 1 && dados.categorias.length <= 12;
        if (rotularTodos || i === 0 || i === serie.valores.length - 1) desenharRotuloValor(ctx, x, y,
          formatarValor(valor, unidade), cor, { esquerda: left, direita: left + w, topo: top, baixo: top + h });
      });
    });
  }

  ctx.textAlign = 'left'; ctx.font = `700 19px ${FONTE}`;
  const legendaY = height - 116; const colunasLegenda = dados.series.length <= 2 ? dados.series.length : 2;
  const larguraLegenda = (width - left - right) / Math.max(1, colunasLegenda);
  dados.series.forEach((serie, i) => {
    const coluna = i % Math.max(1, colunasLegenda); const linha = Math.floor(i / Math.max(1, colunasLegenda));
    const lx = left + coluna * larguraLegenda; const ly = legendaY + linha * 30;
    const ultimo = [...serie.valores].reverse().find(Number.isFinite);
    ctx.fillStyle = CORES[i % CORES.length]; ctx.fillRect(lx, ly - 15, 28, 7);
    ctx.fillStyle = '#dfe7e2'; const sufixo = ultimo == null ? '' : ` · último: ${formatarValor(ultimo, unidade)}`;
    ctx.fillText(limitarTexto(ctx, `${serie.nome}${sufixo}`, larguraLegenda - 48), lx + 40, ly);
  });
  ctx.fillStyle = '#81958a'; ctx.font = `17px ${FONTE}`; ctx.textAlign = 'right';
  const atualizado = formatarAtualizacao(dados.atualizadoEm);
  ctx.fillText(`Dados do Sysemp · cálculo local${atualizado ? ` · atualizado em ${atualizado}` : ''}`, width - 70, height - 34);
  return { buffer: canvas.toBuffer('image/png'), width, height };
}

function construirGrafico(linhas, spec, opcoes) {
  const dados = montarDadosGrafico(linhas, spec); const imagem = desenharGrafico(dados, opcoes);
  return { ...imagem, dados, validacao: { width: imagem.width, height: imagem.height,
    series: dados.series.length, categories: dados.categorias.length, deterministic: true,
    metric: dados.metrica, source: 'result_ref', selfContained: true,
    hasTitle: true, hasAxes: true, hasDataLabels: true, summary: dados.resumo } };
}

module.exports = { ErroGrafico, construirGrafico, desenharGrafico, montarDadosGrafico,
  prepararLinhasGrafico };
