ALTER TABLE intake.submissions
  DROP CONSTRAINT submissions_material_kind_check,
  DROP CONSTRAINT submissions_media_type_check,
  DROP CONSTRAINT submissions_size_bytes_check,
  ADD CONSTRAINT submissions_material_kind_check
    CHECK (material_kind IN ('plain_text', 'document', 'image')),
  ADD CONSTRAINT submissions_media_type_check
    CHECK (media_type IN (
      'text/plain',
      'text/markdown',
      'text/html',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/png',
      'image/jpeg'
    )),
  ADD CONSTRAINT submissions_size_bytes_check
    CHECK (size_bytes > 0 AND size_bytes <= 10485760);

ALTER TABLE asset.original_assets
  DROP CONSTRAINT original_assets_size_bytes_check,
  ADD CONSTRAINT original_assets_size_bytes_check
    CHECK (size_bytes > 0 AND size_bytes <= 10485760);

ALTER TABLE asset.source_versions
  DROP CONSTRAINT source_versions_media_type_check,
  ADD CONSTRAINT source_versions_media_type_check
    CHECK (media_type IN (
      'text/plain',
      'text/markdown',
      'text/html',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/png',
      'image/jpeg'
    ));

ALTER TABLE asset.storage_receipts
  DROP CONSTRAINT storage_receipts_material_kind_check,
  ADD CONSTRAINT storage_receipts_material_kind_check
    CHECK (material_kind IN ('plain_text', 'document', 'image'));

ALTER TABLE evidence.spans
  ADD COLUMN selectors jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE evidence.spans
  ADD CONSTRAINT evidence_selectors_array
  CHECK (jsonb_typeof(selectors) = 'array');
