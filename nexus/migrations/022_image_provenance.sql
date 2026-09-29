ALTER TABLE nexus.ai_turns
  DROP CONSTRAINT IF EXISTS ai_turns_proveniencia_check;

ALTER TABLE nexus.ai_turns
  ADD CONSTRAINT ai_turns_proveniencia_check CHECK (
    proveniencia IS NULL OR proveniencia IN (
      'conhecimento_geral', 'dados_nexus', 'web', 'arquivo', 'imagem', 'misto'
    )
  );

ALTER TABLE nexus.conversation_messages
  DROP CONSTRAINT IF EXISTS conversation_messages_proveniencia_check;

ALTER TABLE nexus.conversation_messages
  ADD CONSTRAINT conversation_messages_proveniencia_check CHECK (
    proveniencia IS NULL OR proveniencia IN (
      'conhecimento_geral', 'dados_nexus', 'web', 'arquivo', 'imagem', 'misto'
    )
  );
