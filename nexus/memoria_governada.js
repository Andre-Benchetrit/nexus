const { comTransacao } = require('./db');

const TIPOS_MEMORIA = Object.freeze([
  'business_knowledge', 'execution_playbook', 'personal_preference'
]);
const ESCOPOS_MEMORIA = Object.freeze(['principal', 'department', 'global']);
const ESTADOS_CANDIDATURA = Object.freeze([
  'offered', 'pending_review', 'changes_requested', 'approved', 'rejected',
  'declined', 'expired', 'revoked'
]);
const MOTIVOS_REVISAO = Object.freeze([
  'correcao', 'preferencia_explicita', 'aprendizado_execucao', 'regra_estavel'
]);
const TEXTO_SENSIVEL = /password|senha|secret|credential|api[_ -]?key|postgres(?:ql)?:\/\/|BEGIN (?:SYSTEM|DEVELOPER) PROMPT/i;
const TEXTO_TRANSITORIO = /\b(hoje|ontem|agora|neste momento|faturamento atual|ranking atual|top \d+)\b/i;
const TEXTO_CONTORNO = /ignorar? (?:a |as )?(?:regra|permiss|seguran)|bypass|contornar (?:a |as )?(?:tool|permiss|governan)/i;

function resolverModoAutomacaoMemoria(valor = process.env.NEXUS_MEMORY_AUTOMATION_MODE || 'observe') {
  const modo = String(valor).toLowerCase();
  if (!['off', 'observe', 'propose'].includes(modo)) {
    throw new Error(`NEXUS_MEMORY_AUTOMATION_MODE invalido: ${modo}.`);
  }
  return modo;
}

function resolverModoPlaybook(valor = process.env.NEXUS_PLAYBOOK_MODE || 'shadow') {
  const modo = String(valor).toLowerCase();
  if (!['off', 'shadow', 'assist'].includes(modo)) {
    throw new Error(`NEXUS_PLAYBOOK_MODE invalido: ${modo}.`);
  }
  return modo;
}

function resumirTexto(valor, limite = 1_000) {
  return String(valor || '').replace(/\s+/g, ' ').trim().slice(0, limite);
}

function listaTextual(valor, limite = 20) {
  return [...new Set((Array.isArray(valor) ? valor : [])
    .map((item) => resumirTexto(item, 120)).filter(Boolean))].slice(0, limite);
}

