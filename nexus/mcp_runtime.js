const dns = require('node:dns').promises;
const net = require('node:net');
const crypto = require('node:crypto');
const Ajv2020 = require('ajv/dist/2020');
const { MCP_MANIFEST, hashSchema, obterServidorManifesto, schemaParaModelo } = require('./mcp_manifest');

const MODOS_MCP = Object.freeze(['off', 'shadow', 'v1']);
const SEGREDO = /(?:password|senha|secret|token|credential|api[_ -]?key|bearer\s+[a-z0-9._-]+)/i;
const INJECAO = /(?:ignore (?:all |previous )?instructions|system prompt|developer message|execute command|BEGIN (?:SYSTEM|DEVELOPER) PROMPT)/i;
const HTML_EXECUTAVEL = /(?:<\s*(?:script|iframe|object|embed|link|meta)\b|\son[a-z]+\s*=|javascript\s*:)/i;

class ErroMcp extends Error {
  constructor(codigo, mensagem, status = 400) {
    super(mensagem);
    this.name = 'ErroMcp';
    this.codigo = codigo;
    this.status = status;
  }
}

function modoMcp(valor = process.env.NEXUS_MCP_MODE || 'off') {
  const modo = String(valor).trim().toLowerCase();
  if (!MODOS_MCP.includes(modo)) throw new ErroMcp('MCP_MODE_INVALID', 'NEXUS_MCP_MODE deve ser off, shadow ou v1.');
  return modo;
}

function inteiro(valor, padrao, minimo, maximo) {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= minimo && numero <= maximo ? numero : padrao;
}

function codigoErro(erro) {
  if (erro?.name === 'AbortError') return 'MCP_CANCELLED';
  const codigo = String(erro?.codigo || erro?.code || 'MCP_ERROR').toUpperCase();
  return /^[A-Z0-9_]{2,80}$/.test(codigo) ? codigo : 'MCP_ERROR';
}

function falhaConexaoRepetivel(erro) {
  const codigo = String(erro?.codigo || erro?.code || '').toUpperCase();
  const mensagem = String(erro?.message || '');
  return ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']
    .includes(codigo) || /fetch failed|socket (?:closed|disconnected)|connection reset/i.test(mensagem);
}

function erroSanitizado(erro) {
  if (erro instanceof ErroMcp) return erro;
  const mensagem = String(erro?.message || 'Falha no servidor MCP.').replace(SEGREDO, '[redigido]').slice(0, 500);
  const convertido = new ErroMcp(codigoErro(erro), mensagem, Number(erro?.status || 502));
  convertido.cause = erro;
  return convertido;
}

function fingerprintEndpoint(url) {
  return crypto.createHash('sha256').update(String(url)).digest('hex');
}

function lerServidoresConfigurados(valor = process.env.NEXUS_MCP_SERVERS_JSON || '[]') {
  let itens;
  try { itens = JSON.parse(valor || '[]'); } catch (_) {
    throw new ErroMcp('MCP_CONFIG_INVALID', 'NEXUS_MCP_SERVERS_JSON contem JSON invalido.');
  }
  if (!Array.isArray(itens)) throw new ErroMcp('MCP_CONFIG_INVALID', 'NEXUS_MCP_SERVERS_JSON deve ser uma lista.');
  const chaves = new Set();
  return itens.map((item) => {
    const key = String(item?.key || '').trim();
    if (!key || chaves.has(key) || !obterServidorManifesto(key)) {
      throw new ErroMcp('MCP_SERVER_NOT_ALLOWLISTED', `Servidor MCP nao homologado ou duplicado: ${key || '(vazio)'}.`);
    }
    chaves.add(key);
    const manifesto = obterServidorManifesto(key);
    return Object.freeze({
      key,
      url: item.url ? String(item.url).trim() : '',
      transport: String(item.transport || 'streamable_http'),
      networkScope: String(item.networkScope || manifesto.networkScope || 'public'),
      allowedPrivateHosts: Object.freeze([...(manifesto.allowedPrivateHosts || [])])
    });
  });
}

