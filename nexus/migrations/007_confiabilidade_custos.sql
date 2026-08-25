ALTER TABLE nexus.llm_calls
  ADD COLUMN IF NOT EXISTS pricing_usd_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pricing_brl_complete boolean NOT NULL DEFAULT false;

ALTER TABLE nexus.ai_turns
  ADD COLUMN IF NOT EXISTS pricing_usd_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pricing_brl_complete boolean NOT NULL DEFAULT false;

UPDATE nexus.llm_calls
SET pricing_usd_complete = estimated_cost_usd IS NOT NULL,
    pricing_brl_complete = estimated_cost_brl IS NOT NULL
WHERE status = 'sucesso';

UPDATE nexus.ai_turns
SET pricing_usd_complete = estimated_cost_usd IS NOT NULL,
    pricing_brl_complete = estimated_cost_brl IS NOT NULL
WHERE status = 'sucesso';

ALTER TABLE nexus.usage_line_items
  DROP CONSTRAINT IF EXISTS usage_line_items_pricing_status_check;

ALTER TABLE nexus.usage_line_items
  ADD CONSTRAINT usage_line_items_pricing_status_check
  CHECK (pricing_status IN ('priced', 'pricing_missing', 'missing_exchange_rate'));

UPDATE nexus.usage_line_items
SET pricing_status = 'missing_exchange_rate'
WHERE pricing_status = 'priced'
  AND pricing_rate_id IS NOT NULL
  AND exchange_rate_id IS NULL;

