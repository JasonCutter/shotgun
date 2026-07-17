CREATE TABLE projection.compiled_truth (
  project_id text PRIMARY KEY,
  projector_version text NOT NULL,
  source_snapshot_digest text CHECK (source_snapshot_digest IS NULL OR source_snapshot_digest ~ '^sha256:[a-f0-9]{64}$'),
  logical_digest text CHECK (logical_digest IS NULL OR logical_digest ~ '^sha256:[a-f0-9]{64}$'),
  canonical_version integer NOT NULL DEFAULT 0 CHECK (canonical_version >= 0),
  build_mode text CHECK (build_mode IS NULL OR build_mode IN ('FULL_REBUILD', 'INCREMENTAL')),
  projection jsonb,
  status text NOT NULL CHECK (status IN ('READY', 'DEGRADED')),
  last_error text,
  updated_at timestamptz NOT NULL,
  CHECK (
    (status = 'READY' AND projection IS NOT NULL AND source_snapshot_digest IS NOT NULL
      AND logical_digest IS NOT NULL AND build_mode IS NOT NULL AND last_error IS NULL)
    OR status = 'DEGRADED'
  )
);

CREATE TABLE projection.discovery_inferences (
  project_id text NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  candidate_id text NOT NULL,
  candidate jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, fingerprint),
  UNIQUE (project_id, candidate_id)
);

CREATE INDEX projection_discovery_created_idx
  ON projection.discovery_inferences (project_id, created_at, candidate_id);
