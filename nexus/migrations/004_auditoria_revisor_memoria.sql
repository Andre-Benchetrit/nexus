ALTER TABLE nexus.llm_calls
  DROP CONSTRAINT IF EXISTS llm_calls_stage_check;

ALTER TABLE nexus.llm_calls
  ADD CONSTRAINT llm_calls_stage_check CHECK (stage IN (
    'generalist_response', 'generalist_decision', 'semantic_router',
    'business_reasoning', 'generalist_final', 'memory_assessment'
  ));
