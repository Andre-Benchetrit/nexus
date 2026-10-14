const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  criarServicoReportesPiloto, csvCell, selecionarMensagensVisiveis
} = require('../nexus/pilot_reports');

const raiz = path.resolve(__dirname, '..');

test('migration preserva snapshot e concede administração somente ao administrador', () => {
  const sql = fs.readFileSync(path.join(raiz, 'nexus', 'migrations', '025_pilot_reports.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS nexus\.pilot_reports/);
  assert.match(sql, /conversation_snapshot jsonb NOT NULL/);
  assert.match(sql, /UNIQUE \(reporter_principal_id, message_ref\)/);
  assert.match(sql, /piloto\.problemas\.administrar/);
  assert.match(sql, /WHERE r\.slug = 'administrador'/);
  assert.doesNotMatch(sql, /conversation_ref uuid[^\n]+REFERENCES/);
  assert.doesNotMatch(sql, /message_ref uuid[^\n]+REFERENCES/);
});

test('migration incremental habilita reportes automáticos sem alterar a 025 aplicada', () => {
  const sql = fs.readFileSync(path.join(raiz, 'nexus', 'migrations', '026_pilot_auto_reports.sql'), 'utf8');
  assert.match(sql, /report_origin text NOT NULL DEFAULT 'user'/);
  assert.match(sql, /ALTER COLUMN message_ref DROP NOT NULL/);
  assert.match(sql, /pilot_reports_automatic_trace_unique/);
  assert.match(sql, /WHERE report_origin = 'automatic'/);
});

test('snapshot usa somente a variante ativa e preserva a posição da resposta', () => {
  const mensagens = selecionarMensagensVisiveis([
    { id: 'u1', papel: 'user', criado_em: '2026-10-13T10:00:00Z' },
    { id: 'a1', papel: 'assistant', variant_active: false, criado_em: '2026-10-13T10:01:00Z' },
    { id: 'a2', papel: 'assistant', retry_root_message_id: 'a1', variant_active: true,
      criado_em: '2026-10-13T10:04:00Z' },
    { id: 'u2', papel: 'user', criado_em: '2026-10-13T10:02:00Z' },
    { id: 'a3', papel: 'assistant', variant_active: true, criado_em: '2026-10-13T10:03:00Z' }
  ]);
  assert.deepEqual(mensagens.map((item) => item.id), ['u1', 'a2', 'u2', 'a3']);
});

test('CSV neutraliza formula injection mesmo depois de espaços', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('  +SUM(1,1)'), '"\'  +SUM(1,1)"');
  assert.equal(csvCell('texto normal'), '"texto normal"');
});

test('reporte captura a conversa visível e é idempotente por mensagem', async () => {
  let snapshot;
  let primeira = true;
  const existente = {
    id: 'report-1', reporter_principal_id: 'principal-1', message_ref: 'assistant-2',
    category: 'wrong_data_or_calculation', comment: 'O total apresentado está incorreto.',
    status: 'new', trace_id: '00000000-0000-4000-8000-000000000001'
  };
  const pool = { async query(sql, values = []) {
    if (/FROM nexus\.conversations c/.test(sql)) return { rows: [{
      id: 'conversation-1', titulo: 'Teste do piloto', department_id: 'department-1',
      department_name: 'Comercial', reporter_name: 'Piloto'
    }] };
    if (/FROM nexus\.conversation_messages m/.test(sql)) return { rows: [
      { id: 'user-1', papel: 'user', conteudo: 'Qual foi o total?', criado_em: '2026-10-13T10:00:00Z',
        variant_active: true, attachments: [{ name: 'dados.xlsx', kind: 'document' }], artifacts: [] },
      { id: 'assistant-1', papel: 'assistant', conteudo: 'Resposta antiga', criado_em: '2026-10-13T10:01:00Z',
        trace_id: '00000000-0000-4000-8000-000000000000', variant_active: false,
        attachments: [], artifacts: [] },
      { id: 'assistant-2', papel: 'assistant', conteudo: 'O total é 10.', criado_em: '2026-10-13T10:02:00Z',
        turn_id: 'turn-2', trace_id: existente.trace_id, retry_root_message_id: 'assistant-1',
        variant_active: true, attachments: [], artifacts: [{ name: 'grafico.png', kind: 'image' }] }
    ] };
    if (/INSERT INTO nexus\.pilot_reports/.test(sql)) {
      snapshot = JSON.parse(values[11]);
      if (primeira) { primeira = false; return { rows: [existente] }; }
      return { rows: [] };
    }
    if (/WHERE reporter_principal_id=\$1 AND message_ref=\$2/.test(sql)) return { rows: [existente] };
    if (/INSERT INTO nexus\.audit_events/.test(sql)) return { rows: [] };
    throw new Error(`SQL inesperado: ${sql}`);
  } };
  const service = criarServicoReportesPiloto({ pool, principalId: 'principal-1',
    exigirAdministracao: async () => true });
  const primeiro = await service.criar('conversation-1', 'assistant-2', {
    category: 'wrong_data_or_calculation', comment: 'O total apresentado está incorreto.', consent: true
  });
  assert.equal(primeiro.duplicate, false);
  assert.deepEqual(snapshot.messages.map((item) => item.id), ['user-1', 'assistant-2']);
  assert.equal(snapshot.messages[1].reported, true);
  assert.equal(snapshot.messages[0].attachments[0].name, 'dados.xlsx');
  assert.equal(snapshot.messages[1].artifacts[0].name, 'grafico.png');
  assert.equal(JSON.stringify(snapshot).includes('/api/'), false);

  const repetido = await service.criar('conversation-1', 'assistant-2', {
    category: 'wrong_data_or_calculation', comment: 'O total apresentado está incorreto.', consent: true
  });
  assert.equal(repetido.duplicate, true);
  assert.equal(repetido.id, existente.id);
});