function normalizarAvaliacaoMemoria(avaliacao, contexto = {}) {
  if (!avaliacao || typeof avaliacao !== 'object') {
    throw new Error('Avaliacao de memoria invalida.');
  }
  if (avaliacao.eligible !== true || !avaliacao.candidate) {
    return {
      eligible: false,
      reasonCode: resumirTexto(avaliacao.reasonCode || 'sem_aprendizado_reutilizavel', 80),
      candidate: null
    };
  }
  const candidato = avaliacao.candidate;
  const tipo = String(candidato.type || '');
  if (!TIPOS_MEMORIA.includes(tipo)) throw new Error('Tipo de memoria nao permitido.');
  let escopo = String(candidato.proposedScope || (tipo === 'personal_preference' ? 'principal' : 'department'));
  if (!ESCOPOS_MEMORIA.includes(escopo)) throw new Error('Escopo de memoria nao permitido.');
  if (tipo === 'personal_preference') escopo = 'principal';
  const declaracao = resumirTexto(candidato.statement, 1_000);
  if (!declaracao) throw new Error('A candidatura nao possui declaracao.');
  if (TEXTO_SENSIVEL.test(declaracao)) throw new Error('Candidatura rejeitada por conteudo sensivel.');
  if (TEXTO_CONTORNO.test(declaracao)) throw new Error('Candidatura rejeitada por tentativa de contorno.');
  if (TEXTO_TRANSITORIO.test(declaracao)) throw new Error('Candidatura rejeitada por conteudo transitorio.');
  if (tipo === 'personal_preference' && contexto.preferenciaExplicita !== true) {
    throw new Error('Preferencia pessoal exige declaracao explicita do usuario.');
  }
  if (contexto.processoConcluido !== true) {
    throw new Error('Memoria exige um processo concluido com sucesso.');
  }
  const padraoSucesso = candidato.successPattern && typeof candidato.successPattern === 'object'
    ? candidato.successPattern : {};
  if (tipo === 'execution_playbook' && !Object.keys(padraoSucesso).length) {
    throw new Error('Playbook exige um caminho de sucesso comprovado.');
  }
  if (tipo === 'execution_playbook' && contexto.sucessoComprovado === false) {
    throw new Error('Playbook exige sucesso comprovado no ledger de tools.');
  }
  if (tipo === 'business_knowledge' && contexto.evidenciaCorporativa === false) {
    throw new Error('Conhecimento de negocio exige evidencia corporativa verificada.');
  }
  let referencias = listaTextual(candidato.evidenceRefs, 50);
  if (Array.isArray(contexto.evidenceRefsPermitidas)) {
    const permitidas = new Set(contexto.evidenceRefsPermitidas);
    referencias = referencias.filter((item) => permitidas.has(item));
    if (!referencias.length) throw new Error('Candidatura sem referencia de evidencia valida.');
  }
  return {
    eligible: true,
    reasonCode: resumirTexto(avaliacao.reasonCode || 'aprendizado_reutilizavel', 80),
    candidate: {
      type: tipo,
      category: resumirTexto(candidato.category || (
        tipo === 'execution_playbook' ? 'correcao_agente' :
          tipo === 'personal_preference' ? 'preferencia_resposta' : 'regra_negocio'
      ), 80),
      statement: declaracao,
      triggers: listaTextual(candidato.triggers),
      proposedScope: escopo,
      confidence: Math.max(0, Math.min(1, Number(candidato.confidence ?? 0.5))),
      evidenceRefs: referencias,
      failurePattern: candidato.failurePattern && typeof candidato.failurePattern === 'object'
        ? candidato.failurePattern : {},
      successPattern: padraoSucesso,
      riskFlags: listaTextual(candidato.riskFlags)
    }
  };
}

function classificarRespostaOferta(texto) {
  const normalizado = String(texto || '').trim().toLowerCase();
  if (/^(sim|s|confirmo|pode enviar|envie|aprovo)[.!]?$/.test(normalizado)) return 'confirmar';
  if (/^(nao|não|n|recuso|descarte|deixa pra la|deixa pra lá)[.!]?$/.test(normalizado)) return 'recusar';
  return null;
}

