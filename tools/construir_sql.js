const poolPadrao = require('../config/db');
const { construirSql } = require('./sql/compilador');
const { ENTIDADES_SQL, METRICAS_SQL } = require('./sql/catalogo');

const schemaListaTexto = { type: 'array', items: { type: 'string' }, maxItems: 30 };
const definicaoConstruirSql = {
  type: 'function',
  name: 'construir_sql',
  description: 'Constroi SQL PostgreSQL somente leitura a partir do catalogo semantico aprovado e valida com EXPLAIN.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      objetivo: { type: 'string', enum: ['listar', 'agregar', 'comparar', 'detalhar'] },
      entidade_principal: { type: 'string', enum: Object.keys(ENTIDADES_SQL) },
      campos: schemaListaTexto,
      dimensoes: schemaListaTexto,
      metricas: { type: 'array', items: { type: 'string', enum: Object.keys(METRICAS_SQL) }, maxItems: 10 },
      periodo: {
        anyOf: [{
          type: 'object',
          properties: {
            campo: { type: 'string' },
            inicio: { type: 'string' },
            fim: { type: 'string' }
          },
          required: ['campo', 'inicio', 'fim'],
          additionalProperties: false
        }, { type: 'null' }]
      },
      filtros: {
        type: 'array',
        maxItems: 20,
        items: {
          type: 'object',
          properties: {
            campo: { type: 'string' },
            operador: { type: 'string', enum: ['igual', 'diferente', 'maior_que', 'maior_ou_igual', 'menor_que', 'menor_ou_igual', 'contem', 'em'] },
            valor: {
              anyOf: [
                { type: 'string' }, { type: 'number' }, { type: 'boolean' },
                { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] }, maxItems: 50 }
              ]
            }
          },
          required: ['campo', 'operador', 'valor'],
          additionalProperties: false
        }
      },
      agrupamentos: schemaListaTexto,
      ordenacao: {
        anyOf: [{
          type: 'object',
          properties: {
            campo: { type: 'string' },
            direcao: { type: 'string', enum: ['asc', 'desc'] }
          },
          required: ['campo', 'direcao'],
          additionalProperties: false
        }, { type: 'null' }]
      },
      limite: { type: ['integer', 'null'], minimum: 1, maximum: 1000 },
      regras: schemaListaTexto,
      suposicoes: schemaListaTexto
    },
    required: [
      'objetivo', 'entidade_principal', 'campos', 'dimensoes', 'metricas', 'periodo',
      'filtros', 'agrupamentos', 'ordenacao', 'limite', 'regras', 'suposicoes'
    ],
    additionalProperties: false
  }
};

function sanitizarErroExplain(erro) {
  const codigo = String(erro?.code || 'EXPLAIN_INDISPONIVEL').slice(0, 40);
  let mensagem = String(erro?.message || 'Validacao PostgreSQL indisponivel.');
  mensagem = mensagem
    .replace(/password\s*=\s*[^\s]+/gi, 'password=[oculto]')
    .replace(/(?:\d{1,3}\.){3}\d{1,3}:\d+/g, '[endpoint]')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[conexao]')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
  return { codigo, mensagem };
}

function resumirPlanoExplain(valor) {
  const recebido = typeof valor === 'string' ? JSON.parse(valor) : valor;
  const raiz = Array.isArray(recebido) ? recebido[0]?.Plan : recebido?.Plan || recebido;
  if (!raiz || typeof raiz !== 'object') return null;
  const tipos = [];
  function visitar(no) {
    if (!no || typeof no !== 'object') return;
    if (no['Node Type'] && !tipos.includes(no['Node Type'])) tipos.push(no['Node Type']);
    (no.Plans || []).forEach(visitar);
  }
  visitar(raiz);
  return {
    custo_inicial: raiz['Startup Cost'] ?? null,
    custo_total: raiz['Total Cost'] ?? null,
    linhas_estimadas: raiz['Plan Rows'] ?? null,
    largura_estimada: raiz['Plan Width'] ?? null,
    nos_principais: tipos.slice(0, 12),
    alerta: tipos.includes('Seq Scan') ? 'O plano contem leitura sequencial; avalie filtros e indices para grandes volumes.' : null
  };
}

