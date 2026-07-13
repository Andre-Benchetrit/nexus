const path = require('path');

const RAIZ_PROJETO = path.resolve(__dirname, '../..');

function formatarData(data) {
  return data.toISOString().slice(0, 10);
}

function formatarExecucao(data) {
  return data.toISOString().replace(/[-:.]/g, '').replace('Z', 'Z');
}

function criarCaminhosExportacao(entidade, data = new Date()) {
  const dataExtracao = formatarData(data);
  const idExecucao = formatarExecucao(data);
  const raizEntidade = path.join(
    RAIZ_PROJETO,
    'lake',
    entidade.destino.camada,
    entidade.fonte,
    entidade.nome
  );
  const diretorio = path.join(
    raizEntidade,
    `dt_extracao=${dataExtracao}`,
    `execucao=${idExecucao}`
  );

  return {
    dataExtracao,
    idExecucao,
    raizEntidade,
    diretorio,
    parquet: path.join(diretorio, 'dados.parquet'),
    parquetTemporario: path.join(diretorio, 'dados.parquet.tmp'),
    manifesto: path.join(diretorio, 'manifest.json')
  };
}

function caminhoParaDuckDB(caminho) {
  return caminho.replace(/\\/g, '/').replace(/'/g, "''");
}

module.exports = {
  criarCaminhosExportacao,
  caminhoParaDuckDB
};
