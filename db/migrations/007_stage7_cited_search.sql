CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS projection;

CREATE TABLE projection.search_documents (
  project_id text NOT NULL,
  claim_id text NOT NULL,
  commit_id uuid NOT NULL,
  revision_id text NOT NULL,
  canonical_version integer NOT NULL CHECK (canonical_version >= 1),
  claim_text text NOT NULL,
  source_version_id uuid NOT NULL,
  evidence_ids text[] NOT NULL,
  access_scope text[] NOT NULL,
  sensitivity text NOT NULL CHECK (sensitivity IN ('public', 'internal', 'private', 'restricted')),
  projected_at timestamptz NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', claim_text)) STORED,
  PRIMARY KEY (project_id, claim_id)
);

CREATE INDEX projection_search_fts_idx
  ON projection.search_documents USING gin (search_vector);

CREATE INDEX projection_search_trgm_idx
  ON projection.search_documents USING gin (claim_text gin_trgm_ops);

CREATE TABLE projection.watermarks (
  project_id text PRIMARY KEY,
  last_commit_id uuid,
  canonical_version integer NOT NULL CHECK (canonical_version >= 0),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('READY', 'DEGRADED')),
  last_error text,
  updated_at timestamptz NOT NULL
);
