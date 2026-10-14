const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  criarControladorDrenagem,
  instalarEncerramentoGracioso,
  limiteDrenagemMs,
  marcarTurnosInterrompidos
} = require('../services/nexus-api/graceful_shutdown');

test('drenagem rejeita novos turnos e aguarda os turnos ativos', async () => {
  const controlador = criarControladorDrenagem();
  const turno = controlador.iniciarTurno({ conversationId: 'conversa-1' });
  turno.atualizar({ requestId: 'request-1', turnId: 'turno-1' });
  const inicio = controlador.iniciarDrenagem();

  assert.equal(inicio.turnosAtivos, 1);
  assert.throws(() => controlador.iniciarTurno(), (erro) =>
    erro.codigo === 'DEPLOY_DRAINING' && erro.status === 503);

  const espera = controlador.aguardarConclusao(1_000);
  turno.concluir();
  assert.deepEqual(await espera, { concluido: true, ativos: [] });
  assert.equal(controlador.estado().turnosAtivos, 0);
});

test('limite interno reserva dez segundos para fechar recursos', () => {
  assert.equal(limiteDrenagemMs({ RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '300' }), 290_000);
  assert.equal(limiteDrenagemMs({
    RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '300', NEXUS_API_DRAIN_TIMEOUT_MS: '120000'
  }), 120_000);
  assert.equal(limiteDrenagemMs({ NEXUS_API_DRAIN_TIMEOUT_MS: 'invalido' }), 290_000);
});

test('timeout marca somente solicitacoes e turnos rastreados pela instancia', async () => {
  const consultas = [];
  const pool = { async query(sql, parametros) {
    consultas.push({ sql: sql.replace(/\s+/g, ' ').trim(), parametros });
    return { rows: [], rowCount: 1 };
  } };
  const resultado = await marcarTurnosInterrompidos(pool, [
    { requestId: '00000000-0000-0000-0000-000000000001',
      turnId: '00000000-0000-0000-0000-000000000002' },
    { requestId: null, turnId: null }
  ]);
  assert.deepEqual(resultado, { requests: 1, turns: 1 });
  assert.equal(consultas.length, 3);
  assert.match(consultas[0].sql, /id=ANY\(\$1::uuid\[\]\)/);
  assert.deepEqual(consultas[0].parametros[0], ['00000000-0000-0000-0000-000000000001']);
});

test('encerramento por sinal espera o turno antes de fechar a API', async () => {
  const controlador = criarControladorDrenagem();
  const turno = controlador.iniciarTurno({ requestId: 'request-1' });
  const eventos = [];
  const processo = new EventEmitter();
  processo.exitCode = null;
  const app = {
    nexusDrain: controlador,
    log: {
      info(dados) { eventos.push(dados.event); },
      warn(dados) { eventos.push(dados.event); },
      error(dados) { eventos.push(dados.event); }
    },
    async close() { eventos.push('app_closed'); }
  };
  const pool = { async query() { throw new Error('nao deveria interromper turnos'); } };
  const encerramento = instalarEncerramentoGracioso(app, { pool, processo, timeoutMs: 1_000 });

  const promessa = encerramento.encerrar('SIGTERM');
  await Promise.resolve();
  assert.equal(controlador.estado().drenando, true);
  assert.equal(eventos.includes('app_closed'), false);
  turno.concluir();
  const resultado = await promessa;

  assert.equal(resultado.concluido, true);
  assert.deepEqual(eventos, ['api_drain_started', 'api_drain_completed', 'app_closed']);
  assert.equal(processo.exitCode, 0);
});
