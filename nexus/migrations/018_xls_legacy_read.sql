ALTER TABLE nexus.conversation_attachments
  DROP CONSTRAINT IF EXISTS conversation_attachments_media_type_check;

ALTER TABLE nexus.conversation_attachments
  ADD CONSTRAINT conversation_attachments_media_type_check CHECK (media_type IN (
    'image/png','image/jpeg','image/webp','application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ));

ALTER TABLE nexus.attachment_assets
  DROP CONSTRAINT IF EXISTS attachment_assets_format_check;

ALTER TABLE nexus.attachment_assets
  ADD CONSTRAINT attachment_assets_format_check
  CHECK (format IN ('png','jpeg','webp','pdf','docx','xls','xlsx'));
