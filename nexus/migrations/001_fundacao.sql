CREATE SCHEMA IF NOT EXISTS nexus;

CREATE TABLE IF NOT EXISTS nexus.principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  tipo text NOT NULL CHECK (tipo IN ('usuario', 'tecnico')),
  nome text NOT NULL,
  email text,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS principals_email_unico
  ON nexus.principals (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS nexus.principal_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES nexus.principals(id) ON DELETE CASCADE,
  provedor text NOT NULL CHECK (provedor IN ('microsoft')),
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provedor, tenant_id, subject_id)
);

CREATE TABLE IF NOT EXISTS nexus.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nexus.principal_departments (
  principal_id uuid NOT NULL REFERENCES nexus.principals(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES nexus.departments(id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_id, department_id)
);

CREATE TABLE IF NOT EXISTS nexus.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  nome text NOT NULL,
  descricao text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nexus.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  descricao text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nexus.role_permissions (
  role_id uuid NOT NULL REFERENCES nexus.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES nexus.permissions(id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS nexus.role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES nexus.principals(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES nexus.roles(id) ON DELETE CASCADE,
  department_id uuid REFERENCES nexus.departments(id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS role_assignments_escopo_unico
  ON nexus.role_assignments (principal_id, role_id, COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE IF NOT EXISTS nexus.permission_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES nexus.principals(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES nexus.permissions(id) ON DELETE CASCADE,
  department_id uuid REFERENCES nexus.departments(id) ON DELETE CASCADE,
  efeito text NOT NULL CHECK (efeito IN ('permitir', 'negar')),
  motivo text NOT NULL,
  expira_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nexus.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES nexus.principals(id),
  chave_sessao text NOT NULL,
  tarefa_ativa_id uuid,
  criada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (principal_id, chave_sessao)
);

CREATE TABLE IF NOT EXISTS nexus.interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES nexus.conversations(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  source_key text UNIQUE,
  criada_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS interactions_conversa_data
  ON nexus.interactions (conversation_id, criada_em DESC, id DESC);

CREATE TABLE IF NOT EXISTS nexus.interaction_tasks (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES nexus.conversations(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  estado text NOT NULL CHECK (estado IN ('ativa', 'aguardando_usuario', 'pausada', 'concluida', 'cancelada', 'expirada')),
  slots jsonb NOT NULL DEFAULT '{}'::jsonb,
  campos_pendentes jsonb NOT NULL DEFAULT '[]'::jsonb,
  contexto jsonb NOT NULL DEFAULT '{}'::jsonb,
  perguntas jsonb NOT NULL DEFAULT '[]'::jsonb,
  criada_em timestamptz NOT NULL,
  atualizada_em timestamptz NOT NULL,
  expira_em timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS interaction_tasks_conversa_estado
  ON nexus.interaction_tasks (conversation_id, estado, atualizada_em DESC);

CREATE UNIQUE INDEX IF NOT EXISTS interaction_tasks_uma_ativa
  ON nexus.interaction_tasks (conversation_id)
  WHERE estado IN ('ativa', 'aguardando_usuario');

CREATE TABLE IF NOT EXISTS nexus.knowledge_items (
  id text PRIMARY KEY,
  categoria text NOT NULL,
  conteudo text NOT NULL,
  origem text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL,
  desativado_em timestamptz
);

CREATE TABLE IF NOT EXISTS nexus.knowledge_triggers (
  knowledge_id text NOT NULL REFERENCES nexus.knowledge_items(id) ON DELETE CASCADE,
  gatilho text NOT NULL,
  PRIMARY KEY (knowledge_id, gatilho)
);

CREATE TABLE IF NOT EXISTS nexus.legacy_imports (
  source_key text PRIMARY KEY,
  checksum text NOT NULL,
  importado_em timestamptz NOT NULL DEFAULT now(),
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS nexus.authorization_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid REFERENCES nexus.principals(id),
  conversation_id uuid REFERENCES nexus.conversations(id) ON DELETE SET NULL,
  permission_code text NOT NULL,
  tool_name text NOT NULL,
  camada text,
  modo text NOT NULL CHECK (modo IN ('off', 'audit', 'enforce')),
  decisao text NOT NULL CHECK (decisao IN ('allow', 'deny', 'would_deny', 'off')),
  motivo_codigo text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nexus.tool_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_decision_id uuid REFERENCES nexus.authorization_decisions(id),
  principal_id uuid REFERENCES nexus.principals(id),
  conversation_id uuid REFERENCES nexus.conversations(id) ON DELETE SET NULL,
  tool_name text NOT NULL,
  permission_code text NOT NULL,
  camada text,
  provider text,
  modelo text,
  status text NOT NULL CHECK (status IN ('iniciada', 'sucesso', 'erro', 'bloqueada')),
  argument_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  duracao_ms integer,
  erro_codigo text,
  criada_em timestamptz NOT NULL DEFAULT now(),
  concluida_em timestamptz
);

CREATE TABLE IF NOT EXISTS nexus.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid REFERENCES nexus.principals(id),
  conversation_id uuid REFERENCES nexus.conversations(id) ON DELETE SET NULL,
  tipo text NOT NULL,
  recurso text,
  resultado text,
  metadados jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);

INSERT INTO nexus.principals (slug, tipo, nome)
VALUES ('legacy-cli', 'tecnico', 'CLI legado do Nexus')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO nexus.roles (slug, nome, descricao) VALUES
  ('usuario', 'Usuário', 'Acesso básico às capacidades autorizadas'),
  ('analista', 'Analista', 'Consultas analíticas e geração de SQL'),
  ('gestor', 'Gestor', 'Visões de gestão do setor'),
  ('auditor', 'Auditor', 'Auditoria de fontes e decisões'),
  ('administrador', 'Administrador', 'Administração da governança')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO nexus.permissions (codigo, descricao) VALUES
  ('indicadores.consultar', 'Consultar indicadores executivos'),
  ('influencias.consultar', 'Consultar influências de resultados'),
  ('estoque.consultar', 'Consultar estoque e rupturas'),
  ('reposicoes.consultar', 'Consultar reposições'),
  ('bloqueios_estoque.consultar', 'Consultar bloqueios de estoque'),
  ('desempenho.consultar', 'Consultar desempenho'),
  ('frete.consultar', 'Consultar frete'),
  ('operacao.consultar', 'Consultar operação'),
  ('vendas.consultar', 'Consultar vendas'),
  ('catalogo.consultar', 'Consultar catálogo'),
  ('pessoas.consultar', 'Consultar pessoas'),
  ('produto.consultar', 'Resolver produtos'),
  ('sql.gerar', 'Gerar e validar SQL'),
  ('gold.consultar', 'Consultar camada Gold'),
  ('silver.consultar', 'Consultar camada Silver'),
  ('bronze.auditar', 'Auditar camada Bronze'),
  ('governanca.administrar', 'Administrar governança'),
  ('auditoria.consultar', 'Consultar auditoria')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r CROSS JOIN nexus.permissions p
WHERE r.slug = 'administrador'
ON CONFLICT DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r JOIN nexus.permissions p
  ON p.codigo IN ('auditoria.consultar', 'bronze.auditar', 'gold.consultar', 'silver.consultar')
WHERE r.slug = 'auditor'
ON CONFLICT DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM nexus.roles r JOIN nexus.permissions p
  ON p.codigo NOT IN ('governanca.administrar', 'auditoria.consultar', 'bronze.auditar')
WHERE r.slug IN ('analista', 'gestor')
ON CONFLICT DO NOTHING;
