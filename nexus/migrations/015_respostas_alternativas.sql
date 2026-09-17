ALTER TABLE nexus.conversation_messages
  ADD COLUMN IF NOT EXISTS retry_root_message_id uuid
    REFERENCES nexus.conversation_messages(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS variant_index integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS variant_active boolean NOT NULL DEFAULT true;

ALTER TABLE nexus.conversation_messages
  DROP CONSTRAINT IF EXISTS conversation_messages_retry_assistant_check,
  DROP CONSTRAINT IF EXISTS conversation_messages_variant_index_check;

ALTER TABLE nexus.conversation_messages
  ADD CONSTRAINT conversation_messages_retry_assistant_check
    CHECK (retry_root_message_id IS NULL OR papel='assistant'),
  ADD CONSTRAINT conversation_messages_variant_index_check
    CHECK (variant_index >= 1);

CREATE INDEX IF NOT EXISTS conversation_messages_retry_root
  ON nexus.conversation_messages (retry_root_message_id, variant_index)
  WHERE retry_root_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversation_messages_contexto_ativo
  ON nexus.conversation_messages (conversation_id, criado_em, id)
  WHERE papel='user' OR variant_active=true;