function ipPrivado(ip) {
  if (net.isIPv4(ip)) {
    const partes = ip.split('.').map(Number);
    return partes[0] === 10 || partes[0] === 127 || partes[0] === 0 ||
      partes[0] === 169 && partes[1] === 254 || partes[0] === 172 && partes[1] >= 16 && partes[1] <= 31 ||
      partes[0] === 192 && partes[1] === 168 || partes[0] >= 224;
  }
  if (net.isIPv6(ip)) {
    const valor = ip.toLowerCase();
    return valor === '::1' || valor === '::' || valor.startsWith('fc') || valor.startsWith('fd') ||
      valor.startsWith('fe8') || valor.startsWith('fe9') || valor.startsWith('fea') || valor.startsWith('feb');
  }
  return true;
}

async function validarEndpoint(config, { resolverDns = dns.lookup } = {}) {
  let url;
  try { url = new URL(config.url); } catch (_) {
    throw new ErroMcp('MCP_ENDPOINT_INVALID', 'Endpoint MCP invalido.');
  }
  if (url.username || url.password || url.hash) throw new ErroMcp('MCP_ENDPOINT_INVALID', 'Endpoint MCP contem credenciais ou fragmento.');
  if (net.isIP(url.hostname)) throw new ErroMcp('MCP_ENDPOINT_IP_BLOCKED', 'Endpoints MCP por IP literal nao sao permitidos.');
  if (config.networkScope === 'public') {
    if (url.protocol !== 'https:') throw new ErroMcp('MCP_HTTPS_REQUIRED', 'Servidor MCP publico exige HTTPS.');
    const enderecos = await resolverDns(url.hostname, { all: true, verbatim: true });
    if (!enderecos.length || enderecos.some((item) => ipPrivado(item.address))) {
      throw new ErroMcp('MCP_SSRF_BLOCKED', 'O endpoint MCP resolveu para uma rede nao publica.');
    }
  } else if (config.networkScope === 'railway_private') {
    if (!['http:', 'https:'].includes(url.protocol) ||
        !(config.allowedPrivateHosts || []).includes(url.hostname)) {
      throw new ErroMcp('MCP_PRIVATE_ENDPOINT_BLOCKED', 'Endpoint privado deve usar um hostname Railway homologado.');
    }
  } else if (config.networkScope === 'local_dev') {
    if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
      throw new ErroMcp('MCP_LOCAL_ENDPOINT_BLOCKED', 'Endpoint MCP local e permitido somente em desenvolvimento.');
    }
  } else throw new ErroMcp('MCP_NETWORK_SCOPE_INVALID', 'Escopo de rede MCP invalido.');
  return url;
}

function criarFetchSeguro(endpoint, config, dependencias = {}) {
  const baseFetch = dependencias.fetch || globalThis.fetch;
  const resolverDns = dependencias.resolverDns || dns.lookup;
  return async (input, init = {}) => {
    const alvo = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (alvo.origin !== endpoint.origin || alvo.pathname !== endpoint.pathname) {
      throw new ErroMcp('MCP_REDIRECT_BLOCKED', 'O transporte tentou acessar um destino fora da allowlist.');
    }
    await validarEndpoint({ ...config, url: alvo.toString() }, { resolverDns });
    return baseFetch(input, { ...init, redirect: 'error' });
  };
}

function validarConteudoSensivel(valor) {
  const texto = JSON.stringify(valor || {});
  if (SEGREDO.test(texto)) throw new ErroMcp('MCP_DLP_BLOCKED', 'O argumento contem segredo ou credencial e nao pode sair do Nexus.');
}

