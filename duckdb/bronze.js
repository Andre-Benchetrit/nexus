const fs = require('fs/promises');
const path = require('path');

const { entidades: catalogoPadrao, obterEntidade } = require('../exportadores/catalogo');
const { criarConexaoDuckDB, fecharConexaoDuckDB, runDuckDB } = require('./connections');

const RAIZ_LAKE_PADRAO = path.resolve(__dirname, '..', 'lake');
const IDENTIFICADOR_SEGURO = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;
const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 500;

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

async function descobrirExecucoesValidas(raizLake, entidade) {
  const raizEntidade = path.join(
    raizLake,
    entidade.destino.camada,
    entidade.fonte,
    entidade.nome
  );
  const manifestos = await listarArquivosRecursivamente(raizEntidade, 'manifest.json');
  const execucoes = [];

  for (const caminhoManifesto of manifestos) {
    let manifesto;
    try {
      manifesto = JSON.parse(await fs.readFile(caminhoManifesto, 'utf8'));
    } catch (erro) {
      throw new Error(`Manifesto inválido em ${caminhoManifesto}: ${erro.message}`);
    }

    if (manifesto.status !== 'sucesso' || manifesto.entidade !== entidade.nome) continue;

    const nomeArquivo = manifesto.arquivo || 'dados.parquet';
    if (path.basename(nomeArquivo) !== nomeArquivo) {
      throw new Error(`Manifesto aponta para um arquivo inválido: ${caminhoManifesto}`);
    }

    const arquivo = path.join(path.dirname(caminhoManifesto), nomeArquivo);
    try {
      await fs.access(arquivo);
    } catch (erro) {
      if (erro.code === 'ENOENT') continue;
      throw erro;
    }

    execucoes.push({ manifesto, caminhoManifesto, arquivo });
  }

  return execucoes.sort((a, b) => a.arquivo.localeCompare(b.arquivo));
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

function criarLeitorBronze(opcoes = {}) {
  const raizLake = path.resolve(opcoes.raizLake || RAIZ_LAKE_PADRAO);
  const catalogo = opcoes.catalogo || catalogoPadrao;
  const con = opcoes.conexao || criarConexaoDuckDB();
  const entidadesPreparadas = new Map();
  let fechado = false;

  async function prepararEntidade(nome) {
    if (fechado) throw new Error('O leitor do bronze já foi fechado.');
    if (entidadesPreparadas.has(nome)) return entidadesPreparadas.get(nome);

    const entidade = obterConfiguracaoEntidade(nome, catalogo);
    const execucoes = await descobrirExecucoesValidas(raizLake, entidade);
    if (!execucoes.length) {
      throw new Error(`Nenhuma execução válida encontrada para ${nome}.`);
    }

    const arquivosSql = execucoes
      .map(({ arquivo }) => escaparLiteral(arquivo.replace(/\\/g, '/')))
      .join(', ');
    const viewHistorica = nomeViewHistorica(entidade);
    const viewAtual = nomeViewAtual(entidade);
    const chavePrimaria = entidade.extracao?.chavePrimaria;
    const cursor = entidade.extracao?.cursor;

    if (!chavePrimaria || !cursor) {
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

    await runDuckDB(con, `
      CREATE OR REPLACE TEMP VIEW ${citarIdentificador(viewAtual)} AS
      SELECT *
      FROM ${citarIdentificador(viewHistorica)}
      QUALIFY row_number() OVER (
        PARTITION BY ${citarIdentificador(chavePrimaria)}
        ORDER BY
          ${citarIdentificador(cursor)} DESC NULLS LAST,
          ${citarIdentificador('execucao')} DESC NULLS LAST,
          ${citarIdentificador('filename')} DESC
      ) = 1
    `);

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
      colunas: new Set(schema.map((coluna) => coluna.column_name))
    };
    entidadesPreparadas.set(nome, contexto);
    return contexto;
  }

  function validarColunas(contexto, colunas) {
    const solicitadas = colunas?.length
      ? colunas
      : contexto.entidade.consulta?.colunasPadrao || [
        contexto.entidade.extracao.chavePrimaria,
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

  function montarFiltros(contexto, filtros = {}, combinacao = 'todos') {
    const condicoes = [];
    const parametros = [];
    for (const [coluna, filtro] of Object.entries(filtros)) {
      if (!contexto.colunas.has(coluna)) {
        throw new Error(`Coluna de filtro não encontrada em ${contexto.entidade.nome}: ${coluna}`);
      }
      const estruturado = filtro && typeof filtro === 'object' && !Array.isArray(filtro);
      const operador = estruturado ? filtro.operador : 'igual';
      const valor = estruturado ? filtro.valor : filtro;

      if (!['igual', 'contem'].includes(operador)) {
        throw new Error(`Operador de filtro inválido para ${coluna}: ${operador}`);
      }
      if (valor === null) {
        if (operador !== 'igual') {
          throw new Error(`O operador ${operador} não aceita valor null.`);
        }
        condicoes.push(`${citarIdentificador(coluna)} IS NULL`);
      } else if (operador === 'contem') {
        if (typeof valor !== 'string') {
          throw new Error(`O operador contem exige texto em ${coluna}.`);
        }
        condicoes.push(`${citarIdentificador(coluna)} ILIKE ? ESCAPE '\\'`);
        parametros.push(`%${escaparLike(valor)}%`);
      } else if (['string', 'number', 'boolean', 'bigint'].includes(typeof valor)) {
        condicoes.push(`${citarIdentificador(coluna)} = ?`);
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
    const resultado = [];
    for (const entidade of Object.values(catalogo)) {
      const execucoes = await descobrirExecucoesValidas(raizLake, entidade);
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
    const colunas = validarColunas(contexto, opcoesConsulta.colunas);
    const filtros = opcoesConsulta.filtros || {};
    const { condicoes, parametros, separador } = montarFiltros(
      contexto,
      filtros,
      opcoesConsulta.combinacaoFiltros
    );

    const view = visao === 'atual' ? contexto.viewAtual : contexto.viewHistorica;
    const where = condicoes.length ? ` WHERE ${condicoes.join(separador)}` : '';
    const sql = `SELECT ${colunas.map(citarIdentificador).join(', ')} ` +
      `FROM ${citarIdentificador(view)}${where} LIMIT ${limite}`;
    const linhas = await allComParametros(con, sql, parametros);

    return {
      entidade: nome,
      visao,
      colunas,
      filtros,
      limite,
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
    return consultar(nome, {
      ...opcoesConsulta,
      filtros: {
        ...(opcoesConsulta.filtros || {}),
        [entidade.extracao.chavePrimaria]: id
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

  async function fechar() {
    if (fechado) return;
    fechado = true;
    if (!opcoes.conexao) await fecharConexaoDuckDB(con);
  }

  return {
    listarEntidades,
    descreverEntidade,
    consultar,
    buscarPorId,
    contar,
    fechar
  };
}

module.exports = {
  criarLeitorBronze,
  descobrirExecucoesValidas,
  LIMITE_PADRAO,
  LIMITE_MAXIMO
};
