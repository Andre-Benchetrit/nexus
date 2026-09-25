CREATE TABLE IF NOT EXISTS nexus.lake_pipeline_state (
  entity_key text PRIMARY KEY,
  source_key text,
  watermark_end date,
  execution_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nexus.lake_pipeline_runs (
  id text PRIMARY KEY,
  mode text NOT NULL,
  status text NOT NULL CHECK (status IN ('executando','sucesso','parcial','erro')),
  scheduled_type text,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  duration_ms bigint,
  plan_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_count integer NOT NULL DEFAULT 0,
  blocked_count integer NOT NULL DEFAULT 0,
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lake_pipeline_runs_started_at
  ON nexus.lake_pipeline_runs (started_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS nexus.lake_pipeline_stages (
  run_id text NOT NULL REFERENCES nexus.lake_pipeline_runs(id) ON DELETE CASCADE,
  layer text NOT NULL CHECK (layer IN ('bronze','silver','gold')),
  object_key text NOT NULL,
  source_key text,
  action text,
  status text NOT NULL CHECK (status IN ('executando','ignorada','sucesso','erro','bloqueada')),
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms bigint,
  row_count bigint,
  checksum text,
  blocked_by jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, layer, object_key)
);

CREATE INDEX IF NOT EXISTS lake_pipeline_stages_status
  ON nexus.lake_pipeline_stages (status, updated_at DESC);
