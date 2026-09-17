ALTER TABLE nexus.conversation_attachments
  ALTER COLUMN storage_key DROP NOT NULL;

ALTER TABLE nexus.conversation_attachment_analyses
  DROP CONSTRAINT IF EXISTS conversation_attachment_analyses_analysis_cache_id_conversation_id_message_id_attachment_id_key;

ALTER TABLE nexus.conversation_attachment_analyses
  ADD CONSTRAINT conversation_attachment_analyses_branch_unique
    UNIQUE (analysis_cache_id, conversation_id, message_id, attachment_id, turn_id);

CREATE INDEX IF NOT EXISTS conversation_attachment_analyses_active_turn
  ON nexus.conversation_attachment_analyses (conversation_id, message_id, turn_id, active);
