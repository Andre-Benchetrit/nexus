const { createHash, randomUUID } = require('node:crypto');
const { comTransacao } = require('./db');
const { relatorioExecutivo, relatorioTrace } = require('./relatorios_uso');

const COMPOSICOES = Object.freeze(['baixo', 'medio', 'alto', 'extra_alto']);
const LIMITE_CONVERSAS = 50;
const LIMITE_MENSAGENS = 100;

class ErroHub extends Error {
  constructor(codigo, mensagem, status = 400) {
    super(mensagem);
    this.name = 'ErroHub';
    this.codigo = codigo;
    this.status = status;
  }
}

function normalizarEmail(valor) {
  const email = String(valor || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ErroHub('EMAIL_INVALIDO', 'Informe um e-mail corporativo valido.');
  }
  return email;
}

function normalizarSlug(valor, rotulo = 'slug') {
  const slug = String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  if (!slug) throw new ErroHub('SLUG_INVALIDO', `${rotulo} invalido.`);
  return slug;
}

function slugDoEmail(email) {
  const normalizado = normalizarEmail(email);
  const base = normalizarSlug(normalizado.split('@')[0], 'e-mail').slice(0, 48);
  const sufixo = createHash('sha256').update(normalizado).digest('hex').slice(0, 8);
  return `${base}-${sufixo}`;
}

function normalizarComposicao(valor = 'medio') {
  const nivel = String(valor || 'medio').toLowerCase();
  if (!COMPOSICOES.includes(nivel)) {
    throw new ErroHub('COMPOSICAO_INVALIDA', 'Nivel de composicao invalido.');
  }
  return nivel;
}

function faixaMinimaDaComposicao(nivel) {
  return nivel === 'alto' ? 'assistida' : nivel === 'extra_alto' ? 'avancada' : 'auto';
}

function tituloDaPergunta(pergunta) {
  const texto = String(pergunta || '').replace(/\s+/g, ' ').trim();
  if (!texto) return 'Nova conversa';
  return texto.length <= 64 ? texto : `${texto.slice(0, 61).trimEnd()}...`;
}

function codigoErro(erro) {
  const codigo = erro?.codigo || erro?.code || erro?.name || 'ERRO_HUB';
  return /^[A-Za-z0-9_-]{2,80}$/.test(String(codigo)) ? String(codigo).toUpperCase() : 'ERRO_HUB';
}

async function buscarPrincipal(pool, referencia) {
  const campo = referencia.id ? 'id' : 'slug';
  const valor = referencia.id || referencia.slug;
  const linha = (await pool.query(`
    SELECT id,slug,tipo,nome,email,ativo FROM nexus.principals WHERE ${campo}=$1
  `, [valor])).rows[0];
  if (!linha) throw new ErroHub('PRINCIPAL_NAO_ENCONTRADO', 'Usuario nao encontrado.', 404);
  return linha;
}

async function decisaoPermissao(pool, principalId, codigo, departmentId = null) {
  const principal = (await pool.query(
    'SELECT ativo FROM nexus.principals WHERE id=$1', [principalId]
  )).rows[0];
  if (!principal?.ativo) return { permitida: false, motivo: 'principal_inativo' };
  const override = (await pool.query(`
    SELECT po.efeito FROM nexus.permission_overrides po
    JOIN nexus.permissions p ON p.id=po.permission_id
    WHERE po.principal_id=$1 AND p.codigo=$2
      AND (po.expira_em IS NULL OR po.expira_em>now())
      AND (po.department_id IS NULL OR po.department_id=$3)
    ORDER BY CASE po.efeito WHEN 'negar' THEN 0 ELSE 1 END LIMIT 1
  `, [principalId, codigo, departmentId])).rows[0];
  if (override) return {
    permitida: override.efeito === 'permitir',
    motivo: override.efeito === 'permitir' ? 'override_permissao' : 'override_negacao'
  };
  const papel = (await pool.query(`
    SELECT ra.department_id FROM nexus.role_assignments ra
    JOIN nexus.role_permissions rp ON rp.role_id=ra.role_id
    JOIN nexus.permissions p ON p.id=rp.permission_id
    WHERE ra.principal_id=$1 AND p.codigo=$2
      AND (ra.department_id IS NULL OR ra.department_id=$3)
    ORDER BY CASE WHEN ra.department_id IS NULL THEN 0 ELSE 1 END LIMIT 1
  `, [principalId, codigo, departmentId])).rows[0];
  return papel
    ? { permitida: true, motivo: papel.department_id ? 'papel_setor' : 'papel_global' }
    : { permitida: false, motivo: 'sem_concessao' };
}

