const test = require('node:test');
const assert = require('node:assert/strict');

const {
  faixaMinimaDaComposicao, normalizarComposicao, resolverIdentidadeMicrosoft,
  slugDoEmail, tituloDaPergunta
} = require('../nexus/hub');
const { assinarTokenHub, verificarTokenHub } = require('../nexus/hub_token');
const {
  criarServidor, statusDoCheckpoint, statusDoEvento, validarResultadoTurno
} = require('../services/nexus-api/server');

test('composicao do hub so eleva a faixa e titulos nao consomem LLM', () => {
  assert.equal(normalizarComposicao('medio'), 'medio');
  assert.equal(faixaMinimaDaComposicao('baixo'), 'auto');
  assert.equal(faixaMinimaDaComposicao('medio'), 'auto');
  assert.equal(faixaMinimaDaComposicao('alto'), 'assistida');
  assert.equal(faixaMinimaDaComposicao('extra_alto'), 'avancada');
  assert.throws(() => normalizarComposicao('economico'), /composicao/i);
  assert.equal(tituloDaPergunta('  Quais   são minhas vendas hoje? '), 'Quais são minhas vendas hoje?');
  assert.ok(tituloDaPergunta('x'.repeat(100)).length <= 64);
  assert.equal(slugDoEmail('Pessoa@FID.COM'), slugDoEmail('pessoa@fid.com'));
});

test('token interno valida assinatura, audiencia e expiracao', () => {
  const segredo = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
  const token = assinarTokenHub({ sub: 'usuario', pid: '123', typ: 'session' }, { segredo });
  const payload = verificarTokenHub(token, { segredo });
  assert.equal(payload.sub, 'usuario');
  assert.equal(payload.pid, '123');
  assert.throws(() => verificarTokenHub(token, { segredo: `${segredo}-diferente` }), /assinatura/i);
});

test('estagios SSE traduzem checkpoints sem expor conteudo tecnico', () => {
  assert.equal(statusDoCheckpoint({ tipo: 'faixa_semantica_decidida' }), 'planejando');
  assert.equal(statusDoCheckpoint({ tipo: 'tool_concluida' }), 'validando_evidencias');
  assert.equal(statusDoEvento('Executando tool analisar_vendas'), 'consultando_dados');
  assert.equal(statusDoEvento('Groq: aguardando resposta'), 'interpretando');
});

test('API recusa concluir turno com mensagem vazia', () => {
  assert.equal(validarResultadoTurno({ texto: 'Resposta válida.' }).texto, 'Resposta válida.');
  assert.throws(
    () => validarResultadoTurno({ texto: '   ' }),
    (erro) => erro.codigo === 'RESPOSTA_VAZIA' && erro.status === 502
  );
});

function criarPoolIdentidade({ cadastrado = true } = {}) {
  const consultas = [];
  const principal = {
    id: '00000000-0000-0000-0000-000000000001', slug: 'maria-12345678', tipo: 'usuario',
    nome: 'Maria', email: 'maria@fid.com', ativo: true
  };
  const cliente = {
    async query(sql) {
      consultas.push(sql.trim().replace(/\s+/g, ' '));
      if (/^BEGIN|^COMMIT|^ROLLBACK/.test(sql.trim())) return { rows: [], rowCount: 0 };
      if (/FROM nexus\.principal_identities/.test(sql)) return { rows: [] };
      if (/WHERE lower\(email\)/.test(sql)) return { rows: cadastrado ? [principal] : [] };
      if (/INSERT INTO nexus\.principal_identities/.test(sql)) return { rows: [], rowCount: 1 };
      if (/SELECT ativo FROM nexus\.principals/.test(sql)) return { rows: [{ ativo: true }] };
      if (/FROM nexus\.permission_overrides/.test(sql)) return { rows: [] };
      if (/SELECT ra\.department_id/.test(sql)) return { rows: [{ department_id: null }] };
      if (/SELECT id,slug,tipo,nome,email,ativo/.test(sql)) return { rows: [principal] };
      if (/FROM nexus\.principal_departments pd/.test(sql)) return { rows: [{
        id: 'setor-1', slug: 'comercial', nome: 'Comercial', ativo: true, papeis: ['analista']
      }] };
      if (/WHERE ra\.principal_id=\$1 AND ra\.department_id IS NULL/.test(sql)) return { rows: [] };
      if (/SELECT DISTINCT p\.codigo/.test(sql)) return { rows: [
        { codigo: 'hub.acessar' }, { codigo: 'ia.conversar' }
      ] };
      return { rows: [], rowCount: 1 };
    },
    release() {}
  };
  return { consultas, connect: async () => cliente, query: cliente.query.bind(cliente) };
}

test('primeiro login Microsoft vincula apenas usuario pre-cadastrado', async () => {
  const pool = criarPoolIdentidade();
  const perfil = await resolverIdentidadeMicrosoft(pool, {
    tenantId: 'tenant-fid', subjectId: 'subject-1', email: 'MARIA@FID.COM'
  }, { tenantId: 'tenant-fid' });
  assert.equal(perfil.slug, 'maria-12345678');
  assert.equal(perfil.setores[0].slug, 'comercial');
  assert.deepEqual(perfil.permissoesGlobais, ['hub.acessar', 'ia.conversar']);
  assert.deepEqual(perfil.setores[0].permissoes, ['hub.acessar', 'ia.conversar']);
  assert.ok(pool.consultas.some((sql) => /INSERT INTO nexus\.principal_identities/.test(sql)));
});

test('primeiro login Microsoft recusa tenant e usuario sem pre-cadastro', async () => {
  await assert.rejects(resolverIdentidadeMicrosoft(criarPoolIdentidade(), {
    tenantId: 'outro', subjectId: 'subject-1', email: 'maria@fid.com'
  }, { tenantId: 'tenant-fid' }), /tenant/i);
  await assert.rejects(resolverIdentidadeMicrosoft(criarPoolIdentidade({ cadastrado: false }), {
    tenantId: 'tenant-fid', subjectId: 'subject-2', email: 'nova@fid.com'
  }, { tenantId: 'tenant-fid' }), /ainda nao foi liberado/i);
});

test('API separa healthcheck publico de rotas autenticadas', async (t) => {
  const pool = {
    async query(sql) {
      if (/SELECT 1/.test(sql)) return { rows: [{ '?column?': 1 }] };
      return { rows: [], rowCount: 0 };
    }
  };
  const agendador = { habilitado: false, iniciar() {}, parar() {} };
  const app = await criarServidor({
    pool, agendador, logger: false,
    lakeStorage: { verificarSaude: async () => ({
      saudavel: true, tipo: 'filesystem', camadas: { bronze: 1, silver: 1, gold: 1 }
    }) }
  });
  t.after(() => app.close());
  const live = await app.inject({ method: 'GET', url: '/health/live' });
  const ready = await app.inject({ method: 'GET', url: '/health/ready' });
  const me = await app.inject({ method: 'GET', url: '/v1/me' });
  assert.equal(live.statusCode, 200);
  assert.equal(ready.statusCode, 200);
  assert.equal(me.statusCode, 401);
  assert.equal(me.json().error.code, 'NAO_AUTENTICADO');
});
