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
const { operacaoArquivoComRetentativas } = require('../core/arquivos');
const { criarCaminhosExportacao, caminhoParaDuckDB } = require('../core/caminhos');
const {
  montarConsultaPostgres,
  montarConsultaChavesAtuais,
  normalizarChavesPrimarias,
  validarEntidade
} = require('../core/sql');
const { exportarConsultaParaCsv, converterCsvParaParquet } = require('./copy_stream');
const { criarLakeStorage } = require('../../nexus/lake_storage');
const {
  criarWorkspaceLake, limparWorkspaceLake, prefixoRelativoWorkspace
} = require('../../nexus/lake_workspace');

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
  const storage = opcoes.lakeStorage || criarLakeStorage({ raizLake: opcoes.raizLake, env: opcoes.env });
  const consulta = montarConsultaPostgres(entidade, opcoes);
  const consultaNativa = montarConsultaPostgres(entidade, opcoes, null);
  const consultaChavesAtuais = montarConsultaChavesAtuais(entidade);
  const consultaChavesAtuaisNativa = montarConsultaChavesAtuais(entidade, null);

  if (opcoes.dryRun) {
    const caminhos = criarCaminhosExportacao(entidade, inicio, {
      raizLake: storage.raizLake || storage.raizTemporaria
    });
    return { entidade: entidade.nome, consulta, consultaChavesAtuais, caminhos };
  }

  if (
    entidade.extracao?.modo === 'incremental_data' &&
    !opcoes.forcar &&
    (await storage.listarVersoes(entidade.destino.camada, entidade.nome)).some(({ manifesto }) =>
      manifesto.status === 'sucesso' && manifesto.janela?.inicio === opcoes.inicio &&
      manifesto.janela?.fim === opcoes.fim)
  ) {
    throw new Error('Esta janela já foi exportada. Use --forcar somente se quiser reprocessá-la.');
  }

  const workspace = await criarWorkspaceLake({ ...opcoes, lakeStorage: storage }, `bronze-${entidade.nome}`);
  const caminhos = criarCaminhosExportacao(entidade, inicio, { raizLake: workspace.raiz });

  await fsp.mkdir(caminhos.diretorio, { recursive: true });
  const con = criarConexaoDuckDB();
  let erroExportacao = null;
  let conexaoFechada = false;
  const arquivoTemporario = path.join(caminhos.diretorio, 'dados.csv.tmp');
  const arquivoChavesTemporario = caminhos.csvChavesAtuaisTemporario;
  let reconciliacaoExclusoes = null;

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
        parquet: caminhos.parquet,
        colunas: entidade.extracao?.colunas || ['*']
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

    if (consultaChavesAtuais) {
      console.log(`[${entidade.nome}] Reconciliando chaves removidas da origem...`);
      if (entidade.extracao?.transporte === 'copy_stream') {
        await exportarConsultaParaCsv(
          consultaChavesAtuaisNativa,
          arquivoChavesTemporario
        );
        await converterCsvParaParquet({
          schema: entidade.schema,
          tabela: entidade.tabela,
          csv: arquivoChavesTemporario,
          parquet: caminhos.parquetChavesAtuais,
          colunas: normalizarChavesPrimarias(entidade.extracao.chavePrimaria)
        });
        await operacaoArquivoComRetentativas(() => fsp.unlink(arquivoChavesTemporario));
      } else {
        await runDuckDB(
          con,
          `COPY (${consultaChavesAtuais}) TO ` +
          `'${caminhoParaDuckDB(caminhos.parquetChavesAtuais)}' ` +
          `(FORMAT PARQUET, COMPRESSION ZSTD);`
        );
      }

      const [resultadoChaves] = await allDuckDB(
        con,
        `SELECT count(*) AS total, bit_xor(hash(chaves)) AS checksum ` +
        `FROM read_parquet('${caminhoParaDuckDB(caminhos.parquetChavesAtuais)}') AS chaves`
      );
      reconciliacaoExclusoes = {
        estrategia: 'snapshot_chaves_atuais',
        arquivo: 'chaves_atuais.parquet',
        totalChaves: Number(resultadoChaves.total),
        checksum: resultadoChaves.checksum?.toString() || null
      };
    }

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
      reconciliacaoExclusoes,
      arquivo: 'dados.parquet'
    };

    let caminhosPublicados = caminhos;
    if (storage.tipo === 'filesystem') {
      await fsp.writeFile(caminhos.manifesto, JSON.stringify(manifesto, null, 2));
    } else {
      const arquivosExtras = reconciliacaoExclusoes
        ? [{ origem: caminhos.parquetChavesAtuais, nome: 'chaves_atuais.parquet' }] : [];
      const publicado = await storage.publicarSnapshot({
        camada: entidade.destino.camada, objeto: entidade.nome, manifesto,
        arquivoOrigem: caminhos.parquet, arquivosExtras,
        prefixoRelativo: prefixoRelativoWorkspace(workspace, caminhos.diretorio)
      });
      caminhosPublicados = { ...caminhos, diretorio: publicado.caminho,
        parquet: `${publicado.caminho}/dados.parquet`, manifesto: publicado.caminhoManifesto,
        parquetChavesAtuais: reconciliacaoExclusoes
          ? `${publicado.caminho}/chaves_atuais.parquet` : caminhos.parquetChavesAtuais };
    }
    console.log(`[${entidade.nome}] Concluído: ${totalLinhas} linhas.`);
    console.log(caminhosPublicados.parquet);

    return { ...manifesto, caminhos: caminhosPublicados };
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
    if (erroExportacao && fs.existsSync(caminhos.parquetChavesAtuais)) {
      try {
        await operacaoArquivoComRetentativas(() => fsp.unlink(caminhos.parquetChavesAtuais));
      } catch (erroLimpeza) {
        erroExportacao.message += ` (snapshot de chaves sem manifesto sera ignorado: ${erroLimpeza.message})`;
      }
    }
    if (fs.existsSync(arquivoChavesTemporario)) {
      try {
        await operacaoArquivoComRetentativas(() => fsp.unlink(arquivoChavesTemporario));
      } catch (erroLimpeza) {
        if (erroExportacao) erroExportacao.message += ` (CSV temporario de chaves nao removido: ${erroLimpeza.message})`;
      }
    }
    await limparWorkspaceLake(workspace);
  }
}

module.exports = { exportarPostgres, operacaoArquivoComRetentativas };