async function auditarAcao(pool, ator, dados) {
  await pool.query(`
    INSERT INTO nexus.audit_events
      (principal_id,conversation_id,tipo,recurso,resultado,metadados)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb)
  `, [ator.principalId, dados.conversationId || null, dados.tipo,
    dados.recurso || null, dados.resultado || null, JSON.stringify(dados.metadados || {})]);
}

async function exigirPermissao(pool, ator, codigo, opcoes = {}) {
  const decisao = await decisaoPermissao(pool, ator.principalId, codigo, opcoes.departmentId || null);
  await pool.query(`
    INSERT INTO nexus.authorization_decisions
      (principal_id,conversation_id,permission_code,tool_name,camada,modo,decisao,motivo_codigo)
    VALUES ($1,$2,$3,$4,'hub','enforce',$5,$6)
  `, [ator.principalId, opcoes.conversationId || null, codigo,
    opcoes.acao || 'hub', decisao.permitida ? 'allow' : 'deny', decisao.motivo]);
  if (!decisao.permitida) {
    throw new ErroHub('ACESSO_NEGADO', `Acesso negado para ${codigo}.`, 403);
  }
  return decisao;
}

async function montarPerfil(pool, principalId) {
  const principal = await buscarPrincipal(pool, { id: principalId });
  const setores = (await pool.query(`
    SELECT d.id,d.slug,d.nome,d.ativo,
      COALESCE(array_agg(DISTINCT r.slug) FILTER (WHERE r.slug IS NOT NULL),'{}') AS papeis
    FROM nexus.principal_departments pd
    JOIN nexus.departments d ON d.id=pd.department_id
    LEFT JOIN nexus.role_assignments ra
      ON ra.principal_id=pd.principal_id AND ra.department_id=d.id
    LEFT JOIN nexus.roles r ON r.id=ra.role_id
    WHERE pd.principal_id=$1 AND d.ativo=true
    GROUP BY d.id ORDER BY d.nome
  `, [principalId])).rows;
  const papeisGlobais = (await pool.query(`
    SELECT r.slug FROM nexus.role_assignments ra JOIN nexus.roles r ON r.id=ra.role_id
    WHERE ra.principal_id=$1 AND ra.department_id IS NULL ORDER BY r.slug
  `, [principalId])).rows.map((item) => item.slug);
  const concessoes = (await pool.query(`
    SELECT DISTINCT p.codigo,ra.department_id FROM nexus.role_assignments ra
    JOIN nexus.role_permissions rp ON rp.role_id=ra.role_id
    JOIN nexus.permissions p ON p.id=rp.permission_id
    WHERE ra.principal_id=$1 ORDER BY p.codigo,ra.department_id NULLS FIRST
  `, [principalId])).rows;
  const overrides = (await pool.query(`
    SELECT p.codigo,po.department_id,po.efeito FROM nexus.permission_overrides po
    JOIN nexus.permissions p ON p.id=po.permission_id
    WHERE po.principal_id=$1 AND (po.expira_em IS NULL OR po.expira_em>now())
    ORDER BY p.codigo
  `, [principalId])).rows;
  const codigos = [...new Set([
    ...concessoes.map((item) => item.codigo),
    ...overrides.map((item) => item.codigo)
  ])].sort();
  const efetivas = (departmentId) => codigos.filter((codigo) => {
    const overridesAplicaveis = overrides.filter((item) => item.codigo === codigo &&
      (item.department_id == null || item.department_id === departmentId));
    if (overridesAplicaveis.some((item) => item.efeito === 'negar')) return false;
    if (overridesAplicaveis.some((item) => item.efeito === 'permitir')) return true;
    return concessoes.some((item) => item.codigo === codigo &&
      (item.department_id == null || item.department_id === departmentId));
  });
  const permissoesGlobais = efetivas(null);
  const setoresComPermissoes = setores.map((setor) => ({
    ...setor,
    permissoes: efetivas(setor.id)
  }));
  const permissoes = [...new Set([
    ...permissoesGlobais,
    ...setoresComPermissoes.flatMap((setor) => setor.permissoes)
  ])].sort();
  return { ...principal, setores: setoresComPermissoes, papeisGlobais,
    permissoesGlobais, permissoes };
}

