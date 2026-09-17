CREATE TABLE IF NOT EXISTS nexus.attachment_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES nexus.principals(id) ON DELETE CASCADE,
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  media_type text NOT NULL,
  format text NOT NULL CHECK (format IN ('png','jpeg','webp','pdf','docx','xlsx')),
  bytes bigint NOT NULL CHECK (bytes > 0),
  source_storage_key text NOT NULL UNIQUE,
  ir_storage_key text UNIQUE,
  parquet_storage_key text UNIQUE,
  ir_sha256 char(64) CHECK (ir_sha256 IS NULL OR ir_sha256 ~ '^[0-9a-f]{64}$'),
  ir_version text,
  classification text NOT NULL DEFAULT 'conversa_privada',
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(safe_metadata) = 'object'),
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','ready','error','deleting')),
  error_code text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (principal_id, sha256),
  CHECK (
    status <> 'ready' OR
    (ir_storage_key IS NOT NULL AND ir_sha256 IS NOT NULL AND ir_version IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS attachment_assets_principal_status
  ON nexus.attachment_assets (principal_id, status, atualizado_em DESC);

CREATE TABLE IF NOT EXISTS nexus.attachment_asset_index (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES nexus.attachment_assets(id) ON DELETE CASCADE,
  ir_version text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  locator_type text NOT NULL CHECK (locator_type IN (
    'page','section','table','sheet','range','cell','image','block'
  )),
  locator jsonb NOT NULL CHECK (jsonb_typeof(locator) = 'object'),
  locator_hash char(64) NOT NULL CHECK (locator_hash ~ '^[0-9a-f]{64}$'),
  term_hashes text[] NOT NULL DEFAULT '{}'::text[],
  embedding vector(384),
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(safe_metadata) = 'object'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, ir_version, locator_hash)
);

CREATE INDEX IF NOT EXISTS attachment_asset_index_asset_ordinal
  ON nexus.attachment_asset_index (asset_id, ir_version, ordinal);
CREATE INDEX IF NOT EXISTS attachment_asset_index_terms
  ON nexus.attachment_asset_index USING gin (term_hashes);
CREATE INDEX IF NOT EXISTS attachment_asset_index_embedding
  ON nexus.attachment_asset_index USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE TABLE IF NOT EXISTS nexus.attachment_analysis_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES nexus.principals(id) ON DELETE CASCADE,
  department_id uuid REFERENCES nexus.departments(id) ON DELETE SET NULL,
  signature char(64) NOT NULL CHECK (signature ~ '^[0-9a-f]{64}$'),
  question_hash char(64) NOT NULL CHECK (question_hash ~ '^[0-9a-f]{64}$'),
  asset_hashes char(64)[] NOT NULL CHECK (
    cardinality(asset_hashes) > 0 AND cardinality(asset_hashes) <= 32
  ),
  asset_set_hash char(64) NOT NULL CHECK (asset_set_hash ~ '^[0-9a-f]{64}$'),
  intent text NOT NULL CHECK (intent IN (
    'local_file','mixed_corporate','documentation','web','artifact'
  )),
  depth text NOT NULL CHECK (depth IN ('baixo','medio','alto','extra_alto')),
  analyze_visual boolean NOT NULL DEFAULT false,
  analyzer_version text NOT NULL,
  result_storage_key text UNIQUE,
  result_sha256 char(64) CHECK (result_sha256 IS NULL OR result_sha256 ~ '^[0-9a-f]{64}$'),
  result_bytes bigint CHECK (result_bytes IS NULL OR result_bytes > 0),
  classification text NOT NULL DEFAULT 'conversa_privada',
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(safe_metadata) = 'object'),
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','ready','error','deleting')),
  error_code text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  UNIQUE (principal_id, signature),
  CHECK (
    status <> 'ready' OR
    (result_storage_key IS NOT NULL AND result_sha256 IS NOT NULL AND result_bytes IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS attachment_analysis_cache_lookup
  ON nexus.attachment_analysis_cache (principal_id, signature)
  WHERE status = 'ready';
CREATE INDEX IF NOT EXISTS attachment_analysis_cache_expiration
  ON nexus.attachment_analysis_cache (expires_at)
  WHERE status = 'ready' AND expires_at IS NOT NULL;

ALTER TABLE nexus.conversation_attachments
  ADD COLUMN IF NOT EXISTS asset_id uuid,
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES nexus.departments(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_attachments_asset_id_fkey'
      AND conrelid = 'nexus.conversation_attachments'::regclass
  ) THEN
    ALTER TABLE nexus.conversation_attachments
      ADD CONSTRAINT conversation_attachments_asset_id_fkey
      FOREIGN KEY (asset_id) REFERENCES nexus.attachment_assets(id) ON DELETE SET NULL;
  END IF;
END $$;

UPDATE nexus.conversation_attachments a
SET department_id = c.department_id
FROM nexus.conversations c
WHERE c.id = a.conversation_id
  AND a.department_id IS NULL
  AND c.department_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversation_attachments_asset
  ON nexus.conversation_attachments (asset_id)
  WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversation_attachments_department
  ON nexus.conversation_attachments (department_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS nexus.conversation_attachment_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_cache_id uuid NOT NULL
    REFERENCES nexus.attachment_analysis_cache(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES nexus.conversations(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES nexus.principals(id) ON DELETE CASCADE,
  department_id uuid REFERENCES nexus.departments(id) ON DELETE SET NULL,
  message_id uuid NOT NULL REFERENCES nexus.conversation_messages(id) ON DELETE CASCADE,
  turn_id uuid REFERENCES nexus.ai_turns(id) ON DELETE SET NULL,
  branch_message_id uuid REFERENCES nexus.conversation_messages(id) ON DELETE SET NULL,
  attachment_id uuid NOT NULL REFERENCES nexus.conversation_attachments(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (analysis_cache_id, conversation_id, message_id, attachment_id)
);

CREATE INDEX IF NOT EXISTS conversation_attachment_analyses_context
  ON nexus.conversation_attachment_analyses
    (conversation_id, message_id, active, criado_em DESC);
CREATE INDEX IF NOT EXISTS conversation_attachment_analyses_attachment
  ON nexus.conversation_attachment_analyses (attachment_id, criado_em DESC);
