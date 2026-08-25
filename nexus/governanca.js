const { obterCapacidade } = require('../agentes/capacidades');

const MODOS_AUTORIZACAO = Object.freeze(['off', 'audit', 'enforce']);
const PERMISSOES_ESPECIAIS = Object.freeze({
  ia_conversar: 'ia.conversar',
  consultar_nexus: 'ia.nexus.consultar',
  solicitar_revisao_memoria: 'memoria.candidatar',
  construir_sql: 'sql.gerar',
  consultar_gold: 'gold.consultar',
  agregar_gold: 'gold.consultar',
  consultar_silver: 'silver.consultar',
  agregar_silver: 'silver.consultar',
  consultar_bronze: 'bronze.auditar',
  agregar_bronze: 'bronze.auditar',
  solicitar_aprofundamento: 'produto.consultar'
});
const CHAVE_SENSIVEL = /password|senha|secret|token|credential|api[_-]?key|sql/i;

class ErroAutorizacao extends Error {
  constructor(permissao) {
    super(`Acesso negado para a permissao ${permissao}.`);
    this.name = 'ErroAutorizacao';
    this.codigo = 'ACESSO_NEGADO';
    this.permissao = permissao;
  }
}

function resolverModoAutorizacao(valor = process.env.NEXUS_AUTHZ_MODE || 'audit') {
  const modo = String(valor).toLowerCase();
  if (!MODOS_AUTORIZACAO.includes(modo)) {
    throw new Error(`NEXUS_AUTHZ_MODE invalido: ${modo}.`);
  }
  return modo;
}

function permissaoDaFerramenta(nome) {
  if (PERMISSOES_ESPECIAIS[nome]) return PERMISSOES_ESPECIAIS[nome];
  const capacidade = obterCapacidade(nome);
  return capacidade ? `${capacidade.dominio}.consultar` : 'produto.consultar';
}

function codigoErro(erro) {
  if (!erro) return null;
  if (erro.codigo && /^[A-Z0-9_]{2,80}$/.test(erro.codigo)) return erro.codigo;
  if (erro.code && /^[A-Z0-9_]{2,80}$/.test(String(erro.code))) return String(erro.code);
  return erro.name === 'ErroAutorizacao' ? 'ACESSO_NEGADO' : 'ERRO_TOOL';
}

function chavesArgumentosSeguras(argumentos) {
  return Object.keys(argumentos || {}).filter((chave) => !CHAVE_SENSIVEL.test(chave)).sort();
}

function resolverDecisaoAutorizacao({ ativo, modo, override, papel }) {
  if (!ativo) return { permitida: false, motivo: 'principal_inativo' };
  if (modo === 'off') return { permitida: true, motivo: 'autorizacao_desativada' };
  if (override === 'negar') return { permitida: false, motivo: 'override_negacao' };
  if (override === 'permitir') return { permitida: true, motivo: 'override_permissao' };
  if (papel === 'setor') return { permitida: true, motivo: 'papel_setor' };
  if (papel === 'global') return { permitida: true, motivo: 'papel_global' };
  return { permitida: false, motivo: 'sem_concessao' };
}

