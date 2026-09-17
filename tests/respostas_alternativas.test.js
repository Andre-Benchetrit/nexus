const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { criarServicoAuditoriaIA } = require('../nexus/auditoria_ia');

function poolVariantes() {
  const raiz = '11111111-1111-4111-8111-111111111111';
  const conversa = '22222222-2222-4222-8222-222222222222';
  const linhas = [{ id: raiz, conversation_id: conversa, papel: 'assistant', conteudo: 'Resposta antiga',
    retry_root_message_id: null, variant_index: 1, variant_active: true }];
  const analises = [{ turn_id: 'turno-antigo', active: true },
    { turn_id: 'turno-novo', active: true }];
  let sequencia = 2;
  const executar = async (sql, valores = []) => {
    if (/^(?:BEGIN|COMMIT|ROLLBACK)/.test(sql.trim())) return { rows: [] };
    if (/SELECT id,COALESCE\(retry_root_message_id,id\) AS raiz/.test(sql)) {
      const item = linhas.find((linha) => linha.id === valores[0] && linha.conversation_id === valores[1]);
      return { rows: item ? [{ id: item.id, raiz: item.retry_root_message_id || item.id }] : [] };
    }
    if (/COALESCE\(MAX\(variant_index\),0\)\+1/.test(sql)) {
      const indices = linhas.filter((linha) => linha.id === valores[1] || linha.retry_root_message_id === valores[1])
        .map((linha) => linha.variant_index);
      return { rows: [{ indice: Math.max(0, ...indices) + 1 }] };
    }
    if (/UPDATE nexus\.conversation_messages SET variant_active=false/.test(sql)) {
      linhas.filter((linha) => linha.id === valores[1] || linha.retry_root_message_id === valores[1])
        .forEach((linha) => { linha.variant_active = false; });
      return { rows: [] };
    }
    if (/INSERT INTO nexus\.conversation_messages/.test(sql) && /retry_root_message_id/.test(sql)) {
      const item = { id: `33333333-3333-4333-8333-${String(sequencia).padStart(12, '0')}`,
        conversation_id: valores[0], papel: 'assistant', conteudo: valores[3],
        retry_root_message_id: valores[6], variant_index: Number(valores[7]), variant_active: true };
      sequencia += 1; linhas.push(item);
      return { rows: [{ id: item.id, retry_root_message_id: item.retry_root_message_id,
        variant_index: item.variant_index, variant_active: true }] };
    }
    if (/UPDATE nexus\.conversation_attachment_analyses caa/.test(sql)) {
      analises.forEach((item) => { item.active = item.turn_id === valores[2]; });
      return { rows: [] };
    }
    throw new Error(`SQL inesperado: ${sql.trim().slice(0, 80)}`);
  };
  const cliente = { query: executar, release() {} };
  return { raiz, conversa, linhas, analises, query: executar, connect: async () => cliente };
}

test('nova tentativa cria variante e somente ela permanece ativa', async () => {
  const pool = poolVariantes();
  const auditoria = criarServicoAuditoriaIA({ pool, principalId: 'principal',
    conversationId: pool.conversa, departamentoId: 'setor', modo: 'enforce' });
  const criada = await auditoria.registrarMensagem({ id: 'turno-novo', traceId: 'trace',
    conversationId: pool.conversa }, { papel: 'assistant', conteudo: 'Resposta repensada',
    proveniencia: 'conhecimento_geral', metadados: { retryRootMessageId: pool.raiz } });
  assert.equal(criada.retry_root_message_id, pool.raiz);
  assert.equal(criada.variant_index, 2);
  assert.equal(pool.linhas.find((item) => item.id === pool.raiz).variant_active, false);
  assert.equal(pool.linhas.at(-1).variant_active, true);
  assert.equal(pool.analises.find((item) => item.turn_id === 'turno-antigo').active, false);
  assert.equal(pool.analises.find((item) => item.turn_id === 'turno-novo').active, true);
});

