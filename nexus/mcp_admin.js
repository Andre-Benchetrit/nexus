const crypto = require('node:crypto');
const { criarServicoGovernanca } = require('./governanca');
const { MCP_MANIFEST, obterServidorManifesto } = require('./mcp_manifest');
const { ErroMcp } = require('./mcp_runtime');

function criarServicoMcpAdmin({ pool, ator, manager }) {
  if (!pool || !ator?.principalId || !manager) throw new Error('Dependencias MCP administrativas incompletas.');

  async function auditar(tipo, recurso, resultado, metadados = {}) {
    await pool.query(`INSERT INTO nexus.audit_events
      (principal_id,tipo,recurso,resultado,metadados) VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [ator.principalId, tipo, recurso || null, resultado, JSON.stringify(metadados)]);
  }

  async function sync() { await manager.syncManifest(); }

  async function listar() {
    await sync();
    const servidores = (await pool.query(`SELECT id,server_key,nome,descricao,transport,network_scope,
      enabled,status,manifest_version,observed_server_name,observed_server_version,
      observed_protocol_version,last_error_code,last_checked_at,created_at,updated_at
      FROM nexus.mcp_servers ORDER BY nome`)).rows;
    if (!servidores.length) return [];
    const bindings = (await pool.query(`SELECT b.id,b.server_id,b.remote_tool_name,b.nexus_tool_name,
      b.capability_code,b.permission_code,b.description,b.effect,b.exposure,b.enabled,b.status,
      b.input_schema_hash,b.output_schema_hash,b.observed_input_schema_hash,
      b.observed_output_schema_hash,b.timeout_ms,b.max_result_bytes,b.observed_at
      FROM nexus.mcp_tool_bindings b WHERE b.server_id=ANY($1::uuid[])
      ORDER BY b.remote_tool_name`, [servidores.map((item) => item.id)])).rows;
    return servidores.map((server) => ({ ...server,
      tools: bindings.filter((item) => item.server_id === server.id) }));
  }

  async function obter(serverId) {
    const itens = await listar();
    const item = itens.find((server) => server.id === serverId);
    if (!item) throw new ErroMcp('MCP_SERVER_NOT_FOUND', 'Servidor MCP nao encontrado.', 404);
    item.healthChecks = (await pool.query(`SELECT status,latency_ms,protocol_version,
      observed_server_version,discovered_tools,approved_tools,error_code,checked_at
      FROM nexus.mcp_health_checks WHERE server_id=$1 ORDER BY checked_at DESC LIMIT 20`, [serverId])).rows;
    return item;
  }

  async function atualizarServidor(serverId, dados = {}) {
    if (typeof dados.enabled !== 'boolean' || Object.keys(dados).some((key) => key !== 'enabled')) {
      throw new ErroMcp('MCP_UPDATE_INVALID', 'Somente o campo enabled pode ser alterado.');
    }
    const atual = (await pool.query('SELECT id,server_key FROM nexus.mcp_servers WHERE id=$1', [serverId])).rows[0];
    if (!atual || !obterServidorManifesto(atual.server_key)) {
      throw new ErroMcp('MCP_SERVER_NOT_FOUND', 'Servidor MCP nao encontrado na allowlist.', 404);
    }
    const linha = (await pool.query(`UPDATE nexus.mcp_servers SET enabled=$2,
      status=CASE WHEN $2 THEN CASE WHEN status='disabled' THEN 'unknown' ELSE status END ELSE 'disabled' END,
      updated_at=now() WHERE id=$1 RETURNING id,server_key,enabled,status`, [serverId, dados.enabled])).rows[0];
    await auditar('mcp_server_updated', linha.server_key, 'success', { enabled: linha.enabled });
    return linha;
  }

  async function atualizarTool(serverId, toolName, dados = {}) {
    if (typeof dados.enabled !== 'boolean' || Object.keys(dados).some((key) => key !== 'enabled')) {
      throw new ErroMcp('MCP_UPDATE_INVALID', 'Somente o campo enabled pode ser alterado.');
    }
    const atual = (await pool.query(`SELECT b.id,b.remote_tool_name,b.nexus_tool_name,b.enabled,b.status,s.server_key
      FROM nexus.mcp_tool_bindings b JOIN nexus.mcp_servers s ON s.id=b.server_id
      WHERE s.id=$1 AND b.remote_tool_name=$2`, [serverId, toolName])).rows[0];
    const manifesto = atual && obterServidorManifesto(atual.server_key);
    const homologada = manifesto?.tools.some((tool) => tool.remoteToolName === toolName);
    if (!atual || !homologada) throw new ErroMcp('MCP_TOOL_NOT_FOUND', 'Tool MCP nao encontrada na allowlist.', 404);
    if (dados.enabled && atual.status !== 'approved') {
      throw new ErroMcp('MCP_TOOL_NOT_APPROVED', 'Verifique o servidor e resolva o drift antes de habilitar a tool.', 409);
    }
    const linha = (await pool.query(`UPDATE nexus.mcp_tool_bindings SET enabled=$2,updated_at=now()
      WHERE id=$1 RETURNING id,remote_tool_name,nexus_tool_name,enabled,status`,
    [atual.id, dados.enabled])).rows[0];
    linha.server_key = atual.server_key;
    await auditar('mcp_tool_updated', `${linha.server_key}:${toolName}`, 'success', { enabled: linha.enabled });
    return linha;
  }

  async function verificar(serverId) {
    await sync();
    const servidor = (await pool.query('SELECT server_key FROM nexus.mcp_servers WHERE id=$1', [serverId])).rows[0];
    if (!servidor || !obterServidorManifesto(servidor.server_key)) {
      throw new ErroMcp('MCP_SERVER_NOT_FOUND', 'Servidor MCP nao encontrado na allowlist.', 404);
    }
    try {
      const resultado = await manager.check(servidor.server_key);
      await auditar('mcp_health_check', servidor.server_key, resultado.status, {
        latency_ms: resultado.latencyMs, protocol: resultado.protocol,
        tools: resultado.tools.map((item) => ({ name: item.name, status: item.status }))
      });
      return resultado;
    } catch (erro) {
      await auditar('mcp_health_check', servidor.server_key, 'error', { error_code: erro.codigo || 'MCP_ERROR' });
      throw erro;
    }
  }

  async function executarLaboratorio(dados = {}) {
    const codigo = String(dados.codigo || 'LAB-001').trim();
    const traceId = crypto.randomUUID();
    const governanca = criarServicoGovernanca({ pool, principalId: ator.principalId,
      principalSlug: ator.principalSlug, modo: 'enforce', semConversa: true });
    const inicio = Date.now();
    const execucao = await governanca.iniciarTool('mcp_consultar_item_laboratorio', { codigo }, {
      permissionCode: 'mcp.laboratorio.testar', camada: 'integracao', provider: 'mcp',
      modelo: 'laboratorio', traceId, stage: 'mcp_lab', purpose: 'admin_lab_test'
    });
    try {
      const resultado = await manager.invoke('laboratorio', 'mcp_consultar_item_laboratorio', { codigo }, {
        principalId: ator.principalId, traceId, toolExecutionId: execucao.execucaoId
      });
      await governanca.concluirTool(execucao, { sucesso: true, duracaoMs: Date.now() - inicio });
      await auditar('mcp_lab_test', 'laboratorio', 'success', { trace_id: traceId });
      return { traceId, ...resultado };
    } catch (erro) {
      await governanca.concluirTool(execucao, { sucesso: false, duracaoMs: Date.now() - inicio, erro });
      await auditar('mcp_lab_test', 'laboratorio', 'error', { trace_id: traceId, error_code: erro.codigo || 'MCP_ERROR' });
      throw erro;
    }
  }

  return {
    alterarBinding: atualizarTool,
    alterarServidor: atualizarServidor,
    atualizarServidor,
    atualizarTool,
    executarLaboratorio,
    listar,
    listarServidores: listar,
    obter,
    obterServidor: obter,
    sync,
    verificar,
    verificarServidor: verificar
  };
}

module.exports = { criarServicoMcpAdmin, MCP_MANIFEST };
