const { executarPipeline } = require('../../pipeline/executar');
const { criarLakeStorage } = require('../../nexus/lake_storage');

const CHAVE_TRAVA_AGENDADOR = 721_913_048;

function partesHorario(data = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(data).reduce((acc, item) => ({ ...acc, [item.type]: item.value }), {});
  return { data: `${partes.year}-${partes.month}-${partes.day}`,
    hora: Number(partes.hour), minuto: Number(partes.minute) };
}

function criarAgendadorLake(opcoes = {}) {
  const { pool } = opcoes;
  const storage = opcoes.storage || criarLakeStorage();
  const habilitado = String(
    opcoes.habilitado ?? process.env.NEXUS_LAKE_SCHEDULER_ENABLED ?? '0'
  ) === '1';
  const minutoIntradiario = Number(process.env.NEXUS_LAKE_INTRADAY_MINUTE || 15);
  let timer = null;
  let executando = false;
  let ultimaHoraIntradiaria = null;
  let ultimaDataCompleta = null;

  async function auditar(tipo, resultado, metadados = {}) {
    await pool.query(`INSERT INTO nexus.audit_events (tipo,recurso,resultado,metadados)
      VALUES ('lake_scheduler',$1,$2,$3::jsonb)`, [tipo, resultado, JSON.stringify(metadados)]);
  }

  async function executar(tipo) {
    if (executando) return { executado: false, motivo: 'execucao_local_ativa' };
    const cliente = await pool.connect();
    executando = true;
    try {
      const trava = (await cliente.query(
        'SELECT pg_try_advisory_lock($1) AS adquirida', [CHAVE_TRAVA_AGENDADOR]
      )).rows[0]?.adquirida;
      if (!trava) return { executado: false, motivo: 'execucao_distribuida_ativa' };
      const inicio = Date.now();
      await auditar(tipo, 'started');
      try {
        const resultado = await executarPipeline({
          raizLake: storage.raizLake,
          incluirHoje: tipo === 'intraday',
          sobreposicaoDias: tipo === 'intraday' ? 2 : undefined,
          onEvento: (evento) => opcoes.onEvento?.({ tipo, evento })
        });
        await auditar(tipo, resultado.status || 'success', {
          duration_ms: Date.now() - inicio,
          stages: resultado.etapas?.length || 0
        });
        return { executado: true, resultado };
      } catch (erro) {
        await auditar(tipo, 'error', {
          duration_ms: Date.now() - inicio,
          error_code: String(erro.code || erro.name || 'LAKE_UPDATE_ERROR').slice(0, 80)
        });
        throw erro;
      } finally {
        await cliente.query('SELECT pg_advisory_unlock($1)', [CHAVE_TRAVA_AGENDADOR]);
      }
    } finally {
      executando = false;
      cliente.release();
    }
  }

  async function verificar(agora = new Date()) {
    if (!habilitado || executando) return;
    const horario = partesHorario(agora);
    const chaveHora = `${horario.data}-${horario.hora}`;
    if (horario.hora === 2 && horario.minuto < 5 && ultimaDataCompleta !== horario.data) {
      ultimaDataCompleta = horario.data;
      await executar('full').catch(() => {});
      return;
    }
    if (horario.minuto >= minutoIntradiario && horario.minuto < minutoIntradiario + 5 &&
      ultimaHoraIntradiaria !== chaveHora) {
      ultimaHoraIntradiaria = chaveHora;
      await executar('intraday').catch(() => {});
    }
  }

  function iniciar() {
    if (!habilitado || timer) return;
    timer = setInterval(() => verificar(), 60_000);
    timer.unref?.();
    verificar().catch(() => {});
  }

  function parar() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { executar, habilitado, iniciar, parar, verificar };
}

module.exports = { CHAVE_TRAVA_AGENDADOR, criarAgendadorLake, partesHorario };
