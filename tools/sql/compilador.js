const {
  CAMPOS_CALCULADOS_SQL,
  CAMPOS_NEGOCIO,
  ENTIDADES_SQL,
  METRICAS_SQL,
  REGRAS_SQL,
  RELACIONAMENTOS_SQL
} = require('./catalogo');

const IDENTIFICADOR = /^[a-z_][a-z0-9_]*$/i;
const OPERADORES = Object.freeze({
  igual: '=', diferente: '<>', maior_que: '>', maior_ou_igual: '>=',
  menor_que: '<', menor_ou_igual: '<=', contem: 'ILIKE', em: 'IN'
});
function citar(nome) {
  if (!IDENTIFICADOR.test(nome || '')) throw new Error(`Identificador SQL invalido: ${nome}`);
  return `"${nome}"`;
}

function resolverCampo(nome, entidadePrincipal) {
  if (CAMPOS_CALCULADOS_SQL[nome]) {
    return { nome, ...CAMPOS_CALCULADOS_SQL[nome] };
  }
  if (CAMPOS_NEGOCIO[nome]) {
    const [entidade, campo] = CAMPOS_NEGOCIO[nome];
    return { nome, entidade, campo, tipo: ENTIDADES_SQL[entidade].campos[campo] };
  }
  const partes = String(nome || '').split('.');
  const entidade = partes.length === 2 ? partes[0] : entidadePrincipal;
  const campo = partes.length === 2 ? partes[1] : partes[0];
  const definicao = ENTIDADES_SQL[entidade];
  if (!definicao || !definicao.campos[campo]) throw new Error(`Campo nao autorizado no catalogo SQL: ${nome}`);
  return { nome, entidade, campo, tipo: definicao.campos[campo] };
}

function encontrarCaminho(origem, destino) {
  if (origem === destino) return [];
  const fila = [{ entidade: origem, caminho: [] }];
  const visitadas = new Set([origem]);
  while (fila.length) {
    const atual = fila.shift();
    for (const relacao of RELACIONAMENTOS_SQL) {
      let proxima = null;
      if (relacao.esquerda === atual.entidade) proxima = relacao.direita;
      else if (relacao.direita === atual.entidade) proxima = relacao.esquerda;
      if (!proxima || visitadas.has(proxima)) continue;
      const caminho = [...atual.caminho, relacao];
      if (proxima === destino) return caminho;
      visitadas.add(proxima);
      fila.push({ entidade: proxima, caminho });
    }
  }
  throw new Error(`Nao existe relacionamento aprovado entre ${origem} e ${destino}.`);
}

function validarTipoFiltro(campo, valor, operador) {
  if (operador === 'em') {
    if (!Array.isArray(valor) || !valor.length || valor.length > 50) {
      throw new Error(`Filtro em ${campo.nome} exige uma lista de 1 a 50 valores.`);
    }
    return;
  }
  if (valor === null || valor === undefined) throw new Error(`Filtro ${campo.nome} exige valor.`);
  if (campo.tipo === 'numeric' || campo.tipo === 'bigint' || campo.tipo === 'integer') {
    if (typeof valor !== 'number' && !/^-?\d+(?:\.\d+)?$/.test(String(valor))) {
      throw new Error(`Filtro ${campo.nome} exige valor numerico.`);
    }
  }
}

function validarEspecificacao(especificacao) {
  if (!especificacao || typeof especificacao !== 'object' || Array.isArray(especificacao)) {
    throw new Error('QuerySpec deve ser um objeto estruturado.');
  }
  if (!['listar', 'agregar', 'comparar', 'detalhar'].includes(especificacao.objetivo)) {
    throw new Error(`Objetivo SQL invalido: ${especificacao.objetivo}`);
  }
  if (!ENTIDADES_SQL[especificacao.entidade_principal]) {
    throw new Error(`Entidade SQL nao autorizada: ${especificacao.entidade_principal}`);
  }
  for (const lista of ['campos', 'dimensoes', 'metricas', 'filtros', 'agrupamentos', 'regras']) {
    if (!Array.isArray(especificacao[lista] || [])) throw new Error(`${lista} deve ser uma lista.`);
  }
  const limite = especificacao.limite == null ? 100 : Number(especificacao.limite);
  if (!Number.isInteger(limite) || limite < 1 || limite > 1000) {
    throw new Error('limite deve ser um inteiro entre 1 e 1000.');
  }
  return { ...especificacao, limite };
}

function renderizarLiteral(valor) {
  if (valor === null) return 'NULL';
  if (typeof valor === 'number') return Number.isFinite(valor) ? String(valor) : (() => { throw new Error('Numero invalido.'); })();
  if (typeof valor === 'boolean') return valor ? 'TRUE' : 'FALSE';
  return `'${String(valor).replace(/'/g, "''")}'`;
}