function limparTextoExterno(texto) {
  const semControles = String(texto || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .slice(0, 200_000);
  const injectionDetected = INJECAO.test(semControles);
  const executableContentDetected = HTML_EXECUTAVEL.test(semControles);
  const limpo = semControles.replace(/https?:\/\/[^\s<>()]+/giu, '[link externo removido]');
  return { text: limpo, injectionDetected, executableContentDetected };
}

function limparEstruturadoExterno(valor, estado = { injectionDetected: false, executableContentDetected: false }) {
  if (typeof valor === 'string') {
    const limpo = limparTextoExterno(valor);
    estado.injectionDetected ||= limpo.injectionDetected;
    estado.executableContentDetected ||= limpo.executableContentDetected;
    return limpo.text;
  }
  if (Array.isArray(valor)) return valor.map((item) => limparEstruturadoExterno(item, estado));
  if (valor && typeof valor === 'object') return Object.fromEntries(
    Object.entries(valor).map(([chave, item]) => [chave, limparEstruturadoExterno(item, estado)])
  );
  return valor;
}

function extrairResultadoSeguro(resultado, limiteBytes) {
  if (resultado?.isError) throw new ErroMcp('MCP_TOOL_ERROR', 'A tool MCP informou falha.', 502);
  const textos = [];
  for (const bloco of resultado?.content || []) {
    if (bloco?.type !== 'text') throw new ErroMcp('MCP_CONTENT_TYPE_BLOCKED', `Conteudo MCP nao permitido: ${bloco?.type || 'desconhecido'}.`);
    textos.push(limparTextoExterno(bloco.text));
  }
  const estadoEstruturado = { injectionDetected: false, executableContentDetected: false };
  const structuredContent = resultado?.structuredContent === undefined
    ? undefined : limparEstruturadoExterno(resultado.structuredContent, estadoEstruturado);
  const injectionDetected = estadoEstruturado.injectionDetected ||
    textos.some((item) => item.injectionDetected);
  if (injectionDetected) {
    throw new ErroMcp('MCP_PROMPT_INJECTION_BLOCKED',
      'A resposta MCP continha instrucoes potencialmente maliciosas e foi bloqueada.', 502);
  }
  const executableContentDetected = estadoEstruturado.executableContentDetected ||
    textos.some((item) => item.executableContentDetected);
  if (executableContentDetected) {
    throw new ErroMcp('MCP_EXECUTABLE_CONTENT_BLOCKED',
      'A resposta MCP continha HTML executavel ou manipuladores de evento e foi bloqueada.', 502);
  }
  const seguro = {
    structuredContent,
    text: textos.map((item) => item.text).join('\n'),
    untrustedExternalEvidence: true,
    injectionDetected: false
  };
  const bytes = Buffer.byteLength(JSON.stringify(seguro));
  if (bytes > limiteBytes) throw new ErroMcp('MCP_RESULT_TOO_LARGE', 'O resultado MCP excedeu o limite homologado.', 502);
  return { value: seguro, bytes };
}

function criarValidador() {
  return new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
}

class McpClientManager {
  constructor(opcoes = {}) {
    this.pool = opcoes.pool || null;
    this.env = opcoes.env || process.env;
    this.mode = modoMcp(opcoes.mode ?? this.env.NEXUS_MCP_MODE);
    this.manifest = opcoes.manifest || MCP_MANIFEST;
    this.configs = opcoes.configs || lerServidoresConfigurados(this.env.NEXUS_MCP_SERVERS_JSON || '[]');
    this.clientFactory = opcoes.clientFactory || null;
    this.fetch = opcoes.fetch;
    this.resolverDns = opcoes.resolverDns;
    this.ajv = opcoes.ajv || criarValidador();
    this.active = new Map();
    this.circuits = new Map();
    this.sessions = new Set();
    this.controllers = new Set();
    this.closed = false;
  }

  config(serverKey) {
    const manifesto = this.manifest.servers.find((item) => item.key === serverKey);
    const config = this.configs.find((item) => item.key === serverKey);
    if (!manifesto || !config) throw new ErroMcp('MCP_SERVER_NOT_CONFIGURED', `Servidor MCP nao configurado: ${serverKey}.`, 404);
    return { manifesto, config };
  }

  async syncManifest() {
    if (!this.pool) return;
    for (const config of this.configs) {
      const manifesto = obterServidorManifesto(config.key);
      const endpoint = config.url || '';
      const servidor = (await this.pool.query(`INSERT INTO nexus.mcp_servers AS atual
        (server_key,nome,descricao,transport,network_scope,manifest_version,endpoint_fingerprint,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'disabled')
        ON CONFLICT (server_key) DO UPDATE SET nome=EXCLUDED.nome,descricao=EXCLUDED.descricao,
          transport=EXCLUDED.transport,network_scope=EXCLUDED.network_scope,
          manifest_version=EXCLUDED.manifest_version,endpoint_fingerprint=EXCLUDED.endpoint_fingerprint,
          enabled=CASE WHEN atual.endpoint_fingerprint IS DISTINCT FROM EXCLUDED.endpoint_fingerprint
            OR atual.manifest_version IS DISTINCT FROM EXCLUDED.manifest_version THEN false ELSE atual.enabled END,
          status=CASE WHEN atual.endpoint_fingerprint IS DISTINCT FROM EXCLUDED.endpoint_fingerprint
            OR atual.manifest_version IS DISTINCT FROM EXCLUDED.manifest_version THEN 'unknown' ELSE atual.status END,
          updated_at=now() RETURNING id`, [manifesto.key, manifesto.name, manifesto.description,
        config.transport, config.networkScope, this.manifest.version,
        endpoint ? fingerprintEndpoint(endpoint) : null])).rows[0];
      for (const tool of manifesto.tools) {
        await this.pool.query(`INSERT INTO nexus.mcp_tool_bindings AS atual
          (server_id,remote_tool_name,nexus_tool_name,capability_code,permission_code,description,
           effect,exposure,input_schema,output_schema,input_schema_hash,output_schema_hash,
           timeout_ms,max_result_bytes,status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,'unknown')
          ON CONFLICT (server_id,remote_tool_name) DO UPDATE SET
           nexus_tool_name=EXCLUDED.nexus_tool_name,capability_code=EXCLUDED.capability_code,
           permission_code=EXCLUDED.permission_code,description=EXCLUDED.description,
           effect=EXCLUDED.effect,exposure=EXCLUDED.exposure,input_schema=EXCLUDED.input_schema,
           output_schema=EXCLUDED.output_schema,input_schema_hash=EXCLUDED.input_schema_hash,
           output_schema_hash=EXCLUDED.output_schema_hash,timeout_ms=EXCLUDED.timeout_ms,
           max_result_bytes=EXCLUDED.max_result_bytes,
           enabled=CASE WHEN atual.input_schema_hash IS DISTINCT FROM EXCLUDED.input_schema_hash
             OR atual.output_schema_hash IS DISTINCT FROM EXCLUDED.output_schema_hash THEN false ELSE atual.enabled END,
           status=CASE WHEN atual.input_schema_hash IS DISTINCT FROM EXCLUDED.input_schema_hash
             OR atual.output_schema_hash IS DISTINCT FROM EXCLUDED.output_schema_hash THEN 'drifted' ELSE atual.status END,
           updated_at=now()`, [servidor.id,
          tool.remoteToolName, tool.nexusToolName, tool.capabilityCode, tool.permissionCode,
          tool.description, tool.effect, tool.exposure, JSON.stringify(tool.inputSchema),
          JSON.stringify(tool.outputSchema), tool.inputSchemaHash, tool.outputSchemaHash,
          tool.timeoutMs, tool.maxResultBytes]);
      }
    }
  }

  async createClient(serverKey) {
    if (this.closed) throw new ErroMcp('MCP_MANAGER_CLOSED', 'O runtime MCP esta encerrando.', 503);
    const { manifesto, config } = this.config(serverKey);
    if (this.clientFactory) return this.clientFactory({ manifesto, config });
    const { Client, StreamableHTTPClientTransport } = require('@modelcontextprotocol/client');
    const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
    const client = new Client({ name: 'nexus', version: '1.0.0' }, {
      capabilities: {}, listMaxPages: 4, inputRequired: { autoFulfill: false },
      versionNegotiation: manifesto.allowedProtocols.length === 1
        ? { mode: { pin: manifesto.allowedProtocols[0] } }
        : { mode: 'auto', probe: { timeoutMs: 3_000, maxRetries: 0 } }
    });
    let transport;
    if (config.transport === 'stdio') {
      if (this.env.NODE_ENV === 'production') throw new ErroMcp('MCP_STDIO_PRODUCTION_BLOCKED', 'stdio MCP e bloqueado em producao.');
      transport = new StdioClientTransport(manifesto.devStdio);
    } else {
      const endpoint = await validarEndpoint(config, { resolverDns: this.resolverDns || dns.lookup });
      const token = String(this.env[manifesto.credentialEnv] || '');
      if (!token) throw new ErroMcp('MCP_CREDENTIAL_MISSING', `Credencial MCP ausente: ${manifesto.credentialEnv}.`, 503);
      transport = new StreamableHTTPClientTransport(endpoint, {
        authProvider: { token: async () => token },
        fetch: criarFetchSeguro(endpoint, config, { fetch: this.fetch, resolverDns: this.resolverDns }),
        requestInit: { redirect: 'error' }, redirectPolicy: 'same-origin', onInsufficientScope: 'throw'
      });
    }
    const timeoutMs = inteiro(this.env.NEXUS_MCP_CONNECT_TIMEOUT_MS, 5_000, 1_000, 30_000);
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { await client.connect(transport, { signal: controller.signal, timeout: timeoutMs }); }
    catch (erro) { await client.close().catch(() => {}); throw erro; }
    finally { clearTimeout(timer); this.controllers.delete(controller); }
    const sessao = {
      client, manifesto, config,
      close: async () => {
        this.sessions.delete(sessao);
        await client.close();
      }
    };
    this.sessions.add(sessao);
    return sessao;
  }

  compareTools(manifesto, tools) {
    const remotas = new Map((tools || []).map((tool) => [tool.name, tool]));
    return manifesto.tools.map((binding) => {
      const remoto = remotas.get(binding.remoteToolName);
      const observedInputHash = remoto ? hashSchema(remoto.inputSchema || {}) : null;
      const observedOutputHash = remoto?.outputSchema ? hashSchema(remoto.outputSchema) : null;
      const status = !remoto ? 'missing' : observedInputHash !== binding.inputSchemaHash ||
        observedOutputHash !== binding.outputSchemaHash ? 'drifted' : 'approved';
      return { binding, remoto, observedInputHash, observedOutputHash, status };
    });
  }

  async check(serverKey) {
    if (this.mode === 'off') throw new ErroMcp('MCP_DISABLED', 'MCP esta desabilitado.', 409);
    await this.syncManifest();
    const inicio = Date.now();
    let sessao;
    try {
      sessao = await this.createClient(serverKey);
      const listado = await sessao.client.listTools();
      const protocol = sessao.client.getNegotiatedProtocolVersion?.() || null;
      const serverVersion = sessao.client.getServerVersion?.() || {};
      const comparacao = this.compareTools(sessao.manifesto, listado.tools);
      const identityDrift = !sessao.manifesto.allowedProtocols.includes(protocol) ||
        !sessao.manifesto.allowedServerNames.includes(serverVersion.name) ||
        !sessao.manifesto.allowedServerVersions.includes(serverVersion.version);
      const drift = identityDrift || comparacao.some((item) => item.status !== 'approved');
      const status = drift ? 'drifted' : 'healthy';
      if (this.pool) await this.recordCheck(serverKey, {
        status, latencyMs: Date.now() - inicio, protocol, serverVersion, comparacao
      });
      this.success(serverKey);
      return { serverKey, status, latencyMs: Date.now() - inicio, protocol,
        server: serverVersion, tools: comparacao.map((item) => ({
          name: item.binding.remoteToolName, nexusToolName: item.binding.nexusToolName,
          status: item.status, inputSchemaHash: item.observedInputHash,
          outputSchemaHash: item.observedOutputHash
        })) };
    } catch (erro) {
      const seguro = erroSanitizado(erro);
      if (seguro.status >= 500) this.failure(serverKey);
      if (this.pool) await this.recordCheckError(serverKey, seguro, Date.now() - inicio);
      throw seguro;
    } finally { await sessao?.close?.().catch(() => {}); }
  }

  async recordCheck(serverKey, dados) {
    const servidor = (await this.pool.query(`UPDATE nexus.mcp_servers SET status=$2,
      observed_server_name=$3,observed_server_version=$4,observed_protocol_version=$5,
      last_error_code=NULL,last_checked_at=now(),updated_at=now() WHERE server_key=$1 RETURNING id`,
    [serverKey, dados.status, dados.serverVersion.name || null, dados.serverVersion.version || null,
      dados.protocol])).rows[0];
    for (const item of dados.comparacao) await this.pool.query(`UPDATE nexus.mcp_tool_bindings SET
      status=$3,observed_input_schema_hash=$4,observed_output_schema_hash=$5,observed_at=now(),
      updated_at=now() WHERE server_id=$1 AND remote_tool_name=$2`, [servidor.id,
      item.binding.remoteToolName, item.status, item.observedInputHash, item.observedOutputHash]);
    await this.pool.query(`INSERT INTO nexus.mcp_health_checks
      (server_id,status,latency_ms,protocol_version,observed_server_version,discovered_tools,approved_tools)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [servidor.id, dados.status, dados.latencyMs,
      dados.protocol, dados.serverVersion.version || null, dados.comparacao.filter((x) => x.remoto).length,
      dados.comparacao.filter((x) => x.status === 'approved').length]);
  }

  async recordCheckError(serverKey, erro, latencyMs) {
    const code = codigoErro(erro);
    const status = code === 'ERA_NEGOTIATION_FAILED' || /PROTOCOL|VERSION/.test(code)
      ? 'drifted' : code.endsWith('_BLOCKED') ? 'blocked' : 'degraded';
    const servidor = (await this.pool.query(`UPDATE nexus.mcp_servers SET status=$3,
      last_error_code=$2,last_checked_at=now(),updated_at=now() WHERE server_key=$1 RETURNING id`,
    [serverKey, code, status])).rows[0];
    if (servidor) await this.pool.query(`INSERT INTO nexus.mcp_health_checks
      (server_id,status,latency_ms,error_code) VALUES ($1,$2,$3,$4)`,
    [servidor.id, status === 'degraded' ? 'error' : status, latencyMs, code]);
  }

  circuit(serverKey) {
    const atual = this.circuits.get(serverKey);
    if (atual?.openUntil > Date.now()) throw new ErroMcp('MCP_CIRCUIT_OPEN', 'Servidor MCP temporariamente suspenso apos falhas consecutivas.', 503);
  }

  failure(serverKey) {
    const agora = Date.now();
    const atual = this.circuits.get(serverKey) || { failures: [], openUntil: 0 };
    atual.failures = atual.failures.filter((item) => agora - item < 120_000).concat(agora);
    if (atual.failures.length >= 3) atual.openUntil = agora + 60_000;
    this.circuits.set(serverKey, atual);
  }

  success(serverKey) { this.circuits.delete(serverKey); }

  acquire(serverKey) {
    const limite = inteiro(this.env.NEXUS_MCP_MAX_CONCURRENCY_PER_SERVER, 4, 1, 32);
    const ativos = this.active.get(serverKey) || 0;
    if (ativos >= limite) throw new ErroMcp('MCP_CONCURRENCY_LIMIT', 'Servidor MCP atingiu o limite de chamadas simultaneas.', 429);
    this.active.set(serverKey, ativos + 1);
    return () => this.active.set(serverKey, Math.max(0, (this.active.get(serverKey) || 1) - 1));
  }

  async criarFerramentasAssistente(contexto = {}) {
    if (this.mode !== 'v1' || !this.pool) return [];
    const linhas = (await this.pool.query(`SELECT s.server_key,b.nexus_tool_name
      FROM nexus.mcp_tool_bindings b
      JOIN nexus.mcp_servers s ON s.id=b.server_id
      WHERE s.enabled=true AND s.status='healthy' AND b.enabled=true
        AND b.status='approved' AND b.exposure='assistant' AND b.effect='read'
      ORDER BY b.nexus_tool_name`)).rows;
    return linhas.flatMap((linha) => {
      const servidor = this.manifest.servers.find((item) => item.key === linha.server_key);
      const binding = servidor?.tools.find((item) =>
        item.nexusToolName === linha.nexus_tool_name && item.exposure === 'assistant');
      if (!binding) return [];
      return [{
        definicao: {
          type: 'function', name: binding.nexusToolName, strict: true,
          description: binding.description, parameters: schemaParaModelo(binding.inputSchema)
        },
        terminal: false,
        mcpBinding: {
          serverKey: servidor.key, permissionCode: binding.permissionCode,
          capabilityCode: binding.capabilityCode, effect: binding.effect
        },
        executar: async (argumentos) => {
          if (!contexto.governanca) {
            throw new ErroMcp('MCP_GOVERNANCE_REQUIRED',
              'Uma tool MCP do assistente exige governanca explicita antes da execucao.', 500);
          }
          const inicio = Date.now();
          const autorizacao = await contexto.governanca.iniciarTool(
            binding.nexusToolName, argumentos, {
              permissionCode: binding.permissionCode,
              camada: 'integracao', provider: 'mcp', modelo: servidor.name,
              traceId: contexto.traceId || null, turnId: contexto.turnId || null,
              parentCallId: contexto.parentCallId || null,
              stage: contexto.stage || 'generalist_response',
              purpose: contexto.purpose || 'external_read'
            }
          );
          try {
            const resultado = await this.invoke(servidor.key, binding.nexusToolName,
              argumentos, { ...contexto, toolExecutionId: autorizacao?.execucaoId || null });
            await contexto.governanca.concluirTool(autorizacao, {
              sucesso: true, duracaoMs: Date.now() - inicio
            });
            return JSON.stringify(resultado);
          } catch (erro) {
            await contexto.governanca.concluirTool(autorizacao, {
              sucesso: false, duracaoMs: Date.now() - inicio, erro
            });
            throw erro;
          }
        }
      }];
    });
  }

  async invoke(serverKey, nexusToolName, args, contexto = {}) {
    if (this.mode !== 'v1') throw new ErroMcp('MCP_EXECUTION_DISABLED', 'Execucao MCP exige NEXUS_MCP_MODE=v1.', 409);
    this.circuit(serverKey);
    const release = this.acquire(serverKey);
    let sessao;
    let invocationId;
    const inicio = Date.now();
    try {
      await this.syncManifest();
      const { manifesto } = this.config(serverKey);
      const binding = manifesto.tools.find((item) => item.nexusToolName === nexusToolName);
      if (!binding || binding.effect !== 'read') throw new ErroMcp('MCP_TOOL_NOT_APPROVED', 'Tool MCP nao homologada.', 403);
      const estado = this.pool ? (await this.pool.query(`SELECT b.*,s.id AS server_id,
        s.enabled AS server_enabled,s.status AS server_status
        FROM nexus.mcp_tool_bindings b JOIN nexus.mcp_servers s ON s.id=b.server_id
        WHERE s.server_key=$1 AND b.nexus_tool_name=$2`, [serverKey, nexusToolName])).rows[0] : {
        enabled: true, server_enabled: true, server_status: 'healthy', status: 'approved', id: null, server_id: null
      };
      if (!estado?.server_enabled || estado.server_status !== 'healthy' ||
          !estado.enabled || estado.status !== 'approved') {
        throw new ErroMcp('MCP_TOOL_DISABLED', 'Tool MCP desabilitada, ausente ou com drift.', 409);
      }
      const requestBytes = Buffer.byteLength(JSON.stringify(args));
      if (this.pool) invocationId = (await this.pool.query(`INSERT INTO nexus.mcp_invocations
        (server_id,binding_id,principal_id,conversation_id,turn_id,trace_id,tool_execution_id,status,request_bytes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'started',$8) RETURNING id`, [estado.server_id, estado.id,
        contexto.principalId || null, contexto.conversationId || null, contexto.turnId || null,
        contexto.traceId || null, contexto.toolExecutionId || null, requestBytes])).rows[0]?.id;
      validarConteudoSensivel(args);
      const validarEntrada = this.ajv.compile(binding.inputSchema);
      if (!validarEntrada(args)) throw new ErroMcp('MCP_ARGUMENT_SCHEMA_INVALID', 'Argumentos MCP nao atendem ao contrato homologado.');
      sessao = await this.createClient(serverKey);
      const listado = await sessao.client.listTools();
      const comparado = this.compareTools(manifesto, listado.tools).find((item) => item.binding.nexusToolName === nexusToolName);
      if (!comparado || comparado.status !== 'approved') {
        if (this.pool) await this.recordCheck(serverKey, { status: 'drifted', latencyMs: Date.now() - inicio,
          protocol: sessao.client.getNegotiatedProtocolVersion?.() || null,
          serverVersion: sessao.client.getServerVersion?.() || {}, comparacao: this.compareTools(manifesto, listado.tools) });
        throw new ErroMcp('MCP_SCHEMA_DRIFT', 'A tool MCP mudou desde a homologacao.', 409);
      }
      const timeoutMs = inteiro(binding.timeoutMs || this.env.NEXUS_MCP_CALL_TIMEOUT_MS, 15_000, 1_000, 120_000);
      const controller = new AbortController();
      this.controllers.add(controller);
      const signal = contexto.signal ? AbortSignal.any([contexto.signal, controller.signal]) : controller.signal;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let bruto;
      try {
        bruto = await sessao.client.callTool({ name: binding.remoteToolName, arguments: args },
          { signal, timeout: timeoutMs });
      } catch (erroChamada) {
        if (!falhaConexaoRepetivel(erroChamada) || signal.aborted) throw erroChamada;
        // Uma unica repeticao e permitida somente quando nenhuma resposta foi
        // recebida e a falha e inequivocamente de conexao. O schema e conferido
        // novamente antes da segunda chamada.
        await sessao.close().catch(() => {});
        sessao = await this.createClient(serverKey);
        const ferramentasRetry = await sessao.client.listTools();
        const bindingRetry = this.compareTools(manifesto, ferramentasRetry.tools)
          .find((item) => item.binding.nexusToolName === nexusToolName);
        if (!bindingRetry || bindingRetry.status !== 'approved') {
          throw new ErroMcp('MCP_SCHEMA_DRIFT', 'A tool MCP mudou durante a repeticao segura.', 409);
        }
        bruto = await sessao.client.callTool({ name: binding.remoteToolName, arguments: args },
          { signal, timeout: timeoutMs });
      }
      finally { clearTimeout(timer); this.controllers.delete(controller); }
      const limite = Math.min(binding.maxResultBytes,
        inteiro(this.env.NEXUS_MCP_MAX_RESULT_BYTES, 262_144, 1024, 1_048_576));
      const seguro = extrairResultadoSeguro(bruto, limite);
      if (binding.outputSchema && seguro.value.structuredContent !== undefined) {
        const validarSaida = this.ajv.compile(binding.outputSchema);
        if (!validarSaida(seguro.value.structuredContent)) throw new ErroMcp('MCP_OUTPUT_SCHEMA_INVALID', 'Resultado MCP violou o contrato homologado.', 502);
      }
      if (this.pool && invocationId) await this.pool.query(`UPDATE nexus.mcp_invocations SET
        status='success',protocol_version=$2,response_bytes=$3,duration_ms=$4,completed_at=now() WHERE id=$1`,
      [invocationId, sessao.client.getNegotiatedProtocolVersion?.() || null, seguro.bytes, Date.now() - inicio]);
      this.success(serverKey);
      return seguro.value;
    } catch (erro) {
      const seguro = erroSanitizado(erro);
      if (seguro.status >= 500) this.failure(serverKey);
      if (this.pool && invocationId) await this.pool.query(`UPDATE nexus.mcp_invocations SET
        status=$2,error_code=$3,duration_ms=$4,completed_at=now() WHERE id=$1`, [invocationId,
        seguro.codigo === 'MCP_CANCELLED' ? 'cancelled' :
          seguro.status === 403 || seguro.codigo.endsWith('_BLOCKED') ? 'blocked' : 'error',
        seguro.codigo, Date.now() - inicio]);
      throw seguro;
    } finally {
      await sessao?.close?.().catch(() => {});
      release();
    }
  }

  async close() {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    await Promise.allSettled([...this.sessions].map((sessao) => sessao.close()));
    this.sessions.clear();
  }
}

module.exports = {
  ErroMcp,
  McpClientManager,
  MODOS_MCP,
  criarFetchSeguro,
  extrairResultadoSeguro,
  falhaConexaoRepetivel,
  fingerprintEndpoint,
  ipPrivado,
  lerServidoresConfigurados,
  limparEstruturadoExterno,
  limparTextoExterno,
  modoMcp,
  validarEndpoint
};
