const crypto = require('node:crypto');
const {
  criarConexaoDuckDB,
  fecharConexaoDuckDB,
  allDuckDB
} = require('../duckdb/connections');
const { montarPrevia } = require('./dataset_query_engine');

const OPERACOES = new Set(['consultar', 'agrupar', 'resumir']);
const CALCULOS = Object.freeze({
  contar_linhas: 'count',
  contar_distintos: 'count',
  somar: 'sum',
  media: 'avg',
  minimo: 'min',
  maximo: 'max'
});
const FILTROS = new Set([
  'igual', 'diferente', 'contem', 'comeca_com',
  'maior', 'maior_ou_igual', 'menor', 'menor_ou_igual',
  'em', 'nulo', 'nao_nulo'
]);

function citar(nome) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(nome || ''))) {
    const erro = new Error(`Campo de resultado inválido: ${nome}.`);
    erro.codigo = 'RESULT_REF_FIELD_INVALID';
    throw erro;
  }
  return `"${nome}"`;
}

function escaparSql(valor) {
  return String(valor).replace(/'/g, "''").replace(/\\/g, '/');
}

function literal(valor) {
  if (valor == null) return 'NULL';
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new Error('Valor numérico de filtro inválido.');
    return String(valor);
  }
  if (typeof valor === 'boolean') return valor ? 'TRUE' : 'FALSE';
  return `'${String(valor).replace(/'/g, "''")}'`;
}

function nomeCalculo(calculo) {
  if (calculo.operacao === 'contar_linhas') return 'contagem_registros';
  const campo = String(calculo.campo || 'valor');
  const prefixos = {
    contar_distintos: 'contagem_distinta', somar: 'soma', media: 'media',
    minimo: 'minimo', maximo: 'maximo'
  };
  return `${prefixos[calculo.operacao]}_${campo}`;
}

function validarCampo(nome, permitidos, finalidade) {
  if (!permitidos.has(nome)) {
    const erro = new Error(`O campo ${nome} não existe no resultado autorizado para ${finalidade}.`);
    erro.codigo = 'RESULT_REF_FIELD_NOT_FOUND';
    throw erro;
  }
  return nome;
}

function montarFiltros(filtros, colunas) {
  return (filtros || []).map((filtro) => {
    const campo = validarCampo(String(filtro.campo || ''), colunas, 'filtro');
    const operador = String(filtro.operador || 'igual');
    if (!FILTROS.has(operador)) throw new Error(`Operador de filtro inválido: ${operador}.`);
    const coluna = citar(campo);
    if (operador === 'nulo') return `${coluna} IS NULL`;
    if (operador === 'nao_nulo') return `${coluna} IS NOT NULL`;
    if (operador === 'em') {
      const valores = Array.isArray(filtro.valores) ? filtro.valores.slice(0, 100) : [];
      if (!valores.length) throw new Error('O filtro em exige ao menos um valor.');
      return `CAST(${coluna} AS VARCHAR) IN (${valores.map((item) => literal(item)).join(', ')})`;
    }
    if (operador === 'contem') {
      return `lower(CAST(${coluna} AS VARCHAR)) LIKE lower('%' || ${literal(filtro.valor)} || '%')`;
    }
    if (operador === 'comeca_com') {
      return `lower(CAST(${coluna} AS VARCHAR)) LIKE lower(${literal(filtro.valor)} || '%')`;
    }
    const simbolos = {
      igual: '=', diferente: '<>', maior: '>', maior_ou_igual: '>=',
      menor: '<', menor_ou_igual: '<='
    };
    return `${coluna} ${simbolos[operador]} ${literal(filtro.valor)}`;
  });
}

