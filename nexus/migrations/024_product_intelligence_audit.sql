INSERT INTO nexus.permissions (codigo, descricao) VALUES
  ('auditoria.consultar.setor', 'Consultar metadados de auditoria dos setores geridos')
ON CONFLICT (codigo) DO UPDATE SET descricao = EXCLUDED.descricao;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM nexus.roles r
JOIN nexus.permissions p ON p.codigo = 'auditoria.consultar.setor'
WHERE r.slug = 'gestor'
ON CONFLICT DO NOTHING;

DELETE FROM nexus.role_permissions rp
USING nexus.roles r, nexus.permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.slug = 'auditor'
  AND p.codigo = 'auditoria.consultar';

ALTER TABLE nexus.ai_turns
  ADD COLUMN IF NOT EXISTS source_mode text NOT NULL DEFAULT 'automatico';

ALTER TABLE nexus.ai_turns
  DROP CONSTRAINT IF EXISTS ai_turns_source_mode_check;

ALTER TABLE nexus.ai_turns
  ADD CONSTRAINT ai_turns_source_mode_check CHECK (
    source_mode IN ('automatico', 'geral', 'dados', 'documentacao', 'web', 'imagem')
  );

CREATE INDEX IF NOT EXISTS ai_turns_department_data
  ON nexus.ai_turns (department_id, criado_em DESC, id DESC);

CREATE INDEX IF NOT EXISTS ai_turns_source_mode_data
  ON nexus.ai_turns (source_mode, criado_em DESC, id DESC);

CREATE INDEX IF NOT EXISTS tool_executions_tool_status_data
  ON nexus.tool_executions (tool_name, status, criada_em DESC, id DESC);

CREATE INDEX IF NOT EXISTS tool_executions_principal_data
  ON nexus.tool_executions (principal_id, criada_em DESC, id DESC);
