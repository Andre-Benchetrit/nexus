const fs = require('fs/promises');
const path = require('path');

const { entidades: catalogoPadrao, obterEntidade } = require('../exportadores/catalogo');
const { normalizarChavesPrimarias } = require('../exportadores/core/sql');
const { criarConexaoDuckDB, fecharConexaoDuckDB, runDuckDB } = require('./connections');
const { criarLakeStorage, resolverRaizLake } = require('../nexus/lake_storage');

const RAIZ_LAKE_PADRAO = resolverRaizLake();
const IDENTIFICADOR_SEGURO = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;
const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 500;
const OPERADORES_SQL = Object.freeze({
  igual: '=',
  diferente: '<>',
  maior_que: '>',
  maior_ou_igual: '>=',
  menor_que: '<',
  menor_ou_igual: '<='
});

function citarIdentificador(valor) {
  if (!IDENTIFICADOR_SEGURO.test(valor || '')) {
    throw new Error(`Identificador inválido: ${valor}`);
  }
  return `"${valor}"`;
}

function escaparLiteral(valor) {
  return `'${String(valor).replace(/'/g, "''")}'`;
}

function allComParametros(con, sql, parametros = []) {
  return new Promise((resolve, reject) => {
    con.all(sql, ...parametros, (erro, linhas) => {
      if (erro) reject(erro);
      else resolve(linhas);
    });
  });
}

async function listarArquivosRecursivamente(diretorio, nomeArquivo) {
  let entradas;
  try {
    entradas = await fs.readdir(diretorio, { withFileTypes: true });
  } catch (erro) {
    if (erro.code === 'ENOENT') return [];
    throw erro;
  }

  const resultados = [];
  for (const entrada of entradas) {
    const caminho = path.join(diretorio, entrada.name);
    if (entrada.isDirectory()) {
      resultados.push(...await listarArquivosRecursivamente(caminho, nomeArquivo));
    } else if (entrada.isFile() && entrada.name === nomeArquivo) {
      resultados.push(caminho);
    }
  }
  return resultados;
}

async function descobrirExecucoesValidas(raizOuStorage, entidade) {
  const storage = raizOuStorage?.listarVersoes
    ? raizOuStorage : criarLakeStorage({ raizLake: raizOuStorage });
  return storage.listarVersoes(entidade.destino.camada, entidade.nome);
}

function obterConfiguracaoEntidade(nome, catalogo) {
  if (catalogo === catalogoPadrao) return obterEntidade(nome);
  const entidade = catalogo[nome];
  if (!entidade) {
    throw new Error(`Entidade não encontrada: ${nome}. Disponíveis: ${Object.keys(catalogo).join(', ')}`);
  }
  return entidade;
}

function nomeViewHistorica(entidade) {
  return `bronze_${entidade.nome}`;
}

function nomeViewAtual(entidade) {
  return `${entidade.nome}_atual`;
}

function normalizarVisao(visao = 'atual') {
  if (!['atual', 'historico'].includes(visao)) {
    throw new Error('visao deve ser atual ou historico.');
  }
  return visao;
}

function normalizarLimite(limite = LIMITE_PADRAO) {
  const numero = Number(limite);
  if (!Number.isInteger(numero) || numero < 1 || numero > LIMITE_MAXIMO) {
    throw new Error(`limite deve ser um inteiro entre 1 e ${LIMITE_MAXIMO}.`);
  }
  return numero;
}

function normalizarDeslocamento(deslocamento = 0) {
  const numero = Number(deslocamento);
  if (!Number.isInteger(numero) || numero < 0 || numero > 10000) {
    throw new Error('deslocamento deve ser um inteiro entre 0 e 10000.');
  }
  return numero;
}

