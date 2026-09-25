require('dotenv').config({ quiet: true });

const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const { resolverConexao } = require('../../integracoes/microsoft/conexoes');
const { criarClienteGraph } = require('../../integracoes/microsoft/graph');
const { operacaoArquivoComRetentativas } = require('../core/arquivos');
const { criarCaminhosExportacao } = require('../core/caminhos');
const { lerPlanilha } = require('./excel');
const { criarLakeStorage } = require('../../nexus/lake_storage');
const {
  criarWorkspaceLake, limparWorkspaceLake, prefixoRelativoWorkspace
} = require('../../nexus/lake_workspace');

const FORMATOS_SUPORTADOS = Object.freeze(['.xlsx']);
const executarArquivo = promisify(execFile);

function escaparCsv(valor) {
  if (valor == null) return '';
  return `"${String(valor).replace(/"/g, '""')}"`;
}

function criarCsv(colunas, linhas) {
  const nomes = colunas.map((coluna) => coluna.destino);
  const registros = [nomes.map(escaparCsv).join(',')];
  for (const linha of linhas) {
    registros.push(nomes.map((nome) => escaparCsv(linha[nome])).join(','));
  }
  return `${registros.join('\r\n')}\r\n`;
}

async function converterCsvParaParquet(csv, parquet, dependencias = {}) {
  const executar = dependencias.executarArquivo || executarArquivo;
  const script = dependencias.script || path.join(__dirname, 'converter_csv.js');
  const { stdout } = await executar(dependencias.execPath || process.execPath, [script, csv, parquet], {
    env: process.env,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  return JSON.parse(stdout);
}

async function listarManifestos(diretorio) {
  let entradas;
  try {
    entradas = await fsp.readdir(diretorio, { withFileTypes: true });
  } catch (erro) {
    if (erro.code === 'ENOENT') return [];
    throw erro;
  }
  const manifestos = [];
  for (const entrada of entradas) {
    const caminho = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) manifestos.push(...await listarManifestos(caminho));
    else if (entrada.isFile() && entrada.name === 'manifest.json') manifestos.push(caminho);
  }
  return manifestos;
}

async function ultimoManifestoSucesso(raizEntidade) {
  const caminhos = await listarManifestos(raizEntidade);
  let ultimo = null;
  for (const caminho of caminhos) {
    const manifesto = JSON.parse(await fsp.readFile(caminho, 'utf8'));
    if (manifesto.status !== 'sucesso') continue;
    if (!ultimo || manifesto.fim > ultimo.fim) ultimo = manifesto;
  }
  return ultimo;
}

function validarEntidadeOneDrive(entidade) {
  if (!entidade || entidade.fonte !== 'onedrive') {
    throw new Error('O exportador OneDrive recebeu uma entidade de outra fonte.');
  }
  if (!entidade.nome || !entidade.destino?.camada) {
    throw new Error('Entidade OneDrive sem nome ou destino.camada.');
  }
  if (!entidade.extracao?.conexao) {
    throw new Error(`Entidade ${entidade.nome} sem extracao.conexao.`);
  }
  if (!entidade.extracao?.itemId && !entidade.extracao?.itemIdEnv) {
    throw new Error(`Entidade ${entidade.nome} sem itemId ou itemIdEnv.`);
  }
}

function obterItemId(entidade, env) {
  const extracao = entidade.extracao;
  const itemId = extracao.itemId || env[extracao.itemIdEnv];
  if (!String(itemId || '').trim()) {
    throw new Error(
      `Arquivo nao configurado para ${entidade.nome}: preencha ${extracao.itemIdEnv}.`
    );
  }
  return String(itemId).trim();
}

function configuracaoExcel(entidade, env, metadadosOrigem = {}) {
  const extracao = entidade.extracao;
  return {
    planilha: extracao.planilha || (
      extracao.planilhaEnv ? String(env[extracao.planilhaEnv] || '').trim() || null : null
    ),
    linhaCabecalho: extracao.linhaCabecalho || 1,
    colunas: extracao.colunas || [],
    metadadosOrigem
  };
}

async function exportarOneDrive(entidade, opcoes = {}, dependencias = {}) {
  validarEntidadeOneDrive(entidade);
  const env = dependencias.env || process.env;
  const agora = opcoes.agora || new Date();
  const criarCaminhos = dependencias.criarCaminhos || criarCaminhosExportacao;
  const storage = opcoes.lakeStorage || dependencias.lakeStorage || criarLakeStorage({
    raizLake: opcoes.raizLake, env
  });
  const conexao = (dependencias.resolverConexao || resolverConexao)(
    entidade.extracao.conexao,
    { env, exigirCredenciais: !opcoes.dryRun }
  );
  const itemId = obterItemId(entidade, env);

  if (opcoes.dryRun) {
    const caminhos = criarCaminhos(entidade, agora, {
      raizLake: storage.raizLake || storage.raizTemporaria
    });
    return {
      entidade: entidade.nome,
      fonte: entidade.fonte,
      conexao: conexao.nome,
      itemId,
      caminhos
    };
  }

  const criarGraph = dependencias.criarClienteGraph || criarClienteGraph;
  let graph = criarGraph(conexao);
  let driveId = conexao.driveId;
  if (!driveId) {
    const drive = await graph.resolverDrive();
    driveId = drive.id;
    graph = criarGraph({ ...conexao, driveId });
  }
  const item = await graph.obterItem(itemId, driveId);
  const extensao = path.extname(item.name || '').toLowerCase();
  if (!FORMATOS_SUPORTADOS.includes(extensao)) {
    throw new Error(
      `Formato nao suportado para ${item.name || itemId}: use ${FORMATOS_SUPORTADOS.join(', ')}.`
    );
  }

  const caminhosReferencia = criarCaminhos(entidade, agora, {
    raizLake: storage.raizLake || storage.raizTemporaria
  });
  const anterior = dependencias.ultimoManifesto || dependencias.criarCaminhos
    ? await (dependencias.ultimoManifesto || ultimoManifestoSucesso)(caminhosReferencia.raizEntidade)
    : (await storage.listarVersoes(entidade.destino.camada, entidade.nome)).at(-1)?.manifesto || null;
  if (!opcoes.forcar && anterior?.origem?.eTag && anterior.origem.eTag === item.eTag) {
    const caminhos = criarCaminhos(entidade, agora, {
      raizLake: storage.raizLake || storage.raizTemporaria
    });
    return {
      ...anterior,
      alterado: false,
      reutilizado: true,
      caminhos
    };
  }

  const tamanhoMaximoMb = Number(entidade.extracao.tamanhoMaximoMb || 100);
  if (item.size && item.size > tamanhoMaximoMb * 1024 * 1024) {
    throw new Error(
      `Arquivo ${item.name} excede o limite de ${tamanhoMaximoMb} MB definido no catalogo.`
    );
  }

  const workspace = await criarWorkspaceLake({ ...opcoes, lakeStorage: storage }, `bronze-${entidade.nome}`);
  const caminhos = criarCaminhos(entidade, agora, { raizLake: workspace.raiz });
  await fsp.mkdir(caminhos.diretorio, { recursive: true });
  const original = path.join(caminhos.diretorio, `origem${extensao}`);
  const csvTemporario = path.join(caminhos.diretorio, 'dados.csv.tmp');
  let erroExportacao;

  try {
    const download = await graph.baixarItem(itemId, driveId);
    if (download.buffer.length > tamanhoMaximoMb * 1024 * 1024) {
      throw new Error(`Download excedeu o limite de ${tamanhoMaximoMb} MB.`);
    }
    const excel = await (dependencias.lerPlanilha || lerPlanilha)(
      download.buffer,
      configuracaoExcel(entidade, env, {
        conexao: conexao.id,
        itemId: item.id,
        arquivo: item.name
      })
    );
    await fsp.writeFile(original, download.buffer);
    await fsp.writeFile(csvTemporario, criarCsv(excel.colunas, excel.linhas), 'utf8');

    const resultado = await (dependencias.converterCsvParaParquet || converterCsvParaParquet)(
      csvTemporario,
      caminhos.parquet
    );
    await operacaoArquivoComRetentativas(() => fsp.unlink(csvTemporario));

    const fim = new Date();
    const manifesto = {
      entidade: entidade.nome,
      fonte: entidade.fonte,
      modo: entidade.extracao.modo || 'arquivo_versionado',
      status: 'sucesso',
      inicio: agora.toISOString(),
      fim: fim.toISOString(),
      totalLinhas: resultado.totalLinhas,
      checksum: resultado.checksum,
      arquivo: 'dados.parquet',
      arquivoOriginal: path.basename(original),
      origem: {
        conexaoId: conexao.id,
        conexaoNome: conexao.nome,
        driveId,
        itemId: item.id,
        nomeArquivo: item.name,
        eTag: item.eTag || null,
        cTag: item.cTag || null,
        tamanhoBytes: Number(item.size || download.buffer.length),
        modificadoEm: item.lastModifiedDateTime || null,
        sha256: crypto.createHash('sha256').update(download.buffer).digest('hex'),
        planilha: excel.nomePlanilha,
        linhaCabecalho: excel.linhaCabecalho,
        colunas: excel.colunas
      }
    };
    let caminhosPublicados = caminhos;
    if (storage.tipo === 'filesystem') {
      await fsp.writeFile(caminhos.manifesto, JSON.stringify(manifesto, null, 2));
    } else {
      const publicado = await storage.publicarSnapshot({
        camada: entidade.destino.camada, objeto: entidade.nome, manifesto,
        arquivoOrigem: caminhos.parquet,
        arquivosExtras: [{ origem: original, nome: path.basename(original) }],
        prefixoRelativo: prefixoRelativoWorkspace(workspace, caminhos.diretorio)
      });
      caminhosPublicados = { ...caminhos, diretorio: publicado.caminho,
        parquet: `${publicado.caminho}/dados.parquet`,
        manifesto: publicado.caminhoManifesto,
        original: `${publicado.caminho}/${path.basename(original)}` };
    }
    return { ...manifesto, alterado: true, caminhos: caminhosPublicados };
  } catch (erro) {
    erroExportacao = erro;
    throw erro;
  } finally {
    for (const arquivo of [csvTemporario, caminhos.parquet, original]) {
      if (erroExportacao && fs.existsSync(arquivo)) {
        try {
          await operacaoArquivoComRetentativas(() => fsp.unlink(arquivo));
        } catch (_) {
          // Sem manifesto de sucesso, arquivos residuais nao entram no lake.
        }
      }
    }
    await limparWorkspaceLake(workspace);
  }
}

module.exports = {
  converterCsvParaParquet,
  criarCsv,
  exportarOneDrive,
  ultimoManifestoSucesso,
  validarEntidadeOneDrive
};
