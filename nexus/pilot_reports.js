const auditoriaOperacional = require('./auditoria_operacional');

const CATEGORIAS_REPORTE = Object.freeze({
  incorrect_or_incomplete: 'Resposta incorreta ou incompleta',
  wrong_data_or_calculation: 'Dados ou cálculo incorretos',
  misunderstood_request: 'Não entendeu o pedido ou contexto',
  wrong_source_or_tool: 'Fonte ou ferramenta inadequada',
  technical_error: 'Erro técnico ou travamento',
  file_image_or_chart: 'Problema com arquivo, imagem ou gráfico',
  usability: 'Interface ou experiência',
  other: 'Outro'
});

const STATUS_REPORTE = Object.freeze({
  new: 'Novo', in_review: 'Em análise', resolved: 'Resolvido', dismissed: 'Descartado'
});

const TRANSICOES = Object.freeze({
  new: new Set(['new', 'in_review']),
  in_review: new Set(['in_review', 'resolved', 'dismissed']),
  resolved: new Set(['resolved', 'in_review']),
  dismissed: new Set(['dismissed', 'in_review'])
});

class ErroReportePiloto extends Error {
  constructor(codigo, mensagem, status = 400) {
    super(mensagem);
    this.name = 'ErroReportePiloto';
    this.codigo = codigo;
    this.status = status;
  }
}

function textoLimitado(valor, minimo, maximo, codigo, mensagem) {
  const texto = String(valor || '').trim();
  if (texto.length < minimo || texto.length > maximo) {
    throw new ErroReportePiloto(codigo, mensagem);
  }
  return texto;
}

function categoriaValida(valor) {
  const categoria = String(valor || '');
  if (!Object.hasOwn(CATEGORIAS_REPORTE, categoria)) {
    throw new ErroReportePiloto('REPORT_CATEGORY_INVALID', 'Selecione um motivo válido para o reporte.');
  }
  return categoria;
}

function statusValido(valor) {
  const status = String(valor || '');
  if (!Object.hasOwn(STATUS_REPORTE, status)) {
    throw new ErroReportePiloto('REPORT_STATUS_INVALID', 'Selecione um estado válido para o reporte.');
  }
  return status;
}

function codificarCursor(linha) {
  if (!linha) return null;
  return Buffer.from(JSON.stringify({ createdAt: linha.created_at, id: linha.id })).toString('base64url');
}

function decodificarCursor(valor) {
  if (!valor) return null;
  try {
    const cursor = JSON.parse(Buffer.from(String(valor), 'base64url').toString('utf8'));
    return cursor?.createdAt && cursor?.id ? cursor : null;
  } catch (_) { return null; }
}

function validarUuidOpcional(valor, codigo = 'REPORT_FILTER_INVALID') {
  if (!valor) return null;
  const texto = String(valor);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(texto)) {
    throw new ErroReportePiloto(codigo, 'Filtro de identificador inválido.');
  }
  return texto;
}

function codigoOperacional(valor, padrao = 'UNEXPECTED_ERROR') {
  const codigo = String(valor || padrao).trim().toUpperCase()
    .replace(/[^A-Z0-9_.:-]/g, '_').slice(0, 120);
  return codigo || padrao;
}

