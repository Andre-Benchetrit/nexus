const fs = require('fs/promises');
const path = require('path');

const { objetos: catalogoPadrao, obterObjeto } = require('../silver/catalogo');
const { normalizarChavesPrimarias } = require('../exportadores/core/sql');
const { criarConexaoDuckDB, fecharConexaoDuckDB, runDuckDB } = require('./connections');
const { criarLakeStorage, resolverRaizLake } = require('../nexus/lake_storage');

const RAIZ_LAKE_PADRAO = resolverRaizLake();
const IDENTIFICADOR_SEGURO = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;
const LIMITE_MAXIMO = 500;
const OPERADORES_SQL = Object.freeze({
  igual: '=',
  diferente: '<>',
  maior_que: '>',
  maior_ou_igual: '>=',
  menor_que: '<',
  menor_ou_igual: '<='
});

function citar(nome) {
  if (!IDENTIFICADOR_SEGURO.test(nome || '')) throw new Error(`Identificador invalido: ${nome}`);
  return `"${nome}"`;
}

function literal(valor) {
  return `'${String(valor).replace(/'/g, "''")}'`;
}

function allComParametros(con, sql, parametros = []) {
  return new Promise((resolve, reject) => {
    con.all(sql, ...parametros, (erro, linhas) => erro ? reject(erro) : resolve(linhas));
  });
}

async function listarArquivos(diretorio, nomeArquivo) {
  let entradas;
  try {
    entradas = await fs.readdir(diretorio, { withFileTypes: true });
  } catch (erro) {
    if (erro.code === 'ENOENT') return [];
    throw erro;
  }
  const arquivos = [];
  for (const entrada of entradas) {
    const caminho = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) arquivos.push(...await listarArquivos(caminho, nomeArquivo));
    else if (entrada.isFile() && entrada.name === nomeArquivo) arquivos.push(caminho);
  }
  return arquivos;
}

async function descobrirExecucoesSilver(raizLake, objeto, camada = 'silver') {
  return criarLakeStorage({ raizLake }).listarVersoes(camada, objeto.nome);
}

