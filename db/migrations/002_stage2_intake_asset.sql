CREATE SCHEMA IF NOT EXISTS intake;
CREATE SCHEMA IF NOT EXISTS asset;

CREATE TABLE intake.submissions (
  submission_key uuid PRIMARY KEY,
  submission_id text NOT NULL,
  project_id text NOT NULL,
  actor_id text NOT NULL,
  requested_source_id uuid,
  channel text NOT NULL CHECK (channel IN ('direct_text', 'file_upload')),
  material_kind text NOT NULL CHECK (material_kind = 'plain_text'),
  media_type text NOT NULL CHECK (media_type IN ('text/plain', 'text/markdown')),
  original_file_name text,
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 1048576),
  access_scope text[] NOT NULL CHECK (cardinality(access_scope) > 0),
  sensitivity text NOT NULL CHECK (sensitivity IN ('public', 'internal', 'private', 'restricted')),
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, submission_id)
);

CREATE TABLE asset.original_assets (
  asset_id uuid PRIMARY KEY,
  content_hash text NOT NULL UNIQUE CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 1048576),
  storage_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);

CREATE TABLE asset.sources (
  source_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  created_by_actor_id text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX asset_sources_project_idx ON asset.sources (project_id, source_id);

CREATE TABLE asset.source_versions (
  source_version_id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES asset.sources(source_id),
  version_number integer NOT NULL CHECK (version_number > 0),
  original_asset_id uuid NOT NULL REFERENCES asset.original_assets(asset_id),
  media_type text NOT NULL CHECK (media_type IN ('text/plain', 'text/markdown')),
  access_scope text[] NOT NULL CHECK (cardinality(access_scope) > 0),
  sensitivity text NOT NULL CHECK (sensitivity IN ('public', 'internal', 'private', 'restricted')),
  created_at timestamptz NOT NULL,
  UNIQUE (source_id, version_number),
  UNIQUE (source_id, original_asset_id)
);

CREATE TABLE asset.storage_receipts (
  receipt_id uuid PRIMARY KEY,
  submission_id text NOT NULL,
  project_id text NOT NULL,
  source_version_id uuid NOT NULL REFERENCES asset.source_versions(source_version_id),
  channel text NOT NULL CHECK (channel IN ('direct_text', 'file_upload')),
  material_kind text NOT NULL CHECK (material_kind = 'plain_text'),
  original_file_name text,
  asset_reused boolean NOT NULL,
  version_created boolean NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, submission_id)
);

CREATE INDEX asset_receipts_version_idx
  ON asset.storage_receipts (project_id, source_version_id);
