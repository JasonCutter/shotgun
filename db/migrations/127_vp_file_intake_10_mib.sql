DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '126_vp_bounded_search_statistics.sql'
  ) THEN
    RAISE EXCEPTION
      'Migration 127 preflight failed: migration 126 is not registered';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'source_product.intake_submission_items'::regclass
      AND conname = 'intake_submission_items_size_bytes_check'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'asset.staging_asset_leases'::regclass
      AND conname = 'staging_asset_leases_size_bytes_check'
  ) THEN
    RAISE EXCEPTION
      'Migration 127 preflight failed: expected intake size constraints are missing';
  END IF;
END
$$;

-- Stage 8 already bounds format workers at 10 MiB. Apply that same raw-file
-- limit to active Product intake while keeping text and URL at one MiB.
ALTER TABLE source_product.intake_submission_items
  DROP CONSTRAINT intake_submission_items_size_bytes_check,
  ADD CONSTRAINT intake_submission_items_size_bytes_check
    CHECK (
      size_bytes IS NULL OR (
        size_bytes > 0 AND size_bytes <= CASE
          WHEN input_kind = 'FILE' THEN 10485760
          ELSE 1048576
        END
      )
    );

ALTER TABLE asset.staging_asset_leases
  DROP CONSTRAINT staging_asset_leases_size_bytes_check,
  ADD CONSTRAINT staging_asset_leases_size_bytes_check
    CHECK (
      size_bytes > 0 AND size_bytes <= CASE
        WHEN input_kind = 'FILE' THEN 10485760
        ELSE 1048576
      END
    );
