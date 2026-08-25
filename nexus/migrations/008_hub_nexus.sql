ALTER TABLE nexus.conversations
  ADD COLUMN IF NOT EXISTS titulo text,
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES nexus.departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS composition_level text NOT NULL DEFAULT 'medio',
  ADD COLUMN IF NOT EXISTS fixada_em timestamptz,
  ADD COLUMN IF NOT EXISTS arquivada_em timestamptz,
  ADD COLUMN IF NOT EXISTS ultima_atividade_em timestamptz NOT NULL DEFAULT now();

ALTER TABLE nexus.conversations
  DROP CONSTRAINT IF EXISTS conversations_composition_level_check;

ALTER TABLE nexus.conversations
  ADD CONSTRAINT conversations_composition_level_check
  CHECK (composition_level IN ('baixo', 'medio', 'alto', 'extra_alto'));

UPDATE nexus.conversations
SET ultima_atividade_em = GREATEST(criada_em, atualizada_em)
WHERE ultima_atividade_em IS NULL OR ultima_atividade_em = criada_em;

ALTER TABLE nexus.ai_turns
  ADD COLUMN IF NOT EXISTS requested_composition_level text;

ALTER TABLE nexus.ai_turns
  DROP CONSTRAINT IF EXISTS ai_turns_requested_composition_level_check;

ALTER TABLE nexus.ai_turns
  ADD CONSTRAINT ai_turns_requested_composition_level_check
  CHECK (requested_composition_level IS NULL OR requested_composition_level IN (
    'baixo', 'medio', 'alto', 'extra_alto'
  ));

CREATE TABLE IF NOT EXISTS nexus.hub_turn_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES nexus.conversations(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES nexus.principals(id) ON DELETE CASCADE,
  department_id uuid REFERENCES nexus.departments(id) ON DELETE SET NULL,
  client_request_id text NOT NULL,
  trace_id uuid NOT NULL,
  turn_id uuid REFERENCES nexus.ai_turns(id) ON DELETE SET NULL,
  composition_level text NOT NULL CHECK (composition_level IN (
    'baixo', 'medio', 'alto', 'extra_alto'
  )),
  status text NOT NULL DEFAULT 'accepted' CHECK (status IN (
    'accepted', 'running', 'success', 'error', 'interrupted'
  )),
  erro_codigo text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  iniciado_em timestamptz,
  concluido_em timestamptz,
  UNIQUE (conversation_id, client_request_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS hub_turn_requests_um_ativo_por_conversa
  ON nexus.hub_turn_requests (conversation_id)
  WHERE status IN ('accepted', 'running');

CREATE INDEX IF NOT EXISTS conversations_hub_sidebar
  ON nexus.conversations (principal_id, arquivada_em, fixada_em DESC, ultima_atividade_em DESC);

CREATE INDEX IF NOT EXISTS conversations_hub_department
  ON nexus.conversations (department_id, ultima_atividade_em DESC);

CREATE INDEX IF NOT EXISTS conversation_messages_hub_cursor
  ON nexus.conversation_messages (conversation_id, criado_em ASC, id ASC);

CREATE INDEX IF NOT EXISTS hub_turn_requests_trace
  ON nexus.hub_turn_requests (trace_id);

INSERT INTO nexus.permissions (codigo, descricao) VALUES
  ('hub.acessar', 'Acessar o Hub Nexus'),
  ('ia.composicao.alta', 'Usar composicao de nivel alto'),
  ('ia.composicao.extra_alta', 'Usar composicao de nivel extra-alto'),
  ('custos.consultar.setor', 'Consultar custos de IA do proprio setor'),
  ('custos.consultar.global', 'Consultar custos de IA de toda a organizacao')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r JOIN nexus.permissions p
  ON p.codigo IN ('hub.acessar', 'ia.conversar')
WHERE r.slug = 'usuario'
ON CONFLICT DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r JOIN nexus.permissions p
  ON p.codigo IN ('hub.acessar', 'ia.composicao.alta')
WHERE r.slug = 'analista'
ON CONFLICT DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r JOIN nexus.permissions p
  ON p.codigo IN (
    'hub.acessar', 'ia.composicao.alta', 'ia.composicao.extra_alta',
    'custos.consultar.setor'
  )
WHERE r.slug = 'gestor'
ON CONFLICT DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r JOIN nexus.permissions p
  ON p.codigo = 'hub.acessar'
WHERE r.slug = 'auditor'
ON CONFLICT DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r CROSS JOIN nexus.permissions p
WHERE r.slug = 'administrador'
  AND p.codigo IN (
    'hub.acessar', 'ia.composicao.alta', 'ia.composicao.extra_alta',
    'custos.consultar.setor', 'custos.consultar.global'
  )
ON CONFLICT DO NOTHING;
