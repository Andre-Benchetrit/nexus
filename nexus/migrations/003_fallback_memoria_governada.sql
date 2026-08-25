CREATE TABLE IF NOT EXISTS nexus.memory_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES nexus.conversations(id) ON DELETE CASCADE,
  source_turn_id uuid REFERENCES nexus.ai_turns(id) ON DELETE SET NULL,
  trace_id uuid,
  proposed_by_principal_id uuid NOT NULL REFERENCES nexus.principals(id),
  tipo text NOT NULL CHECK (tipo IN ('business_knowledge','execution_playbook','personal_preference')),
  categoria text NOT NULL,
  declaracao text NOT NULL,
  gatilhos jsonb NOT NULL DEFAULT '[]'::jsonb,
  escopo text NOT NULL CHECK (escopo IN ('principal','department','global')),
  target_principal_id uuid REFERENCES nexus.principals(id),
  target_department_id uuid REFERENCES nexus.departments(id),
  confianca numeric(5,4),
  justificativa text,
  evidencias jsonb NOT NULL DEFAULT '[]'::jsonb,
  padrao_falha jsonb NOT NULL DEFAULT '{}'::jsonb,
  padrao_sucesso jsonb NOT NULL DEFAULT '{}'::jsonb,
  riscos jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN (
    'offered','pending_review','changes_requested','approved','rejected',
    'declined','expired','revoked'
  )),
  expira_oferta_em timestamptz,
  confirmado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (escopo='principal' AND target_principal_id IS NOT NULL AND target_department_id IS NULL) OR
    (escopo='department' AND target_principal_id IS NULL AND target_department_id IS NOT NULL) OR
    (escopo='global' AND target_principal_id IS NULL AND target_department_id IS NULL)
  ),
  CHECK (tipo <> 'personal_preference' OR escopo='principal')
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_candidates_uma_oferta_conversa
  ON nexus.memory_candidates (conversation_id) WHERE status='offered';

CREATE INDEX IF NOT EXISTS memory_candidates_fila
  ON nexus.memory_candidates (status, escopo, target_department_id, criado_em);

CREATE TABLE IF NOT EXISTS nexus.memory_candidate_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES nexus.memory_candidates(id) ON DELETE CASCADE,
  versao integer NOT NULL,
  declaracao text NOT NULL,
  gatilhos jsonb NOT NULL DEFAULT '[]'::jsonb,
  escopo text NOT NULL CHECK (escopo IN ('principal','department','global')),
  target_principal_id uuid REFERENCES nexus.principals(id),
  target_department_id uuid REFERENCES nexus.departments(id),
  edited_by_principal_id uuid NOT NULL REFERENCES nexus.principals(id),
  motivo text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, versao),
  CHECK (
    (escopo='principal' AND target_principal_id IS NOT NULL AND target_department_id IS NULL) OR
    (escopo='department' AND target_principal_id IS NULL AND target_department_id IS NOT NULL) OR
    (escopo='global' AND target_principal_id IS NULL AND target_department_id IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS nexus.memory_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES nexus.memory_candidates(id) ON DELETE CASCADE,
  revision_id uuid REFERENCES nexus.memory_candidate_revisions(id),
  reviewer_principal_id uuid NOT NULL REFERENCES nexus.principals(id),
  decisao text NOT NULL CHECK (decisao IN ('approved','rejected','changes_requested','revoked')),
  motivo text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE nexus.knowledge_items
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'business_knowledge',
  ADD COLUMN IF NOT EXISTS escopo text NOT NULL DEFAULT 'global',
  ADD COLUMN IF NOT EXISTS principal_id uuid REFERENCES nexus.principals(id),
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES nexus.departments(id),
  ADD COLUMN IF NOT EXISTS source_candidate_id uuid REFERENCES nexus.memory_candidates(id),
  ADD COLUMN IF NOT EXISTS approved_by_principal_id uuid REFERENCES nexus.principals(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS versao integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE nexus.knowledge_items
  ADD CONSTRAINT knowledge_items_tipo_governado_check
    CHECK (tipo IN ('business_knowledge','execution_playbook','personal_preference')),
  ADD CONSTRAINT knowledge_items_escopo_governado_check
    CHECK (escopo IN ('principal','department','global')),
  ADD CONSTRAINT knowledge_items_alvo_governado_check
    CHECK (
      (escopo='principal' AND principal_id IS NOT NULL AND department_id IS NULL) OR
      (escopo='department' AND principal_id IS NULL AND department_id IS NOT NULL) OR
      (escopo='global' AND principal_id IS NULL AND department_id IS NULL)
    ),
  ADD CONSTRAINT knowledge_items_preferencia_pessoal_check
    CHECK (tipo <> 'personal_preference' OR escopo='principal');

UPDATE nexus.knowledge_items
SET tipo='business_knowledge', escopo='global', approved_at=COALESCE(approved_at, criado_em)
WHERE tipo IS NULL OR escopo IS NULL OR approved_at IS NULL;

INSERT INTO nexus.permissions (codigo, descricao) VALUES
  ('memoria.candidatar', 'Confirmar e submeter candidaturas de memória'),
  ('memoria.revisar.pessoal', 'Revisar memórias pessoais'),
  ('memoria.revisar.setor', 'Revisar memórias do próprio setor'),
  ('memoria.revisar.global', 'Revisar memórias globais'),
  ('memoria.auditar', 'Consultar fila e histórico de memórias'),
  ('memoria.administrar', 'Administrar e revogar memórias')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r JOIN nexus.permissions p
  ON p.codigo='memoria.candidatar'
WHERE r.slug IN ('usuario','analista','gestor','administrador')
ON CONFLICT DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r JOIN nexus.permissions p
  ON p.codigo IN ('memoria.revisar.pessoal','memoria.revisar.setor','memoria.auditar')
WHERE r.slug='gestor'
ON CONFLICT DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r JOIN nexus.permissions p
  ON p.codigo='memoria.auditar'
WHERE r.slug='auditor'
ON CONFLICT DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r CROSS JOIN nexus.permissions p
WHERE r.slug='administrador' AND p.codigo LIKE 'memoria.%'
ON CONFLICT DO NOTHING;

INSERT INTO nexus.permission_overrides
  (principal_id, permission_id, efeito, motivo)
SELECT pr.id, pe.id, 'permitir', 'Compatibilidade do CLI técnico durante implantação da memória governada'
FROM nexus.principals pr CROSS JOIN nexus.permissions pe
WHERE pr.slug='legacy-cli' AND pe.codigo='memoria.candidatar'
  AND NOT EXISTS (
    SELECT 1 FROM nexus.permission_overrides po
    WHERE po.principal_id=pr.id AND po.permission_id=pe.id
      AND po.department_id IS NULL AND po.efeito='permitir'
  );
