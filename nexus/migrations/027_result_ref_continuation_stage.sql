-- A continuacao de resultados estruturados possui uma etapa propria de
-- telemetria. A lista fechada anterior rejeitava essa etapa antes mesmo da
-- chamada ao provider (PostgreSQL 23514).
ALTER TABLE nexus.llm_calls
  DROP CONSTRAINT IF EXISTS llm_calls_stage_check;

ALTER TABLE nexus.llm_calls
  ADD CONSTRAINT llm_calls_stage_check CHECK (stage IN (
    'generalist_response', 'generalist_decision', 'semantic_router',
    'business_reasoning', 'generalist_final', 'memory_assessment',
    'web_synthesis', 'web_query_refinement', 'web_citation_repair',
    'vision_interpretation', 'file_analysis', 'artifact_generation',
    'artifact_validation', 'document_source_delivery', 'policy_validation',
    'dataset_materialization', 'dataset_query', 'dataset_export',
    'image_local_processing', 'web_search', 'image_planning', 'image_generation',
    'image_composition', 'image_validation', 'result_ref_continuation'
  ));
