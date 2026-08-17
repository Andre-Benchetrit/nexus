CREATE TABLE IF NOT EXISTS nexus.ai_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id uuid NOT NULL UNIQUE,
  principal_id uuid REFERENCES nexus.principals(id),
  conversation_id uuid REFERENCES nexus.conversations(id) ON DELETE SET NULL,
  department_id uuid REFERENCES nexus.departments(id) ON DELETE SET NULL,
  finalidade text NOT NULL,
  proveniencia text CHECK (proveniencia IN ('conhecimento_geral', 'dados_nexus', 'web', 'arquivo', 'misto')),
  status text NOT NULL CHECK (status IN ('iniciado', 'sucesso', 'erro')) DEFAULT 'iniciado',
  provider_calls integer NOT NULL DEFAULT 0,
  tool_calls integer NOT NULL DEFAULT 0,
  input_tokens_total bigint NOT NULL DEFAULT 0,
  output_tokens_total bigint NOT NULL DEFAULT 0,
  cache_read_tokens_total bigint NOT NULL DEFAULT 0,
  cache_write_tokens_total bigint NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(20,10),
  estimated_cost_brl numeric(20,10),
  pricing_complete boolean NOT NULL DEFAULT false,
  duracao_ms integer,
  erro_codigo text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz
);

CREATE INDEX IF NOT EXISTS ai_turns_data ON nexus.ai_turns (criado_em DESC);
CREATE INDEX IF NOT EXISTS ai_turns_principal_data ON nexus.ai_turns (principal_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS nexus.conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES nexus.conversations(id) ON DELETE CASCADE,
  turn_id uuid REFERENCES nexus.ai_turns(id) ON DELETE SET NULL,
  trace_id uuid,
  papel text NOT NULL CHECK (papel IN ('user', 'assistant')),
  conteudo text NOT NULL,
  proveniencia text CHECK (proveniencia IN ('conhecimento_geral', 'dados_nexus', 'web', 'arquivo', 'misto')),
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_messages_conversa_data
  ON nexus.conversation_messages (conversation_id, criado_em DESC, id DESC);

CREATE TABLE IF NOT EXISTS nexus.pricing_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  servico text NOT NULL,
  modelo text NOT NULL,
  metrica text NOT NULL,
  tamanho_unidade numeric(24,6) NOT NULL CHECK (tamanho_unidade > 0),
  preco_usd numeric(20,10) NOT NULL CHECK (preco_usd >= 0),
  vigente_desde date NOT NULL,
  vigente_ate date,
  versao text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (vigente_ate IS NULL OR vigente_ate >= vigente_desde),
  UNIQUE (provider, servico, modelo, metrica, vigente_desde)
);

CREATE TABLE IF NOT EXISTS nexus.exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  moeda_origem text NOT NULL DEFAULT 'USD',
  moeda_destino text NOT NULL DEFAULT 'BRL',
  competencia date NOT NULL,
  taxa numeric(20,8) NOT NULL CHECK (taxa > 0),
  origem text NOT NULL,
  versao text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (moeda_origem, moeda_destino, competencia)
);

CREATE TABLE IF NOT EXISTS nexus.llm_calls (
  id uuid PRIMARY KEY,
  turn_id uuid NOT NULL REFERENCES nexus.ai_turns(id) ON DELETE CASCADE,
  trace_id uuid NOT NULL,
  parent_call_id uuid,
  fallback_from_call_id uuid,
  principal_id uuid REFERENCES nexus.principals(id),
  conversation_id uuid REFERENCES nexus.conversations(id) ON DELETE SET NULL,
  stage text NOT NULL CHECK (stage IN (
    'generalist_response', 'generalist_decision', 'semantic_router',
    'business_reasoning', 'generalist_final'
  )),
  purpose text NOT NULL,
  provider text NOT NULL,
  modelo text NOT NULL,
  status text NOT NULL CHECK (status IN ('iniciada', 'sucesso', 'erro')) DEFAULT 'iniciada',
  input_tokens bigint,
  output_tokens bigint,
  cache_read_tokens bigint,
  cache_write_tokens bigint,
  usage_provider jsonb NOT NULL DEFAULT '{}'::jsonb,
  composicao_input_estimada jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_id text,
  stop_reason text,
  duracao_ms integer,
  erro_codigo text,
  estimated_cost_usd numeric(20,10),
  estimated_cost_brl numeric(20,10),
  pricing_complete boolean NOT NULL DEFAULT false,
  criada_em timestamptz NOT NULL DEFAULT now(),
  concluida_em timestamptz
);

CREATE INDEX IF NOT EXISTS llm_calls_trace_data ON nexus.llm_calls (trace_id, criada_em, id);
CREATE INDEX IF NOT EXISTS llm_calls_provider_modelo_data
  ON nexus.llm_calls (provider, modelo, criada_em DESC);

CREATE TABLE IF NOT EXISTS nexus.usage_line_items (
  id bigserial PRIMARY KEY,
  turn_id uuid NOT NULL REFERENCES nexus.ai_turns(id) ON DELETE CASCADE,
  call_id uuid NOT NULL,
  tipo_chamada text NOT NULL CHECK (tipo_chamada IN ('llm', 'tool', 'service')),
  provider text,
  servico text NOT NULL,
  modelo text,
  metrica text NOT NULL,
  quantidade numeric(24,6) NOT NULL CHECK (quantidade >= 0),
  pricing_rate_id uuid REFERENCES nexus.pricing_rates(id),
  exchange_rate_id uuid REFERENCES nexus.exchange_rates(id),
  custo_usd numeric(20,10),
  custo_brl numeric(20,10),
  pricing_status text NOT NULL CHECK (pricing_status IN ('priced', 'pricing_missing')),
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_line_items_turno ON nexus.usage_line_items (turn_id, id);

ALTER TABLE nexus.tool_executions
  ADD COLUMN IF NOT EXISTS trace_id uuid,
  ADD COLUMN IF NOT EXISTS turn_id uuid REFERENCES nexus.ai_turns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS call_id uuid,
  ADD COLUMN IF NOT EXISTS parent_call_id uuid,
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS purpose text;

CREATE INDEX IF NOT EXISTS tool_executions_trace_data
  ON nexus.tool_executions (trace_id, criada_em, id);

INSERT INTO nexus.permissions (codigo, descricao) VALUES
  ('ia.conversar', 'Usar a IA generalista'),
  ('ia.nexus.consultar', 'Consultar dados corporativos pela IA generalista')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r CROSS JOIN nexus.permissions p
WHERE r.slug = 'administrador' AND p.codigo IN ('ia.conversar', 'ia.nexus.consultar')
ON CONFLICT DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r JOIN nexus.permissions p
  ON p.codigo IN ('ia.conversar', 'ia.nexus.consultar')
WHERE r.slug IN ('analista', 'gestor')
ON CONFLICT DO NOTHING;