function criarServicoGovernanca(opcoes) {
  const { pool } = opcoes;
  if (!pool) throw new Error('Pool PostgreSQL obrigatorio para governanca.');
  const principalSlug = opcoes.principalSlug || 'legacy-cli';
  const sessao = opcoes.sessao || 'padrao';
  const modo = resolverModoAutorizacao(opcoes.modo);

  async function contexto() {
    const principal = (await pool.query(
      'SELECT id, ativo FROM nexus.principals WHERE slug = $1', [principalSlug]
    )).rows[0];
    if (!principal) throw new Error(`Principal de governanca nao encontrado: ${principalSlug}`);
    const conversa = (await pool.query(`
      INSERT INTO nexus.conversations (principal_id, chave_sessao)
      VALUES ($1, $2)
      ON CONFLICT (principal_id, chave_sessao) DO UPDATE SET atualizada_em = now()
      RETURNING id
    `, [principal.id, sessao])).rows[0];
    return { principal, conversationId: conversa.id };
  }

  async function avaliar(nome, departamentoSlug = null) {
    const permissao = permissaoDaFerramenta(nome);
    const { principal, conversationId } = await contexto();
    let override = null;
    let papel = null;
    if (principal.ativo && modo !== 'off') {
      const parametros = [principal.id, permissao, departamentoSlug];
      const linhaOverride = (await pool.query(`
        SELECT po.efeito
        FROM nexus.permission_overrides po
        JOIN nexus.permissions p ON p.id = po.permission_id
        LEFT JOIN nexus.departments d ON d.id = po.department_id
        WHERE po.principal_id = $1 AND p.codigo = $2
          AND (po.expira_em IS NULL OR po.expira_em > now())
          AND (po.department_id IS NULL OR d.slug = $3)
        ORDER BY CASE po.efeito WHEN 'negar' THEN 0 ELSE 1 END
        LIMIT 1
      `, parametros)).rows[0];
      override = linhaOverride?.efeito || null;
      if (!override) {
        const atribuicao = (await pool.query(`
          SELECT ra.department_id
          FROM nexus.role_assignments ra
          JOIN nexus.role_permissions rp ON rp.role_id = ra.role_id
          JOIN nexus.permissions p ON p.id = rp.permission_id
          LEFT JOIN nexus.departments d ON d.id = ra.department_id
          WHERE ra.principal_id = $1 AND p.codigo = $2
            AND (ra.department_id IS NULL OR d.slug = $3)
          ORDER BY CASE WHEN ra.department_id IS NULL THEN 0 ELSE 1 END
          LIMIT 1
        `, parametros)).rows[0];
        if (atribuicao) papel = atribuicao.department_id ? 'setor' : 'global';
      }
    }
    const resolucao = resolverDecisaoAutorizacao({
      ativo: principal.ativo, modo, override, papel
    });
    const { permitida, motivo } = resolucao;
    const decisao = modo === 'off' ? 'off' : permitida ? 'allow' :
      modo === 'audit' ? 'would_deny' : 'deny';
    const camada = ['ia_conversar', 'consultar_nexus', 'solicitar_revisao_memoria'].includes(nome)
      ? 'generalista' : obterCapacidade(nome)?.camada || 'negocio';
    const registro = (await pool.query(`
      INSERT INTO nexus.authorization_decisions
        (principal_id, conversation_id, permission_code, tool_name, camada, modo, decisao, motivo_codigo)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [principal.id, conversationId, permissao, nome, camada, modo, decisao, motivo])).rows[0];
    return {
      id: registro.id, principalId: principal.id, conversationId,
      permissao, ferramenta: nome, camada, modo, decisao, permitida: permitida || modo !== 'enforce', motivo
    };
  }

  async function iniciarTool(nome, argumentos = {}, metadados = {}) {
    const decisao = await avaliar(nome, metadados.departamentoSlug);
    if (!decisao.permitida) {
      await pool.query(`
      INSERT INTO nexus.tool_executions
          (authorization_decision_id, principal_id, conversation_id, tool_name,
           permission_code, camada, provider, modelo, status, argument_keys, concluida_em,
           trace_id, turn_id, call_id, parent_call_id, stage, purpose)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'bloqueada',$9::jsonb,now(),$10,$11,$12,$13,$14,$15)
      `, [decisao.id, decisao.principalId, decisao.conversationId, nome,
        decisao.permissao, decisao.camada, metadados.provider || null, metadados.modelo || null,
        JSON.stringify(chavesArgumentosSeguras(argumentos)), metadados.traceId || null,
        metadados.turnId || null, metadados.callId || null, metadados.parentCallId || null,
        metadados.stage || null, metadados.purpose || null]);
      throw new ErroAutorizacao(decisao.permissao);
    }
    const execucao = (await pool.query(`
      INSERT INTO nexus.tool_executions
        (authorization_decision_id, principal_id, conversation_id, tool_name,
         permission_code, camada, provider, modelo, status, argument_keys,
         trace_id, turn_id, call_id, parent_call_id, stage, purpose)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'iniciada',$9::jsonb,$10,$11,$12,$13,$14,$15)
      RETURNING id
    `, [decisao.id, decisao.principalId, decisao.conversationId, nome,
      decisao.permissao, decisao.camada, metadados.provider || null, metadados.modelo || null,
      JSON.stringify(chavesArgumentosSeguras(argumentos)), metadados.traceId || null,
      metadados.turnId || null, metadados.callId || null, metadados.parentCallId || null,
      metadados.stage || null, metadados.purpose || null])).rows[0];
    return { decisao, execucaoId: execucao.id, callId: metadados.callId || execucao.id };
  }

  async function concluirTool(contextoExecucao, { sucesso, duracaoMs, erro } = {}) {
    if (!contextoExecucao?.execucaoId) return;
    await pool.query(`
      UPDATE nexus.tool_executions
      SET status = $2, duracao_ms = $3, erro_codigo = $4, concluida_em = now()
      WHERE id = $1
    `, [contextoExecucao.execucaoId, sucesso ? 'sucesso' : 'erro',
      Math.max(0, Math.round(duracaoMs || 0)), codigoErro(erro)]);
    await pool.query(`
      INSERT INTO nexus.audit_events
        (principal_id, conversation_id, tipo, recurso, resultado, metadados)
      VALUES ($1,$2,'tool_execucao',$3,$4,$5::jsonb)
    `, [contextoExecucao.decisao.principalId, contextoExecucao.decisao.conversationId,
      contextoExecucao.decisao.ferramenta, sucesso ? 'sucesso' : 'erro',
      JSON.stringify({
        permissao: contextoExecucao.decisao.permissao,
        camada: contextoExecucao.decisao.camada,
        duracao_ms: Math.max(0, Math.round(duracaoMs || 0)),
        erro_codigo: codigoErro(erro)
      })]);
  }

  async function criarSetor({ slug, nome }) {
    return (await pool.query(`
      INSERT INTO nexus.departments (slug, nome) VALUES ($1, $2)
      ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome
      RETURNING id, slug, nome, ativo
    `, [slug, nome])).rows[0];
  }

  async function criarPrincipal({ slug, nome, email = null, tipo = 'usuario' }) {
    return (await pool.query(`
      INSERT INTO nexus.principals (slug, tipo, nome, email) VALUES ($1,$2,$3,$4)
      ON CONFLICT (slug) DO UPDATE SET nome=EXCLUDED.nome, email=EXCLUDED.email,
        atualizado_em=now()
      RETURNING id, slug, tipo, nome, email, ativo
    `, [slug, tipo, nome, email])).rows[0];
  }

  async function associarSetor({ principal, setor }) {
    const resultado = await pool.query(`
      INSERT INTO nexus.principal_departments (principal_id, department_id)
      SELECT p.id, d.id FROM nexus.principals p CROSS JOIN nexus.departments d
      WHERE p.slug=$1 AND d.slug=$2
      ON CONFLICT DO NOTHING RETURNING principal_id, department_id
    `, [principal, setor]);
    if (!resultado.rowCount) throw new Error('Principal ou setor nao encontrado, ou associacao ja existente.');
    return resultado.rows[0];
  }

  async function definirOverride({ principal, permissao, efeito, motivo, setor = null, expiraEm = null }) {
    if (!['permitir', 'negar'].includes(efeito)) throw new Error('Efeito de override invalido.');
    const resultado = await pool.query(`
      INSERT INTO nexus.permission_overrides
        (principal_id, permission_id, department_id, efeito, motivo, expira_em)
      SELECT pr.id, pe.id, d.id, $3, $4, $6
      FROM nexus.principals pr CROSS JOIN nexus.permissions pe
      LEFT JOIN nexus.departments d ON d.slug=$5
      WHERE pr.slug=$1 AND pe.codigo=$2
      RETURNING id
    `, [principal, permissao, efeito, motivo, setor, expiraEm]);
    if (!resultado.rowCount) throw new Error('Principal, permissao ou setor nao encontrado.');
    return resultado.rows[0];
  }

  async function atribuirPapel({ principal, papel, setor = null }) {
    const resultado = await pool.query(`
      INSERT INTO nexus.role_assignments (principal_id, role_id, department_id)
      SELECT p.id, r.id, d.id
      FROM nexus.principals p CROSS JOIN nexus.roles r
      LEFT JOIN nexus.departments d ON d.slug = $3
      WHERE p.slug = $1 AND r.slug = $2
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [principal, papel, setor]);
    if (!resultado.rowCount) throw new Error('Principal, papel ou setor nao encontrado, ou atribuicao ja existente.');
    return resultado.rows[0];
  }

  async function vincularIdentidadeMicrosoft({ principal, tenantId, subjectId }) {
    const resultado = await pool.query(`
      INSERT INTO nexus.principal_identities (principal_id, provedor, tenant_id, subject_id)
      SELECT id, 'microsoft', $2, $3 FROM nexus.principals WHERE slug = $1
      ON CONFLICT (provedor, tenant_id, subject_id)
      DO UPDATE SET principal_id = EXCLUDED.principal_id
      RETURNING id
    `, [principal, tenantId, subjectId]);
    if (!resultado.rowCount) throw new Error(`Principal nao encontrado: ${principal}`);
    return resultado.rows[0];
  }

  return {
    associarSetor,
    atribuirPapel,
    avaliar,
    criarPrincipal,
    criarSetor,
    definirOverride,
    iniciarTool,
    concluirTool,
    modo,
    principalSlug,
    vincularIdentidadeMicrosoft
  };
}

module.exports = {
  ErroAutorizacao,
  MODOS_AUTORIZACAO,
  chavesArgumentosSeguras,
  criarServicoGovernanca,
  permissaoDaFerramenta,
  resolverDecisaoAutorizacao,
  resolverModoAutorizacao
};