function filtroSql(filtros = {}, alias = 'r') {
  const valores = [];
  const where = [];
  const adicionar = (sql, valor) => {
    valores.push(valor);
    where.push(sql.replace('?', `$${valores.length}`));
  };
  if (filtros.from) {
    const data = new Date(String(filtros.from));
    if (Number.isNaN(data.getTime())) throw new ErroReportePiloto('REPORT_PERIOD_INVALID', 'Período inválido.');
    adicionar(`${alias}.created_at >= ?::timestamptz`, data.toISOString());
  }
  if (filtros.to) {
    const raw = String(filtros.to);
    const data = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59.999Z` : raw);
    if (Number.isNaN(data.getTime())) throw new ErroReportePiloto('REPORT_PERIOD_INVALID', 'Período inválido.');
    adicionar(`${alias}.created_at <= ?::timestamptz`, data.toISOString());
  }
  if (filtros.status) adicionar(`${alias}.status = ?`, statusValido(filtros.status));
  if (filtros.category) adicionar(`${alias}.category = ?`, categoriaValida(filtros.category));
  if (filtros.departmentId) adicionar(`${alias}.department_id = ?::uuid`, validarUuidOpcional(filtros.departmentId));
  if (filtros.principalId) adicionar(`${alias}.reporter_principal_id = ?::uuid`, validarUuidOpcional(filtros.principalId));
  if (filtros.traceId) adicionar(`${alias}.trace_id = ?::uuid`, validarUuidOpcional(filtros.traceId));
  return { where: where.length ? where.join(' AND ') : 'true', valores };
}

function selecionarMensagensVisiveis(linhas) {
  const grupos = new Map();
  for (const linha of linhas.filter((item) => item.papel === 'assistant')) {
    const raiz = linha.retry_root_message_id || linha.id;
    if (!grupos.has(raiz)) grupos.set(raiz, []);
    grupos.get(raiz).push(linha);
  }
  const emitidos = new Set();
  const visiveis = [];
  for (const linha of linhas) {
    if (linha.papel === 'user') { visiveis.push(linha); continue; }
    const raiz = linha.retry_root_message_id || linha.id;
    if (emitidos.has(raiz)) continue;
    emitidos.add(raiz);
    const variantes = grupos.get(raiz) || [linha];
    const selecionada = [...variantes].reverse().find((item) => item.variant_active !== false) || variantes.at(-1);
    visiveis.push(selecionada);
  }
  return visiveis;
}

function mensagemDoSnapshot(linha, reportada) {
  return {
    id: linha.id,
    role: linha.papel,
    content: linha.conteudo,
    turnId: linha.turn_id || null,
    traceId: linha.trace_id || null,
    provenance: linha.proveniencia || null,
    sourceMode: linha.source_mode || 'automatico',
    createdAt: linha.criado_em,
    attachments: linha.attachments || [],
    artifacts: linha.artifacts || [],
    reported: linha.id === reportada
  };
}

function csvCell(valor) {
  let texto = valor == null ? '' : String(valor);
  if (/^[\u0000-\u0020]*[=+\-@]/.test(texto)) texto = `'${texto}`;
  return `"${texto.replace(/"/g, '""')}"`;
}

function linhaPublica(linha) {
  return {
    ...linha,
    categoryLabel: CATEGORIAS_REPORTE[linha.category] || linha.category,
    statusLabel: STATUS_REPORTE[linha.status] || linha.status
  };
}

function criarServicoReportesPiloto({ pool, principalId, exigirAdministracao }) {
  if (!pool || !principalId) throw new Error('Pool e principal são obrigatórios nos reportes do piloto.');

  async function auditar(tipo, reportId, resultado = 'success', metadados = {}) {
    await pool.query(`INSERT INTO nexus.audit_events
      (principal_id,tipo,recurso,resultado,metadados)
      VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [principalId, tipo, reportId || null, resultado, JSON.stringify(metadados)]);
  }

  async function admin(acao) {
    return exigirAdministracao('piloto.problemas.administrar', acao);
  }

  async function criar(conversationId, messageId, dados = {}) {
    if (dados.consent !== true) {
      throw new ErroReportePiloto('REPORT_CONSENT_REQUIRED',
        'Confirme o compartilhamento da conversa antes de enviar o reporte.');
    }
    const categoria = categoriaValida(dados.category);
    const comentario = textoLimitado(dados.comment, 5, 2000, 'REPORT_COMMENT_INVALID',
      'Descreva o problema em uma mensagem de 5 a 2.000 caracteres.');
    const conversa = (await pool.query(`SELECT c.id,c.titulo,c.department_id,d.nome AS department_name,
        p.nome AS reporter_name
      FROM nexus.conversations c
      JOIN nexus.principals p ON p.id=c.principal_id
      LEFT JOIN nexus.departments d ON d.id=c.department_id
      WHERE c.id=$1 AND c.principal_id=$2`, [conversationId, principalId])).rows[0];
    if (!conversa) throw new ErroReportePiloto('REPORT_CONVERSATION_NOT_FOUND',
      'Conversa não encontrada ou não autorizada.', 404);

    const linhas = (await pool.query(`SELECT m.id,m.turn_id,m.trace_id,m.papel,m.conteudo,
        m.proveniencia,m.criado_em,m.retry_root_message_id,m.variant_active,
        COALESCE((SELECT ae.metadados->>'source_mode' FROM nexus.audit_events ae
          WHERE ae.turn_id=m.turn_id AND ae.tipo='source_policy_decision'
          ORDER BY ae.criado_em DESC,ae.id DESC LIMIT 1),'automatico') AS source_mode,
        CASE WHEN m.papel='user' THEN COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'name',a.file_name,'kind',a.kind,'format',a.format,'mediaType',a.media_type,
          'bytes',a.bytes,'pages',a.page_count,'sheets',a.sheet_count
        ) ORDER BY a.criado_em,a.id) FROM nexus.conversation_attachments a
          WHERE a.turn_id=m.turn_id AND a.status='ready'),'[]'::jsonb) ELSE '[]'::jsonb END AS attachments,
        CASE WHEN m.papel='assistant' THEN COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'name',ar.file_name,'title',ar.title,'kind',ar.artifact_kind,'format',ar.format,
          'mediaType',ar.media_type,'bytes',ar.bytes,'version',ar.version_number
        ) ORDER BY ar.criado_em,ar.id) FROM nexus.conversation_artifacts ar
          WHERE ar.turn_id=m.turn_id AND ar.status='ready'),'[]'::jsonb) ELSE '[]'::jsonb END AS artifacts
      FROM nexus.conversation_messages m WHERE m.conversation_id=$1
      ORDER BY m.criado_em,m.id`, [conversationId])).rows;
    const alvo = linhas.find((item) => item.id === messageId);
    if (!alvo || alvo.papel !== 'assistant' || !alvo.trace_id) {
      throw new ErroReportePiloto('REPORT_MESSAGE_NOT_FOUND',
        'A resposta não foi encontrada ou ainda não pode ser reportada.', 404);
    }
    if (alvo.variant_active === false) {
      throw new ErroReportePiloto('REPORT_VARIANT_NOT_ACTIVE',
        'Esta versão não está mais ativa. Reporte a resposta atualmente exibida.', 409);
    }
    const visiveis = selecionarMensagensVisiveis(linhas);
    const snapshot = {
      version: 1,
      capturedAt: new Date().toISOString(),
      conversation: {
        id: conversa.id, title: conversa.titulo || 'Nova conversa',
        departmentId: conversa.department_id, departmentName: conversa.department_name || null
      },
      reportedMessageId: alvo.id,
      messages: visiveis.map((item) => mensagemDoSnapshot(item, alvo.id))
    };
    const inserida = (await pool.query(`INSERT INTO nexus.pilot_reports
      (reporter_principal_id,reporter_name,department_id,department_name,
       conversation_ref,conversation_title,message_ref,turn_ref,trace_id,
       category,comment,conversation_snapshot,report_origin)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,'user')
      ON CONFLICT (reporter_principal_id,message_ref)
        WHERE report_origin='user' AND message_ref IS NOT NULL DO NOTHING
      RETURNING *`, [principalId, conversa.reporter_name, conversa.department_id,
      conversa.department_name || null, conversa.id, conversa.titulo || null, alvo.id,
      alvo.turn_id || null, alvo.trace_id, categoria, comentario, JSON.stringify(snapshot)])).rows[0];
    if (!inserida) {
      const existente = (await pool.query(`SELECT * FROM nexus.pilot_reports
        WHERE reporter_principal_id=$1 AND message_ref=$2`, [principalId, messageId])).rows[0];
      return { ...linhaPublica(existente), duplicate: true };
    }
    await auditar('pilot_report_created', inserida.id, 'success', {
      category: categoria, trace_id: alvo.trace_id, department_id: conversa.department_id
    });
    return { ...linhaPublica(inserida), duplicate: false };
  }

  async function criarAutomatico(conversationId, dados = {}) {
    const traceId = validarUuidOpcional(dados.traceId, 'AUTO_REPORT_TRACE_INVALID');
    const requestId = validarUuidOpcional(dados.requestId, 'AUTO_REPORT_REQUEST_INVALID');
    const turnId = validarUuidOpcional(dados.turnId, 'AUTO_REPORT_TURN_INVALID');
    if (!traceId || !requestId) throw new ErroReportePiloto('AUTO_REPORT_CONTEXT_INVALID',
      'Trace e solicitação são obrigatórios para o reporte automático.');
    const errorCode = codigoOperacional(dados.errorCode);
    const errorStage = codigoOperacional(dados.errorStage, 'PROCESSING');
    const conversa = (await pool.query(`SELECT c.id,c.titulo,c.department_id,d.nome AS department_name,
        p.nome AS reporter_name
      FROM nexus.conversations c
      JOIN nexus.principals p ON p.id=c.principal_id
      LEFT JOIN nexus.departments d ON d.id=c.department_id
      WHERE c.id=$1 AND c.principal_id=$2`, [conversationId, principalId])).rows[0];
    if (!conversa) throw new ErroReportePiloto('REPORT_CONVERSATION_NOT_FOUND',
      'Conversa não encontrada ou não autorizada.', 404);
    // O reporte automático guarda somente metadados. Copiar o conteúdo da conversa
    // continua dependendo do consentimento explícito do fluxo manual.
    const snapshot = {
      version: 1,
      capturedAt: new Date().toISOString(),
      automatic: true,
      contentShared: false,
      conversation: {
        id: conversa.id,
        departmentId: conversa.department_id, departmentName: conversa.department_name || null
      },
      reportedMessageId: null,
      messages: []
    };
    const comentario = `Falha automática registrada em ${errorStage} (${errorCode}).`;
    const inserida = (await pool.query(`INSERT INTO nexus.pilot_reports
      (reporter_principal_id,reporter_name,department_id,department_name,
       conversation_ref,conversation_title,message_ref,turn_ref,trace_id,
       category,comment,conversation_snapshot,consent_confirmed_at,report_origin,
       request_ref,error_code,error_stage)
      VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8,'technical_error',$9,$10::jsonb,
        NULL,'automatic',$11,$12,$13)
      ON CONFLICT (trace_id) WHERE report_origin='automatic' DO NOTHING
      RETURNING *`, [principalId, conversa.reporter_name, conversa.department_id,
      conversa.department_name || null, conversa.id, null,
      turnId, traceId, comentario, JSON.stringify(snapshot), requestId, errorCode,
      errorStage])).rows[0];
    if (!inserida) {
      const existente = (await pool.query(`SELECT * FROM nexus.pilot_reports
        WHERE trace_id=$1 AND report_origin='automatic'`, [traceId])).rows[0];
      return { ...linhaPublica(existente), duplicate: true };
    }
    await auditar('pilot_report_auto_created', inserida.id, 'success', {
      trace_id: traceId, request_id: requestId, error_code: errorCode,
      error_stage: errorStage, department_id: conversa.department_id
    });
    return { ...linhaPublica(inserida), duplicate: false };
  }

  async function listar(filtros = {}) {
    await admin('pilot_reports_list');
    const base = filtroSql(filtros);
    const baseResumo = filtroSql(filtros);
    const limite = Math.min(100, Math.max(1, Number(filtros.limit || 50)));
    const cursor = decodificarCursor(filtros.cursor);
    if (cursor) {
      base.valores.push(cursor.createdAt, cursor.id);
      base.where += ` AND (r.created_at,r.id) < ($${base.valores.length - 1}::timestamptz,$${base.valores.length}::uuid)`;
    }
    const valoresItens = [...base.valores, limite + 1];
    const itens = (await pool.query(`SELECT r.id,r.reporter_principal_id,r.reporter_name,
        r.department_id,r.department_name,r.conversation_ref,r.conversation_title,
        r.message_ref,r.turn_ref,r.trace_id,r.category,r.comment,r.status,r.internal_note,
        r.report_origin,r.request_ref,r.error_code,r.error_stage,
        r.created_at,r.updated_at,r.resolved_at,up.nome AS updated_by_name
      FROM nexus.pilot_reports r
      LEFT JOIN nexus.principals up ON up.id=r.updated_by_principal_id
      WHERE ${base.where} ORDER BY r.created_at DESC,r.id DESC LIMIT $${valoresItens.length}`,
    valoresItens)).rows;
    const temMais = itens.length > limite;
    const pagina = itens.slice(0, limite).map(linhaPublica);
    const resumo = (await pool.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE r.status='new')::int AS new,
        count(*) FILTER (WHERE r.status='in_review')::int AS in_review,
        count(*) FILTER (WHERE r.status='resolved')::int AS resolved,
        count(*) FILTER (WHERE r.status='dismissed')::int AS dismissed
      FROM nexus.pilot_reports r WHERE ${baseResumo.where}`, baseResumo.valores)).rows[0];
    const [usuarios, setores] = await Promise.all([
      pool.query(`SELECT DISTINCT reporter_principal_id AS id,reporter_name AS name
        FROM nexus.pilot_reports WHERE reporter_principal_id IS NOT NULL ORDER BY reporter_name`),
      pool.query(`SELECT DISTINCT department_id AS id,department_name AS name
        FROM nexus.pilot_reports WHERE department_id IS NOT NULL ORDER BY department_name`)
    ]);
    return {
      summary: resumo,
      items: pagina,
      nextCursor: temMais ? codificarCursor(pagina.at(-1)) : null,
      facets: {
        categories: Object.entries(CATEGORIAS_REPORTE).map(([code, label]) => ({ code, label })),
        statuses: Object.entries(STATUS_REPORTE).map(([code, label]) => ({ code, label })),
        users: usuarios.rows, departments: setores.rows
      }
    };
  }

  async function obter(reportId) {
    await admin('pilot_report_view');
    const linha = (await pool.query(`SELECT r.*,up.nome AS updated_by_name
      FROM nexus.pilot_reports r LEFT JOIN nexus.principals up ON up.id=r.updated_by_principal_id
      WHERE r.id=$1`, [reportId])).rows[0];
    if (!linha) throw new ErroReportePiloto('REPORT_NOT_FOUND', 'Reporte não encontrado.', 404);
    let trace = null;
    try { trace = await auditoriaOperacional.trace(pool, linha.trace_id, { global: true, departmentIds: [] }); }
    catch (_) { trace = null; }
    await auditar('pilot_report_viewed', linha.id, 'success', { trace_id: linha.trace_id });
    return { ...linhaPublica(linha), snapshot: linha.conversation_snapshot, trace };
  }

  async function atualizar(reportId, dados = {}) {
    await admin('pilot_report_update');
    const atual = (await pool.query('SELECT * FROM nexus.pilot_reports WHERE id=$1', [reportId])).rows[0];
    if (!atual) throw new ErroReportePiloto('REPORT_NOT_FOUND', 'Reporte não encontrado.', 404);
    const proximo = dados.status == null ? atual.status : statusValido(dados.status);
    if (!TRANSICOES[atual.status]?.has(proximo)) {
      throw new ErroReportePiloto('REPORT_STATUS_TRANSITION_INVALID',
        `Não é possível alterar o estado de ${STATUS_REPORTE[atual.status]} para ${STATUS_REPORTE[proximo]}.`, 409);
    }
    const nota = dados.internalNote == null ? atual.internal_note
      : textoLimitado(dados.internalNote, 0, 4000, 'REPORT_NOTE_INVALID',
        'A nota interna deve ter no máximo 4.000 caracteres.') || null;
    const linha = (await pool.query(`UPDATE nexus.pilot_reports SET status=$2,internal_note=$3,
        updated_by_principal_id=$4,updated_at=now(),
        resolved_at=CASE WHEN $2 IN ('resolved','dismissed') THEN COALESCE(resolved_at,now()) ELSE NULL END
      WHERE id=$1 RETURNING *`, [reportId, proximo, nota, principalId])).rows[0];
    await auditar('pilot_report_updated', linha.id, 'success', {
      from_status: atual.status, to_status: proximo, has_internal_note: Boolean(nota)
    });
    return linhaPublica(linha);
  }

  async function excluir(reportId) {
    await admin('pilot_report_delete');
    const atual = (await pool.query('SELECT id,status,trace_id FROM nexus.pilot_reports WHERE id=$1', [reportId])).rows[0];
    if (!atual) throw new ErroReportePiloto('REPORT_NOT_FOUND', 'Reporte não encontrado.', 404);
    if (!['resolved', 'dismissed'].includes(atual.status)) {
      throw new ErroReportePiloto('REPORT_DELETE_NOT_FINAL',
        'Somente reportes resolvidos ou descartados podem ser excluídos.', 409);
    }
    await pool.query('DELETE FROM nexus.pilot_reports WHERE id=$1', [reportId]);
    await auditar('pilot_report_deleted', reportId, 'success', {
      final_status: atual.status, trace_id: atual.trace_id
    });
    return { id: reportId, deleted: true };
  }

  async function exportar(filtros = {}) {
    await admin('pilot_reports_export');
    const base = filtroSql(filtros);
    const linhas = (await pool.query(`SELECT r.id,r.created_at,r.reporter_name,r.department_name,
        r.category,r.comment,r.status,r.trace_id,r.conversation_ref,r.message_ref,
        r.internal_note,r.updated_at,r.resolved_at,r.report_origin,r.request_ref,
        r.error_code,r.error_stage
      FROM nexus.pilot_reports r WHERE ${base.where}
      ORDER BY r.created_at DESC,r.id DESC LIMIT 10000`, base.valores)).rows;
    const cabecalho = ['id', 'criado_em', 'origem', 'usuario', 'setor', 'categoria', 'comentario',
      'status', 'trace_id', 'request_id', 'conversation_id', 'message_id', 'erro_codigo',
      'erro_etapa', 'nota_interna', 'atualizado_em', 'resolvido_em'];
    const conteudo = [cabecalho.map(csvCell).join(','), ...linhas.map((linha) => [
      linha.id, linha.created_at, linha.report_origin, linha.reporter_name, linha.department_name,
      CATEGORIAS_REPORTE[linha.category] || linha.category, linha.comment,
      STATUS_REPORTE[linha.status] || linha.status, linha.trace_id, linha.request_ref,
      linha.conversation_ref, linha.message_ref, linha.error_code, linha.error_stage,
      linha.internal_note, linha.updated_at, linha.resolved_at
    ].map(csvCell).join(','))].join('\r\n');
    await auditar('pilot_reports_exported', null, 'success', { rows: linhas.length });
    return {
      name: `problemas-piloto-${new Date().toISOString().slice(0, 10)}.csv`,
      content: `\uFEFF${conteudo}`
    };
  }

  return { atualizar, criar, criarAutomatico, excluir, exportar, listar, obter };
}

module.exports = {
  CATEGORIAS_REPORTE,
  ErroReportePiloto,
  STATUS_REPORTE,
  codigoOperacional,
  criarServicoReportesPiloto,
  csvCell,
  selecionarMensagensVisiveis
};