function criarServicoMemoriaGovernada(opcoes = {}) {
  const { pool } = opcoes;
  if (!pool) throw new Error('Pool PostgreSQL obrigatorio para memoria governada.');
  const principalSlug = opcoes.principalSlug || 'legacy-cli';
  const sessao = opcoes.sessao || 'padrao';
  const departamentoSlug = opcoes.departamentoSlug || null;
  const modo = resolverModoAutomacaoMemoria(opcoes.modo);

  async function contexto(cliente = pool) {
    const principal = (await cliente.query(
      'SELECT id, ativo FROM nexus.principals WHERE slug=$1', [principalSlug]
    )).rows[0];
    if (!principal?.ativo) throw new Error(`Principal ativo nao encontrado: ${principalSlug}`);
    const conversa = (await cliente.query(`
      INSERT INTO nexus.conversations (principal_id,chave_sessao) VALUES ($1,$2)
      ON CONFLICT (principal_id,chave_sessao) DO UPDATE SET atualizada_em=now()
      RETURNING id
    `, [principal.id, sessao])).rows[0];
    let departmentId = null;
    if (departamentoSlug) {
      const departamento = (await cliente.query(`
        SELECT d.id FROM nexus.departments d
        JOIN nexus.principal_departments pd ON pd.department_id=d.id
        WHERE d.slug=$1 AND d.ativo=true AND pd.principal_id=$2
      `, [departamentoSlug, principal.id])).rows[0];
      if (!departamento) throw new Error(`Setor ativo nao encontrado: ${departamentoSlug}`);
      departmentId = departamento.id;
    }
    return { principalId: principal.id, conversationId: conversa.id, departmentId };
  }

  async function permissao(cliente, principalId, codigo, departmentId = null) {
    const principal = (await cliente.query(
      'SELECT ativo FROM nexus.principals WHERE id=$1', [principalId]
    )).rows[0];
    if (!principal?.ativo) return false;
    const override = (await cliente.query(`
      SELECT po.efeito FROM nexus.permission_overrides po
      JOIN nexus.permissions p ON p.id=po.permission_id
      WHERE po.principal_id=$1 AND p.codigo=$2
        AND (po.expira_em IS NULL OR po.expira_em>now())
        AND (po.department_id IS NULL OR po.department_id=$3)
      ORDER BY CASE po.efeito WHEN 'negar' THEN 0 ELSE 1 END LIMIT 1
    `, [principalId, codigo, departmentId])).rows[0];
    if (override) return override.efeito === 'permitir';
    return Boolean((await cliente.query(`
      SELECT 1 FROM nexus.role_assignments ra
      JOIN nexus.role_permissions rp ON rp.role_id=ra.role_id
      JOIN nexus.permissions p ON p.id=rp.permission_id
      WHERE ra.principal_id=$1 AND p.codigo=$2
        AND (ra.department_id IS NULL OR ra.department_id=$3)
      LIMIT 1
    `, [principalId, codigo, departmentId])).rowCount);
  }

  async function registrarEvento(cliente, base, tipo, recurso, resultado, metadados = {}) {
    await cliente.query(`
      INSERT INTO nexus.audit_events
        (principal_id,conversation_id,tipo,recurso,resultado,metadados)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb)
    `, [base.principalId, base.conversationId, tipo, recurso, resultado,
      JSON.stringify(metadados)]);
  }

  async function expirarOfertas(cliente = pool) {
    return cliente.query(`
      UPDATE nexus.memory_candidates SET status='expired', atualizado_em=now()
      WHERE status='offered' AND expira_oferta_em<=now()
    `);
  }

  async function oferecer(avaliacao, dados = {}) {
    const normalizada = normalizarAvaliacaoMemoria(avaliacao, dados);
    const base = await contexto();
    if (!normalizada.eligible || modo === 'off') return { modo, oferecida: false, avaliacao: normalizada };
    if (modo === 'observe') {
      await registrarEvento(pool, base, 'memory_assessment', normalizada.candidate.type, 'observed', {
        reason_code: normalizada.reasonCode,
        escopo: normalizada.candidate.proposedScope,
        confianca: normalizada.candidate.confidence
      });
      return { modo, oferecida: false, avaliacao: normalizada };
    }
    const ttl = Number(opcoes.ttlHoras || process.env.NEXUS_MEMORY_OFFER_TTL_HOURS || 24);
    return comTransacao(pool, async (cliente) => {
      const atual = await contexto(cliente);
      await expirarOfertas(cliente);
      await cliente.query(`
        UPDATE nexus.memory_candidates SET status='expired', atualizado_em=now()
        WHERE conversation_id=$1 AND status='offered'
      `, [atual.conversationId]);
      const candidato = normalizada.candidate;
      if (candidato.proposedScope === 'department' && !atual.departmentId) {
        throw new Error('Uma memoria setorial exige um setor ativo no turno.');
      }
      const escopo = candidato.proposedScope;
      if (escopo !== 'global' && candidato.triggers.length) {
        const conflitoGlobal = (await cliente.query(`
          SELECT 1 FROM nexus.knowledge_items k
          JOIN nexus.knowledge_triggers kt ON kt.knowledge_id=k.id
          WHERE k.ativo=true AND k.escopo='global' AND k.categoria=$1
            AND kt.gatilho=ANY($2::text[]) AND lower(k.conteudo)<>lower($3)
          LIMIT 1
        `, [candidato.category, candidato.triggers, candidato.statement])).rowCount > 0;
        if (conflitoGlobal && !candidato.riskFlags.includes('conflito_global')) {
          candidato.riskFlags.push('conflito_global');
        }
      }
      const linha = (await cliente.query(`
        INSERT INTO nexus.memory_candidates
          (conversation_id,source_turn_id,trace_id,proposed_by_principal_id,
           tipo,categoria,declaracao,gatilhos,escopo,target_principal_id,
           target_department_id,confianca,justificativa,evidencias,padrao_falha,
           padrao_sucesso,riscos,status,expira_oferta_em)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14::jsonb,
                $15::jsonb,$16::jsonb,$17::jsonb,'offered',now()+($18||' hours')::interval)
        RETURNING *
      `, [atual.conversationId, dados.turnId || null, dados.traceId || null,
        atual.principalId, candidato.type, candidato.category, candidato.statement,
        JSON.stringify(candidato.triggers), escopo,
        escopo === 'principal' ? atual.principalId : null,
        escopo === 'department' ? atual.departmentId : null,
        candidato.confidence, normalizada.reasonCode,
        JSON.stringify(candidato.evidenceRefs), JSON.stringify(candidato.failurePattern),
        JSON.stringify(candidato.successPattern), JSON.stringify(candidato.riskFlags), ttl])).rows[0];
      await cliente.query(`
        INSERT INTO nexus.memory_candidate_revisions
          (candidate_id,versao,declaracao,gatilhos,escopo,target_principal_id,
           target_department_id,edited_by_principal_id,motivo)
        VALUES ($1,1,$2,$3::jsonb,$4,$5,$6,$7,'Proposta original do revisor')
      `, [linha.id, linha.declaracao, JSON.stringify(linha.gatilhos), linha.escopo,
        linha.target_principal_id, linha.target_department_id, atual.principalId]);
      await registrarEvento(cliente, atual, 'memory_candidate', String(linha.id), 'offered', {
        tipo: linha.tipo, escopo: linha.escopo, confianca: linha.confianca
      });
      return { modo, oferecida: true, candidato: mapearCandidato(linha), avaliacao: normalizada };
    });
  }

  async function processarRespostaOferta(texto) {
    const acao = classificarRespostaOferta(texto);
    if (!acao) return null;
    return comTransacao(pool, async (cliente) => {
      const base = await contexto(cliente);
      await expirarOfertas(cliente);
      const linha = (await cliente.query(`
        SELECT * FROM nexus.memory_candidates
        WHERE conversation_id=$1 AND status='offered' AND expira_oferta_em>now()
        ORDER BY criado_em DESC LIMIT 1 FOR UPDATE
      `, [base.conversationId])).rows[0];
      if (!linha) return null;
      if (acao === 'confirmar') {
        if (!await permissao(cliente, base.principalId, 'memoria.candidatar', linha.target_department_id)) {
          const erro = new Error('Acesso negado para memoria.candidatar.');
          erro.codigo = 'ACESSO_NEGADO';
          throw erro;
        }
        await cliente.query(`UPDATE nexus.memory_candidates
          SET status='pending_review',confirmado_em=now(),atualizado_em=now() WHERE id=$1`, [linha.id]);
        await registrarEvento(cliente, base, 'memory_candidate', String(linha.id), 'pending_review');
        return { acao, status: 'pending_review', candidatoId: linha.id };
      }
      await cliente.query(`UPDATE nexus.memory_candidates
        SET status='declined',atualizado_em=now() WHERE id=$1`, [linha.id]);
      await registrarEvento(cliente, base, 'memory_candidate', String(linha.id), 'declined');
      return { acao, status: 'declined', candidatoId: linha.id };
    });
  }

  async function listar(filtros = {}) {
    const base = await contexto();
    if (!await permissao(pool, base.principalId, 'memoria.auditar', base.departmentId)) {
      const podeRevisar = await permissao(pool, base.principalId, 'memoria.revisar.pessoal', base.departmentId)
        || await permissao(pool, base.principalId, 'memoria.revisar.setor', base.departmentId)
        || await permissao(pool, base.principalId, 'memoria.revisar.global', base.departmentId);
      if (!podeRevisar) {
        const erro = new Error('Acesso negado para consultar candidaturas de memoria.');
        erro.codigo = 'ACESSO_NEGADO';
        throw erro;
      }
    }
    const auditoriaGlobal = await permissao(pool, base.principalId, 'memoria.auditar', null);
    const parametros = [base.principalId, filtros.status || null, filtros.tipo || null,
      auditoriaGlobal, base.departmentId];
    const linhas = (await pool.query(`
      SELECT mc.* FROM nexus.memory_candidates mc
      WHERE ($2::text IS NULL OR mc.status=$2)
        AND ($3::text IS NULL OR mc.tipo=$3)
        AND ($4::boolean=true OR mc.escopo='global'
          OR mc.proposed_by_principal_id=$1
          OR mc.target_principal_id=$1
          OR (mc.escopo='department' AND mc.target_department_id=$5))
      ORDER BY mc.criado_em DESC LIMIT 200
    `, parametros)).rows;
    return linhas.map(mapearCandidato);
  }

  async function obter(id, cliente = pool, ignorarAutorizacao = false) {
    const linha = (await cliente.query(
      'SELECT * FROM nexus.memory_candidates WHERE id=$1', [id]
    )).rows[0];
    if (linha && !ignorarAutorizacao) {
      const base = await contexto(cliente);
      const global = await permissao(cliente, base.principalId, 'memoria.auditar', null);
      const visivel = global || linha.escopo === 'global'
        || String(linha.proposed_by_principal_id) === String(base.principalId)
        || String(linha.target_principal_id) === String(base.principalId)
        || (linha.escopo === 'department' && String(linha.target_department_id) === String(base.departmentId));
      if (!visivel) {
        const erro = new Error('Candidatura de memoria nao encontrada ou sem acesso.');
        erro.codigo = 'ACESSO_NEGADO';
        throw erro;
      }
    }
    return linha ? mapearCandidato(linha) : null;
  }

  async function revisar(id, decisao, dados = {}) {
    if (!['approved', 'rejected', 'changes_requested', 'revoked'].includes(decisao)) {
      throw new Error('Decisao de memoria invalida.');
    }
    const motivo = resumirTexto(dados.motivo, 500);
    if (!motivo) throw new Error('Informe o motivo da revisao.');
    return comTransacao(pool, async (cliente) => {
      const base = await contexto(cliente);
      const linha = (await cliente.query(
        'SELECT * FROM nexus.memory_candidates WHERE id=$1 FOR UPDATE', [id]
      )).rows[0];
      if (!linha) throw new Error(`Candidatura nao encontrada: ${id}`);
      const escopoEfetivo = dados.escopo || linha.escopo;
      const targetPrincipalEfetivo = escopoEfetivo === 'principal'
        ? (dados.targetPrincipalId || linha.target_principal_id || linha.proposed_by_principal_id) : null;
      const departmentEfetivo = escopoEfetivo === 'department'
        ? (dados.targetDepartmentId || linha.target_department_id)
        : escopoEfetivo === 'principal' ? base.departmentId : null;
      if (escopoEfetivo === 'principal' && base.departmentId) {
        const pertenceAoSetor = (await cliente.query(`
          SELECT 1 FROM nexus.principal_departments
          WHERE principal_id=$1 AND department_id=$2
        `, [targetPrincipalEfetivo, base.departmentId])).rowCount > 0;
        if (!pertenceAoSetor) {
          const erro = new Error('A memoria pessoal pertence a outro setor.');
          erro.codigo = 'ACESSO_NEGADO';
          throw erro;
        }
      }
      const codigo = decisao === 'revoked' ? 'memoria.administrar'
        : escopoEfetivo === 'global' ? 'memoria.revisar.global'
          : escopoEfetivo === 'department' ? 'memoria.revisar.setor' : 'memoria.revisar.pessoal';
      if (!await permissao(cliente, base.principalId, codigo, departmentEfetivo)) {
        const erro = new Error(`Acesso negado para ${codigo}.`);
        erro.codigo = 'ACESSO_NEGADO';
        throw erro;
      }
      const mesmaAutoria = String(linha.proposed_by_principal_id) === String(base.principalId);
      const excecaoPessoal = linha.tipo === 'personal_preference' && escopoEfetivo === 'principal';
      if (mesmaAutoria && !excecaoPessoal) throw new Error('Autoaprovacao nao permitida para esta candidatura.');
      if (decisao === 'revoked' && linha.status !== 'approved') {
        throw new Error('Somente memoria aprovada pode ser revogada.');
      }
      if (decisao !== 'revoked' && !['pending_review','changes_requested'].includes(linha.status)) {
        throw new Error(`Candidatura nao pode ser revisada no estado ${linha.status}.`);
      }
      let revisao = (await cliente.query(`
        SELECT * FROM nexus.memory_candidate_revisions
        WHERE candidate_id=$1 ORDER BY versao DESC LIMIT 1
      `, [id])).rows[0];
      if (dados.declaracao || dados.gatilhos || dados.escopo) {
        const novaDeclaracao = resumirTexto(dados.declaracao || linha.declaracao, 1_000);
        const novoEscopo = dados.escopo || linha.escopo;
        if (!ESCOPOS_MEMORIA.includes(novoEscopo)) throw new Error('Escopo de revisao invalido.');
        if (linha.tipo === 'personal_preference' && novoEscopo !== 'principal') {
          throw new Error('Preferencia pessoal deve permanecer no escopo principal.');
        }
        const targetPrincipal = novoEscopo === 'principal'
          ? (dados.targetPrincipalId || linha.target_principal_id || linha.proposed_by_principal_id) : null;
        const targetDepartment = novoEscopo === 'department'
          ? (dados.targetDepartmentId || linha.target_department_id) : null;
        revisao = (await cliente.query(`
          INSERT INTO nexus.memory_candidate_revisions
            (candidate_id,versao,declaracao,gatilhos,escopo,target_principal_id,
             target_department_id,edited_by_principal_id,motivo)
          VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9) RETURNING *
        `, [id, Number(revisao?.versao || 0) + 1, novaDeclaracao,
          JSON.stringify(listaTextual(dados.gatilhos || linha.gatilhos)), novoEscopo,
          targetPrincipal, targetDepartment, base.principalId, motivo])).rows[0];
        await cliente.query(`UPDATE nexus.memory_candidates SET
          declaracao=$2,gatilhos=$3::jsonb,escopo=$4,target_principal_id=$5,
          target_department_id=$6,atualizado_em=now() WHERE id=$1`,
        [id, revisao.declaracao, JSON.stringify(revisao.gatilhos), revisao.escopo,
          revisao.target_principal_id, revisao.target_department_id]);
        linha.declaracao = revisao.declaracao;
        linha.gatilhos = revisao.gatilhos;
        linha.escopo = revisao.escopo;
        linha.target_principal_id = revisao.target_principal_id;
        linha.target_department_id = revisao.target_department_id;
      }
      if (linha.escopo !== 'global' && (linha.riscos || []).includes('conflito_global')) {
        if (!await permissao(cliente, base.principalId, 'memoria.revisar.global', null)) {
          throw new Error('Conflito com memoria global exige revisao administrativa global.');
        }
      }
      await cliente.query(`
        INSERT INTO nexus.memory_reviews
          (candidate_id,revision_id,reviewer_principal_id,decisao,motivo)
        VALUES ($1,$2,$3,$4,$5)
      `, [id, revisao?.id || null, base.principalId, decisao, motivo]);
      await cliente.query(`UPDATE nexus.memory_candidates SET status=$2,atualizado_em=now() WHERE id=$1`,
        [id, decisao]);
      if (decisao === 'approved') await publicar(cliente, linha, revisao, base.principalId);
      if (decisao === 'revoked') {
        await cliente.query(`UPDATE nexus.knowledge_items
          SET ativo=false,desativado_em=now() WHERE source_candidate_id=$1`, [id]);
      }
      await registrarEvento(cliente, base, 'memory_review', String(id), decisao, {
        escopo: linha.escopo, tipo: linha.tipo, versao: revisao?.versao || 1
      });
      return obter(id, cliente, true);
    });
  }

  async function publicar(cliente, candidato, revisao, aprovadorId) {
    const idMemoria = `memory-${candidato.id}`;
    const versao = Number(revisao?.versao || 1);
    const declaracao = revisao?.declaracao || candidato.declaracao;
    const gatilhos = revisao?.gatilhos || candidato.gatilhos || [];
    const escopo = revisao?.escopo || candidato.escopo;
    const principalId = revisao?.target_principal_id || candidato.target_principal_id;
    const departmentId = revisao?.target_department_id || candidato.target_department_id;
    await cliente.query(`
      INSERT INTO nexus.knowledge_items
        (id,categoria,conteudo,origem,ativo,criado_em,tipo,escopo,principal_id,
         department_id,source_candidate_id,approved_by_principal_id,approved_at,
         versao,payload)
      VALUES ($1,$2,$3,'ia_candidatura_aprovada',true,now(),$4,$5,$6,$7,$8,$9,now(),$10,$11::jsonb)
      ON CONFLICT (id) DO UPDATE SET conteudo=EXCLUDED.conteudo,
        categoria=EXCLUDED.categoria,ativo=true,desativado_em=NULL,
        tipo=EXCLUDED.tipo,escopo=EXCLUDED.escopo,principal_id=EXCLUDED.principal_id,
        department_id=EXCLUDED.department_id,approved_by_principal_id=EXCLUDED.approved_by_principal_id,
        approved_at=now(),versao=EXCLUDED.versao,payload=EXCLUDED.payload
    `, [idMemoria, candidato.categoria, declaracao, candidato.tipo, escopo,
      principalId, departmentId, candidato.id, aprovadorId, versao,
      JSON.stringify({
        evidencias: candidato.evidencias || [],
        padrao_falha: candidato.padrao_falha || {},
        padrao_sucesso: candidato.padrao_sucesso || {},
        riscos: candidato.riscos || []
      })]);
    await cliente.query('DELETE FROM nexus.knowledge_triggers WHERE knowledge_id=$1', [idMemoria]);
    for (const gatilho of listaTextual(gatilhos)) {
      await cliente.query(`INSERT INTO nexus.knowledge_triggers (knowledge_id,gatilho)
        VALUES ($1,$2) ON CONFLICT DO NOTHING`, [idMemoria, gatilho]);
    }
  }

  return {
    contexto,
    expirarOfertas,
    listar,
    modo,
    obter,
    oferecer,
    processarRespostaOferta,
    revisar
  };
}

