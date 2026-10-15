const http = require('node:http');
const crypto = require('node:crypto');
const { createMcpHandler } = require('@modelcontextprotocol/server');
const { criarServidorLaboratorio } = require('./laboratorio');

const MAX_BODY = 64 * 1024;

function segredoValido(recebido, esperado) {
  const a = Buffer.from(String(recebido || ''));
  const b = Buffer.from(String(esperado || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function hostsPermitidos(env = process.env) {
  return new Set([
    env.RAILWAY_PUBLIC_DOMAIN,
    env.RAILWAY_PRIVATE_DOMAIN,
    ...(env.NEXUS_MCP_LAB_ALLOWED_HOSTS || '').split(',')
  ].map((item) => String(item || '').trim().toLowerCase()).filter(Boolean));
}

function origensPermitidas(env = process.env) {
  return new Set((env.NEXUS_MCP_LAB_ALLOWED_ORIGINS || '').split(',')
    .map((item) => item.trim()).filter(Boolean));
}

async function lerCorpo(req) {
  const partes = [];
  let total = 0;
  for await (const parte of req) {
    total += parte.length;
    if (total > MAX_BODY) {
      const erro = new Error('Corpo excede o limite.'); erro.status = 413; throw erro;
    }
    partes.push(parte);
  }
  return Buffer.concat(partes);
}

function responder(res, status, corpo, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
}

function criarApp(opcoes = {}) {
  const env = opcoes.env || process.env;
  const token = String(env.NEXUS_MCP_LAB_TOKEN || '');
  if (token.length < 32) throw new Error('NEXUS_MCP_LAB_TOKEN deve possuir ao menos 32 caracteres.');
  const handler = createMcpHandler(() => criarServidorLaboratorio(), {
    legacy: 'reject', responseMode: 'json', maxRequestBodySize: MAX_BODY,
    onerror: (erro) => process.stderr.write(`MCP lab request error: ${erro?.code || erro?.name || 'ERROR'}\n`)
  });
  const allowedHosts = hostsPermitidos(env);
  if (!allowedHosts.size) {
    throw new Error('Configure NEXUS_MCP_LAB_ALLOWED_HOSTS ou um dominio Railway antes de iniciar o laboratorio.');
  }
  const allowedOrigins = origensPermitidas(env);
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/health' && req.method === 'GET') return responder(res, 200, { status: 'ok' });
      if (req.url !== '/mcp' || req.method !== 'POST') return responder(res, 404, { error: 'not_found' });
      const host = String(req.headers.host || '').split(':')[0].toLowerCase();
      if (!allowedHosts.has(host)) return responder(res, 403, { error: 'host_blocked' });
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) return responder(res, 403, { error: 'origin_blocked' });
      const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!segredoValido(bearer, token)) return responder(res, 401, { error: 'unauthorized' }, {
        'www-authenticate': 'Bearer realm="nexus-mcp-lab"'
      });
      if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) {
        return responder(res, 415, { error: 'unsupported_media_type' });
      }
      const corpo = await lerCorpo(req);
      const protocolo = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
      const url = `${protocolo}://${req.headers.host}/mcp`;
      const headers = new Headers();
      for (const [nome, valor] of Object.entries(req.headers)) {
        if (Array.isArray(valor)) valor.forEach((item) => headers.append(nome, item));
        else if (valor != null) headers.set(nome, valor);
      }
      const request = new Request(url, { method: 'POST', headers, body: corpo });
      const response = await handler.fetch(request, {
        authInfo: { token: '[validated]', clientId: 'nexus-api', scopes: ['mcp.laboratorio.testar'] }
      });
      const responseHeaders = {};
      response.headers.forEach((valor, nome) => { responseHeaders[nome] = valor; });
      res.writeHead(response.status, responseHeaders);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (erro) {
      responder(res, Number(erro.status || 500), { error: erro.status === 413 ? 'payload_too_large' : 'internal_error' });
    }
  });
  server.fecharMcp = () => handler.close();
  return server;
}

if (require.main === module) {
  const server = criarApp();
  server.listen(Number(process.env.PORT || 3010), '0.0.0.0');
  const encerrar = async () => {
    await server.fecharMcp();
    server.close(() => process.exit(0));
  };
  process.once('SIGTERM', encerrar);
  process.once('SIGINT', encerrar);
}

module.exports = { criarApp, hostsPermitidos, origensPermitidas, segredoValido };
