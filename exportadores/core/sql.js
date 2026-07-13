const IDENTIFICADOR_SEGURO = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;

function citarIdentificador(valor, campo) {
  if (!IDENTIFICADOR_SEGURO.test(valor)) {
    throw new Error(`${campo} possui um identificador inválido: ${valor}`);
  }

  return `"${valor}"`;
}

function validarDataISO(valor, campo) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor || '') || Number.isNaN(Date.parse(`${valor}T00:00:00Z`))) {
    throw new Error(`${campo} deve estar no formato YYYY-MM-DD.`);
  }
}

function montarConsultaPostgres(entidade, opcoes = {}, alias = 'pg_db') {
  const extracao = entidade.extracao || {};

  if (extracao.sql) {
    return extracao.sql.trim().replace(/;$/, '');
  }

  const colunas = extracao.colunas || ['*'];
  const selecao = colunas.length === 1 && colunas[0] === '*'
    ? '*'
    : colunas.map((coluna) => citarIdentificador(coluna, 'coluna')).join(', ');

  const origem = [alias, entidade.schema, entidade.tabela]
    .map((parte, indice) => citarIdentificador(parte, indice === 0 ? 'alias' : 'tabela'))
    .join('.');

  let consulta = `SELECT ${selecao} FROM ${origem}`;

  if (extracao.modo === 'incremental_data') {
    validarDataISO(opcoes.inicio, 'inicio');
    validarDataISO(opcoes.fim, 'fim');
    if (opcoes.inicio >= opcoes.fim) {
      throw new Error('inicio deve ser anterior a fim.');
    }

    const cursor = citarIdentificador(extracao.cursor, 'cursor');
    consulta += ` WHERE ${cursor} >= DATE '${opcoes.inicio}' AND ${cursor} < DATE '${opcoes.fim}'`;
  }

  return consulta;
}

function validarEntidade(entidade) {
  if (!entidade || typeof entidade !== 'object') {
    throw new Error('A configuração da entidade é obrigatória.');
  }

  for (const campo of ['nome', 'fonte', 'schema', 'tabela']) {
    if (!entidade[campo]) throw new Error(`Entidade sem o campo obrigatório: ${campo}`);
  }

  if (entidade.fonte !== 'postgres') {
    throw new Error(`Fonte ainda não suportada neste exportador: ${entidade.fonte}`);
  }

  if (!entidade.destino?.camada) {
    throw new Error('Entidade sem destino.camada.');
  }

  citarIdentificador(entidade.nome, 'nome');
  citarIdentificador(entidade.schema, 'schema');
  citarIdentificador(entidade.tabela, 'tabela');

  if (entidade.extracao?.modo === 'incremental_data') {
    if (!entidade.extracao.cursor) throw new Error('Extração incremental sem cursor.');
    if (!entidade.extracao.chavePrimaria) throw new Error('Extração incremental sem chavePrimaria.');
    citarIdentificador(entidade.extracao.cursor, 'cursor');
    citarIdentificador(entidade.extracao.chavePrimaria, 'chavePrimaria');
  }
}

module.exports = {
  montarConsultaPostgres,
  validarEntidade
};
