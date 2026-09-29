ALTER TABLE nexus.llm_calls
  DROP CONSTRAINT IF EXISTS llm_calls_stage_check;

ALTER TABLE nexus.llm_calls
  ADD CONSTRAINT llm_calls_stage_check CHECK (stage IN (
    'generalist_response', 'generalist_decision', 'semantic_router',
    'business_reasoning', 'generalist_final', 'memory_assessment',
    'web_synthesis', 'web_query_refinement', 'web_citation_repair',
    'vision_interpretation', 'file_analysis', 'artifact_generation',
    'artifact_validation', 'document_source_delivery', 'policy_validation',
    'dataset_materialization', 'dataset_query', 'dataset_export',
    'image_local_processing', 'web_search', 'image_planning', 'image_generation',
    'image_composition', 'image_validation'
  ));

ALTER TABLE nexus.conversation_artifacts
  DROP CONSTRAINT IF EXISTS conversation_artifacts_format_check;

ALTER TABLE nexus.conversation_artifacts
  ADD CONSTRAINT conversation_artifacts_format_check
    CHECK (format IN ('xlsx','docx','pdf','png','jpeg','webp')),
  ADD COLUMN IF NOT EXISTS artifact_kind text NOT NULL DEFAULT 'file',
  ADD COLUMN IF NOT EXISTS parent_artifact_id uuid
    REFERENCES nexus.conversation_artifacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS version_number integer NOT NULL DEFAULT 1;

ALTER TABLE nexus.conversation_artifacts
  DROP CONSTRAINT IF EXISTS conversation_artifacts_kind_check;

ALTER TABLE nexus.conversation_artifacts
  ADD CONSTRAINT conversation_artifacts_kind_check
    CHECK (artifact_kind IN ('file','image')),
  ADD CONSTRAINT conversation_artifacts_version_check CHECK (version_number > 0);

CREATE TABLE IF NOT EXISTS nexus.conversation_image_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL UNIQUE REFERENCES nexus.conversation_artifacts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES nexus.conversations(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES nexus.principals(id) ON DELETE CASCADE,
  project_group_id uuid NOT NULL,
  parent_project_id uuid REFERENCES nexus.conversation_image_projects(id) ON DELETE SET NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  brand_mode text NOT NULL CHECK (brand_mode IN ('none','visual_identity','full_brand')),
  brand_profile_version text,
  base_storage_key text NOT NULL UNIQUE,
  base_sha256 char(64) NOT NULL,
  project jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text,
  modelo text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS conversation_image_projects_group_version
  ON nexus.conversation_image_projects (project_group_id, version_number);
CREATE INDEX IF NOT EXISTS conversation_image_projects_conversation
  ON nexus.conversation_image_projects (conversation_id, criado_em DESC);

INSERT INTO nexus.permissions (codigo, descricao) VALUES
  ('ia.imagem.gerar', 'Gerar imagens privadas na conversa'),
  ('ia.imagem.editar', 'Editar imagens privadas da conversa')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r CROSS JOIN nexus.permissions p
WHERE r.slug IN ('usuario','analista','gestor','auditor','administrador')
  AND p.codigo IN ('ia.imagem.gerar','ia.imagem.editar')
ON CONFLICT DO NOTHING;
