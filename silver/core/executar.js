const fs = require('fs/promises');
const path = require('path');

const {
  criarConexaoDuckDB,
  fecharConexaoDuckDB,
  runDuckDB,
  allDuckDB
} = require('../../duckdb/connections');
const { criarLeitorBronze } = require('../../duckdb/bronze');
const { criarLeitorSilver } = require('../../duckdb/silver');
const { criarCaminhosSilver, caminhoParaDuckDB } = require('./caminhos');
const { prepararFontesBronze } = require('./fontes_bronze');
const { validarArquivoSilver } = require('./qualidade');

function citar(nome) {
  return `"${nome.replace(/"/g, '""')}"`;
}

function normalizarValores(linha) {
  return Object.fromEntries(Object.entries(linha).map(([chave, valor]) => [
    chave,
    typeof valor === 'bigint' ? Number(valor) : valor
  ]));
}

function resumirFontes(contextos, raizLake) {
  return [...contextos.entries()].map(([nome, contexto]) => ({
    entidade: nome,
    execucoesConsideradas: contexto.execucoes.length,
    manifestos: contexto.execucoes.map(({ manifesto, caminhoManifesto }) => ({
      caminho: path.relative(raizLake, caminhoManifesto).replace(/\\/g, '/'),
      fim: manifesto.fim || null,
      totalLinhas: Number(manifesto.totalLinhas || 0),
      checksum: manifesto.checksum || null
    }))
  }));
}

function resumirFontesSilver(contextos, raizLake) {
  return [...contextos.entries()].map(([nome, contexto]) => ({
    objeto: nome,
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
    await operacaoArquivoComRetentativas(() => fs.rm(caminho, { force: true }));
  } catch (_) {
    // Um arquivo sem manifesto nunca sera considerado uma execucao valida.
  }
}

async function operacaoArquivoComRetentativas(operacao, tentativas = 10) {
  let ultimoErro;
  for (let tentativa = 0; tentativa < tentativas; tentativa += 1) {
    try {
      return await operacao();
    } catch (erro) {
      ultimoErro = erro;
      if (!['EBUSY', 'EPERM'].includes(erro.code) || tentativa === tentativas - 1) throw erro;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw ultimoErro;
}

async function construirSilver(objeto, opcoes = {}) {
  const inicio = opcoes.agora || new Date();
  const caminhos = criarCaminhosSilver(objeto, {
    agora: inicio,
    raizLake: opcoes.raizLake
  });
  await fs.mkdir(caminhos.diretorio, { recursive: true });

  const con = criarConexaoDuckDB();
  const leitorBronze = criarLeitorBronze({
    raizLake: caminhos.raizLake,
    catalogo: opcoes.catalogoBronze,
    conexao: con
  });
  const leitorSilver = criarLeitorSilver({
    raizLake: caminhos.raizLake,
    catalogo: opcoes.catalogoSilver,
    conexao: con
  });
  let validacao;
  let relacionamentos = {};
  let fontesBronze;
  let fontesSilver = [];
  let erroProcessamento = null;

  try {
    const contextos = await prepararFontesBronze(leitorBronze, objeto.fontesBronze);
    const contextosSilver = new Map();
    for (const nome of objeto.fontesSilver || []) {
      contextosSilver.set(nome, await leitorSilver.prepararObjeto(nome));
    }
    const contextoPrincipal = contextos.get(objeto.fontePrincipal);
    const [entrada] = await allDuckDB(
      con,
      `SELECT count(*) AS total FROM ${citar(contextoPrincipal.viewAtual)}`
    );

    const sql = objeto.construirSql(contextos, contextosSilver);
    const destino = caminhoParaDuckDB(caminhos.parquet);
    await runDuckDB(
      con,
      `COPY (${sql}) TO '${destino}' (FORMAT PARQUET, COMPRESSION ZSTD)`
    );

    validacao = await validarArquivoSilver(
      con,
      caminhos.parquet,
      objeto,
      entrada.total
    );
    if (objeto.construirMetricasRelacionamentosSql) {
      const [metricas] = await allDuckDB(
        con,
        objeto.construirMetricasRelacionamentosSql(contextos, contextosSilver)
      );
      relacionamentos = normalizarValores(metricas);
    }
    fontesBronze = resumirFontes(contextos, caminhos.raizLake);
    fontesSilver = resumirFontesSilver(contextosSilver, caminhos.raizLake);
  } catch (erro) {
    erroProcessamento = erro;
  } finally {
    await leitorBronze.fechar();
    await leitorSilver.fechar();
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
      camada: 'silver',
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
        totalEntrada: validacao.totalEntrada,
        totalSaida: validacao.totalSaida,
        chavesNulas: validacao.chavesNulas,
        chavesDuplicadas: validacao.chavesDuplicadas,
        relacionamentos
      },
      fontesBronze,
      fontesSilver
    };
    await fs.writeFile(caminhos.manifesto, JSON.stringify(manifesto, null, 2));
    return { ...manifesto, caminhos };
  } catch (erro) {
    await removerSeExistir(caminhos.parquetTemporario);
    await removerSeExistir(caminhos.parquet);
    await removerSeExistir(caminhos.manifesto);
    throw erro;
  }
}

module.exports = { construirSilver };
