function valorPrimitivo(valor) {
  if (valor == null) return null;
  if (typeof valor !== 'object') return valor;
  if (Object.hasOwn(valor, 'valorCalculado')) return valor.valorCalculado;
  if (Object.hasOwn(valor, 'valor')) return valor.valor;
  return valor.result ?? valor.text ?? null;
}

function normalizar(valor) {
  return String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function preenchido(valor) {
  const primitivo = valorPrimitivo(valor);
  return primitivo !== null && primitivo !== undefined && String(primitivo).trim() !== '';
}

function letraColuna(indice) {
  let numero = Number(indice); let saida = '';
  while (numero > 0) {
    numero -= 1;
    saida = String.fromCharCode(65 + (numero % 26)) + saida;
    numero = Math.floor(numero / 26);
  }
  return saida || String(indice);
}

const ROTULOS_TABELA = /\b(?:produto|descricao|item|categoria|quantidade|qtd|valor|preco|total|sku|ean|gtin|codigo|id|data|pedido|cliente|marca|estoque|saldo|status|empresa|fornecedor|documento|nota|receita|faturamento|margem|forma de pagamento)\b/;
const METADADOS_RELATORIO = /\b(?:relatorio|emitido em|emissao|pagina|empresa|cnpj|endereco|rua|avenida|telefone|usuario|periodo|data e hora)\b/;

function entradasLinha(linha) {
  return Object.entries(linha?.valores || {})
    .map(([indice, valor]) => ({ indice: Number(indice), valor: valorPrimitivo(valor) }))
    .filter((item) => Number.isInteger(item.indice) && item.indice > 0 && preenchido(item.valor));
}

function dadosPosteriores(linhas, posicao, indices, limite = 25) {
  const seguintes = linhas.slice(posicao + 1, posicao + 1 + limite);
  const ocupadas = seguintes.filter((linha) => indices.some((indice) => preenchido(linha.valores?.[indice])));
  if (!ocupadas.length) return { linhas: 0, densidade: 0, numericos: 0 };
  let preenchidas = 0; let numericos = 0;
  for (const linha of ocupadas) for (const indice of indices) {
    const valor = valorPrimitivo(linha.valores?.[indice]);
    if (!preenchido(valor)) continue;
    preenchidas += 1;
    if (typeof valor === 'number' || (String(valor).trim() && Number.isFinite(Number(valor)))) numericos += 1;
  }
  return {
    linhas: ocupadas.length,
    densidade: preenchidas / Math.max(1, ocupadas.length * indices.length),
    numericos: numericos / Math.max(1, preenchidas)
  };
}

function pontuarCandidato(linhas, posicao) {
  const linha = linhas[posicao];
  const entradas = entradasLinha(linha);
  if (entradas.length < 2) return null;
  const textos = entradas.map((item) => normalizar(item.valor));
  const unicos = new Set(textos.filter(Boolean));
  const indices = entradas.map((item) => item.indice);
  const posteriores = dadosPosteriores(linhas, posicao, indices);
  if (!posteriores.linhas) return null;
  const rotulos = textos.filter((texto) => ROTULOS_TABELA.test(texto)).length;
  const numericosCabecalho = entradas.filter((item) => typeof item.valor === 'number' ||
    (String(item.valor).trim() && Number.isFinite(Number(item.valor)))).length;
  const metadados = textos.filter((texto) => METADADOS_RELATORIO.test(texto)).length;
  const textosLongos = textos.filter((texto) => texto.length > 80).length;
  const score = Math.min(entradas.length, 12) * 0.7 +
    rotulos * 4.5 +
    (unicos.size / entradas.length) * 2 +
    posteriores.densidade * 9 +
    Math.min(posteriores.linhas, 8) * 0.6 +
    (posteriores.numericos > 0 && numericosCabecalho === 0 ? 2 : 0) -
    numericosCabecalho * 3.5 -
    (rotulos === 0 ? metadados * 2.5 : 0) -
    textosLongos * 2;
  return { linha, posicao, entradas, indices, rotulos, posteriores, score };
}

function linhasDaTabela(linhas, posicaoCabecalho, indices) {
  const resultado = []; let vaziasConsecutivas = 0;
  for (const linha of linhas.slice(posicaoCabecalho + 1)) {
    const valoresPresentes = indices.map((indice) => valorPrimitivo(linha.valores?.[indice])).filter(preenchido);
    const temDado = valoresPresentes.length > 0;
    if (!temDado) {
      vaziasConsecutivas += 1;
      if (vaziasConsecutivas >= 3 && resultado.length) break;
      continue;
    }
    const primeiroTexto = normalizar(valoresPresentes[0]);
    const rodapeTotalizador = resultado.length >= 2 && /^total\b/.test(primeiroTexto) &&
      valoresPresentes.length <= Math.max(2, Math.ceil(indices.length * 0.4));
    const novoCabecalho = resultado.length >= 2 && vaziasConsecutivas > 0 &&
      valoresPresentes.length <= Math.max(2, Math.ceil(indices.length * 0.5)) &&
      valoresPresentes.filter((valor) => ROTULOS_TABELA.test(normalizar(valor))).length >= 2;
    if (rodapeTotalizador || novoCabecalho) break;
    vaziasConsecutivas = 0;
    resultado.push(linha);
  }
  return resultado;
}

function detectarTabelaEmAba(aba, { maxScanRows = 50 } = {}) {
  const linhas = aba?.linhas || [];
  if (linhas.length < 2) return null;
  const candidatos = linhas.slice(0, maxScanRows)
    .map((_, posicao) => pontuarCandidato(linhas, posicao)).filter(Boolean)
    .sort((a, b) => b.score - a.score || a.posicao - b.posicao);
  const escolhido = candidatos[0];
  if (!escolhido) return null;
  const usados = new Map();
  const colunas = escolhido.entradas.map(({ indice, valor }) => {
    const rotuloBase = String(valor ?? `Coluna ${indice}`).trim() || `Coluna ${indice}`;
    const chave = normalizar(rotuloBase) || `coluna ${indice}`;
    const repeticao = (usados.get(chave) || 0) + 1; usados.set(chave, repeticao);
    return { indice, rotulo: repeticao > 1 ? `${rotuloBase} ${repeticao}` : rotuloBase };
  });
  const dados = linhasDaTabela(linhas, escolhido.posicao, escolhido.indices);
  if (!dados.length) return null;
  const primeiraColuna = Math.min(...escolhido.indices);
  const ultimaColuna = Math.max(...escolhido.indices);
  const ultimaLinha = Number(dados.at(-1)?.numero || escolhido.linha.numero);
  return {
    aba: aba.nome,
    cabecalho: escolhido.linha,
    headerRow: Number(escolhido.linha.numero),
    headerRowIndex: escolhido.posicao,
    colunas,
    linhas: dados,
    intervalo: `${letraColuna(primeiraColuna)}${escolhido.linha.numero}:${letraColuna(ultimaColuna)}${ultimaLinha}`,
    score: Number(escolhido.score.toFixed(3)),
    metodo: 'real_header_structural_v1'
  };
}

function detectarMelhorTabela(abas, opcoes = {}) {
  return (abas || []).map((aba, indice) => ({ indice, tabela: detectarTabelaEmAba(aba, opcoes) }))
    .filter((item) => item.tabela)
    .sort((a, b) => b.tabela.score - a.tabela.score || b.tabela.linhas.length - a.tabela.linhas.length || a.indice - b.indice)[0]?.tabela || null;
}

module.exports = { detectarMelhorTabela, detectarTabelaEmAba, letraColuna, normalizar, valorPrimitivo };
