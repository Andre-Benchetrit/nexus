'use strict';

const { randomUUID } = require('node:crypto');

function erroDrenagem() {
  const erro = new Error('A API está concluindo solicitações em andamento para uma atualização. Tente novamente em instantes.');
  erro.codigo = 'DEPLOY_DRAINING';
  erro.status = 503;
  return erro;
}

function criarControladorDrenagem() {
  let drenando = false;
  let iniciadoEm = null;
  const ativos = new Map();
  const observadores = new Set();

  function notificarSeConcluido() {
    if (ativos.size) return;
    for (const observar of observadores) observar();
    observadores.clear();
  }

  function iniciarTurno(metadados = {}) {
    if (drenando) throw erroDrenagem();
    const id = randomUUID();
    ativos.set(id, { id, ...metadados, iniciadoEm: new Date().toISOString() });
    let concluido = false;
    return {
      id,
      atualizar(novosDados = {}) {
        if (!concluido && ativos.has(id)) {
          ativos.set(id, { ...ativos.get(id), ...novosDados });
        }
      },
      concluir() {
        if (concluido) return;
        concluido = true;
        ativos.delete(id);
        notificarSeConcluido();
      }
    };
  }

  function iniciarDrenagem() {
    if (!drenando) {
      drenando = true;
      iniciadoEm = new Date().toISOString();
    }
    return { drenando, iniciadoEm, turnosAtivos: ativos.size };
  }

  async function aguardarConclusao(limiteMs) {
    if (!ativos.size) return { concluido: true, ativos: [] };
    const espera = Math.max(0, Number(limiteMs) || 0);
    return new Promise((resolve) => {
      let finalizado = false;
      const concluir = (resultado) => {
        if (finalizado) return;
        finalizado = true;
        clearTimeout(timer);
        observadores.delete(semAtivos);
        resolve(resultado);
      };
      const semAtivos = () => concluir({ concluido: true, ativos: [] });
      const timer = setTimeout(() => concluir({
        concluido: false,
        ativos: [...ativos.values()].map((item) => ({ ...item }))
      }), espera);
      timer.unref?.();
      observadores.add(semAtivos);
      notificarSeConcluido();
    });
  }

  function estado() {
    return { drenando, iniciadoEm, turnosAtivos: ativos.size };
  }

  return { aguardarConclusao, estado, iniciarDrenagem, iniciarTurno };
}

function limiteDrenagemMs(ambiente = process.env) {
  const railwaySegundos = Number(ambiente.RAILWAY_DEPLOYMENT_DRAINING_SECONDS || 300);
  const margemSegundos = Math.max(1, railwaySegundos - 10);
  const configurado = Number(ambiente.NEXUS_API_DRAIN_TIMEOUT_MS || margemSegundos * 1000);
  return Number.isFinite(configurado) && configurado >= 1_000 ? Math.floor(configurado) : 290_000;
}

async function marcarTurnosInterrompidos(pool, ativos = []) {
  const requestIds = ativos.map((item) => item.requestId).filter(Boolean);
  const turnIds = ativos.map((item) => item.turnId).filter(Boolean);
  if (requestIds.length) {
    await pool.query(`UPDATE nexus.hub_turn_requests SET status='interrupted',
      erro_codigo='DEPLOY_DRAIN_TIMEOUT',concluido_em=now()
      WHERE id=ANY($1::uuid[]) AND status IN ('accepted','running')`, [requestIds]);
  }
  if (turnIds.length) {
    await pool.query(`UPDATE nexus.ai_turns SET status='erro',
      erro_codigo='DEPLOY_DRAIN_TIMEOUT',concluido_em=COALESCE(concluido_em,now())
      WHERE id=ANY($1::uuid[]) AND status='iniciado'`, [turnIds]);
    await pool.query(`UPDATE nexus.llm_calls SET status='erro',
      erro_codigo='DEPLOY_DRAIN_TIMEOUT',concluida_em=COALESCE(concluida_em,now())
      WHERE turn_id=ANY($1::uuid[]) AND status='iniciada'`, [turnIds]);
  }
  return { requests: requestIds.length, turns: turnIds.length };
}

function instalarEncerramentoGracioso(app, { pool, processo = process,
  timeoutMs = limiteDrenagemMs() } = {}) {
  let encerramento = null;
  const encerrar = (sinal) => {
    if (encerramento) return encerramento;
    encerramento = (async () => {
      const inicio = app.nexusDrain.iniciarDrenagem();
      app.log.info({ event: 'api_drain_started', signal: sinal,
        activeTurns: inicio.turnosAtivos, timeoutMs });
      const resultado = await app.nexusDrain.aguardarConclusao(timeoutMs);
      if (!resultado.concluido) {
        const marcados = await marcarTurnosInterrompidos(pool, resultado.ativos);
        app.log.warn({ event: 'api_drain_timeout', signal: sinal,
          activeTurns: resultado.ativos.length, ...marcados });
      } else {
        app.log.info({ event: 'api_drain_completed', signal: sinal });
      }
      await app.close();
      processo.exitCode = resultado.concluido ? 0 : 1;
      return resultado;
    })().catch((erro) => {
      processo.exitCode = 1;
      app.log.error({ event: 'api_graceful_shutdown_failed', signal: sinal, err: erro });
      throw erro;
    });
    return encerramento;
  };
  processo.once('SIGTERM', () => { void encerrar('SIGTERM'); });
  processo.once('SIGINT', () => { void encerrar('SIGINT'); });
  return { encerrar };
}

module.exports = {
  criarControladorDrenagem,
  erroDrenagem,
  instalarEncerramentoGracioso,
  limiteDrenagemMs,
  marcarTurnosInterrompidos
};
