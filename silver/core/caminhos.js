const path = require('path');

const RAIZ_LAKE_PADRAO = path.resolve(__dirname, '..', '..', 'lake');

function formatarData(data) {
  return data.toISOString().slice(0, 10);
}

function formatarExecucao(data) {
  return data.toISOString().replace(/[-:.]/g, '');
}

function criarCaminhosSilver(objeto, opcoes = {}) {
  const agora = opcoes.agora || new Date();
  const raizLake = path.resolve(opcoes.raizLake || RAIZ_LAKE_PADRAO);
  const dataProcessamento = formatarData(agora);
  const idExecucao = formatarExecucao(agora);
  const raizObjeto = path.join(raizLake, 'silver', objeto.nome);
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
    parquetTemporario: path.join(diretorio, 'dados.parquet.tmp'),
    manifesto: path.join(diretorio, 'manifest.json')
  };
}

function caminhoParaDuckDB(caminho) {
  return caminho.replace(/\\/g, '/').replace(/'/g, "''");
}

module.exports = { RAIZ_LAKE_PADRAO, criarCaminhosSilver, caminhoParaDuckDB };
