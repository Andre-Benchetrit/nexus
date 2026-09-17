ALTER TABLE nexus.attachment_asset_index
  DROP CONSTRAINT IF EXISTS attachment_asset_index_locator_type_check;

ALTER TABLE nexus.attachment_asset_index
  ADD CONSTRAINT attachment_asset_index_locator_type_check CHECK (locator_type IN (
    'page','section','table','sheet','range','cell','image','block','defined_name'
  ));
