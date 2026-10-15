INSERT INTO nexus.permissions (codigo, descricao) VALUES
  ('mcp.administrar', 'Administrar conectores MCP homologados'),
  ('mcp.laboratorio.testar', 'Executar o laboratorio MCP')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM nexus.roles r
JOIN nexus.permissions p ON p.codigo IN ('mcp.administrar', 'mcp.laboratorio.testar')
WHERE r.slug = 'administrador'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS nexus.mcp_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_key text NOT NULL UNIQUE CHECK (server_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  nome text NOT NULL,
  descricao text,
  transport text NOT NULL CHECK (transport IN ('streamable_http', 'stdio')),
  network_scope text NOT NULL DEFAULT 'public'
    CHECK (network_scope IN ('public', 'railway_private', 'local_dev')),
  enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'disabled'
    CHECK (status IN ('disabled', 'healthy', 'degraded', 'drifted', 'blocked', 'unknown')),
  manifest_version text NOT NULL,
  endpoint_fingerprint char(64),
  observed_server_name text,
  observed_server_version text,
  observed_protocol_version text,
  last_error_code text,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nexus.mcp_tool_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES nexus.mcp_servers(id) ON DELETE CASCADE,
  remote_tool_name text NOT NULL,
  nexus_tool_name text NOT NULL UNIQUE CHECK (nexus_tool_name ~ '^[a-z][a-z0-9_]{2,79}$'),
  capability_code text NOT NULL,
  permission_code text NOT NULL REFERENCES nexus.permissions(codigo),
  description text NOT NULL,
  effect text NOT NULL DEFAULT 'read' CHECK (effect = 'read'),
  exposure text NOT NULL CHECK (exposure IN ('admin_lab', 'assistant')),
  enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('unknown', 'approved', 'disabled', 'drifted', 'blocked', 'missing')),
  input_schema jsonb NOT NULL CHECK (jsonb_typeof(input_schema) = 'object'),
  output_schema jsonb CHECK (output_schema IS NULL OR jsonb_typeof(output_schema) = 'object'),
  input_schema_hash char(64) NOT NULL CHECK (input_schema_hash ~ '^[0-9a-f]{64}$'),
  output_schema_hash char(64) CHECK (output_schema_hash IS NULL OR output_schema_hash ~ '^[0-9a-f]{64}$'),
  observed_input_schema_hash char(64),
  observed_output_schema_hash char(64),
  timeout_ms integer NOT NULL CHECK (timeout_ms BETWEEN 1000 AND 120000),
  max_result_bytes integer NOT NULL CHECK (max_result_bytes BETWEEN 1024 AND 1048576),
  observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (server_id, remote_tool_name)
);

CREATE TABLE IF NOT EXISTS nexus.mcp_health_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES nexus.mcp_servers(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('healthy', 'degraded', 'drifted', 'blocked', 'error')),
  latency_ms integer,
  protocol_version text,
  observed_server_version text,
  discovered_tools integer NOT NULL DEFAULT 0,
  approved_tools integer NOT NULL DEFAULT 0,
  error_code text,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nexus.mcp_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES nexus.mcp_servers(id) ON DELETE RESTRICT,
  binding_id uuid NOT NULL REFERENCES nexus.mcp_tool_bindings(id) ON DELETE RESTRICT,
  principal_id uuid REFERENCES nexus.principals(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES nexus.conversations(id) ON DELETE SET NULL,
  turn_id uuid REFERENCES nexus.ai_turns(id) ON DELETE SET NULL,
  trace_id uuid,
  tool_execution_id uuid REFERENCES nexus.tool_executions(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('started', 'success', 'error', 'blocked', 'cancelled')),
  protocol_version text,
  request_bytes integer,
  response_bytes integer,
  duration_ms integer,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS mcp_servers_status ON nexus.mcp_servers (status, server_key);
CREATE INDEX IF NOT EXISTS mcp_bindings_server_status
  ON nexus.mcp_tool_bindings (server_id, status, enabled);
CREATE INDEX IF NOT EXISTS mcp_health_server_checked
  ON nexus.mcp_health_checks (server_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS mcp_invocations_trace ON nexus.mcp_invocations (trace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_invocations_server_created
  ON nexus.mcp_invocations (server_id, created_at DESC);
