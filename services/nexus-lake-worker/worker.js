#!/usr/bin/env node

const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

const { criarPoolNexus } = require('../../nexus/db');
const { criarLakeStorage } = require('../../nexus/lake_storage');
const { executarPipeline } = require('../../pipeline/executar');

function inteiro(valor, padrao, nome, minimo = 0, maximo = 23) {
  const numero = Number(valor ?? padrao);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${nome} deve ser inteiro entre ${minimo} e ${maximo}.`);
  }
  return numero;
}

function horasIntradiarias(valor = '8,10,12,14,16,18,20,22') {
  const horas = String(valor).split(',').map((item) => item.trim()).filter(Boolean)
    .map((item) => inteiro(item, null, 'NEXUS_LAKE_INTRADAY_HOURS'));
  if (!horas.length) throw new Error('NEXUS_LAKE_INTRADAY_HOURS deve conter ao menos uma hora.');
  return [...new Set(horas)];
}

function horarioNoFuso(data = new Date(), fuso = 'America/Sao_Paulo') {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(data).reduce((acc, item) => ({ ...acc, [item.type]: item.value }), {});
  return { data: `${partes.year}-${partes.month}-${partes.day}`,
    hora: Number(partes.hour), minuto: Number(partes.minute), fuso };
}

function validarTipoManual(valor) {
  if (valor == null) return null;
  const tipo = String(valor).trim().toLowerCase();
  if (!['full', 'intraday'].includes(tipo)) throw new Error('--run deve ser full ou intraday.');
  return tipo;
}

function argumentos(argv = process.argv.slice(2)) {
  const igual = argv.find((item) => item.startsWith('--run='));
  const indice = argv.indexOf('--run');
  const valor = igual ? igual.slice('--run='.length) : indice >= 0 ? argv[indice + 1] : null;
  return { tipoManual: validarTipoManual(valor) };
}

function decidirExecucao(agora = new Date(), env = process.env, tipoManual = null) {
  const manual = validarTipoManual(tipoManual);
  if (manual) {
    return { executar: true, tipo: manual, manual: true,
      horario: horarioNoFuso(agora, env.NEXUS_LAKE_WORKER_TIMEZONE || 'America/Sao_Paulo') };
  }
  if (String(env.NEXUS_LAKE_WORKER_ENABLED || '0') !== '1') {
    return { executar: false, motivo: 'worker_desabilitado' };
  }
  const horario = horarioNoFuso(agora, env.NEXUS_LAKE_WORKER_TIMEZONE || 'America/Sao_Paulo');
  const horaCompleta = inteiro(env.NEXUS_LAKE_FULL_HOUR, 2, 'NEXUS_LAKE_FULL_HOUR');
  if (horario.hora === horaCompleta) return { executar: true, tipo: 'full', horario };
  if (horasIntradiarias(env.NEXUS_LAKE_INTRADAY_HOURS).includes(horario.hora)) {
    return { executar: true, tipo: 'intraday', horario };
  }
  return { executar: false, motivo: 'fora_da_janela', horario };
}

async function executarWorker(opcoes = {}) {
  const env = opcoes.env || process.env;
  // Valida o backend mesmo quando o Worker esta desabilitado. Uma implantacao
  // declarada como S3 nunca deve aparentar saude com credenciais incompletas.
  const storage = opcoes.storage || (opcoes.criarStorage || criarLakeStorage)({ env });
  let pool;
  try {
    const decisao = decidirExecucao(opcoes.agora || new Date(), env, opcoes.tipoManual);
    if (!decisao.executar) return { status: 'ignorado', ...decisao };
    pool = opcoes.pool || (opcoes.criarPool || criarPoolNexus)({ env });
    const resultado = await (opcoes.executarPipeline || executarPipeline)({
      env,
      pool,
      lakeStorage: storage,
      modoControle: 'postgres',
      tipoAgendado: decisao.tipo,
      incluirHoje: decisao.tipo === 'intraday',
      sobreposicaoDias: decisao.tipo === 'intraday' ? 2 : undefined,
      onEvento: (evento) => opcoes.onEvento?.({ tipo: decisao.tipo, evento })
    });
    return { status: resultado.execucao?.status || 'sucesso', tipo: decisao.tipo,
      execucaoId: resultado.execucao?.id || null };
  } finally {
    if (!opcoes.pool && pool) await pool.end();
    if (!opcoes.storage) await storage.fechar?.();
  }
}

async function main() {
  const opcoesCli = argumentos();
  const resultado = await executarWorker({
    tipoManual: opcoesCli.tipoManual,
    onEvento: ({ tipo, evento }) => process.stdout.write(JSON.stringify({
      level: 'info', event: 'lake_update_progress', kind: tipo, message: evento
    }) + '\n')
  });
  process.stdout.write(`${JSON.stringify({ level: 'info', event: 'lake_worker_finished', ...resultado })}\n`);
  if (resultado.status === 'parcial') process.exitCode = 2;
}

if (require.main === module) {
  main().catch((erro) => {
    const codigo = String(erro?.codigo || erro?.code || erro?.name || 'LAKE_WORKER_ERROR')
      .replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'LAKE_WORKER_ERROR';
    process.stderr.write(`${JSON.stringify({ level: 'error', event: 'lake_worker_failed', code: codigo })}\n`);
    process.exitCode = codigo === 'LAKE_PIPELINE_LOCKED' ? 0 : 1;
  });
}

module.exports = { argumentos, decidirExecucao, executarWorker, horarioNoFuso,
  horasIntradiarias, validarTipoManual };
