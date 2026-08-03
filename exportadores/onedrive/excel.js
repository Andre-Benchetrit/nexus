const readXlsxFile = require('read-excel-file/node');

function normalizarCabecalho(valor) {
  let texto = String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  if (/^\d/.test(texto)) texto = `coluna_${texto}`;
  return texto;
}

function textoCelula(valor) {
  if (valor == null) return null;
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor !== 'object') return String(valor);
  if (Object.hasOwn(valor, 'result')) return textoCelula(valor.result);
  if (Array.isArray(valor.richText)) {
    return valor.richText.map((trecho) => trecho.text || '').join('');
  }
  if (Object.hasOwn(valor, 'text')) return String(valor.text);
  if (Object.hasOwn(valor, 'error')) return String(valor.error);
  return JSON.stringify(valor);
}

function aliasesColuna(coluna) {
  const origens = Array.isArray(coluna.origem) ? coluna.origem : [coluna.origem];
  return origens.filter(Boolean).map(normalizarCabecalho);
}

function mapearColunas(cabecalhos, contrato = []) {
  const porNormalizado = new Map(cabecalhos.map((cabecalho) => [
    cabecalho.normalizado,
    cabecalho
  ]));
  const mapeadas = [];
  const usados = new Set();

  for (const coluna of contrato) {
    const encontrada = aliasesColuna(coluna)
      .map((alias) => porNormalizado.get(alias))
      .find(Boolean);
    if (!encontrada) {
      if (coluna.obrigatoria !== false) {
        throw new Error(
          `Coluna obrigatoria ausente na planilha: ${[].concat(coluna.origem).join(' ou ')}.`
        );
      }
      continue;
    }
    const destino = normalizarCabecalho(coluna.destino || encontrada.normalizado);
    if (!destino) throw new Error('Coluna de destino invalida no contrato OneDrive.');
    mapeadas.push({ ...encontrada, destino });
    usados.add(encontrada.indice);
  }

  for (const cabecalho of cabecalhos) {
    if (!usados.has(cabecalho.indice)) {
      mapeadas.push({ ...cabecalho, destino: cabecalho.normalizado });
    }
  }

  const destinos = new Set();
  for (const coluna of mapeadas) {
    if (destinos.has(coluna.destino)) {
      throw new Error(`Cabecalho duplicado apos normalizacao: ${coluna.destino}.`);
    }
    destinos.add(coluna.destino);
  }
  return mapeadas;
}

async function lerPlanilha(buffer, configuracao = {}) {
  const planilhas = await readXlsxFile(buffer);
  const nomesPlanilhas = planilhas.map((planilha) => planilha.sheet);
  if (!nomesPlanilhas.length) throw new Error('O arquivo Excel nao possui abas.');
  const nomePlanilha = configuracao.planilha || nomesPlanilhas[0];
  if (!nomesPlanilhas.includes(nomePlanilha)) {
    throw new Error(`Aba nao encontrada no Excel: ${nomePlanilha}.`);
  }
  const registrosExcel = planilhas.find((planilha) => planilha.sheet === nomePlanilha).data;

  const linhaCabecalho = Number(configuracao.linhaCabecalho || 1);
  if (!Number.isInteger(linhaCabecalho) || linhaCabecalho < 1) {
    throw new Error('linhaCabecalho deve ser um inteiro positivo.');
  }
  const rowCabecalho = registrosExcel[linhaCabecalho - 1] || [];
  const cabecalhos = [];
  const vistos = new Set();
  for (let indice = 0; indice < rowCabecalho.length; indice += 1) {
    const original = textoCelula(rowCabecalho[indice]);
    const normalizado = normalizarCabecalho(original);
    if (!normalizado) continue;
    if (vistos.has(normalizado)) {
      throw new Error(`Cabecalho duplicado apos normalizacao: ${normalizado}.`);
    }
    vistos.add(normalizado);
    cabecalhos.push({ indice, original, normalizado });
  }
  if (!cabecalhos.length) {
    throw new Error(`Nenhum cabecalho encontrado na linha ${linhaCabecalho}.`);
  }

  const colunas = mapearColunas(cabecalhos, configuracao.colunas || []);
  const colunasTecnicas = [
    { original: null, destino: 'conexao_origem', tecnica: true },
    { original: null, destino: 'item_id_origem', tecnica: true },
    { original: null, destino: 'arquivo_origem', tecnica: true },
    { original: null, destino: 'planilha_origem', tecnica: true },
    { original: null, destino: 'linha_origem', tecnica: true }
  ];
  const destinos = new Set(colunas.map(({ destino }) => destino));
  for (const coluna of colunasTecnicas) {
    if (destinos.has(coluna.destino)) {
      throw new Error(`Coluna reservada para rastreabilidade: ${coluna.destino}.`);
    }
  }
  const metadados = configuracao.metadadosOrigem || {};
  const linhas = [];
  for (let numero = linhaCabecalho; numero < registrosExcel.length; numero += 1) {
    const row = registrosExcel[numero] || [];
    const registro = {};
    let preenchida = false;
    for (const coluna of colunas) {
      const valor = textoCelula(row[coluna.indice]);
      registro[coluna.destino] = valor;
      if (valor != null && valor !== '') preenchida = true;
    }
    if (preenchida) {
      Object.assign(registro, {
        conexao_origem: metadados.conexao || null,
        item_id_origem: metadados.itemId || null,
        arquivo_origem: metadados.arquivo || null,
        planilha_origem: nomePlanilha,
        linha_origem: String(numero + 1)
      });
      linhas.push(registro);
    }
  }

  return {
    nomePlanilha,
    linhaCabecalho,
    colunas: [...colunas, ...colunasTecnicas].map(
      ({ original, destino, tecnica }) => ({ original, destino, tecnica: Boolean(tecnica) })
    ),
    linhas
  };
}

module.exports = {
  lerPlanilha,
  normalizarCabecalho,
  textoCelula
};
