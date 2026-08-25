ALTER TABLE nexus.audit_events
  ADD COLUMN IF NOT EXISTS trace_id uuid,
  ADD COLUMN IF NOT EXISTS turn_id uuid REFERENCES nexus.ai_turns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS call_id uuid;

CREATE INDEX IF NOT EXISTS audit_events_trace_data
  ON nexus.audit_events (trace_id, criado_em) WHERE trace_id IS NOT NULL;
