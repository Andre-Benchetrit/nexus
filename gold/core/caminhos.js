const path = require('path');
const { resolverRaizLake } = require('../../nexus/lake_storage');

const RAIZ_LAKE_PADRAO = resolverRaizLake();

function formatarData(data) {
  return data.toISOString().slice(0, 10);
}

function formatarExecucao(data) {
  return data.toISOString().replace(/[-:.]/g, '');
}

function criarCaminhosGold(objeto, opcoes = {}) {
  const agora = opcoes.agora || new Date();
  const raizLake = path.resolve(opcoes.raizLake || RAIZ_LAKE_PADRAO);
  const dataProcessamento = formatarData(agora);
  const idExecucao = formatarExecucao(agora);
  const raizObjeto = path.join(raizLake, 'gold', objeto.nome);
  const diretorio = path.join(
    raizObjeto,
    `dt_processamento=${dataProcessamento}`,
    `execucao=${idExecucao}`
  );

  return {
    raizLake,
    raizObjeto,
    diretorio,
    dataProcessamento,
    idExecucao,
    parquet: path.join(diretorio, 'dados.parquet'),
    manifesto: path.join(diretorio, 'manifest.json')
  };
}

function caminhoParaDuckDB(caminho) {
  return caminho.replace(/\\/g, '/').replace(/'/g, "''");
}

module.exports = { RAIZ_LAKE_PADRAO, criarCaminhosGold, caminhoParaDuckDB };
