const FUSO_NEGOCIO = 'America/Sao_Paulo';

const CAMPOS_INSTANTE = new Set([
  'ultimaConstrucao',
  'atualizado_em',
  'estoque_atualizado_em',
  'processado_em',
  'extraido_em',
  'dt_extracao',
  'dt_alteracao',
  'dt_atualizacao',
  'dt_cadastro',
  'dt_registro',
  'datamodificacao',
  'datamodificacaoserver',
  'inicio',
  'fim'
]);

function campoRepresentaInstante(campo) {
  const nome = String(campo || '');
  return CAMPOS_INSTANTE.has(nome) ||
    /(?:Atualizado|Processado|Extraido|Modificado|Criado|Iniciado|Finalizado)Em$/.test(nome) ||
    /(?:atualizado|processado|extraido|modificado|criado|iniciado|finalizado)_em$/i.test(nome) ||
    /_timestamp$/i.test(nome) ||
    /^dthr_/i.test(nome);
}

function instanteIso(valor) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
    String(valor || '')
  );
}

function partesNoFuso(data, fuso = FUSO_NEGOCIO) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(data);
  return Object.fromEntries(partes.map(({ type, value }) => [type, value]));
}

function formatarOffset(minutos) {
  const sinal = minutos >= 0 ? '+' : '-';
  const absoluto = Math.abs(minutos);
  const horas = String(Math.floor(absoluto / 60)).padStart(2, '0');
  const minutosRestantes = String(absoluto % 60).padStart(2, '0');
  return `${sinal}${horas}:${minutosRestantes}`;
}

function converterInstanteParaFuso(valor, fuso = FUSO_NEGOCIO) {
  if (!instanteIso(valor)) return valor;
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return valor;
  const partes = partesNoFuso(data, fuso);
  const localComoUtc = Date.UTC(
    Number(partes.year),
    Number(partes.month) - 1,
    Number(partes.day),
    Number(partes.hour),
    Number(partes.minute),
    Number(partes.second)
  );
  const instanteSemMilissegundos = Math.floor(data.getTime() / 1000) * 1000;
  const offsetMinutos = Math.round((localComoUtc - instanteSemMilissegundos) / 60000);
  const milissegundos = String(data.getUTCMilliseconds()).padStart(3, '0');
  return `${partes.year}-${partes.month}-${partes.day}T` +
    `${partes.hour}:${partes.minute}:${partes.second}.${milissegundos}` +
    formatarOffset(offsetMinutos);
}

function normalizarTimestampSaida(campo, valor) {
  return campoRepresentaInstante(campo) && instanteIso(valor)
    ? converterInstanteParaFuso(valor)
    : valor;
}

function formatarInstanteParaUsuario(valor, fuso = FUSO_NEGOCIO) {
  const local = converterInstanteParaFuso(valor, fuso);
  const resultado = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(local));
  if (!resultado) return valor;
  const [, ano, mes, dia, hora, minuto] = resultado;
  return `${dia}/${mes}/${ano} às ${hora}:${minuto}`;
}

module.exports = {
  FUSO_NEGOCIO,
  campoRepresentaInstante,
  converterInstanteParaFuso,
  formatarInstanteParaUsuario,
  instanteIso,
  normalizarTimestampSaida
};
