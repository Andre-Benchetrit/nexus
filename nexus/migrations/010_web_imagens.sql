ALTER TABLE nexus.llm_calls
  DROP CONSTRAINT IF EXISTS llm_calls_stage_check;

ALTER TABLE nexus.llm_calls
  ADD CONSTRAINT llm_calls_stage_check CHECK (stage IN (
    'generalist_response', 'generalist_decision', 'semantic_router',
    'business_reasoning', 'generalist_final', 'memory_assessment',
    'web_synthesis', 'vision_interpretation'
  ));

CREATE TABLE IF NOT EXISTS nexus.conversation_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES nexus.conversations(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES nexus.principals(id) ON DELETE CASCADE,
  message_id uuid REFERENCES nexus.conversation_messages(id) ON DELETE SET NULL,
  turn_id uuid REFERENCES nexus.ai_turns(id) ON DELETE SET NULL,
  media_type text NOT NULL CHECK (media_type IN ('image/png','image/jpeg','image/webp')),
  storage_key text NOT NULL UNIQUE,
  sha256 char(64) NOT NULL,
  bytes bigint NOT NULL CHECK (bytes > 0),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('processing','ready','error','deleting')),
  error_code text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_attachments_conversa_data
  ON nexus.conversation_attachments (conversation_id, criado_em, id);
CREATE INDEX IF NOT EXISTS conversation_attachments_principal
  ON nexus.conversation_attachments (principal_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS nexus.attachment_cleanup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  proxima_tentativa_em timestamptz NOT NULL DEFAULT now(),
  concluida_em timestamptz
);

INSERT INTO nexus.permissions (codigo, descricao) VALUES
  ('ia.web.pesquisar', 'Pesquisar fontes publicas na internet'),
  ('ia.imagem.processar_local', 'Processar imagens localmente'),
  ('ia.imagem.interpretar', 'Interpretar imagens com provider de IA')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r JOIN nexus.permissions p
  ON p.codigo IN ('ia.web.pesquisar', 'ia.imagem.processar_local')
WHERE r.slug IN ('usuario', 'analista', 'gestor')
ON CONFLICT DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r JOIN nexus.permissions p
  ON p.codigo = 'ia.imagem.interpretar'
WHERE r.slug IN ('analista', 'gestor')
ON CONFLICT DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r CROSS JOIN nexus.permissions p
WHERE r.slug='administrador'
  AND p.codigo IN ('ia.web.pesquisar', 'ia.imagem.processar_local', 'ia.imagem.interpretar')
ON CONFLICT DO NOTHING;
