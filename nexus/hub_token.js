const { createHmac, timingSafeEqual } = require('node:crypto');

function base64url(valor) {
  return Buffer.from(valor).toString('base64url');
}

function assinarParte(valor, segredo) {
  return createHmac('sha256', segredo).update(valor).digest('base64url');
}

function obterSegredo(opcoes = {}) {
  const segredo = String(opcoes.segredo || process.env.NEXUS_HUB_INTERNAL_SECRET || '');
  if (segredo.length < 32) throw new Error('NEXUS_HUB_INTERNAL_SECRET deve possuir ao menos 32 caracteres.');
  return segredo;
}

function assinarTokenHub(payload, opcoes = {}) {
  const segredo = obterSegredo(opcoes);
  const agora = Math.floor(Date.now() / 1000);
  const cabecalho = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corpo = base64url(JSON.stringify({
    ...payload,
    iss: opcoes.issuer || 'nexus-hub',
    aud: opcoes.audience || 'nexus-api',
    iat: agora,
    exp: agora + Number(opcoes.ttlSeconds || 60)
  }));
  const entrada = `${cabecalho}.${corpo}`;
  return `${entrada}.${assinarParte(entrada, segredo)}`;
}

function verificarTokenHub(token, opcoes = {}) {
  const segredo = obterSegredo(opcoes);
  const partes = String(token || '').split('.');
  if (partes.length !== 3) throw new Error('Token interno invalido.');
  const entrada = `${partes[0]}.${partes[1]}`;
  const esperada = Buffer.from(assinarParte(entrada, segredo));
  const recebida = Buffer.from(partes[2]);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) {
    throw new Error('Assinatura do token interno invalida.');
  }
  const cabecalho = JSON.parse(Buffer.from(partes[0], 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
  const agora = Math.floor(Date.now() / 1000);
  if (cabecalho.alg !== 'HS256' || payload.exp <= agora) throw new Error('Token interno expirado ou invalido.');
  if (payload.iss !== (opcoes.issuer || 'nexus-hub') || payload.aud !== (opcoes.audience || 'nexus-api')) {
    throw new Error('Emissor ou audiencia do token interno invalido.');
  }
  if (!payload.sub) throw new Error('Token interno sem principal.');
  return payload;
}

module.exports = { assinarTokenHub, verificarTokenHub };
