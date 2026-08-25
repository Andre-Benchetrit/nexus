ALTER TABLE nexus.ai_turns
  ADD COLUMN IF NOT EXISTS semantic_tier_initial text,
  ADD COLUMN IF NOT EXISTS semantic_tier_final text,
  ADD COLUMN IF NOT EXISTS semantic_score_initial integer,
  ADD COLUMN IF NOT EXISTS semantic_score_final integer,
  ADD COLUMN IF NOT EXISTS semantic_escalation_reasons jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE nexus.llm_calls
  ADD COLUMN IF NOT EXISTS semantic_tier text;

CREATE INDEX IF NOT EXISTS ai_turns_semantic_tier_data
  ON nexus.ai_turns (semantic_tier_final, criado_em DESC);

CREATE INDEX IF NOT EXISTS llm_calls_semantic_tier_data
  ON nexus.llm_calls (semantic_tier, criada_em DESC);