async function executarExplain(sql, parametros, dependencias = {}) {
  const pool = dependencias.pool || poolPadrao;
  const timeoutMsRecebido = Number(dependencias.statementTimeoutMs || process.env.NEXUS_SQL_EXPLAIN_TIMEOUT_MS || 5000);
  const timeoutMs = Number.isInteger(timeoutMsRecebido)
    ? Math.min(Math.max(timeoutMsRecebido, 100), 30000)
    : 5000;
  const cliente = await pool.connect();
  let iniciou = false;
  try {
    await cliente.query('BEGIN READ ONLY');
    iniciou = true;
    await cliente.query(`SET LOCAL statement_timeout = '${timeoutMs}ms'`);
    const resultado = await cliente.query(`EXPLAIN (FORMAT JSON) ${sql}`, parametros);
    await cliente.query('ROLLBACK');
    iniciou = false;
    return resumirPlanoExplain(resultado.rows?.[0]?.['QUERY PLAN']);
  } finally {
    if (iniciou) {
      try { await cliente.query('ROLLBACK'); } catch (_) { /* conexao ja indisponivel */ }
    }
    cliente.release();
  }
}

async function executarConstruirSql(argumentos, dependencias = {}) {
  const compilado = construirSql(argumentos);
  let explain = null;
  let falhaValidacao = null;
  try {
    if (dependencias.pularExplain === true) throw new Error('EXPLAIN desabilitado nesta execucao.');
    explain = await executarExplain(compilado.sql, compilado.parametros, dependencias);
    if (!explain) throw new Error('PostgreSQL nao retornou um plano de execucao reconhecivel.');
  } catch (erro) {
    falhaValidacao = sanitizarErroExplain(erro);
  }
  return JSON.stringify({
    status: explain ? 'validado' : 'rascunho_nao_validado',
    dialeto: 'postgresql',
    esquema: 'sysemp',
    sql_parametrizado: compilado.sql,
    parametros: compilado.parametros,
    sql_dbeaver: compilado.sql_dbeaver,
    granularidade: compilado.granularidade,
    fontes: compilado.fontes,
    regras_aplicadas: compilado.regras_aplicadas,
    suposicoes: compilado.suposicoes,
    explain,
    falha_validacao: falhaValidacao,
    executou_dados: false
  });
}

function formatarRespostaSql(resultadoRecebido) {
  const resultado = typeof resultadoRecebido === 'string'
    ? JSON.parse(resultadoRecebido)
    : resultadoRecebido;
  const validacao = resultado.status === 'validado'
    ? 'SQL validado pelo PostgreSQL com `EXPLAIN` (sem executar os dados).'
    : `Rascunho não validado: ${resultado.falha_validacao?.mensagem || 'EXPLAIN indisponível.'}`;
  const detalhes = [
    validacao,
    '',
    '```sql',
    resultado.sql_dbeaver,
    '```',
    '',
    `Fontes: ${resultado.fontes.join(', ')}.`
  ];
  if (resultado.regras_aplicadas.length) detalhes.push(`Regras aplicadas: ${resultado.regras_aplicadas.join(' ')}`);
  if (resultado.explain) {
    detalhes.push(
      `EXPLAIN: custo total ${resultado.explain.custo_total ?? 'indisponível'}, ` +
      `${resultado.explain.linhas_estimadas ?? 'número desconhecido'} linhas estimadas.`
    );
    if (resultado.explain.alerta) detalhes.push(resultado.explain.alerta);
  }
  return detalhes.join('\n');
}

module.exports = {
  definicaoConstruirSql,
  executarConstruirSql,
  executarExplain,
  formatarRespostaSql,
  resumirPlanoExplain,
  sanitizarErroExplain
};