async function resolverIdentidadeMicrosoft(pool, dados, opcoes = {}) {
  const tenantId = String(dados.tenantId || '').trim();
  const subjectId = String(dados.subjectId || '').trim();
  const esperado = String(opcoes.tenantId || process.env.NEXUS_HUB_ENTRA_TENANT_ID || '').trim();
  if (!tenantId || !subjectId || (esperado && tenantId !== esperado)) {
    throw new ErroHub('TENANT_NAO_AUTORIZADO', 'Esta conta Microsoft nao pertence ao tenant autorizado.', 403);
  }
  const email = normalizarEmail(dados.email);
  return comTransacao(pool, async (cliente) => {
    let principal = (await cliente.query(`
      SELECT p.* FROM nexus.principal_identities pi
      JOIN nexus.principals p ON p.id=pi.principal_id
      WHERE pi.provedor='microsoft' AND pi.tenant_id=$1 AND pi.subject_id=$2
      FOR UPDATE OF p
    `, [tenantId, subjectId])).rows[0];
    if (!principal) {
      principal = (await cliente.query(`
        SELECT * FROM nexus.principals
        WHERE lower(email)=$1 AND tipo='usuario' FOR UPDATE
      `, [email])).rows[0];
      if (!principal) {
        throw new ErroHub('PRE_CADASTRO_NAO_ENCONTRADO', 'Seu acesso ao Nexus ainda nao foi liberado.', 403);
      }
      await cliente.query(`
        INSERT INTO nexus.principal_identities (principal_id,provedor,tenant_id,subject_id)
        VALUES ($1,'microsoft',$2,$3)
        ON CONFLICT (provedor,tenant_id,subject_id) DO NOTHING
      `, [principal.id, tenantId, subjectId]);
    }
    if (!principal.ativo) throw new ErroHub('USUARIO_INATIVO', 'Seu acesso ao Nexus esta inativo.', 403);
    const acesso = await decisaoPermissao(cliente, principal.id, 'hub.acessar', null);
    if (!acesso.permitida) {
      const setores = (await cliente.query(
        'SELECT department_id FROM nexus.principal_departments WHERE principal_id=$1', [principal.id]
      )).rows;
      let permitidoSetor = false;
      for (const setor of setores) {
        if ((await decisaoPermissao(cliente, principal.id, 'hub.acessar', setor.department_id)).permitida) {
          permitidoSetor = true;
          break;
        }
      }
      if (!permitidoSetor) throw new ErroHub('ACESSO_HUB_NAO_CONCEDIDO', 'Seu acesso ao Hub Nexus nao foi liberado.', 403);
    }
    await cliente.query('UPDATE nexus.principals SET atualizado_em=now() WHERE id=$1', [principal.id]);
    await auditarAcao(cliente, { principalId: principal.id }, {
      tipo: 'hub_login', recurso: 'microsoft', resultado: 'success'
    });
    return montarPerfil(cliente, principal.id);
  });
}

