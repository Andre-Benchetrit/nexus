require('dotenv').config({ quiet: true });

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const {
  criarConexaoDuckDB,
  fecharConexaoDuckDB,
  runDuckDB,
  allDuckDB,
  prepararPostgresDuckDB,
  conectarPostgresNoDuckDB
} = require('../../duckdb/connections');
const { criarCaminhosExportacao, caminhoParaDuckDB } = require('../core/caminhos');
const { montarConsultaPostgres, validarEntidade } = require('../core/sql');
const { exportarConsultaParaCsv, converterCsvParaParquet } = require('./copy_stream');

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

async function janelaJaExportada(raiz, inicio, fim) {
  if (!fs.existsSync(raiz)) return false;

  const entradas = await fsp.readdir(raiz, { withFileTypes: true });
  for (const entrada of entradas) {
    const caminho = path.join(raiz, entrada.name);
    if (entrada.isDirectory() && await janelaJaExportada(caminho, inicio, fim)) return true;
    if (entrada.isFile() && entrada.name === 'manifest.json') {
      const manifesto = JSON.parse(await fsp.readFile(caminho, 'utf8'));
      if (manifesto.status === 'sucesso' && manifesto.janela?.inicio === inicio && manifesto.janela?.fim === fim) {
        return true;
      }
    }
  }
  return false;
}

async function exportarPostgres(entidade, opcoes = {}) {
  validarEntidade(entidade);

  const inicio = opcoes.agora || new Date();
  const caminhos = criarCaminhosExportacao(entidade, inicio);
  const consulta = montarConsultaPostgres(entidade, opcoes);
  const consultaNativa = montarConsultaPostgres(entidade, opcoes, null);

  if (opcoes.dryRun) {
    return { entidade: entidade.nome, consulta, caminhos };
  }

  if (
    entidade.extracao?.modo === 'incremental_data' &&
    !opcoes.forcar &&
    await janelaJaExportada(caminhos.raizEntidade, opcoes.inicio, opcoes.fim)
  ) {
    throw new Error('Esta janela já foi exportada. Use --forcar somente se quiser reprocessá-la.');
  }

  await fsp.mkdir(caminhos.diretorio, { recursive: true });
  const con = criarConexaoDuckDB();
  let erroExportacao = null;
  let conexaoFechada = false;
  const arquivoTemporario = path.join(caminhos.diretorio, 'dados.csv.tmp');

  try {
    console.log(`[${entidade.nome}] Preparando conexão...`);
    if (entidade.extracao?.transporte !== 'copy_stream') {
      await prepararPostgresDuckDB(con);
      // A cópia binária preserva os bytes da codificação do servidor. Em
      // bancos WIN1252 isso pode produzir Parquet marcado como UTF-8, mas inválido.
      // O protocolo textual faz o PostgreSQL aplicar a conversão para UTF-8.
      await runDuckDB(con, 'SET pg_use_binary_copy=false;');
      await conectarPostgresNoDuckDB(con);
    }

    const arquivoDestino = caminhoParaDuckDB(caminhos.parquet);
    console.log(`[${entidade.nome}] Exportando snapshot...`);
    if (entidade.extracao?.transporte === 'copy_stream') {
      console.log(`[${entidade.nome}] Lendo PostgreSQL em streaming...`);
      await exportarConsultaParaCsv(consultaNativa, arquivoTemporario);

      await converterCsvParaParquet({
        schema: entidade.schema,
        tabela: entidade.tabela,
        csv: arquivoTemporario,
        parquet: caminhos.parquet
      });
      await operacaoArquivoComRetentativas(() => fsp.unlink(arquivoTemporario));
    } else {
      await runDuckDB(
        con,
        `COPY (${consulta}) TO '${arquivoDestino}' (FORMAT PARQUET, COMPRESSION ZSTD);`
      );
    }

    // hash(linha) obriga o leitor a decodificar todas as colunas. count(*) sozinho
    // usa os metadados do Parquet e não detecta strings com codificação inválida.
    const [resultado] = await allDuckDB(
      con,
      `SELECT count(*) AS total, bit_xor(hash(dados)) AS checksum ` +
      `FROM read_parquet('${arquivoDestino}') AS dados`
    );
    const totalLinhas = Number(resultado.total);
    const checksum = resultado.checksum?.toString() || null;

    // O manifest.json é o marcador de commit. O leitor ignora qualquer Parquet
    // que tenha sido escrito sem um manifesto de sucesso.
    await fecharConexaoDuckDB(con);
    conexaoFechada = true;

    const fim = new Date();
    const manifesto = {
      entidade: entidade.nome,
      fonte: entidade.fonte,
      modo: entidade.extracao?.modo || 'snapshot',
      status: 'sucesso',
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
      totalLinhas,
      checksum,
      janela: entidade.extracao?.modo === 'incremental_data'
        ? { inicio: opcoes.inicio, fim: opcoes.fim }
        : null,
      chavePrimaria: entidade.extracao?.chavePrimaria || null,
      arquivo: 'dados.parquet'
    };

    await fsp.writeFile(caminhos.manifesto, JSON.stringify(manifesto, null, 2));
    console.log(`[${entidade.nome}] Concluído: ${totalLinhas} linhas.`);
    console.log(caminhos.parquet);

    return { ...manifesto, caminhos };
  } catch (error) {
    erroExportacao = error;
    throw error;
  } finally {
    if (!conexaoFechada) {
      await fecharConexaoDuckDB(con);
      conexaoFechada = true;
    }
    if (erroExportacao && fs.existsSync(caminhos.parquet)) {
      try {
        await operacaoArquivoComRetentativas(() => fsp.unlink(caminhos.parquet));
      } catch (erroLimpeza) {
        erroExportacao.message += ` (arquivo sem manifesto será ignorado: ${erroLimpeza.message})`;
      }
    }
    if (fs.existsSync(arquivoTemporario)) {
      try {
        await operacaoArquivoComRetentativas(() => fsp.unlink(arquivoTemporario));
      } catch (erroLimpeza) {
        if (erroExportacao) erroExportacao.message += ` (CSV temporário não removido: ${erroLimpeza.message})`;
      }
    }
  }
}

module.exports = { exportarPostgres, operacaoArquivoComRetentativas };