function criarLeitorSilver(opcoes = {}) {
  const storage = opcoes.lakeStorage || criarLakeStorage({ raizLake: opcoes.raizLake });
  const raizLake = storage.raizLake || path.resolve(opcoes.raizLake || RAIZ_LAKE_PADRAO);
  const catalogo = opcoes.catalogo || catalogoPadrao;
  const camada = opcoes.camada || 'silver';
  const rotuloCamada = camada.charAt(0).toUpperCase() + camada.slice(1);
  const con = opcoes.conexao || criarConexaoDuckDB();
  const preparados = new Map();
  let fechado = false;

  function objetoPorNome(nome) {
    if (catalogo === catalogoPadrao) return obterObjeto(nome);
    if (!catalogo[nome]) throw new Error(`Objeto ${rotuloCamada} nao encontrado: ${nome}`);
    return catalogo[nome];
  }

  async function prepararObjeto(nome) {
    if (fechado) throw new Error(`O leitor ${rotuloCamada} ja foi fechado.`);
    if (preparados.has(nome)) return preparados.get(nome);
    const objeto = objetoPorNome(nome);
    const execucoes = await storage.listarVersoes(camada, objeto.nome);
    if (!execucoes.length) throw new Error(`Nenhuma execucao ${rotuloCamada} valida encontrada para ${nome}.`);

    const ultima = execucoes.at(-1);
    const viewAtual = `${nome}_atual`;
    const viewHistorica = `${camada}_${nome}`;
    await runDuckDB(con, `
      CREATE OR REPLACE TEMP VIEW ${citar(viewAtual)} AS
      SELECT * FROM read_parquet(
        ${literal(ultima.arquivo.replace(/\\/g, '/'))},
        hive_partitioning=false
      )
    `);
    const arquivos = execucoes.map(({ arquivo }) => literal(arquivo.replace(/\\/g, '/'))).join(', ');
    await runDuckDB(con, `
      CREATE OR REPLACE TEMP VIEW ${citar(viewHistorica)} AS
      SELECT * FROM read_parquet(
        [${arquivos}],
        union_by_name=true,
        filename=true,
        hive_partitioning=false
      )
    `);
    const schema = await allComParametros(con, `DESCRIBE SELECT * FROM ${citar(viewAtual)}`);
    const contexto = {
      objeto,
      execucoes,
      viewAtual,
      viewHistorica,
      schema,
      colunas: new Set(schema.map((coluna) => coluna.column_name)),
      tipos: new Map(schema.map((coluna) => [coluna.column_name, coluna.column_type]))
    };
    preparados.set(nome, contexto);
    return contexto;
  }

  function validarVisao(visao = 'atual') {
    if (!['atual', 'historico'].includes(visao)) throw new Error('visao deve ser atual ou historico.');
    return visao;
  }

  function validarColunas(contexto, colunas) {
    const resultado = colunas?.length ? colunas : contexto.objeto.consulta.colunasPadrao;
    for (const coluna of resultado) {
      if (!contexto.colunas.has(coluna)) throw new Error(`Coluna nao encontrada em ${contexto.objeto.nome}: ${coluna}`);
    }
    return resultado;
  }

  function normalizarData(valor, coluna) {
    const texto = String(valor).trim();
    const horario = '(?:[T ]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d{1,9})?)?(?:Z|[+-]\\d{2}:?\\d{2})?)?';
    const brasileira = new RegExp(`^(\\d{2})/(\\d{2})/(\\d{4})${horario}$`).exec(texto);
    const internacional = new RegExp(`^(\\d{4})-(\\d{2})-(\\d{2})${horario}$`).exec(texto);
    const partes = brasileira
      ? [brasileira[3], brasileira[2], brasileira[1]]
      : internacional?.slice(1, 4);
    if (!partes) {
      throw new Error(`Data invalida para ${coluna}. Use DD/MM/AAAA ou AAAA-MM-DD.`);
    }
    const [ano, mes, dia] = partes.map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) {
      throw new Error(`Data invalida para ${coluna}: ${valor}`);
    }
    const iso = `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    return iso;
  }

  function normalizarValor(contexto, coluna, operador, valor) {
    const tipo = contexto.tipos.get(coluna) || '';
    if (operador !== 'contem' && typeof valor === 'string' && tipo.startsWith('DATE')) {
      return normalizarData(valor, coluna);
    }
    return valor;
  }

  function escaparLike(valor) {
    return valor.replace(/[\\%_]/g, '\\$&');
  }

  function montarFiltros(contexto, filtros = {}, combinacao = 'todos') {
    const condicoes = [];
    const parametros = [];
    for (const [coluna, filtro] of Object.entries(filtros)) {
      if (!contexto.colunas.has(coluna)) throw new Error(`Coluna de filtro nao encontrada: ${coluna}`);
      const estruturado = filtro && typeof filtro === 'object' && !Array.isArray(filtro);
      const operador = estruturado ? filtro.operador : 'igual';
      const valor = normalizarValor(contexto, coluna, operador, estruturado ? filtro.valor : filtro);
      const valorFinal = estruturado
        ? normalizarValor(contexto, coluna, operador, filtro.valorFinal)
        : undefined;
      const valores = estruturado && Array.isArray(filtro.valores)
        ? filtro.valores.map((item) => normalizarValor(contexto, coluna, operador, item))
        : null;
      const operadores = [
        ...Object.keys(OPERADORES_SQL), 'contem', 'comeca_com', 'termina_com',
        'entre', 'em', 'nao_em', 'esta_vazio', 'nao_esta_vazio'
      ];
      if (!operadores.includes(operador)) throw new Error(`Operador de filtro invalido: ${operador}`);

      if (operador === 'esta_vazio') {
        condicoes.push(`(${citar(coluna)} IS NULL OR CAST(${citar(coluna)} AS VARCHAR) = '')`);
      } else if (operador === 'nao_esta_vazio') {
        condicoes.push(`(${citar(coluna)} IS NOT NULL AND CAST(${citar(coluna)} AS VARCHAR) <> '')`);
      } else if (operador === 'entre') {
        if (valor == null || valorFinal == null) throw new Error(`O operador entre exige dois valores em ${coluna}.`);
        condicoes.push(`${citar(coluna)} BETWEEN ? AND ?`);
        parametros.push(valor, valorFinal);
      } else if (operador === 'em' || operador === 'nao_em') {
        if (!valores?.length || valores.length > 50) throw new Error(`O operador ${operador} exige entre 1 e 50 valores.`);
        condicoes.push(`${citar(coluna)} ${operador === 'em' ? 'IN' : 'NOT IN'} (${valores.map(() => '?').join(', ')})`);
        parametros.push(...valores);
      } else if (valor === null) {
        if (operador === 'igual') condicoes.push(`${citar(coluna)} IS NULL`);
        else if (operador === 'diferente') condicoes.push(`${citar(coluna)} IS NOT NULL`);
        else throw new Error(`O operador ${operador} nao aceita null.`);
      } else if (['contem', 'comeca_com', 'termina_com'].includes(operador)) {
        if (typeof valor !== 'string') throw new Error(`O operador ${operador} exige texto.`);
        const texto = escaparLike(valor);
        condicoes.push(`${citar(coluna)} ILIKE ? ESCAPE '\\'`);
        parametros.push(
          operador === 'comeca_com' ? `${texto}%` :
            operador === 'termina_com' ? `%${texto}` : `%${texto}%`
        );
      } else if (['string', 'number', 'boolean', 'bigint'].includes(typeof valor)) {
        condicoes.push(`${citar(coluna)} ${OPERADORES_SQL[operador]} ?`);
        parametros.push(valor);
      } else throw new Error(`Valor de filtro invalido para ${coluna}.`);
    }
    if (!['todos', 'qualquer'].includes(combinacao)) throw new Error(`Combinacao de filtros invalida: ${combinacao}`);
    return { condicoes, parametros, separador: combinacao === 'qualquer' ? ' OR ' : ' AND ' };
  }

  function montarOrdenacao(contexto, ordenacao) {
    if (!ordenacao) return { sql: '', ordenacao: null };
    const { campo, direcao = 'asc' } = ordenacao;
    if (!contexto.colunas.has(campo)) throw new Error(`Coluna de ordenacao nao encontrada: ${campo}`);
    if (!['asc', 'desc'].includes(direcao)) throw new Error('direcao deve ser asc ou desc.');
    const direcaoSql = direcao.toUpperCase();
    const partes = [`${citar(campo)} ${direcaoSql} NULLS LAST`];
    for (const chave of normalizarChavesPrimarias(contexto.objeto.chavePrimaria)) {
      if (campo !== chave) partes.push(`${citar(chave)} ${direcaoSql} NULLS LAST`);
    }
    return { sql: ` ORDER BY ${partes.join(', ')}`, ordenacao: { campo, direcao } };
  }

  async function listarObjetos() {
    const resultado = [];
    for (const objeto of Object.values(catalogo)) {
      const execucoes = await descobrirExecucoesSilver(raizLake, objeto, camada);
      resultado.push({
        objeto: objeto.nome,
        disponivel: execucoes.length > 0,
        execucoes: execucoes.length,
        ultimaConstrucao: execucoes.at(-1)?.manifesto.fim || null,
        totalLinhasAtual: execucoes.at(-1)?.manifesto.totalLinhas || 0
      });
    }
    return resultado;
  }

  async function descreverObjeto(nome) {
    const contexto = await prepararObjeto(nome);
    return contexto.schema.map((coluna) => ({
      nome: coluna.column_name,
      tipo: coluna.column_type,
      aceitaNulo: coluna.null
    }));
  }

  async function consultar(nome, opcoesConsulta = {}) {
    const contexto = await prepararObjeto(nome);
    const visao = validarVisao(opcoesConsulta.visao);
    const limite = Number(opcoesConsulta.limite || 50);
    if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) {
      throw new Error(`limite deve ser um inteiro entre 1 e ${LIMITE_MAXIMO}.`);
    }
    const deslocamento = Number(opcoesConsulta.deslocamento || 0);
    if (!Number.isInteger(deslocamento) || deslocamento < 0 || deslocamento > 10000) {
      throw new Error('deslocamento deve ser um inteiro entre 0 e 10000.');
    }
    const colunas = validarColunas(contexto, opcoesConsulta.colunas);
    const filtros = opcoesConsulta.filtros || {};
    const { condicoes, parametros, separador } = montarFiltros(
      contexto,
      filtros,
      opcoesConsulta.combinacaoFiltros
    );
    const view = visao === 'atual' ? contexto.viewAtual : contexto.viewHistorica;
    const where = condicoes.length ? ` WHERE ${condicoes.join(separador)}` : '';
    const ordenacao = montarOrdenacao(contexto, opcoesConsulta.ordenacao);
    const dados = await allComParametros(
      con,
      `SELECT ${colunas.map(citar).join(', ')} FROM ${citar(view)}` +
        `${where}${ordenacao.sql} LIMIT ${limite} OFFSET ${deslocamento}`,
      parametros
    );
    return {
      objeto: nome,
      visao,
      colunas,
      filtros,
      ordenacao: ordenacao.ordenacao,
      limite,
      deslocamento,
      totalRetornado: dados.length,
      ultimaConstrucao: contexto.execucoes.at(-1)?.manifesto.fim || null,
      dados
    };
  }

  async function buscarPorId(nome, id, opcoesConsulta = {}) {
    const objeto = objetoPorNome(nome);
    const chaves = normalizarChavesPrimarias(objeto.chavePrimaria);
    let filtrosChave;
    if (chaves.length === 1) filtrosChave = { [chaves[0]]: id };
    else {
      if (!id || typeof id !== 'object' || Array.isArray(id)) {
        throw new Error(`A busca por ID de ${nome} exige as chaves: ${chaves.join(', ')}.`);
      }
      filtrosChave = Object.fromEntries(chaves.map((chave) => {
        if (id[chave] === undefined) throw new Error(`Chave ausente na busca por ID: ${chave}`);
        return [chave, id[chave]];
      }));
    }
    return consultar(nome, {
      ...opcoesConsulta,
      filtros: {
        ...(opcoesConsulta.filtros || {}),
        ...filtrosChave
      }
    });
  }

  async function contar(nome, opcoesConsulta = {}) {
    const contexto = await prepararObjeto(nome);
    const visao = validarVisao(opcoesConsulta.visao);
    const filtros = opcoesConsulta.filtros || {};
    const { condicoes, parametros, separador } = montarFiltros(
      contexto,
      filtros,
      opcoesConsulta.combinacaoFiltros
    );
    const view = visao === 'atual' ? contexto.viewAtual : contexto.viewHistorica;
    const where = condicoes.length ? ` WHERE ${condicoes.join(separador)}` : '';
    const [resultado] = await allComParametros(con, `SELECT count(*) AS total FROM ${citar(view)}${where}`, parametros);
    return {
      objeto: nome,
      visao,
      filtros,
      total: resultado.total,
      ultimaConstrucao: contexto.execucoes.at(-1)?.manifesto.fim || null
    };
  }

  async function agregar(nome, opcoesConsulta = {}) {
    const contexto = await prepararObjeto(nome);
    const visao = validarVisao(opcoesConsulta.visao);
    const limite = Number(opcoesConsulta.limite || 50);
    if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) {
      throw new Error(`limite deve ser um inteiro entre 1 e ${LIMITE_MAXIMO}.`);
    }
    const agrupamentos = opcoesConsulta.agrupamentos || [];
    const calculos = opcoesConsulta.calculos || [];
    if (!Array.isArray(agrupamentos) || agrupamentos.length > 3) {
      throw new Error('agrupamentos deve ter no maximo 3 itens.');
    }
    if (!Array.isArray(calculos) || calculos.length < 1 || calculos.length > 5) {
      throw new Error('calculos deve ter entre 1 e 5 itens.');
    }

    const expressoesGrupo = [];
    const aliasesGrupo = [];
    const gruposNormalizados = [];
    for (const [indice, grupo] of agrupamentos.entries()) {
      const { campo, granularidade = 'valor' } = grupo;
      if (!contexto.colunas.has(campo)) throw new Error(`Coluna de agrupamento nao encontrada: ${campo}`);
      if (!['valor', 'dia', 'mes', 'ano'].includes(granularidade)) {
        throw new Error(`Granularidade invalida: ${granularidade}`);
      }
      const tipo = contexto.tipos.get(campo) || '';
      if (granularidade !== 'valor' && !tipo.startsWith('DATE') && !tipo.startsWith('TIMESTAMP')) {
        throw new Error(`Granularidade ${granularidade} exige data: ${campo}`);
      }
      const alias = `grupo_${indice + 1}`;
      const campoSql = citar(campo);
      const unidade = granularidade === 'dia' ? 'day' : granularidade === 'mes' ? 'month' : 'year';
      const expressao = granularidade === 'valor' ? campoSql : `date_trunc('${unidade}', ${campoSql})`;
      expressoesGrupo.push(`${expressao} AS ${citar(alias)}`);
      aliasesGrupo.push(alias);
      gruposNormalizados.push({ alias, campo, granularidade });
    }

    const expressoesCalculo = [];
    const calculosNormalizados = [];
    const tiposNumericos = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|DECIMAL|NUMERIC|REAL|DOUBLE|FLOAT)/;
    const funcoes = { contar: 'count', somar: 'sum', media: 'avg', minimo: 'min', maximo: 'max' };
    for (const [indice, calculo] of calculos.entries()) {
      const { operacao, campo } = calculo;
      if (!funcoes[operacao]) throw new Error(`Operacao de calculo invalida: ${operacao}`);
      if (operacao !== 'contar' && !campo) throw new Error(`A operacao ${operacao} exige um campo.`);
      if (campo && !contexto.colunas.has(campo)) throw new Error(`Coluna de calculo nao encontrada: ${campo}`);
      if (['somar', 'media'].includes(operacao) && !tiposNumericos.test(contexto.tipos.get(campo) || '')) {
        throw new Error(`A operacao ${operacao} exige coluna numerica: ${campo}`);
      }
      const alias = `calculo_${indice + 1}`;
      const argumento = operacao === 'contar' && !campo ? '*' : citar(campo);
      expressoesCalculo.push(`${funcoes[operacao]}(${argumento}) AS ${citar(alias)}`);
      calculosNormalizados.push({ alias, operacao, campo: campo || null });
    }

    const filtros = opcoesConsulta.filtros || {};
    const { condicoes, parametros, separador } = montarFiltros(
      contexto,
      filtros,
      opcoesConsulta.combinacaoFiltros
    );
    const view = visao === 'atual' ? contexto.viewAtual : contexto.viewHistorica;
    const where = condicoes.length ? ` WHERE ${condicoes.join(separador)}` : '';
    const groupBy = aliasesGrupo.length ? ` GROUP BY ${aliasesGrupo.map(citar).join(', ')}` : '';
    const ordenacao = opcoesConsulta.ordenacao || { tipo: 'calculo', indice: 0, direcao: 'desc' };
    if (!['agrupamento', 'calculo'].includes(ordenacao.tipo)) throw new Error('tipo de ordenacao invalido.');
    const aliasesOrdenaveis = ordenacao.tipo === 'agrupamento'
      ? aliasesGrupo
      : calculosNormalizados.map(({ alias }) => alias);
    if (!Number.isInteger(ordenacao.indice) || !aliasesOrdenaveis[ordenacao.indice]) {
      throw new Error('indice de ordenacao invalido.');
    }
    if (!['asc', 'desc'].includes(ordenacao.direcao)) throw new Error('direcao de ordenacao invalida.');
    const orderBy = ` ORDER BY ${citar(aliasesOrdenaveis[ordenacao.indice])} ${ordenacao.direcao.toUpperCase()} NULLS LAST`;
    const dados = await allComParametros(
      con,
      `SELECT ${[...expressoesGrupo, ...expressoesCalculo].join(', ')} ` +
        `FROM ${citar(view)}${where}${groupBy}${orderBy} LIMIT ${limite}`,
      parametros
    );
    return {
      objeto: nome,
      visao,
      agrupamentos: gruposNormalizados,
      calculos: calculosNormalizados,
      filtros,
      limite,
      ultimaConstrucao: contexto.execucoes.at(-1)?.manifesto.fim || null,
      dados
    };
  }

  async function fechar() {
    if (fechado) return;
    fechado = true;
    if (!opcoes.conexao) await fecharConexaoDuckDB(con);
  }

  return { prepararObjeto, listarObjetos, descreverObjeto, consultar, buscarPorId, contar, agregar, fechar };
}

module.exports = { criarLeitorSilver, descobrirExecucoesSilver, LIMITE_MAXIMO };
