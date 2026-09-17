const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const { criarConexaoDuckDB, fecharConexaoDuckDB, allDuckDB } = require('../duckdb/connections');
const {
  adicionarFaixaTituloXlsx, alinharCelulaXlsx, carregarMarca, configurarFolhaXlsx,
  estilizarCabecalhoXlsx, estilizarLinhaDadosXlsx, formatoColunaXlsx,
  larguraColunaXlsx, normalizarValorXlsx
} = require('./artifact_builder');

function escaparSql(valor) { return String(valor).replace(/'/g, "''").replace(/\\/g, '/'); }
function citar(nome) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(nome || '')) throw new Error(`Coluna de exportação inválida: ${nome}`);
  return `"${nome}"`;
}
function nomeAba(valor) {
  return String(valor || 'Dados').replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 31) || 'Dados';
}
async function construirXlsxDataset({ caminhoDataset, titulo, colunas, quantidadeLinhas,
  marca: marcaConfigurada = null }) {
  const destino = path.join(os.tmpdir(), `nexus-export-${crypto.randomUUID()}.xlsx`);
  const marca = marcaConfigurada || carregarMarca();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: destino,
    useStyles: true, useSharedStrings: true });
  workbook.creator = 'Nexus'; workbook.company = marca.nome; workbook.title = titulo;
  workbook.subject = `Resultado corporativo gerado pelo Nexus para ${marca.nome}`;
  const resumo = workbook.addWorksheet('Resumo', {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }]
  });
  resumo.columns = [{ key: 'item', width: 32 }, { key: 'valor', width: 75 }];
  configurarFolhaXlsx(resumo, marca, { congelarAte: 4, colunas: 2 });
  adicionarFaixaTituloXlsx(resumo, { titulo, subtitulo: `Resultado corporativo · ${marca.nome}`,
    marca, colunas: 2 });
  resumo.addRow([]).commit();
  const cabecalhoResumo = resumo.addRow(['Informação', 'Valor']);
  estilizarCabecalhoXlsx(cabecalhoResumo, marca); cabecalhoResumo.commit();
  [['Relatório', titulo], ['Linhas exportadas', quantidadeLinhas],
    ['Gerado por', `Nexus para ${marca.nome}`]].forEach((valores, indice) => {
    const linha = resumo.addRow(valores); estilizarLinhaDadosXlsx(linha, indice + 1, marca); linha.commit();
  });
  resumo.autoFilter = { from: 'A4', to: `B${Math.max(4, resumo.rowCount)}` };
  resumo.commit();
  const dados = workbook.addWorksheet(nomeAba(titulo), {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }]
  });
  const larguras = colunas.map((coluna) => larguraColunaXlsx(coluna.rotulo || coluna.nome));
  dados.columns = colunas.map((coluna, indice) => ({ key: coluna.nome, width: larguras[indice],
    style: { numFmt: formatoColunaXlsx(coluna.rotulo || coluna.nome) || 'General' } }));
  configurarFolhaXlsx(dados, marca, { congelarAte: 4, colunas: colunas.length });
  adicionarFaixaTituloXlsx(dados, { titulo, subtitulo: `Dados autorizados · ${marca.nome}`,
    marca, colunas: colunas.length });
  dados.addRow([]).commit();
  const cabecalho = dados.addRow(colunas.map((coluna) => coluna.rotulo || coluna.nome));
  estilizarCabecalhoXlsx(cabecalho, marca); cabecalho.commit();
  const con = criarConexaoDuckDB();
  try {
    const selecao = colunas.map(({ nome }) => citar(nome)).join(', ');
    const stream = con.stream(`SELECT ${selecao} FROM read_parquet('${escaparSql(caminhoDataset)}') ORDER BY __nexus_row_number LIMIT 50000`);
    let indiceLinha = 0;
    for await (const linha of stream) {
      const valores = Object.fromEntries(colunas.map(({ nome, rotulo }) =>
        [nome, normalizarValorXlsx(linha[nome], rotulo || nome)]));
      colunas.forEach(({ nome, rotulo }, indice) => {
        larguras[indice] = Math.max(larguras[indice],
          larguraColunaXlsx(rotulo || nome, [valores[nome]], 48));
      });
      const linhaDados = dados.addRow(valores);
      estilizarLinhaDadosXlsx(linhaDados, ++indiceLinha, marca);
      colunas.forEach(({ nome, rotulo }, indice) =>
        alinharCelulaXlsx(linhaDados.getCell(indice + 1), rotulo || nome, [linha[nome]]));
      linhaDados.commit();
    }
    dados.columns.forEach((coluna, indice) => { coluna.width = Math.min(48, larguras[indice]); });
    dados.autoFilter = { from: 'A4', to: `${dados.getColumn(colunas.length).letter}4` };
    dados.commit();
    await workbook.commit();
    const stat = await fs.stat(destino);
    if (!stat.size) throw new Error('A planilha exportada ficou vazia.');
    return { caminho: destino, bytes: stat.size, formato: 'xlsx',
      mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      validacao: { abas: 2, linhas: Math.min(50_000, quantidadeLinhas),
        template: marca.nome } };
  } catch (erro) {
    await fs.unlink(destino).catch(() => null); throw erro;
  } finally { await fecharConexaoDuckDB(con); }
}

async function inspecionarColunasParquet(caminhoDataset) {
  const con = criarConexaoDuckDB();
  try {
    const schema = await allDuckDB(con, `DESCRIBE SELECT * FROM read_parquet('${escaparSql(caminhoDataset)}')`);
    return schema.map((x) => x.column_name).filter((nome) => !nome.startsWith('__nexus_'));
  } finally { await fecharConexaoDuckDB(con); }
}

module.exports = { construirXlsxDataset, inspecionarColunasParquet };
