DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '076_stage4_candidate_revision_lineage.sql'
  ) THEN
    RAISE EXCEPTION
      'Migration 077 preflight failed: migration 076 is not registered';
  END IF;
END
$$;

CREATE TABLE asset.staging_asset_leases (
  lease_id uuid PRIMARY KEY,
  reference_digest text NOT NULL UNIQUE CHECK (reference_digest ~ '^sha256:[a-f0-9]{64}$'),
  project_id text NOT NULL,
  draft_id text NOT NULL CHECK (length(draft_id) BETWEEN 1 AND 512),
  item_id text NOT NULL CHECK (length(item_id) BETWEEN 1 AND 200),
  principal_id text NOT NULL CHECK (length(principal_id) BETWEEN 1 AND 512),
  input_kind text NOT NULL CHECK (input_kind IN ('DIRECT_TEXT', 'FILE', 'URL')),
  storage_key text NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 1048576),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at = issued_at + interval '720 hours'),
  CHECK (expires_at > issued_at)
);

CREATE INDEX asset_staging_asset_leases_active_idx
  ON asset.staging_asset_leases (expires_at, storage_key);

CREATE INDEX asset_staging_asset_leases_storage_key_idx
  ON asset.staging_asset_leases (storage_key, expires_at);