test('Hub envia retry por identificador sem reenviar pergunta ou anexos', async () => {
  const shell = await fs.readFile(path.join(__dirname, '..', 'hub', 'components', 'hub-shell.tsx'), 'utf8');
  const trecho = shell.match(/async function retryAssistantMessage[\s\S]*?\n  async function selectResponseVariant/)?.[0] || '';
  assert.match(trecho, /retryMessageId: message\.id/);
  assert.doesNotMatch(trecho, /fetch\(attachment\.url/);
  assert.match(shell, /response-variant-switcher/);
  const server = await fs.readFile(path.join(__dirname, '..', 'services', 'nexus-api', 'server.js'), 'utf8');
  assert.match(server, /prepararNovaTentativa/);
  assert.match(server, /if \(!retry\) await anexos\(request\)\.vincularTurno/);
});

test('primeiro turno com arquivo só consolida a rota depois do upload e da resposta', async () => {
  const shell = await fs.readFile(path.join(__dirname, '..', 'hub', 'components', 'hub-shell.tsx'), 'utf8');
  const trecho = shell.match(/async function sendMessage[\s\S]*?\n  async function retryAssistantMessage/)?.[0] || '';
  const upload = trecho.indexOf('await uploadFiles(conversationId, files');
  const inicioTurno = trecho.indexOf('fetch(`/api/nexus/conversations/${conversationId}/turns`');
  const consolidarRota = trecho.indexOf('navigateChat(`/chat/${conversationId}`, true)');
  assert.ok(upload >= 0 && inicioTurno > upload);
  assert.ok(consolidarRota > inicioTurno);
  assert.match(trecho.slice(inicioTurno, consolidarRota), /turnAccepted/);
  assert.doesNotMatch(trecho.slice(0, upload), /navigateChat\(`\/chat\/\$\{conversationId\}`/);
  assert.doesNotMatch(trecho, /router\.replace/);
});

test('proxy do Hub preserva multipart sem herdar aborto transitório do App Router', async () => {
  const proxy = await fs.readFile(path.join(__dirname, '..', 'hub', 'app', 'api', 'nexus',
    '[...path]', 'route.ts'), 'utf8');
  assert.match(proxy, /Buffer\.from\(await request\.arrayBuffer\(\)\)/);
  assert.doesNotMatch(proxy, /signal:\s*request\.signal/);
  assert.match(proxy, /NEXUS_API_INDISPONIVEL/);
  assert.match(proxy, /export const runtime = "nodejs"/);
});

test('proxy de autenticação aceita o maior upload configurado no Nexus', async () => {
  const config = await fs.readFile(path.join(__dirname, '..', 'hub', 'next.config.ts'), 'utf8');
  assert.match(config, /NEXUS_FILES_MAX_BYTES/);
  assert.match(config, /NEXUS_KNOWLEDGE_MAX_BYTES/);
  assert.match(config, /proxyClientMaxBodySize:\s*maiorUploadPermitido \+ mib/);
});

test('migration preserva variantes e seleciona somente uma para o contexto', async () => {
  const sql = await fs.readFile(path.join(__dirname, '..', 'nexus', 'migrations',
    '015_respostas_alternativas.sql'), 'utf8');
  assert.match(sql, /retry_root_message_id/);
  assert.match(sql, /variant_active/);
  assert.match(sql, /variant_index/);
});

test('migration de análises preserva um vínculo por turno de cada variante', async () => {
  const sql = await fs.readFile(path.join(__dirname, '..', 'nexus', 'migrations',
    '017_attachment_analysis_branches.sql'), 'utf8');
  assert.match(sql, /UNIQUE\s*\(analysis_cache_id, conversation_id, message_id, attachment_id, turn_id\)/i);
  assert.match(sql, /ALTER COLUMN storage_key DROP NOT NULL/i);
});
