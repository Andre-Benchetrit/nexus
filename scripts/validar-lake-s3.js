#!/usr/bin/env node

const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const { criarConexaoDuckDB, fecharConexaoDuckDB, allDuckDB } = require('../duckdb/connections');
const { criarLakeStorage } = require('../nexus/lake_storage');
const { inventariarLake, integridade, manifestoDestino, mesmaIntegridade } = require('./migrar-lake-s3');

function argumentos(argv = process.argv.slice(2)) {
  const indice = argv.indexOf('--from');
  if (indice < 0 || !argv[indice + 1]) throw new Error('Use --from <diretorio-do-lake>.');
  return { raiz: path.resolve(argv[indice + 1]) };
}

function escaparSql(valor) { return String(valor).replace(/'/g, "''"); }

function chaveObjeto(item) { return `${item.camada}:${item.objeto}`; }

function compararOrdenacao(a, b) {
  const dataA = a.manifesto.fim || a.manifesto.inicio || '';
  const dataB = b.manifesto.fim || b.manifesto.inicio || '';
  return dataA.localeCompare(dataB) || a.prefixoRelativo.localeCompare(b.prefixoRelativo);
}

async function perfilParquet(conexao, arquivo) {
  const origem = `read_parquet('${escaparSql(arquivo)}')`;
  const [contagem] = await allDuckDB(conexao, `SELECT count(*)::BIGINT AS total FROM ${origem}`);
  const colunas = await allDuckDB(conexao, `DESCRIBE SELECT * FROM ${origem}`);
  return { linhas: Number(contagem.total), colunas: colunas.map((item) => ({
    nome: item.column_name, tipo: item.column_type
  })) };
}

async function executar(opcoes = {}, dependencias = {}) {
  const snapshots = dependencias.snapshots || await inventariarLake(opcoes.raiz);
  const storage = dependencias.storage || criarLakeStorage();
  if (storage.tipo !== 's3') throw new Error('A validacao exige NEXUS_LAKE_STORAGE=s3.');
  let local; let remoto;
  try {
    const divergencias = [];
    for (const snapshot of snapshots) {
      const destino = await manifestoDestino(storage, snapshot);
      if (!destino) divergencias.push({ tipo: 'manifesto_ausente', caminho: snapshot.relativoManifesto });
      else if (!mesmaIntegridade(destino.integridadeMigracao, integridade(snapshot))) {
        divergencias.push({ tipo: 'integridade_divergente', caminho: snapshot.relativoManifesto });
      }
    }
    if (divergencias.length) {
      const erro = new Error(`Foram encontradas ${divergencias.length} divergencias de integridade.`);
      erro.codigo = 'LAKE_VALIDATION_INTEGRITY_FAILED'; erro.divergencias = divergencias.slice(0, 20);
      throw erro;
    }

    const porObjeto = new Map();
    for (const snapshot of snapshots) {
      const chave = chaveObjeto(snapshot);
      if (!porObjeto.has(chave)) porObjeto.set(chave, []);
      porObjeto.get(chave).push(snapshot);
    }
    for (const [chave, itens] of porObjeto) {
      const [camada, objeto] = chave.split(':');
      const remotos = await storage.listarVersoes(camada, objeto);
      const esperados = new Set(itens.map((item) => item.prefixoRelativo));
      const encontrados = new Set(remotos.map((item) => {
        const prefixoBucket = storage.prefixo ? `${storage.prefixo}/` : '';
        const chaveManifesto = String(item.chaveManifesto || '').replace(prefixoBucket, '');
        return path.posix.dirname(chaveManifesto);
      }));
      if (esperados.size !== encontrados.size || [...esperados].some((item) => !encontrados.has(item))) {
        divergencias.push({ tipo: 'versoes_divergentes', camada, objeto,
          esperado: esperados.size, encontrado: encontrados.size });
      }
    }
    if (divergencias.length) {
      const erro = new Error('A listagem de snapshots no S3 diverge da origem local.');
      erro.codigo = 'LAKE_VALIDATION_VERSION_FAILED'; erro.divergencias = divergencias.slice(0, 20);
      throw erro;
    }

    local = dependencias.conexaoLocal || criarConexaoDuckDB();
    remoto = dependencias.conexaoRemota || criarConexaoDuckDB();
    await storage.prepararConexaoDuckDB(remoto);
    let objetosValidados = 0;
    for (const itens of porObjeto.values()) {
      const snapshot = [...itens].sort(compararOrdenacao).at(-1);
      const principal = snapshot.arquivos.find((item) => item.nome === snapshot.nomePrincipal);
      const referencia = [storage.prefixo, snapshot.prefixoRelativo, snapshot.nomePrincipal]
        .filter(Boolean).join('/');
      const remotoUri = `s3://${storage.bucket}/${referencia}`;
      const [perfilLocal, perfilRemoto] = await Promise.all([
        perfilParquet(local, principal.caminho.replace(/\\/g, '/')),
        perfilParquet(remoto, remotoUri)
      ]);
      if (JSON.stringify(perfilLocal) !== JSON.stringify(perfilRemoto)) {
        divergencias.push({ tipo: 'parquet_divergente', camada: snapshot.camada,
          objeto: snapshot.objeto, local: perfilLocal, remoto: perfilRemoto });
      }
      if (snapshot.manifesto.totalLinhas != null &&
          Number(snapshot.manifesto.totalLinhas) !== perfilLocal.linhas) {
        divergencias.push({ tipo: 'manifesto_linhas_divergente', camada: snapshot.camada,
          objeto: snapshot.objeto, manifesto: Number(snapshot.manifesto.totalLinhas),
          parquet: perfilLocal.linhas });
      }
      objetosValidados += 1;
      dependencias.onEvento?.({ objetosValidados, totalObjetos: porObjeto.size,
        camada: snapshot.camada, objeto: snapshot.objeto });
    }
    if (divergencias.length) {
      const erro = new Error(`Foram encontradas ${divergencias.length} divergencias logicas.`);
      erro.codigo = 'LAKE_VALIDATION_PARQUET_FAILED'; erro.divergencias = divergencias.slice(0, 20);
      throw erro;
    }
    return { status: 'ok', snapshots: snapshots.length, objetos: porObjeto.size,
      bytes: snapshots.reduce((total, item) => total + item.arquivos.reduce((soma, arquivo) => soma + arquivo.tamanhoBytes, 0), 0) };
  } finally {
    if (!dependencias.conexaoLocal && local) await fecharConexaoDuckDB(local).catch(() => {});
    if (!dependencias.conexaoRemota && remoto) await fecharConexaoDuckDB(remoto).catch(() => {});
    if (!dependencias.storage) await storage.fechar?.();
  }
}

async function main() {
  const resultado = await executar(argumentos(), { onEvento: (evento) => {
    process.stdout.write(`${JSON.stringify({ level: 'info', event: 'lake_validation_progress', ...evento })}\n`);
  } });
  process.stdout.write(`${JSON.stringify({ level: 'info', event: 'lake_validation_finished', ...resultado }, null, 2)}\n`);
}

if (require.main === module) main().catch((erro) => {
  const codigo = String(erro.codigo || erro.code || erro.name || 'LAKE_VALIDATION_FAILED')
    .replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  process.stderr.write(`${JSON.stringify({ level: 'error', event: 'lake_validation_failed', code: codigo,
    divergencias: erro.divergencias || undefined })}\n`);
  process.exitCode = 1;
});

module.exports = { argumentos, compararOrdenacao, executar, perfilParquet };
