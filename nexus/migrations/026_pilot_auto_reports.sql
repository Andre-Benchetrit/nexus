ALTER TABLE nexus.pilot_reports
  ADD COLUMN IF NOT EXISTS report_origin text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS request_ref uuid,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_stage text;

ALTER TABLE nexus.pilot_reports
  DROP CONSTRAINT IF EXISTS pilot_reports_reporter_principal_id_message_ref_key;

ALTER TABLE nexus.pilot_reports
  ALTER COLUMN message_ref DROP NOT NULL,
  ALTER COLUMN consent_confirmed_at DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'nexus.pilot_reports'::regclass
      AND conname = 'pilot_reports_origin_check'
  ) THEN
    ALTER TABLE nexus.pilot_reports
      ADD CONSTRAINT pilot_reports_origin_check
      CHECK (report_origin IN ('user', 'automatic'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS pilot_reports_user_message_unique
  ON nexus.pilot_reports (reporter_principal_id, message_ref)
  WHERE report_origin = 'user' AND message_ref IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pilot_reports_automatic_trace_unique
  ON nexus.pilot_reports (trace_id)
  WHERE report_origin = 'automatic';

CREATE INDEX IF NOT EXISTS pilot_reports_origin_created
  ON nexus.pilot_reports (report_origin, created_at DESC, id DESC);