function criarServicoHub(opcoes = {}) {
  const { pool } = opcoes;
  if (!pool) throw new Error('Pool PostgreSQL obrigatorio para o Hub Nexus.');
  const ator = { principalId: opcoes.principalId, principalSlug: opcoes.principalSlug };
  if (!ator.principalId) throw new Error('Principal autenticado obrigatorio para o Hub Nexus.');

  async function perfil() {
    return montarPerfil(pool, ator.principalId);
  }

  async function listarConversas(filtros = {}) {
    const limite = Math.min(LIMITE_CONVERSAS, Math.max(1, Number(filtros.limite || 30)));
    const linhas = (await pool.query(`
      SELECT c.id,c.chave_sessao,c.titulo,c.composition_level,c.fixada_em,c.arquivada_em,
        c.ultima_atividade_em,c.criada_em,d.id AS department_id,d.slug AS department_slug,
        d.nome AS department_name,
        (SELECT m.conteudo FROM nexus.conversation_messages m
         WHERE m.conversation_id=c.id ORDER BY m.criado_em DESC,m.id DESC LIMIT 1) AS preview
      FROM nexus.conversations c
      LEFT JOIN nexus.departments d ON d.id=c.department_id
      WHERE c.principal_id=$1
        AND (($2::boolean=true AND c.arquivada_em IS NOT NULL)
          OR ($2::boolean=false AND c.arquivada_em IS NULL))
        AND ($3::timestamptz IS NULL OR c.ultima_atividade_em<$3)
        AND c.titulo IS NOT NULL
      ORDER BY c.fixada_em DESC NULLS LAST,c.ultima_atividade_em DESC,c.id DESC
      LIMIT $4
    `, [ator.principalId, filtros.arquivadas === true, filtros.cursor || null, limite])).rows;
    return linhas.map((linha) => ({
      id: linha.id, sessionKey: linha.chave_sessao, title: linha.titulo,
      compositionLevel: linha.composition_level, pinnedAt: linha.fixada_em,
      archivedAt: linha.arquivada_em, updatedAt: linha.ultima_atividade_em,
      createdAt: linha.criada_em, preview: linha.preview,
      department: linha.department_id ? {
        id: linha.department_id, slug: linha.department_slug, name: linha.department_name
      } : null
    }));
  }

  async function obterConversa(id, cliente = pool) {
    const linha = (await cliente.query(`
      SELECT c.*,d.slug AS department_slug,d.nome AS department_name
      FROM nexus.conversations c LEFT JOIN nexus.departments d ON d.id=c.department_id
      WHERE c.id=$1 AND c.principal_id=$2
    `, [id, ator.principalId])).rows[0];
    if (!linha || linha.arquivada_em && linha.titulo === null) {
      throw new ErroHub('CONVERSA_NAO_ENCONTRADA', 'Conversa nao encontrada.', 404);
    }
    return linha;
  }

  async function validarSetor(departmentId, cliente = pool) {
    const setor = (await cliente.query(`
      SELECT d.id,d.slug,d.nome FROM nexus.departments d
      JOIN nexus.principal_departments pd ON pd.department_id=d.id
      WHERE d.id=$1 AND pd.principal_id=$2 AND d.ativo=true
    `, [departmentId, ator.principalId])).rows[0];
    if (!setor) throw new ErroHub('SETOR_NAO_AUTORIZADO', 'Setor nao autorizado para este usuario.', 403);
    return setor;
  }

  async function validarComposicao(nivel, departmentId) {
    const composicao = normalizarComposicao(nivel);
    if (composicao === 'alto') {
      await exigirPermissao(pool, ator, 'ia.composicao.alta', { departmentId, acao: 'hub_composicao' });
    }
    if (composicao === 'extra_alto') {
      await exigirPermissao(pool, ator, 'ia.composicao.extra_alta', { departmentId, acao: 'hub_composicao' });
    }
    return composicao;
  }

  async function criarConversa(dados = {}) {
    const setor = await validarSetor(dados.departmentId);
    await exigirPermissao(pool, ator, 'hub.acessar', { departmentId: setor.id, acao: 'hub_conversa_criar' });
    const composicao = await validarComposicao(dados.compositionLevel || 'medio', setor.id);
    const chave = randomUUID();
    const linha = (await pool.query(`
      INSERT INTO nexus.conversations
        (principal_id,chave_sessao,titulo,department_id,composition_level,ultima_atividade_em)
      VALUES ($1,$2,$3,$4,$5,now()) RETURNING *
    `, [ator.principalId, chave, dados.title ? tituloDaPergunta(dados.title) : null,
      setor.id, composicao])).rows[0];
    return { id: linha.id, sessionKey: chave, title: linha.titulo,
      compositionLevel: composicao, department: setor, createdAt: linha.criada_em };
  }

  async function atualizarConversa(id, dados = {}) {
    const conversa = await obterConversa(id);
    let composicao = conversa.composition_level;
    if (dados.compositionLevel != null) {
      composicao = await validarComposicao(dados.compositionLevel, conversa.department_id);
    }
    const titulo = dados.title == null ? conversa.titulo : tituloDaPergunta(dados.title);
    const fixada = dados.pinned == null ? conversa.fixada_em : dados.pinned ? new Date() : null;
    const arquivada = dados.archived == null ? conversa.arquivada_em : dados.archived ? new Date() : null;
    const linha = (await pool.query(`
      UPDATE nexus.conversations SET titulo=$3,composition_level=$4,fixada_em=$5,
        arquivada_em=$6,atualizada_em=now(),ultima_atividade_em=now()
      WHERE id=$1 AND principal_id=$2 RETURNING *
    `, [id, ator.principalId, titulo, composicao, fixada, arquivada])).rows[0];
    return { id: linha.id, title: linha.titulo, compositionLevel: linha.composition_level,
      pinnedAt: linha.fixada_em, archivedAt: linha.arquivada_em, updatedAt: linha.ultima_atividade_em };
  }

  async function excluirConversa(id) {
    return comTransacao(pool, async (cliente) => {
      const conversa = await obterConversa(id, cliente);
      await cliente.query(`
        UPDATE nexus.knowledge_items k SET ativo=false,desativado_em=now(),source_candidate_id=NULL
        FROM nexus.memory_candidates mc
        WHERE k.source_candidate_id=mc.id AND mc.conversation_id=$1
      `, [id]);
      await cliente.query('DELETE FROM nexus.memory_candidates WHERE conversation_id=$1', [id]);
      await cliente.query('DELETE FROM nexus.conversation_messages WHERE conversation_id=$1', [id]);
      await cliente.query('DELETE FROM nexus.interaction_tasks WHERE conversation_id=$1', [id]);
      await cliente.query('DELETE FROM nexus.interactions WHERE conversation_id=$1', [id]);
      await cliente.query(`UPDATE nexus.conversations SET titulo=NULL,arquivada_em=now(),
        fixada_em=NULL,atualizada_em=now(),ultima_atividade_em=now() WHERE id=$1`, [id]);
      await auditarAcao(cliente, ator, {
        conversationId: id, tipo: 'hub_conversation_deleted', recurso: String(id), resultado: 'success',
        metadados: { department_id: conversa.department_id }
      });
      return { id, deleted: true };
    });
  }

  async function listarMensagens(conversationId, filtros = {}) {
    await obterConversa(conversationId);
    const limite = Math.min(LIMITE_MENSAGENS, Math.max(1, Number(filtros.limite || 50)));
    const linhas = (await pool.query(`
      SELECT m.id,m.turn_id,m.trace_id,m.papel,m.conteudo,m.proveniencia,m.criado_em,
        t.status AS turn_status,
        CASE WHEN m.papel='user' THEN COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id',a.id,'mediaType',a.media_type,'bytes',a.bytes,'width',a.width,'height',a.height,
          'url','/api/nexus/conversations/' || a.conversation_id || '/attachments/' || a.id
        ) ORDER BY a.criado_em,a.id) FROM nexus.conversation_attachments a
          WHERE a.turn_id=m.turn_id AND a.status='ready'), '[]'::jsonb) ELSE '[]'::jsonb END AS attachments
      FROM nexus.conversation_messages m
      LEFT JOIN nexus.ai_turns t ON t.id=m.turn_id
      WHERE m.conversation_id=$1 AND ($2::timestamptz IS NULL OR m.criado_em<$2)
      ORDER BY m.criado_em DESC,m.id DESC LIMIT $3
    `, [conversationId, filtros.cursor || null, limite])).rows.reverse();
    return linhas.map((linha) => ({ id: linha.id, turnId: linha.turn_id, traceId: linha.trace_id,
      role: linha.papel, content: linha.conteudo, provenance: linha.proveniencia,
      attachments: linha.attachments || [], turnStatus: linha.turn_status, createdAt: linha.criado_em }));
  }

  async function iniciarSolicitacao(conversationId, dados) {
    const conversa = await obterConversa(conversationId);
    const composicao = await validarComposicao(
      dados.compositionLevel || conversa.composition_level, conversa.department_id
    );
    const clientRequestId = String(dados.clientRequestId || '').trim();
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(clientRequestId)) {
      throw new ErroHub('REQUEST_ID_INVALIDO', 'Identificador da solicitacao invalido.');
    }
    const traceId = dados.traceId || randomUUID();
    try {
      const linha = (await pool.query(`
        INSERT INTO nexus.hub_turn_requests
          (conversation_id,principal_id,department_id,client_request_id,trace_id,composition_level)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
      `, [conversationId, ator.principalId, conversa.department_id, clientRequestId,
        traceId, composicao])).rows[0];
      return { request: linha, conversation: conversa, reused: false };
    } catch (erro) {
      if (erro.code !== '23505') throw erro;
      const existente = (await pool.query(`
        SELECT * FROM nexus.hub_turn_requests
        WHERE conversation_id=$1 AND client_request_id=$2
      `, [conversationId, clientRequestId])).rows[0];
      if (existente) return { request: existente, conversation: conversa, reused: true };
      throw new ErroHub('TURNO_EM_ANDAMENTO', 'Esta conversa ja possui uma resposta em andamento.', 409);
    }
  }

  async function marcarSolicitacao(id, status, dados = {}) {
    const permitido = ['running', 'success', 'error', 'interrupted'];
    if (!permitido.includes(status)) throw new Error('Estado de solicitacao invalido.');
    await pool.query(`
      UPDATE nexus.hub_turn_requests SET status=$2,turn_id=COALESCE($3,turn_id),
        erro_codigo=$4,iniciado_em=CASE WHEN $2='running' THEN COALESCE(iniciado_em,now()) ELSE iniciado_em END,
        concluido_em=CASE WHEN $2 IN ('success','error','interrupted') THEN now() ELSE concluido_em END
      WHERE id=$1 AND principal_id=$5
    `, [id, status, dados.turnId || null, dados.erro ? codigoErro(dados.erro) : null, ator.principalId]);
  }

  async function obterSolicitacao(conversationId, id) {
    await obterConversa(conversationId);
    const linha = (await pool.query(`
      SELECT id,trace_id,turn_id,composition_level,status,erro_codigo,
        criado_em,iniciado_em,concluido_em
      FROM nexus.hub_turn_requests
      WHERE id=$1 AND conversation_id=$2 AND principal_id=$3
    `, [id, conversationId, ator.principalId])).rows[0];
    if (!linha) throw new ErroHub('SOLICITACAO_NAO_ENCONTRADA', 'Solicitacao nao encontrada.', 404);
    return {
      id: linha.id, traceId: linha.trace_id, turnId: linha.turn_id,
      compositionLevel: linha.composition_level, status: linha.status,
      errorCode: linha.erro_codigo, createdAt: linha.criado_em,
      startedAt: linha.iniciado_em, completedAt: linha.concluido_em
    };
  }

  async function concluirAtividade(conversationId, pergunta, turnId, composicao) {
    await pool.query(`UPDATE nexus.conversations SET
      titulo=COALESCE(titulo,$3),ultima_atividade_em=now(),atualizada_em=now()
      WHERE id=$1 AND principal_id=$2`, [conversationId, ator.principalId, tituloDaPergunta(pergunta)]);
    if (turnId) await pool.query(`UPDATE nexus.ai_turns SET requested_composition_level=$2 WHERE id=$1`,
      [turnId, composicao]);
  }

  async function responderOferta(conversationId, candidatoId, acao) {
    const conversa = await obterConversa(conversationId);
    const candidato = (await pool.query(`
      SELECT id,status FROM nexus.memory_candidates
      WHERE id=$1 AND conversation_id=$2 AND proposed_by_principal_id=$3
    `, [candidatoId, conversationId, ator.principalId])).rows[0];
    if (!candidato || candidato.status !== 'offered') {
      throw new ErroHub('OFERTA_NAO_ENCONTRADA', 'Oferta de memoria nao encontrada ou expirada.', 404);
    }
    const status = acao === 'confirmar' ? 'pending_review' : acao === 'descartar' ? 'declined' : null;
    if (!status) throw new ErroHub('ACAO_INVALIDA', 'Acao de memoria invalida.');
    if (status === 'pending_review') {
      await exigirPermissao(pool, ator, 'memoria.candidatar', {
        departmentId: conversa.department_id, conversationId, acao: 'hub_memory_offer'
      });
    }
    await pool.query(`UPDATE nexus.memory_candidates SET status=$2,
      confirmado_em=CASE WHEN $2='pending_review' THEN now() ELSE confirmado_em END,
      atualizado_em=now() WHERE id=$1`, [candidatoId, status]);
    await auditarAcao(pool, ator, { conversationId, tipo: 'memory_candidate',
      recurso: String(candidatoId), resultado: status });
    return { candidateId: candidatoId, status };
  }

  async function exigirAdmin(acao) {
    return exigirPermissao(pool, ator, 'governanca.administrar', { acao });
  }

  async function listarPrincipals() {
    await exigirAdmin('hub_admin_principals_list');
    return (await pool.query(`
      SELECT p.id,p.slug,p.nome,p.email,p.tipo,p.ativo,p.criado_em,p.atualizado_em,
        COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id',d.id,'slug',d.slug,'nome',d.nome))
          FILTER (WHERE d.id IS NOT NULL),'[]') AS setores,
        COALESCE(jsonb_agg(DISTINCT jsonb_build_object('papel',r.slug,'departmentId',ra.department_id))
          FILTER (WHERE r.id IS NOT NULL),'[]') AS atribuicoes
      FROM nexus.principals p
      LEFT JOIN nexus.principal_departments pd ON pd.principal_id=p.id
      LEFT JOIN nexus.departments d ON d.id=pd.department_id
      LEFT JOIN nexus.role_assignments ra ON ra.principal_id=p.id
      LEFT JOIN nexus.roles r ON r.id=ra.role_id
      GROUP BY p.id ORDER BY p.nome
    `)).rows;
  }

  async function cadastrarPrincipal(dados) {
    await exigirAdmin('hub_admin_principal_create');
    const email = normalizarEmail(dados.email);
    const nome = String(dados.name || '').trim().slice(0, 160);
    if (!nome) throw new ErroHub('NOME_OBRIGATORIO', 'Informe o nome do usuario.');
    let linha;
    try {
      linha = (await pool.query(`
        INSERT INTO nexus.principals (slug,tipo,nome,email,ativo)
        VALUES ($1,'usuario',$2,$3,true) RETURNING *
      `, [slugDoEmail(email), nome, email])).rows[0];
    } catch (erro) {
      if (erro.code === '23505') {
        throw new ErroHub('USUARIO_JA_CADASTRADO', 'Ja existe um usuario com este e-mail.', 409);
      }
      throw erro;
    }
    await auditarAcao(pool, ator, { tipo: 'hub_principal_created', recurso: linha.slug,
      resultado: 'success' });
    return linha;
  }

  async function atualizarPrincipal(id, dados) {
    await exigirAdmin('hub_admin_principal_update');
    const atual = await buscarPrincipal(pool, { id });
    if (atual.id === ator.principalId && dados.active === false) {
      throw new ErroHub('AUTO_DESATIVACAO_NEGADA', 'O administrador nao pode desativar a propria conta.');
    }
    const linha = (await pool.query(`UPDATE nexus.principals SET
      nome=COALESCE($2,nome),email=COALESCE($3,email),ativo=COALESCE($4,ativo),atualizado_em=now()
      WHERE id=$1 RETURNING *`, [id, dados.name || null,
      dados.email ? normalizarEmail(dados.email) : null,
      typeof dados.active === 'boolean' ? dados.active : null])).rows[0];
    await auditarAcao(pool, ator, { tipo: 'hub_principal_updated', recurso: linha.slug,
      resultado: 'success', metadados: { fields: Object.keys(dados).sort() } });
    return linha;
  }

  async function listarSetores() {
    const admin = await decisaoPermissao(pool, ator.principalId, 'governanca.administrar', null);
    if (admin.permitida) return (await pool.query(
      'SELECT id,slug,nome,ativo,criado_em FROM nexus.departments ORDER BY nome'
    )).rows;
    return (await pool.query(`SELECT d.id,d.slug,d.nome,d.ativo,d.criado_em
      FROM nexus.departments d JOIN nexus.principal_departments pd ON pd.department_id=d.id
      WHERE pd.principal_id=$1 AND d.ativo=true ORDER BY d.nome`, [ator.principalId])).rows;
  }

  async function listarPapeis() {
    await exigirAdmin('hub_admin_roles_list');
    return (await pool.query(
      'SELECT id,slug,nome,descricao FROM nexus.roles ORDER BY nome'
    )).rows;
  }

  async function cadastrarSetor(dados) {
    await exigirAdmin('hub_admin_department_create');
    const nome = String(dados.name || '').trim().slice(0, 120);
    if (!nome) throw new ErroHub('NOME_OBRIGATORIO', 'Informe o nome do setor.');
    const slug = normalizarSlug(dados.slug || nome, 'setor');
    return comTransacao(pool, async (cliente) => {
      let linha;
      try {
        linha = (await cliente.query(`INSERT INTO nexus.departments (slug,nome)
          VALUES ($1,$2) RETURNING *`, [slug, nome])).rows[0];
      } catch (erro) {
        if (erro.code === '23505') {
          throw new ErroHub('SETOR_JA_CADASTRADO', 'Ja existe um setor com este identificador.', 409);
        }
        throw erro;
      }
      await cliente.query(`INSERT INTO nexus.principal_departments (principal_id,department_id)
        VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ator.principalId, linha.id]);
      await auditarAcao(cliente, ator, { tipo: 'hub_department_created', recurso: slug,
        resultado: 'success', metadados: { creator_linked: true } });
      return linha;
    });
  }

  async function atualizarSetor(id, dados) {
    await exigirAdmin('hub_admin_department_update');
    const linha = (await pool.query(`UPDATE nexus.departments SET
      nome=COALESCE($2,nome),ativo=COALESCE($3,ativo) WHERE id=$1 RETURNING *`,
    [id, dados.name || null, typeof dados.active === 'boolean' ? dados.active : null])).rows[0];
    if (!linha) throw new ErroHub('SETOR_NAO_ENCONTRADO', 'Setor nao encontrado.', 404);
    await auditarAcao(pool, ator, { tipo: 'hub_department_updated', recurso: linha.slug,
      resultado: 'success', metadados: { fields: Object.keys(dados).sort() } });
    return linha;
  }

  async function substituirAtribuicoes(principalId, dados) {
    await exigirAdmin('hub_admin_assignments_update');
    const departamentos = [...new Set(dados.departmentIds || [])];
    const atribuicoes = Array.isArray(dados.assignments) ? dados.assignments : [];
    if (principalId === ator.principalId &&
        !atribuicoes.some((item) => item.role === 'administrador' && !item.departmentId)) {
      throw new ErroHub('AUTO_REMOCAO_ADMIN_NEGADA',
        'O administrador nao pode remover o proprio papel global de administrador.');
    }
    return comTransacao(pool, async (cliente) => {
      await buscarPrincipal(cliente, { id: principalId });
      await cliente.query('DELETE FROM nexus.role_assignments WHERE principal_id=$1', [principalId]);
      await cliente.query('DELETE FROM nexus.principal_departments WHERE principal_id=$1', [principalId]);
      for (const departmentId of departamentos) {
        const insercao = await cliente.query(`INSERT INTO nexus.principal_departments
          (principal_id,department_id)
          SELECT $1,id FROM nexus.departments WHERE id=$2 AND ativo=true`, [principalId, departmentId]);
        if (!insercao.rowCount) throw new ErroHub('SETOR_NAO_ENCONTRADO', 'Setor de atribuicao invalido.');
      }
      for (const item of atribuicoes) {
        const departmentId = item.departmentId || null;
        if (departmentId && !departamentos.includes(departmentId)) {
          throw new ErroHub('ATRIBUICAO_INVALIDA', 'Papel setorial exige associacao ao setor.');
        }
        const insercao = await cliente.query(`INSERT INTO nexus.role_assignments
          (principal_id,role_id,department_id)
          SELECT $1,id,$3 FROM nexus.roles WHERE slug=$2`,
        [principalId, item.role, departmentId]);
        if (!insercao.rowCount) throw new ErroHub('PAPEL_NAO_ENCONTRADO', 'Papel invalido.');
      }
      await auditarAcao(cliente, ator, { tipo: 'hub_assignments_updated',
        recurso: String(principalId), resultado: 'success',
        metadados: { departments_count: departamentos.length, assignments_count: atribuicoes.length } });
      return montarPerfil(cliente, principalId);
    });
  }

  async function relatorioCustos(filtros = {}) {
    const global = await decisaoPermissao(pool, ator.principalId, 'custos.consultar.global', null);
    if (global.permitida) return relatorioExecutivo(pool, filtros);
    if (!filtros.setor) throw new ErroHub('SETOR_OBRIGATORIO', 'Selecione um setor para consultar custos.');
    const setor = (await pool.query(`SELECT d.id,d.slug FROM nexus.departments d
      JOIN nexus.principal_departments pd ON pd.department_id=d.id
      WHERE d.slug=$1 AND pd.principal_id=$2`, [filtros.setor, ator.principalId])).rows[0];
    if (!setor) throw new ErroHub('SETOR_NAO_AUTORIZADO', 'Setor nao autorizado.', 403);
    await exigirPermissao(pool, ator, 'custos.consultar.setor', {
      departmentId: setor.id, acao: 'hub_usage_report'
    });
    return relatorioExecutivo(pool, { ...filtros, setor: setor.slug });
  }

  async function listarAuditoria(filtros = {}) {
    await exigirPermissao(pool, ator, 'auditoria.consultar', { acao: 'hub_audit_list' });
    const limite = Math.min(200, Math.max(1, Number(filtros.limite || 100)));
    return (await pool.query(`
      SELECT ae.id,ae.tipo,ae.recurso,ae.resultado,ae.metadados,ae.criado_em,
        p.slug AS principal,c.chave_sessao AS sessao
      FROM nexus.audit_events ae
      LEFT JOIN nexus.principals p ON p.id=ae.principal_id
      LEFT JOIN nexus.conversations c ON c.id=ae.conversation_id
      WHERE ($1::timestamptz IS NULL OR ae.criado_em>=$1)
      ORDER BY ae.criado_em DESC LIMIT $2
    `, [filtros.inicio || null, limite])).rows;
  }

  async function obterTrace(traceId) {
    await exigirPermissao(pool, ator, 'auditoria.consultar', { acao: 'hub_audit_trace' });
    return relatorioTrace(pool, traceId);
  }

  return {
    ator, atualizarConversa, atualizarPrincipal, atualizarSetor, cadastrarPrincipal,
    cadastrarSetor, concluirAtividade, criarConversa, excluirConversa, iniciarSolicitacao,
    listarAuditoria, listarConversas, listarMensagens, listarPapeis, listarPrincipals, listarSetores,
    marcarSolicitacao, obterConversa, obterSolicitacao, obterTrace, perfil, relatorioCustos,
    responderOferta, substituirAtribuicoes, validarComposicao
  };
}

module.exports = {
  COMPOSICOES,
  ErroHub,
  criarServicoHub,
  decisaoPermissao,
  faixaMinimaDaComposicao,
  montarPerfil,
  normalizarComposicao,
  resolverIdentidadeMicrosoft,
  slugDoEmail,
  tituloDaPergunta
};
