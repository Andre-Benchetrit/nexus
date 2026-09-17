ALTER TABLE nexus.llm_calls
  DROP CONSTRAINT IF EXISTS llm_calls_stage_check;

ALTER TABLE nexus.llm_calls
  ADD CONSTRAINT llm_calls_stage_check CHECK (stage IN (
    'generalist_response', 'generalist_decision', 'semantic_router',
    'business_reasoning', 'generalist_final', 'memory_assessment',
    'web_synthesis', 'vision_interpretation', 'file_analysis',
    'artifact_generation', 'artifact_validation', 'document_source_delivery'
  ));

ALTER TABLE nexus.conversation_attachments
  DROP CONSTRAINT IF EXISTS conversation_attachments_media_type_check,
  DROP CONSTRAINT IF EXISTS conversation_attachments_width_check,
  DROP CONSTRAINT IF EXISTS conversation_attachments_height_check;

ALTER TABLE nexus.conversation_attachments
  ALTER COLUMN width DROP NOT NULL,
  ALTER COLUMN height DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'image',
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS format text,
  ADD COLUMN IF NOT EXISTS page_count integer,
  ADD COLUMN IF NOT EXISTS sheet_count integer,
  ADD COLUMN IF NOT EXISTS cell_count integer,
  ADD COLUMN IF NOT EXISTS derived_storage_key text,
  ADD COLUMN IF NOT EXISTS classification text NOT NULL DEFAULT 'conversa_privada';

ALTER TABLE nexus.conversation_messages
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE nexus.conversation_attachments
  ADD CONSTRAINT conversation_attachments_media_type_check CHECK (media_type IN (
    'image/png','image/jpeg','image/webp','application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )),
  ADD CONSTRAINT conversation_attachments_kind_check CHECK (kind IN ('image','document')),
  ADD CONSTRAINT conversation_attachments_width_check CHECK (width IS NULL OR width > 0),
  ADD CONSTRAINT conversation_attachments_height_check CHECK (height IS NULL OR height > 0),
  ADD CONSTRAINT conversation_attachments_page_count_check CHECK (page_count IS NULL OR page_count >= 0),
  ADD CONSTRAINT conversation_attachments_sheet_count_check CHECK (sheet_count IS NULL OR sheet_count >= 0),
  ADD CONSTRAINT conversation_attachments_cell_count_check CHECK (cell_count IS NULL OR cell_count >= 0);

CREATE TABLE IF NOT EXISTS nexus.conversation_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES nexus.conversations(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES nexus.principals(id) ON DELETE CASCADE,
  turn_id uuid REFERENCES nexus.ai_turns(id) ON DELETE SET NULL,
  message_id uuid REFERENCES nexus.conversation_messages(id) ON DELETE SET NULL,
  department_id uuid REFERENCES nexus.departments(id) ON DELETE RESTRICT,
  format text NOT NULL CHECK (format IN ('xlsx','docx','pdf')),
  media_type text NOT NULL,
  file_name text NOT NULL,
  title text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  sha256 char(64) NOT NULL,
  bytes bigint NOT NULL CHECK (bytes > 0),
  classification text NOT NULL DEFAULT 'conversa_privada',
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ready'
    CHECK (status IN ('generating','ready','error','deleting')),
  error_code text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversation_artifacts_conversa_data
  ON nexus.conversation_artifacts (conversation_id, criado_em, id);
CREATE INDEX IF NOT EXISTS conversation_artifacts_principal
  ON nexus.conversation_artifacts (principal_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS nexus.artifact_cleanup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  proxima_tentativa_em timestamptz NOT NULL DEFAULT now(),
  concluida_em timestamptz
);

INSERT INTO nexus.permissions (codigo, descricao) VALUES
  ('ia.arquivo.processar_local', 'Validar e extrair arquivos localmente'),
  ('ia.arquivo.analisar', 'Analisar arquivos autorizados com o assistente'),
  ('ia.arquivo.gerar', 'Gerar arquivos privados na conversa'),
  ('documentacao.fonte.baixar', 'Baixar a fonte publicada de uma documentacao autorizada')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r CROSS JOIN nexus.permissions p
WHERE r.slug IN ('usuario','analista','gestor','auditor','administrador')
  AND p.codigo IN (
    'ia.arquivo.processar_local','ia.arquivo.analisar','ia.arquivo.gerar',
    'documentacao.fonte.baixar'
  )
ON CONFLICT DO NOTHING;