function criarLeitorBronze(opcoes = {}) {
  const storage = opcoes.lakeStorage || criarLakeStorage({ raizLake: opcoes.raizLake });
  const raizLake = storage.raizLake || path.resolve(opcoes.raizLake || RAIZ_LAKE_PADRAO);
  const catalogo = opcoes.catalogo || catalogoPadrao;
  const con = opcoes.conexao || criarConexaoDuckDB();
  let storagePreparado = null;
  const prepararStorage = () => {
    storagePreparado ||= Promise.resolve().then(() => storage.prepararConexaoDuckDB(con));
    return storagePreparado;
  };
  const entidadesPreparadas = new Map();
  let fechado = false;

  async function prepararEntidade(nome) {
    if (fechado) throw new Error('O leitor do bronze já foi fechado.');
    if (entidadesPreparadas.has(nome)) return entidadesPreparadas.get(nome);

    await prepararStorage();
    const entidade = obterConfiguracaoEntidade(nome, catalogo);
    const execucoes = await storage.listarVersoes(entidade.destino.camada, entidade.nome);
    if (!execucoes.length) {
      throw new Error(`Nenhuma execução válida encontrada para ${nome}.`);
    }

    const arquivosSql = execucoes
      .map(({ arquivo }) => escaparLiteral(arquivo.replace(/\\/g, '/')))
      .join(', ');
    const viewHistorica = nomeViewHistorica(entidade);
    const viewAtual = nomeViewAtual(entidade);
    const chavesPrimarias = normalizarChavesPrimarias(entidade.extracao?.chavePrimaria);
    const cursor = entidade.extracao?.cursor;
    const modoExtracao = entidade.extracao?.modo;
    const ultimaExecucao = execucoes.at(-1);
    const execucaoReconciliada =
      entidade.extracao?.reconciliarExclusoes === true &&
      ultimaExecucao?.arquivoChavesAtuais
        ? ultimaExecucao
        : null;

    const estrategiaVisaoAtual =
      entidade.extracao?.estrategiaVisaoAtual ||
      (
        modoExtracao === 'snapshot'
          ? 'ultima_execucao'
          : 'por_chave_cursor'
      );

    if (
      estrategiaVisaoAtual !== 'ultima_execucao' &&
      (!chavesPrimarias.length || !cursor)
    ) {
      throw new Error(`Entidade ${nome} precisa de chavePrimaria e cursor para consulta atual.`);
    }

    await runDuckDB(con, `
      CREATE OR REPLACE TEMP VIEW ${citarIdentificador(viewHistorica)} AS
      SELECT *
      FROM read_parquet(
        [${arquivosSql}],
        union_by_name = true,
        hive_partitioning = true,
        filename = true
      )
    `);

    if (estrategiaVisaoAtual === 'ultima_execucao') {
      await runDuckDB(con, `
        CREATE OR REPLACE TEMP VIEW ${citarIdentificador(viewAtual)} AS
        SELECT *
        FROM ${citarIdentificador(viewHistorica)}
        WHERE ${citarIdentificador('execucao')} = (
          SELECT max(${citarIdentificador('execucao')})
          FROM ${citarIdentificador(viewHistorica)}
        )
      `);
    } else if (execucaoReconciliada) {
      const arquivoChavesSql = escaparLiteral(
        execucaoReconciliada.arquivoChavesAtuais.replace(/\\/g, '/')
      );
      const condicaoChaves = chavesPrimarias
        .map((chave) => `dados.${citarIdentificador(chave)} IS NOT DISTINCT FROM chaves.${citarIdentificador(chave)}`)
        .join(' AND ');
      await runDuckDB(con, `
        CREATE OR REPLACE TEMP VIEW ${citarIdentificador(viewAtual)} AS
        WITH dados_deduplicados AS (
          SELECT *
          FROM ${citarIdentificador(viewHistorica)}
          QUALIFY row_number() OVER (
            PARTITION BY ${chavesPrimarias.map(citarIdentificador).join(', ')}
            ORDER BY
              ${citarIdentificador(cursor)} DESC NULLS LAST,
              ${citarIdentificador('execucao')} DESC NULLS LAST,
              ${citarIdentificador('filename')} DESC
          ) = 1
        )
        SELECT dados.*
        FROM dados_deduplicados AS dados
        INNER JOIN read_parquet(${arquivoChavesSql}) AS chaves
          ON ${condicaoChaves}
      `);
    } else {
      await runDuckDB(con, `
        CREATE OR REPLACE TEMP VIEW ${citarIdentificador(viewAtual)} AS
        SELECT *
        FROM ${citarIdentificador(viewHistorica)}
        QUALIFY row_number() OVER (
          PARTITION BY ${chavesPrimarias.map(citarIdentificador).join(', ')}
          ORDER BY
            ${citarIdentificador(cursor)} DESC NULLS LAST,
            ${citarIdentificador('execucao')} DESC NULLS LAST,
            ${citarIdentificador('filename')} DESC
        ) = 1
      `);
    }

    const schema = await allComParametros(
      con,
      `DESCRIBE SELECT * FROM ${citarIdentificador(viewHistorica)}`
    );
    const contexto = {
      entidade,
      execucoes,
      viewHistorica,
      viewAtual,
      schema,
      colunas: new Set(schema.map((coluna) => coluna.column_name)),
      tipos: new Map(schema.map((coluna) => [coluna.column_name, coluna.column_type])),
      chavesPrimarias,
      reconciliacaoExclusoes: execucaoReconciliada
        ? {
            estrategia: 'snapshot_chaves_atuais',
            manifesto: execucaoReconciliada.caminhoManifesto,
            arquivo: execucaoReconciliada.arquivoChavesAtuais
          }
        : null
    };
    entidadesPreparadas.set(nome, contexto);
    return contexto;
  }

  function validarColunas(contexto, colunas) {
    const solicitadas = colunas?.length
      ? colunas
      : contexto.entidade.consulta?.colunasPadrao || [
        ...contexto.chavesPrimarias,
        contexto.entidade.extracao.cursor
      ];

    for (const coluna of solicitadas) {
      if (!contexto.colunas.has(coluna)) {
        throw new Error(`Coluna não encontrada em ${contexto.entidade.nome}: ${coluna}`);
      }
    }
    return solicitadas;
  }

  function escaparLike(valor) {
    return valor.replace(/[\\%_]/g, '\\$&');
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
      throw new Error(`Data inválida para ${coluna}. Use DD/MM/AAAA ou AAAA-MM-DD.`);
    }
    const [ano, mes, dia] = partes.map(Number);
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    if (
      data.getUTCFullYear() !== ano ||
      data.getUTCMonth() !== mes - 1 ||
      data.getUTCDate() !== dia
    ) {
      throw new Error(`Data inválida para ${coluna}: ${valor}`);
    }
    return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }

  function normalizarValorFiltro(contexto, coluna, operador, valor) {
    const tipo = contexto.tipos.get(coluna) || '';
    if (operador !== 'contem' && typeof valor === 'string' && tipo.startsWith('DATE')) {
      return normalizarData(valor, coluna);
    }
    return valor;
  }

  function montarOrdenacao(contexto, ordenacao) {
    if (!ordenacao) return { sql: '', ordenacao: null };
    const { campo, direcao = 'asc' } = ordenacao;
    if (!contexto.colunas.has(campo)) {
      throw new Error(`Coluna de ordenação não encontrada em ${contexto.entidade.nome}: ${campo}`);
    }
    if (!['asc', 'desc'].includes(direcao)) {
      throw new Error('direcao da ordenação deve ser asc ou desc.');
    }

    const direcaoSql = direcao.toUpperCase();
    const partes = [`${citarIdentificador(campo)} ${direcaoSql} NULLS LAST`];
    for (const chavePrimaria of contexto.chavesPrimarias) {
      if (campo !== chavePrimaria && contexto.colunas.has(chavePrimaria)) {
        partes.push(`${citarIdentificador(chavePrimaria)} ${direcaoSql} NULLS LAST`);
      }
    }
    return {
      sql: ` ORDER BY ${partes.join(', ')}`,
      ordenacao: { campo, direcao }
    };
  }

  function montarFiltros(contexto, filtros = {}, combinacao = 'todos') {
    const condicoes = [];
    const parametros = [];
    for (const [coluna, filtro] of Object.entries(filtros)) {
      if (!contexto.colunas.has(coluna)) {
        throw new Error(`Coluna de filtro não encontrada em ${contexto.entidade.nome}: ${coluna}`);
      }
      const estruturado = filtro && typeof filtro === 'object' && !Array.isArray(filtro);
      const operador = estruturado ? filtro.operador : 'igual';
      const valorOriginal = estruturado ? filtro.valor : filtro;
      const valor = normalizarValorFiltro(contexto, coluna, operador, valorOriginal);
      const valorFinal = estruturado
        ? normalizarValorFiltro(contexto, coluna, operador, filtro.valorFinal)
        : undefined;
      const valores = estruturado && Array.isArray(filtro.valores)
        ? filtro.valores.map((item) => normalizarValorFiltro(contexto, coluna, operador, item))
        : null;

      if (![...Object.keys(OPERADORES_SQL), 'contem', 'comeca_com', 'termina_com', 'entre', 'em', 'nao_em', 'esta_vazio', 'nao_esta_vazio'].includes(operador)) {
        throw new Error(`Operador de filtro inválido para ${coluna}: ${operador}`);
      }
      if (operador === 'esta_vazio') {
        condicoes.push(`(${citarIdentificador(coluna)} IS NULL OR CAST(${citarIdentificador(coluna)} AS VARCHAR) = '')`);
      } else if (operador === 'nao_esta_vazio') {
        condicoes.push(`(${citarIdentificador(coluna)} IS NOT NULL AND CAST(${citarIdentificador(coluna)} AS VARCHAR) <> '')`);
      } else if (operador === 'entre') {
        if (valor === null || valor === undefined || valorFinal === null || valorFinal === undefined) {
          throw new Error(`O operador entre exige valor e valorFinal em ${coluna}.`);
        }
        condicoes.push(`${citarIdentificador(coluna)} BETWEEN ? AND ?`);
        parametros.push(valor, valorFinal);
      } else if (operador === 'em' || operador === 'nao_em') {
        if (!valores?.length || valores.length > 50) {
          throw new Error(`O operador ${operador} exige entre 1 e 50 valores em ${coluna}.`);
        }
        const placeholders = valores.map(() => '?').join(', ');
        condicoes.push(`${citarIdentificador(coluna)} ${operador === 'em' ? 'IN' : 'NOT IN'} (${placeholders})`);
        parametros.push(...valores);
      } else if (valor === null) {
        if (operador === 'igual') {
          condicoes.push(`${citarIdentificador(coluna)} IS NULL`);
        } else if (operador === 'diferente') {
          condicoes.push(`${citarIdentificador(coluna)} IS NOT NULL`);
        } else {
          throw new Error(`O operador ${operador} não aceita valor null.`);
        }
      } else if (['contem', 'comeca_com', 'termina_com'].includes(operador)) {
        if (typeof valor !== 'string') {
          throw new Error(`O operador ${operador} exige texto em ${coluna}.`);
        }
        condicoes.push(`${citarIdentificador(coluna)} ILIKE ? ESCAPE '\\'`);
        const texto = escaparLike(valor);
        parametros.push(
          operador === 'comeca_com' ? `${texto}%` :
            operador === 'termina_com' ? `%${texto}` : `%${texto}%`
        );
      } else if (['string', 'number', 'boolean', 'bigint'].includes(typeof valor)) {
        condicoes.push(`${citarIdentificador(coluna)} ${OPERADORES_SQL[operador]} ?`);
        parametros.push(valor);
      } else {
        throw new Error(`Valor de filtro inválido para ${coluna}.`);
      }
    }
    if (!['todos', 'qualquer'].includes(combinacao)) {
      throw new Error(`Combinação de filtros inválida: ${combinacao}`);
    }
    const separador = combinacao === 'qualquer' ? ' OR ' : ' AND ';
    return { condicoes, parametros, separador };
  }

  async function listarEntidades() {
    await prepararStorage();
    const resultado = [];
    for (const entidade of Object.values(catalogo)) {
      const execucoes = await descobrirExecucoesValidas(storage, entidade);
      const ultima = execucoes
        .map(({ manifesto }) => manifesto.fim || manifesto.inicio)
        .filter(Boolean)
        .sort()
        .at(-1) || null;
      resultado.push({
        entidade: entidade.nome,
        disponivel: execucoes.length > 0,
        execucoes: execucoes.length,
        totalLinhasManifestos: execucoes.reduce(
          (total, { manifesto }) => total + Number(manifesto.totalLinhas || 0),
          0
        ),
        ultimaExtracao: ultima
      });
    }
    return resultado;
  }

  async function descreverEntidade(nome) {
    const contexto = await prepararEntidade(nome);
    return contexto.schema.map((coluna) => ({
      nome: coluna.column_name,
      tipo: coluna.column_type,
      aceitaNulo: coluna.null
    }));
  }

  async function consultar(nome, opcoesConsulta = {}) {
    const contexto = await prepararEntidade(nome);
    const visao = normalizarVisao(opcoesConsulta.visao);
    const limite = normalizarLimite(opcoesConsulta.limite);
    const deslocamento = normalizarDeslocamento(opcoesConsulta.deslocamento);
    const colunas = validarColunas(contexto, opcoesConsulta.colunas);
    const filtros = opcoesConsulta.filtros || {};
    const { condicoes, parametros, separador } = montarFiltros(
      contexto,
      filtros,
      opcoesConsulta.combinacaoFiltros
    );

    const view = visao === 'atual' ? contexto.viewAtual : contexto.viewHistorica;
    const where = condicoes.length ? ` WHERE ${condicoes.join(separador)}` : '';
    const ordenacaoMontada = montarOrdenacao(contexto, opcoesConsulta.ordenacao);
    const sql = `SELECT ${colunas.map(citarIdentificador).join(', ')} ` +
      `FROM ${citarIdentificador(view)}${where}${ordenacaoMontada.sql} ` +
      `LIMIT ${limite} OFFSET ${deslocamento}`;
    const linhas = await allComParametros(con, sql, parametros);

    return {
      entidade: nome,
      visao,
      colunas,
      filtros,
      ordenacao: ordenacaoMontada.ordenacao,
      limite,
      deslocamento,
      totalRetornado: linhas.length,
      ultimaExtracao: contexto.execucoes
        .map(({ manifesto }) => manifesto.fim || manifesto.inicio)
        .filter(Boolean)
        .sort()
        .at(-1) || null,
      dados: linhas
    };
  }

  async function buscarPorId(nome, id, opcoesConsulta = {}) {
    const entidade = obterConfiguracaoEntidade(nome, catalogo);
    const chavesPrimarias = normalizarChavesPrimarias(entidade.extracao.chavePrimaria);
    let filtrosChave;
    if (chavesPrimarias.length === 1) {
      filtrosChave = { [chavesPrimarias[0]]: id };
    } else {
      if (!id || typeof id !== 'object' || Array.isArray(id)) {
        throw new Error(`A busca por ID de ${nome} exige as chaves: ${chavesPrimarias.join(', ')}.`);
      }
      filtrosChave = Object.fromEntries(chavesPrimarias.map((chave) => {
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
    const contexto = await prepararEntidade(nome);
    const visao = normalizarVisao(opcoesConsulta.visao);
    const view = visao === 'atual' ? contexto.viewAtual : contexto.viewHistorica;
    const filtros = opcoesConsulta.filtros || {};
    const { condicoes, parametros, separador } = montarFiltros(
      contexto,
      filtros,
      opcoesConsulta.combinacaoFiltros
    );
    const where = condicoes.length ? ` WHERE ${condicoes.join(separador)}` : '';
    const [resultado] = await allComParametros(
      con,
      `SELECT count(*) AS total FROM ${citarIdentificador(view)}${where}`,
      parametros
    );
    return {
      entidade: nome,
      visao,
      filtros,
      total: resultado.total
    };
  }

  async function agregar(nome, opcoesConsulta = {}) {
    const contexto = await prepararEntidade(nome);
    const visao = normalizarVisao(opcoesConsulta.visao);
    const limite = normalizarLimite(opcoesConsulta.limite || 50);
    const agrupamentos = opcoesConsulta.agrupamentos || [];
    const calculos = opcoesConsulta.calculos || [];
    if (!Array.isArray(agrupamentos) || agrupamentos.length > 7) {
      throw new Error('agrupamentos deve ter no máximo 7 itens.');
    }
    if (!Array.isArray(calculos) || calculos.length < 1 || calculos.length > 5) {
      throw new Error('calculos deve ter entre 1 e 5 itens.');
    }

    const expressoesGrupo = [];
    const aliasesGrupo = [];
    const gruposNormalizados = [];
    for (const [indice, grupo] of agrupamentos.entries()) {
      const campo = grupo.campo;
      const granularidade = grupo.granularidade || 'valor';
      if (!contexto.colunas.has(campo)) {
        throw new Error(`Coluna de agrupamento não encontrada em ${nome}: ${campo}`);
      }
      if (!['valor', 'dia', 'mes', 'ano'].includes(granularidade)) {
        throw new Error(`Granularidade inválida: ${granularidade}`);
      }
      const tipo = contexto.tipos.get(campo) || '';
      if (granularidade !== 'valor' && !tipo.startsWith('DATE') && !tipo.startsWith('TIMESTAMP')) {
        throw new Error(`Granularidade ${granularidade} exige uma coluna de data: ${campo}`);
      }
      const alias = `grupo_${indice + 1}`;
      const campoSql = citarIdentificador(campo);
      const expressao = granularidade === 'valor'
        ? campoSql
        : `date_trunc('${granularidade === 'dia' ? 'day' : granularidade === 'mes' ? 'month' : 'year'}', ${campoSql})`;
      expressoesGrupo.push(`${expressao} AS ${citarIdentificador(alias)}`);
      aliasesGrupo.push(alias);
      gruposNormalizados.push({ alias, campo, granularidade });
    }

    const expressoesCalculo = [];
    const calculosNormalizados = [];
    const tiposNumericos = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|DECIMAL|NUMERIC|REAL|DOUBLE|FLOAT)/;
    for (const [indice, calculo] of calculos.entries()) {
      const operacao = calculo.operacao;
      const campo = calculo.campo;
      if (!['contar', 'somar', 'media', 'minimo', 'maximo'].includes(operacao)) {
        throw new Error(`Operação de cálculo inválida: ${operacao}`);
      }
      if (operacao !== 'contar' && !campo) {
        throw new Error(`A operação ${operacao} exige um campo.`);
      }
      if (campo && !contexto.colunas.has(campo)) {
        throw new Error(`Coluna de cálculo não encontrada em ${nome}: ${campo}`);
      }
      if (['somar', 'media'].includes(operacao) && !tiposNumericos.test(contexto.tipos.get(campo) || '')) {
        throw new Error(`A operação ${operacao} exige uma coluna numérica: ${campo}`);
      }
      const funcoes = { contar: 'count', somar: 'sum', media: 'avg', minimo: 'min', maximo: 'max' };
      const alias = `calculo_${indice + 1}`;
      const argumento = operacao === 'contar' && !campo ? '*' : citarIdentificador(campo);
      expressoesCalculo.push(`${funcoes[operacao]}(${argumento}) AS ${citarIdentificador(alias)}`);
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
    const groupBy = aliasesGrupo.length
      ? ` GROUP BY ${aliasesGrupo.map(citarIdentificador).join(', ')}`
      : '';
    const ordenacao = opcoesConsulta.ordenacao || { tipo: 'calculo', indice: 0, direcao: 'desc' };
    const aliasesOrdenaveis = ordenacao.tipo === 'agrupamento' ? aliasesGrupo : calculosNormalizados.map(({ alias }) => alias);
    if (!['agrupamento', 'calculo'].includes(ordenacao.tipo)) {
      throw new Error('tipo de ordenação da agregação deve ser agrupamento ou calculo.');
    }
    if (!Number.isInteger(ordenacao.indice) || !aliasesOrdenaveis[ordenacao.indice]) {
      throw new Error('indice de ordenação da agregação é inválido.');
    }
    if (!['asc', 'desc'].includes(ordenacao.direcao)) {
      throw new Error('direcao da ordenação deve ser asc ou desc.');
    }
    const orderBy = ` ORDER BY ${citarIdentificador(aliasesOrdenaveis[ordenacao.indice])} ${ordenacao.direcao.toUpperCase()} NULLS LAST`;
    const selecao = [...expressoesGrupo, ...expressoesCalculo].join(', ');
    const linhas = await allComParametros(
      con,
      `SELECT ${selecao} FROM ${citarIdentificador(view)}${where}${groupBy}${orderBy} LIMIT ${limite}`,
      parametros
    );

    return {
      entidade: nome,
      visao,
      agrupamentos: gruposNormalizados,
      calculos: calculosNormalizados,
      filtros,
      limite,
      ultimaExtracao: contexto.execucoes
        .map(({ manifesto }) => manifesto.fim || manifesto.inicio)
        .filter(Boolean)
        .sort()
        .at(-1) || null,
      dados: linhas
    };
  }

  async function fechar() {
    if (fechado) return;
    fechado = true;
    if (!opcoes.conexao) await fecharConexaoDuckDB(con);
  }

  return {
    prepararEntidade,
    listarEntidades,
    descreverEntidade,
    consultar,
    buscarPorId,
    contar,
    agregar,
    fechar
  };
}

module.exports = {
  criarLeitorBronze,
  descobrirExecucoesValidas,
  LIMITE_PADRAO,
  LIMITE_MAXIMO,
  normalizarDeslocamento
};
