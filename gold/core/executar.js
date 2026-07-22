const fs = require('fs/promises');
const path = require('path');

const {
  criarConexaoDuckDB,
  fecharConexaoDuckDB,
  runDuckDB,
  allDuckDB
} = require('../../duckdb/connections');
const { criarLeitorSilver } = require('../../duckdb/silver');
const { criarLeitorGold } = require('../../duckdb/gold');
const { criarCaminhosGold, caminhoParaDuckDB } = require('./caminhos');
const { validarArquivoGold } = require('./qualidade');

function normalizarValores(linha = {}) {
  return Object.fromEntries(Object.entries(linha).map(([chave, valor]) => [
    chave,
    typeof valor === 'bigint' ? Number(valor) : valor
  ]));
}

function resumirFontes(contextos, raizLake, campoNome) {
  return [...contextos.entries()].map(([nome, contexto]) => ({
    [campoNome]: nome,
    execucaoUtilizada: path.relative(
      raizLake,
      contexto.execucoes.at(-1).caminhoManifesto
    ).replace(/\\/g, '/'),
    fim: contexto.execucoes.at(-1).manifesto.fim || null,
    totalLinhas: Number(contexto.execucoes.at(-1).manifesto.totalLinhas || 0),
    checksum: contexto.execucoes.at(-1).manifesto.checksum || null
  }));
}

async function removerSeExistir(caminho) {
  try {
    await fs.rm(caminho, { force: true });
  } catch (_) {
    // Sem manifesto, um arquivo parcial nunca sera considerado valido.
  }
}

async function construirGold(objeto, opcoes = {}) {
  const inicio = opcoes.agora || new Date();
  const caminhos = criarCaminhosGold(objeto, {
    agora: inicio,
    raizLake: opcoes.raizLake
  });
  await fs.mkdir(caminhos.diretorio, { recursive: true });

  const con = criarConexaoDuckDB();
  const leitorSilver = criarLeitorSilver({
    raizLake: caminhos.raizLake,
    catalogo: opcoes.catalogoSilver,
    conexao: con
  });
  const leitorGold = criarLeitorGold({
    raizLake: caminhos.raizLake,
    catalogo: opcoes.catalogoGold,
    conexao: con
  });
  let validacao;
  let metricasQualidade = {};
  let fontesSilver = [];
  let fontesGold = [];
  let erroProcessamento = null;

  try {
    const contextosSilver = new Map();
    for (const nome of objeto.fontesSilver || []) {
      contextosSilver.set(nome, await leitorSilver.prepararObjeto(nome));
    }
    const contextosGold = new Map();
    for (const nome of objeto.fontesGold || []) {
      contextosGold.set(nome, await leitorGold.prepararObjeto(nome));
    }

    const sql = objeto.construirSql(contextosSilver, contextosGold);
    const destino = caminhoParaDuckDB(caminhos.parquet);
    await runDuckDB(
      con,
      `COPY (${sql}) TO '${destino}' (FORMAT PARQUET, COMPRESSION ZSTD)`
    );
    validacao = await validarArquivoGold(con, caminhos.parquet, objeto);

    if (objeto.construirMetricasQualidadeSql) {
      const [metricas] = await allDuckDB(
        con,
        objeto.construirMetricasQualidadeSql(contextosSilver, contextosGold)
      );
      metricasQualidade = normalizarValores(metricas);
      objeto.validarMetricasQualidade?.(metricasQualidade);
    }
    fontesSilver = resumirFontes(contextosSilver, caminhos.raizLake, 'objeto');
    fontesGold = resumirFontes(contextosGold, caminhos.raizLake, 'objeto');
  } catch (erro) {
    erroProcessamento = erro;
  } finally {
    await leitorSilver.fechar();
    await leitorGold.fechar();
    await fecharConexaoDuckDB(con);
  }

  if (erroProcessamento) {
    await removerSeExistir(caminhos.parquet);
    throw erroProcessamento;
  }

  try {
    const fim = new Date();
    const manifesto = {
      objeto: objeto.nome,
      camada: 'gold',
      tipo: objeto.tipo,
      descricao: objeto.descricao,
      versaoContrato: objeto.versaoContrato,
      status: 'sucesso',
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      arquivo: 'dados.parquet',
      chavePrimaria: objeto.chavePrimaria,
      totalLinhas: validacao.totalSaida,
      checksum: validacao.checksum,
      qualidade: {
        chavesNulas: validacao.chavesNulas,
        chavesDuplicadas: validacao.chavesDuplicadas,
        metricas: metricasQualidade
      },
      fontesSilver,
      fontesGold
    };
    await fs.writeFile(caminhos.manifesto, JSON.stringify(manifesto, null, 2));
    return { ...manifesto, caminhos };
  } catch (erro) {
    await removerSeExistir(caminhos.parquet);
    await removerSeExistir(caminhos.manifesto);
    throw erro;
  }
}

module.exports = { construirGold };