test('reporte exige confirmação explícita do compartilhamento', async () => {
  const service = criarServicoReportesPiloto({ pool: { query: async () => {
    throw new Error('não deve consultar o banco sem consentimento');
  } }, principalId: 'principal-1', exigirAdministracao: async () => true });
  await assert.rejects(() => service.criar('conversation-1', 'assistant-1', {
    category: 'other', comment: 'Algo parece estranho.'
  }), (erro) => erro.codigo === 'REPORT_CONSENT_REQUIRED');
});

test('falha de turno cria reporte automático idempotente sem copiar a conversa', async () => {
  let snapshot = null;
  let primeira = true;
  const existente = {
    id: 'report-auto-1', reporter_principal_id: 'principal-1', message_ref: null,
    category: 'technical_error', comment: 'Falha automática registrada em PROCESSING (RATE_LIMIT).',
    status: 'new', trace_id: '00000000-0000-4000-8000-000000000011',
    report_origin: 'automatic'
  };
  const pool = { async query(sql, values = []) {
    if (/FROM nexus\.conversations c/.test(sql)) return { rows: [{
      id: '00000000-0000-4000-8000-000000000021', titulo: 'Falha do piloto',
      department_id: '00000000-0000-4000-8000-000000000031',
      department_name: 'Comercial', reporter_name: 'Piloto'
    }] };
    if (/INSERT INTO nexus\.pilot_reports/.test(sql)) {
      snapshot = JSON.parse(values[9]);
      if (primeira) { primeira = false; return { rows: [existente] }; }
      return { rows: [] };
    }
    if (/WHERE trace_id=\$1 AND report_origin='automatic'/.test(sql)) return { rows: [existente] };
    if (/INSERT INTO nexus\.audit_events/.test(sql)) return { rows: [] };
    throw new Error(`SQL inesperado: ${sql}`);
  } };
  const service = criarServicoReportesPiloto({ pool, principalId: 'principal-1',
    exigirAdministracao: async () => true });
  const dados = {
    requestId: '00000000-0000-4000-8000-000000000041',
    traceId: existente.trace_id,
    turnId: '00000000-0000-4000-8000-000000000051',
    errorCode: 'rate limit', errorStage: 'processing'
  };
  const criado = await service.criarAutomatico('00000000-0000-4000-8000-000000000021', dados);
  assert.equal(criado.duplicate, false);
  assert.equal(snapshot.contentShared, false);
  assert.deepEqual(snapshot.messages, []);
  const repetido = await service.criarAutomatico('00000000-0000-4000-8000-000000000021', dados);
  assert.equal(repetido.duplicate, true);
});

test('triagem exige permissão administrativa e respeita transições', async () => {
  const autorizacoes = [];
  const pool = { async query(sql, values = []) {
    if (/SELECT \* FROM nexus\.pilot_reports WHERE id=\$1/.test(sql)) {
      return { rows: [{ id: values[0], status: 'new', internal_note: null }] };
    }
    if (/UPDATE nexus\.pilot_reports/.test(sql)) return { rows: [{
      id: values[0], status: values[1], internal_note: values[2], category: 'other'
    }] };
    if (/INSERT INTO nexus\.audit_events/.test(sql)) return { rows: [] };
    throw new Error(`SQL inesperado: ${sql}`);
  } };
  const service = criarServicoReportesPiloto({ pool, principalId: 'admin-1',
    exigirAdministracao: async (permission, action) => autorizacoes.push([permission, action]) });
  const atualizado = await service.atualizar('report-1', { status: 'in_review', internalNote: 'Conferindo.' });
  assert.equal(atualizado.status, 'in_review');
  assert.equal(autorizacoes[0][0], 'piloto.problemas.administrar');
  await assert.rejects(() => service.atualizar('report-1', { status: 'resolved' }),
    (erro) => erro.codigo === 'REPORT_STATUS_TRANSITION_INVALID' && erro.status === 409);
});

test('rotas e UI mantêm reportes separados da auditoria operacional', () => {
  const server = fs.readFileSync(path.join(raiz, 'services', 'nexus-api', 'server.js'), 'utf8');
  const shell = fs.readFileSync(path.join(raiz, 'hub', 'components', 'hub-shell.tsx'), 'utf8');
  const admin = fs.readFileSync(path.join(raiz, 'hub', 'components', 'admin-dashboard.tsx'), 'utf8');
  const audit = fs.readFileSync(path.join(raiz, 'nexus', 'auditoria_operacional.js'), 'utf8');
  assert.match(server, /messages\/:messageId\/reports/);
  assert.match(server, /admin\/pilot-reports\/export/);
  assert.match(shell, /Reportar esta resposta/);
  assert.match(shell, /message-report-button/);
  assert.match(admin, /Problemas do piloto/);
  assert.match(admin, /Conversa preservada/);
  assert.match(server, /criarReporteAutomatico/);
  assert.match(shell, /reportado automaticamente para análise/);
  assert.doesNotMatch(audit, /conversation_snapshot|pilot_reports/);
});
