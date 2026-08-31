CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

INSERT INTO nexus.departments (slug,nome) VALUES
  ('comercial','Comercial'),('financeiro','Financeiro'),('logistica','Logistica'),
  ('marketing','Marketing'),('rh','Recursos Humanos'),('sac','SAC')
ON CONFLICT (slug) DO UPDATE SET nome=EXCLUDED.nome;

CREATE TABLE IF NOT EXISTS nexus.knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  titulo text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('procedimento','politica','manual')),
  escopo text NOT NULL CHECK (escopo IN ('global','setor')),
  department_id uuid REFERENCES nexus.departments(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho','em_revisao','publicado','arquivado')),
  origem text NOT NULL DEFAULT 'nexus' CHECK (origem IN ('nexus','onedrive')),
  external_drive_id text,
  external_item_id text,
  external_path text,
  current_published_version_id uuid,
  criado_por uuid REFERENCES nexus.principals(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK ((escopo='global' AND department_id IS NULL) OR
         (escopo='setor' AND department_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS nexus.knowledge_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES nexus.knowledge_documents(id) ON DELETE CASCADE,
  numero integer NOT NULL CHECK (numero > 0),
  status text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho','em_revisao','publicado','rejeitado','substituido')),
  titulo text NOT NULL,
  resumo text,
  conteudo_estruturado jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_filename text,
  source_media_type text,
  source_storage_key text,
  docx_storage_key text,
  pdf_storage_key text,
  checksum char(64) NOT NULL,
  origem_modificada_em timestamptz,
  extracao_status text NOT NULL DEFAULT 'pendente'
    CHECK (extracao_status IN ('pendente','processando','concluida','erro')),
  erro_codigo text,
  criado_por uuid REFERENCES nexus.principals(id) ON DELETE SET NULL,
  publicado_por uuid REFERENCES nexus.principals(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  publicado_em timestamptz,
  UNIQUE (document_id, numero)
);

ALTER TABLE nexus.knowledge_documents
  DROP CONSTRAINT IF EXISTS knowledge_documents_current_version_fk;
ALTER TABLE nexus.knowledge_documents
  ADD CONSTRAINT knowledge_documents_current_version_fk
  FOREIGN KEY (current_published_version_id)
  REFERENCES nexus.knowledge_document_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS nexus.knowledge_document_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES nexus.knowledge_document_versions(id) ON DELETE CASCADE,
  numero integer NOT NULL CHECK (numero > 0),
  texto text NOT NULL DEFAULT '',
  image_storage_key text,
  possui_imagem boolean NOT NULL DEFAULT false,
  metadados jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (version_id, numero)
);

CREATE TABLE IF NOT EXISTS nexus.knowledge_document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES nexus.knowledge_document_versions(id) ON DELETE CASCADE,
  page_id uuid REFERENCES nexus.knowledge_document_pages(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  conteudo text NOT NULL,
  embedding vector(384),
  search_vector tsvector GENERATED ALWAYS AS
    (to_tsvector('portuguese', coalesce(conteudo,''))) STORED,
  metadados jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (version_id, ordinal)
);

CREATE INDEX IF NOT EXISTS knowledge_documents_scope_status
  ON nexus.knowledge_documents (status, escopo, department_id, atualizado_em DESC);
CREATE INDEX IF NOT EXISTS knowledge_documents_title_trgm
  ON nexus.knowledge_documents USING gin (titulo gin_trgm_ops);
CREATE INDEX IF NOT EXISTS knowledge_chunks_search
  ON nexus.knowledge_document_chunks USING gin (search_vector);
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding
  ON nexus.knowledge_document_chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS nexus.knowledge_ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES nexus.knowledge_documents(id) ON DELETE CASCADE,
  version_id uuid REFERENCES nexus.knowledge_document_versions(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('importar','reindexar','publicar','sincronizar','exportar')),
  status text NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente','processando','concluido','erro')),
  tentativas integer NOT NULL DEFAULT 0,
  erro_codigo text,
  metadados jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  iniciado_em timestamptz,
  concluido_em timestamptz
);

CREATE INDEX IF NOT EXISTS knowledge_jobs_queue
  ON nexus.knowledge_ingestion_jobs (status, criado_em);

CREATE TABLE IF NOT EXISTS nexus.knowledge_sync_state (
  source_key text PRIMARY KEY,
  delta_token text,
  last_success_at timestamptz,
  last_scan_at timestamptz,
  status text NOT NULL DEFAULT 'nunca_executado',
  erro_codigo text,
  metadados jsonb NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO nexus.permissions (codigo, descricao) VALUES
  ('documentacao.consultar', 'Consultar documentos publicados do setor ativo e globais'),
  ('documentacao.visual.consultar', 'Consultar imagens autorizadas de documentos'),
  ('documentacao.criar.setor', 'Criar documentos no proprio setor'),
  ('documentacao.editar.setor', 'Editar documentos no proprio setor'),
  ('documentacao.publicar.setor', 'Publicar documentos no proprio setor'),
  ('documentacao.importar', 'Importar documentos oficiais para revisao'),
  ('documentacao.administrar.global', 'Administrar politicas e manuais globais'),
  ('documentacao.auditar', 'Auditar versoes e sincronizacoes documentais')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r JOIN nexus.permissions p
  ON p.codigo IN ('documentacao.consultar','documentacao.visual.consultar')
WHERE r.slug IN ('usuario','analista','gestor','auditor')
ON CONFLICT DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r JOIN nexus.permissions p
  ON p.codigo IN ('documentacao.criar.setor','documentacao.editar.setor','documentacao.publicar.setor','documentacao.importar')
WHERE r.slug='gestor'
ON CONFLICT DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r JOIN nexus.permissions p
  ON p.codigo='documentacao.auditar'
WHERE r.slug='auditor'
ON CONFLICT DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r CROSS JOIN nexus.permissions p
WHERE r.slug='administrador' AND p.codigo LIKE 'documentacao.%'
ON CONFLICT DO NOTHING;
