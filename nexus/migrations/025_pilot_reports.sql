INSERT INTO nexus.permissions (codigo, descricao) VALUES
  ('piloto.problemas.administrar', 'Administrar problemas reportados no piloto')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO nexus.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM nexus.roles r
JOIN nexus.permissions p ON p.codigo = 'piloto.problemas.administrar'
WHERE r.slug = 'administrador'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS nexus.pilot_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_principal_id uuid REFERENCES nexus.principals(id) ON DELETE SET NULL,
  reporter_name text NOT NULL,
  department_id uuid REFERENCES nexus.departments(id) ON DELETE SET NULL,
  department_name text,
  conversation_ref uuid NOT NULL,
  conversation_title text,
  message_ref uuid NOT NULL,
  turn_ref uuid,
  trace_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN (
    'incorrect_or_incomplete',
    'wrong_data_or_calculation',
    'misunderstood_request',
    'wrong_source_or_tool',
    'technical_error',
    'file_image_or_chart',
    'usability',
    'other'
  )),
  comment text NOT NULL CHECK (
    char_length(btrim(comment)) BETWEEN 5 AND 2000
  ),
  status text NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'in_review', 'resolved', 'dismissed'
  )),
  internal_note text CHECK (
    internal_note IS NULL OR char_length(internal_note) <= 4000
  ),
  conversation_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(conversation_snapshot) = 'object'
  ),
  consent_confirmed_at timestamptz NOT NULL DEFAULT now(),
  updated_by_principal_id uuid REFERENCES nexus.principals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (reporter_principal_id, message_ref)
);

CREATE INDEX IF NOT EXISTS pilot_reports_status_created
  ON nexus.pilot_reports (status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS pilot_reports_category_created
  ON nexus.pilot_reports (category, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS pilot_reports_department_created
  ON nexus.pilot_reports (department_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS pilot_reports_reporter_created
  ON nexus.pilot_reports (reporter_principal_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS pilot_reports_trace
  ON nexus.pilot_reports (trace_id);