function construirSql(especificacaoRecebida) {
  const especificacao = validarEspecificacao(especificacaoRecebida);
  const principal = especificacao.entidade_principal;
  const campos = [...new Set([...(especificacao.campos || []), ...(especificacao.dimensoes || [])])]
    .map((nome) => resolverCampo(nome, principal));
  const metricas = [...new Set(especificacao.metricas || [])].map((nome) => {
    const metrica = METRICAS_SQL[nome];
    if (!metrica) throw new Error(`Metrica nao autorizada no catalogo SQL: ${nome}`);
    if (metrica.entidade !== principal) {
      throw new Error(`A metrica ${nome} exige entidade_principal ${metrica.entidade}.`);
    }
    return { nome, ...metrica };
  });
  const regras = [...new Set(especificacao.regras || [])].map((nome) => {
    const regra = REGRAS_SQL[nome];
    if (!regra) throw new Error(`Regra SQL nao autorizada: ${nome}`);
    return { nome, ...regra };
  });
  if (!campos.length && !metricas.length) throw new Error('Informe ao menos um campo ou metrica.');

  const filtros = (especificacao.filtros || []).map((filtro) => {
    const campo = resolverCampo(filtro.campo, principal);
    if (!OPERADORES[filtro.operador]) throw new Error(`Operador de filtro invalido: ${filtro.operador}`);
    validarTipoFiltro(campo, filtro.valor, filtro.operador);
    return { ...filtro, campoResolvido: campo };
  });
  let periodo = null;
  if (especificacao.periodo) {
    const { campo, inicio, fim } = especificacao.periodo;
    periodo = { campo: resolverCampo(campo, principal), inicio, fim };
    if (!inicio || !fim || !/^\d{4}-\d{2}-\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
      throw new Error('Periodo exige inicio e fim no formato YYYY-MM-DD.');
    }
    if (inicio > fim) throw new Error('Inicio do periodo deve ser anterior ou igual ao fim.');
  }
  if (metricas.some((item) => item.periodoObrigatorio) && !periodo) {
    throw new Error('A metrica solicitada exige periodo explicito.');
  }
  if (especificacao.objetivo === 'comparar') {
    throw new Error('Comparacao PostgreSQL ainda nao possui receita semantica aprovada.');
  }
  if (metricas.length && especificacao.agrupamentos?.length) {
    const selecionados = new Set(campos.map((item) => item.nome));
    const agrupamentos = new Set(especificacao.agrupamentos);
    if ([...selecionados].some((campo) => !agrupamentos.has(campo))) {
      throw new Error('Todos os campos selecionados devem constar nos agrupamentos.');
    }
  }

  const entidadesNecessarias = new Set([
    principal,
    ...campos.map((item) => item.entidade),
    ...filtros.map((item) => item.campoResolvido.entidade),
    ...(periodo ? [periodo.campo.entidade] : []),
    ...metricas.flatMap((item) => item.entidadesNecessarias || []),
    ...regras.flatMap((item) => item.entidadesNecessarias || [])
  ]);
  const relacoes = [];
  for (const entidade of entidadesNecessarias) {
    for (const relacao of encontrarCaminho(principal, entidade)) {
      if (!relacoes.some((item) => item.id === relacao.id)) relacoes.push(relacao);
    }
  }
  const incluidas = new Set([principal]);
  const joins = [];
  const pendentes = [...relacoes];
  while (pendentes.length) {
    const indice = pendentes.findIndex((relacao) =>
      incluidas.has(relacao.esquerda) !== incluidas.has(relacao.direita));
    if (indice < 0) throw new Error('Plano de joins nao pode ser ordenado com seguranca.');
    const relacao = pendentes.splice(indice, 1)[0];
    const origem = incluidas.has(relacao.esquerda) ? relacao.esquerda : relacao.direita;
    const destino = origem === relacao.esquerda ? relacao.direita : relacao.esquerda;
    const expandeGrao =
      (relacao.cardinalidade === 'um_para_muitos' && origem === relacao.esquerda) ||
      (relacao.cardinalidade === 'muitos_para_um' && origem === relacao.direita);
    if (metricas.length && expandeGrao) {
      throw new Error(
        `O relacionamento ${relacao.id} expande o grao e poderia duplicar a metrica. ` +
        'Use uma metrica registrada no grao de destino.'
      );
    }
    const entidadeOrigem = ENTIDADES_SQL[origem];
    const entidadeDestino = ENTIDADES_SQL[destino];
    const condicoes = relacao.on.map(([campoEsquerda, campoDireita]) => {
      const campoOrigem = origem === relacao.esquerda ? campoEsquerda : campoDireita;
      const campoDestino = origem === relacao.esquerda ? campoDireita : campoEsquerda;
      return `${entidadeOrigem.alias}.${citar(campoOrigem)} = ${entidadeDestino.alias}.${citar(campoDestino)}`;
    });
    const tipoJoin = relacao.tipoJoin === 'inner' ? 'JOIN' : 'LEFT JOIN';
    joins.push(`${tipoJoin} "sysemp".${citar(entidadeDestino.tabela)} ${entidadeDestino.alias} ON ${condicoes.join(' AND ')}`);
    incluidas.add(destino);
  }

  const expressoesCampo = campos.map((item) => {
    const alias = item.alias || item.nome.replace('.', '_');
    const expressao = item.expressao || `${ENTIDADES_SQL[item.entidade].alias}.${citar(item.campo)}`;
    return `${expressao} AS ${citar(alias)}`;
  });
  const expressoesMetricas = metricas.map((item) =>
    `${item.expressao} AS ${citar(item.alias || item.nome)}`
  );
  const parametros = [];
  const condicoes = [...new Set([
    ...metricas.flatMap((item) => item.regras || []),
    ...regras.map((item) => item.expressao)
  ])];
  function parametro(valor) {
    parametros.push(valor);
    return `$${parametros.length}`;
  }
  for (const filtro of filtros) {
    const referencia = `${ENTIDADES_SQL[filtro.campoResolvido.entidade].alias}.${citar(filtro.campoResolvido.campo)}`;
    if (filtro.operador === 'em') {
      condicoes.push(`${referencia} IN (${filtro.valor.map(parametro).join(', ')})`);
    } else if (filtro.operador === 'contem') {
      condicoes.push(`${referencia} ILIKE ${parametro(`%${filtro.valor}%`)}`);
    } else {
      condicoes.push(`${referencia} ${OPERADORES[filtro.operador]} ${parametro(filtro.valor)}`);
    }
  }
  if (periodo) {
    const referencia = `${ENTIDADES_SQL[periodo.campo.entidade].alias}.${citar(periodo.campo.campo)}`;
    condicoes.push(`${referencia} >= ${parametro(periodo.inicio)}::date`);
    condicoes.push(`${referencia} < (${parametro(periodo.fim)}::date + INTERVAL '1 day')`);
  }

  const selecao = [...expressoesCampo, ...expressoesMetricas].join(',\n  ');
  const entidadeBase = ENTIDADES_SQL[principal];
  const groupBy = metricas.length && campos.length
    ? `\nGROUP BY ${campos.map((_, indice) => indice + 1).join(', ')}`
    : '';
  let orderBy = '';
  if (especificacao.ordenacao?.campo) {
    const aliases = new Set([
      ...campos.flatMap((item) => [item.nome.replace('.', '_'), item.alias].filter(Boolean)),
      ...metricas.flatMap((item) => [item.nome, item.alias].filter(Boolean))
    ]);
    if (!aliases.has(especificacao.ordenacao.campo)) throw new Error('Ordenacao deve usar um campo selecionado ou metrica.');
    const direcao = especificacao.ordenacao.direcao === 'asc' ? 'ASC' : 'DESC';
    orderBy = `\nORDER BY ${citar(especificacao.ordenacao.campo)} ${direcao}`;
  }
  const limit = especificacao.objetivo === 'listar' || especificacao.objetivo === 'detalhar'
    ? `\nLIMIT ${especificacao.limite}` : '';
  const sql = `SELECT\n  ${selecao}\nFROM "sysemp".${citar(entidadeBase.tabela)} ${entidadeBase.alias}` +
    (joins.length ? `\n${joins.join('\n')}` : '') +
    (condicoes.length ? `\nWHERE ${condicoes.map((item) => `(${item})`).join('\n  AND ')}` : '') +
    groupBy + orderBy + limit;

  validarSqlCompilado(sql);
  let sqlDbeaver = sql;
  for (let indice = parametros.length; indice >= 1; indice -= 1) {
    sqlDbeaver = sqlDbeaver.replace(new RegExp(`\\$${indice}(?!\\d)`, 'g'), renderizarLiteral(parametros[indice - 1]));
  }
  return {
    sql,
    sql_dbeaver: sqlDbeaver,
    parametros,
    granularidade: campos.map((item) => item.nome),
    fontes: [...incluidas].map((nome) => `sysemp.${ENTIDADES_SQL[nome].tabela}`),
    relacionamentos: joins.length,
    regras_aplicadas: [
      ...metricas.flatMap((item) => item.regras?.length ? [item.descricao] : []),
      ...regras.map((item) => item.descricao)
    ],
    suposicoes: especificacao.suposicoes || []
  };
}

function validarSqlCompilado(sql) {
  const normalizado = String(sql || '').trim();
  if (!/^(SELECT|WITH)\b/i.test(normalizado)) throw new Error('O compilador somente permite SELECT.');
  if (/;|--|\/\*|\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO)\b/i.test(normalizado)) {
    throw new Error('SQL compilado contem operacao ou fragmento nao permitido.');
  }
  const schemas = [...normalizado.matchAll(/"([a-z_][a-z0-9_]*)"\."/gi)].map((item) => item[1]);
  if (schemas.some((schema) => schema !== 'sysemp')) throw new Error('SQL fora do schema sysemp.');
  return true;
}

module.exports = { construirSql, renderizarLiteral, resolverCampo, validarEspecificacao, validarSqlCompilado };