function mapearCandidato(linha) {
  return {
    id: linha.id,
    tipo: linha.tipo,
    categoria: linha.categoria,
    declaracao: linha.declaracao,
    gatilhos: linha.gatilhos || [],
    escopo: linha.escopo,
    targetPrincipalId: linha.target_principal_id || null,
    targetDepartmentId: linha.target_department_id || null,
    confianca: linha.confianca == null ? null : Number(linha.confianca),
    justificativa: linha.justificativa || null,
    evidencias: linha.evidencias || [],
    padraoFalha: linha.padrao_falha || {},
    padraoSucesso: linha.padrao_sucesso || {},
    riscos: linha.riscos || [],
    status: linha.status,
    traceId: linha.trace_id || null,
    criadoEm: linha.criado_em?.toISOString?.() || linha.criado_em,
    atualizadoEm: linha.atualizado_em?.toISOString?.() || linha.atualizado_em,
    expiraOfertaEm: linha.expira_oferta_em?.toISOString?.() || linha.expira_oferta_em || null
  };
}

module.exports = {
  ESCOPOS_MEMORIA,
  ESTADOS_CANDIDATURA,
  MOTIVOS_REVISAO,
  TIPOS_MEMORIA,
  classificarRespostaOferta,
  criarServicoMemoriaGovernada,
  normalizarAvaliacaoMemoria,
  resolverModoAutomacaoMemoria,
  resolverModoPlaybook
};