function montarConsulta(argumentos, descriptor, caminho) {
  const operacao = String(argumentos.operacao || 'consultar');
  if (!OPERACOES.has(operacao)) throw new Error(`Operação de result_ref inválida: ${operacao}.`);
  const colunas = new Set((descriptor.colunas || []).map((item) => item.nome || item));
  if (!colunas.size) throw new Error('O resultado autorizado não possui colunas consultáveis.');
  const filtros = montarFiltros(argumentos.filtros || [], colunas);
  const where = filtros.length ? ` WHERE ${filtros.join(' AND ')}` : '';
  const limite = Math.min(5_000, Math.max(1, Number(argumentos.limite || 200)));
  const origem = `read_parquet('${escaparSql(caminho)}')`;

  if (operacao === 'consultar') {
    const solicitadas = Array.isArray(argumentos.colunas) && argumentos.colunas.length
      ? argumentos.colunas.map((nome) => validarCampo(String(nome), colunas, 'seleção'))
      : [...colunas];
    if (solicitadas.length > 30) throw new Error('Selecione no máximo 30 colunas por consulta.');
    const campoOrdem = argumentos.ordenar_por == null ? null
      : validarCampo(String(argumentos.ordenar_por), colunas, 'ordenação');
    const direcao = argumentos.direcao === 'desc' ? 'DESC' : 'ASC';
    const orderBy = campoOrdem ? ` ORDER BY ${citar(campoOrdem)} ${direcao} NULLS LAST`
      : ' ORDER BY __nexus_row_number';
    return {
      sql: `SELECT ${solicitadas.map(citar).join(', ')} FROM ${origem}${where}${orderBy} LIMIT ${limite}`,
      camposSaida: new Set(solicitadas), limite
    };
  }

  const agrupamentos = (argumentos.agrupar_por || []).map((nome) =>
    validarCampo(String(nome), colunas, 'agrupamento'));
  if (operacao === 'agrupar' && !agrupamentos.length) {
    throw new Error('A operação agrupar exige ao menos um campo em agrupar_por.');
  }
  if (operacao === 'resumir' && agrupamentos.length) {
    throw new Error('A operação resumir não aceita agrupamentos; use agrupar.');
  }
  const metricas = argumentos.metricas || [];
  if (!metricas.length) throw new Error('Informe ao menos uma métrica para agrupar ou resumir.');
  const nomesMetricas = new Set();
  const expressoesMetricas = metricas.map((metrica) => {
    const calculo = String(metrica.operacao || '');
    if (!CALCULOS[calculo]) throw new Error(`Métrica inválida: ${calculo}.`);
    const campo = metrica.campo == null ? null
      : validarCampo(String(metrica.campo), colunas, 'métrica');
    if (calculo !== 'contar_linhas' && !campo) throw new Error(`${calculo} exige um campo.`);
    if (calculo === 'contar_linhas' && campo) throw new Error('contar_linhas não aceita campo.');
    const nome = nomeCalculo({ operacao: calculo, campo });
    if (nomesMetricas.has(nome)) throw new Error(`Métrica duplicada: ${nome}.`);
    nomesMetricas.add(nome);
    if (calculo === 'contar_linhas') return `count(*) AS ${citar(nome)}`;
    const distinct = calculo === 'contar_distintos' ? 'DISTINCT ' : '';
    return `${CALCULOS[calculo]}(${distinct}${citar(campo)}) AS ${citar(nome)}`;
  });
  const selecao = [...agrupamentos.map(citar), ...expressoesMetricas];
  const groupBy = agrupamentos.length ? ` GROUP BY ${agrupamentos.map(citar).join(', ')}` : '';
  const camposSaida = new Set([...agrupamentos, ...nomesMetricas]);
  const campoOrdem = argumentos.ordenar_por == null
    ? [...nomesMetricas][0] : String(argumentos.ordenar_por);
  if (campoOrdem && !camposSaida.has(campoOrdem)) {
    throw new Error(`O campo ${campoOrdem} não existe na saída agregada.`);
  }
  const direcao = argumentos.direcao === 'asc' ? 'ASC' : 'DESC';
  const orderBy = campoOrdem ? ` ORDER BY ${citar(campoOrdem)} ${direcao} NULLS LAST` : '';
  return {
    sql: `SELECT ${selecao.join(', ')} FROM ${origem}${where}${groupBy}${orderBy} LIMIT ${limite}`,
    camposSaida, limite
  };
}

function normalizarLinha(linha) {
  return Object.fromEntries(Object.entries(linha).map(([chave, valor]) => [
    chave, typeof valor === 'bigint' ? Number(valor) : valor
  ]));
}

async function consultarResultadoRef(argumentos, dependencias = {}) {
  const datasets = dependencias.servicoDatasets;
  if (!datasets || !dependencias.conversationId || !dependencias.turnoIA?.id) {
    const erro = new Error('O serviço de resultados não está disponível neste turno.');
    erro.codigo = 'RESULT_REF_SERVICE_UNAVAILABLE';
    throw erro;
  }
  const aberto = await datasets.abrirCaminho(dependencias.conversationId, argumentos.result_ref);
  if (aberto.descriptor.tipo !== 'result_ref') {
    const erro = new Error('A referência selecionada não é um resultado consultável.');
    erro.codigo = 'RESULT_REF_INVALID_KIND';
    throw erro;
  }
  const consulta = montarConsulta(argumentos, aberto.descriptor, aberto.caminho);
  const conexao = criarConexaoDuckDB();
  try {
    const linhas = (await allDuckDB(conexao, consulta.sql)).map(normalizarLinha);
    const assinatura = crypto.createHash('sha256').update(JSON.stringify({
      parent: argumentos.result_ref,
      operacao: argumentos.operacao,
      colunas: argumentos.colunas,
      agrupar_por: argumentos.agrupar_por,
      metricas: argumentos.metricas,
      filtros: argumentos.filtros,
      ordenar_por: argumentos.ordenar_por,
      direcao: argumentos.direcao,
      limite: argumentos.limite
    })).digest('hex');
    const ref = linhas.length ? await datasets.criarDeLinhas(
      dependencias.conversationId,
      dependencias.turnoIA.id,
      linhas,
      {
        parentDatasetId: argumentos.result_ref,
        assinatura,
        queryManifest: {
          tipo: 'result_ref_query',
          parentDatasetId: argumentos.result_ref,
          especificacao: {
            operacao: argumentos.operacao,
            colunas: argumentos.colunas,
            agrupar_por: argumentos.agrupar_por,
            metricas: argumentos.metricas,
            filtros: argumentos.filtros,
            ordenar_por: argumentos.ordenar_por,
            direcao: argumentos.direcao,
            limite: argumentos.limite
          }
        },
        lineage: { parentDatasetId: argumentos.result_ref, operacao: argumentos.operacao },
        corporateUpdatedAt: aberto.descriptor.atualizacaoCorporativa,
        classification: aberto.descriptor.classificacao || 'dados_nexus'
      }
    ) : null;
    const previa = montarPrevia(linhas);
    return {
      status: 'sucesso',
      operacao: argumentos.operacao,
      result_ref: ref,
      quantidade_linhas: linhas.length,
      previa,
      resultado_truncado_no_prompt: linhas.length > previa.length,
      regra: 'Agrupamentos, filtros, ordenações e cálculos foram executados localmente sobre o result_ref autorizado.'
    };
  } finally {
    await fecharConexaoDuckDB(conexao);
  }
}

module.exports = { consultarResultadoRef, montarConsulta, nomeCalculo };
