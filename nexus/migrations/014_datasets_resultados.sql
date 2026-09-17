CREATE TABLE IF NOT EXISTS nexus.conversation_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES nexus.conversations(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES nexus.principals(id) ON DELETE CASCADE,
  department_id uuid REFERENCES nexus.departments(id) ON DELETE RESTRICT,
  turn_id uuid REFERENCES nexus.ai_turns(id) ON DELETE SET NULL,
  attachment_id uuid REFERENCES nexus.conversation_attachments(id) ON DELETE SET NULL,
  parent_dataset_id uuid REFERENCES nexus.conversation_datasets(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('dataset_ref','result_ref')),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','expired','error','deleting')),
  storage_key text UNIQUE,
  signature char(64) NOT NULL,
  schema_columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  row_count integer NOT NULL CHECK (row_count >= 0 AND row_count <= 50000),
  unique_key_count integer CHECK (unique_key_count IS NULL OR unique_key_count BETWEEN 0 AND 50000),
  key_mapping jsonb,
  query_manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  lineage jsonb NOT NULL DEFAULT '{}'::jsonb,
  classification text NOT NULL DEFAULT 'conversa_privada',
  corporate_updated_at timestamptz,
  expires_at timestamptz NOT NULL,
  error_code text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_datasets_active_signature
  ON nexus.conversation_datasets (conversation_id,principal_id,signature)
  WHERE status='ready';
CREATE INDEX IF NOT EXISTS conversation_datasets_conversa_data
  ON nexus.conversation_datasets (conversation_id,criado_em DESC,id DESC);
CREATE INDEX IF NOT EXISTS conversation_datasets_expiracao
  ON nexus.conversation_datasets (expires_at) WHERE status='ready';

CREATE TABLE IF NOT EXISTS nexus.dataset_cleanup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid REFERENCES nexus.conversation_datasets(id) ON DELETE SET NULL,
  storage_key text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error_code text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  proxima_tentativa_em timestamptz NOT NULL DEFAULT now(),
  concluida_em timestamptz
);

ALTER TABLE nexus.llm_calls DROP CONSTRAINT IF EXISTS llm_calls_stage_check;
ALTER TABLE nexus.llm_calls ADD CONSTRAINT llm_calls_stage_check CHECK (stage IN (
  'generalist_response','generalist_decision','semantic_router','business_reasoning',
  'generalist_final','memory_assessment','web_synthesis','vision_interpretation',
  'file_analysis','artifact_generation','artifact_validation','document_source_delivery',
  'dataset_materialization','dataset_query','dataset_export','policy_validation',
  'image_local_processing','web_search'
));
