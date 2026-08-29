-- AKP-2 WP3 additive lifecycle authority for immutable Discovery findings.
-- The finding envelope remains immutable; lifecycle state and history live here.

CREATE INDEX IF NOT EXISTS discovery_findings_fingerprint_lookup_idx
  ON discovery.findings (project_id, fingerprint_version, fingerprint);

CREATE TABLE IF NOT EXISTS discovery.finding_lifecycle_current (
  project_id text NOT NULL,
  finding_id text NOT NULL,
  finding_revision integer NOT NULL CHECK (finding_revision >= 1),
  lifecycle_state text NOT NULL CHECK (
    lifecycle_state IN (
      'NEW',
      'VALIDATING',
      'REVIEW_READY',
      'REENTERED',
      'DISMISSED',
      'SUPPRESSED',
      'RESOLVED',
      'STALE',
      'SUPERSEDED'
    )
  ),
  lifecycle_revision integer NOT NULL CHECK (lifecycle_revision >= 1),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, finding_id, finding_revision),
  CONSTRAINT discovery_finding_lifecycle_current_finding_fk
    FOREIGN KEY (project_id, finding_id, finding_revision)
    REFERENCES discovery.findings (project_id, finding_id, finding_revision)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS discovery.finding_lifecycle_history (
  project_id text NOT NULL,
  finding_id text NOT NULL,
  finding_revision integer NOT NULL CHECK (finding_revision >= 1),
  lifecycle_revision integer NOT NULL CHECK (lifecycle_revision >= 1),
  from_state text CHECK (
    from_state IS NULL OR from_state IN (
      'NEW',
      'VALIDATING',
      'REVIEW_READY',
      'REENTERED',
      'DISMISSED',
      'SUPPRESSED',
      'RESOLVED',
      'STALE',
      'SUPERSEDED'
    )
  ),
  to_state text NOT NULL CHECK (
    to_state IN (
      'NEW',
      'VALIDATING',
      'REVIEW_READY',
      'REENTERED',
      'DISMISSED',
      'SUPPRESSED',
      'RESOLVED',
      'STALE',
      'SUPERSEDED'
    )
  ),
  cause text NOT NULL CHECK (
    cause IN ('MATERIALIZATION', 'GOVERNED_WORKFLOW', 'SYSTEM_RECONCILIATION')
  ),
  reason_code text NOT NULL CHECK (
    reason_code IN (
      'FINDING_MATERIALIZED',
      'VALIDATION_STARTED',
      'REVIEW_READY',
      'REENTERED',
      'DISMISSED',
      'SUPPRESSED',
      'CANONICAL_EQUIVALENT_ACCEPTED',
      'SOURCE_MATERIALLY_SUPERSEDED',
      'RELEVANT_INPUT_CHANGED'
    )
  ),
  canonical_base_version integer CHECK (canonical_base_version IS NULL OR canonical_base_version >= 0),
  canonical_snapshot_digest text,
  discovery_projection_revision text,
  discovery_projection_digest text,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, finding_id, finding_revision, lifecycle_revision),
  CONSTRAINT discovery_finding_lifecycle_history_finding_fk
    FOREIGN KEY (project_id, finding_id, finding_revision)
    REFERENCES discovery.findings (project_id, finding_id, finding_revision)
    ON DELETE RESTRICT,
  CONSTRAINT discovery_finding_lifecycle_history_canonical_context_ck
    CHECK ((canonical_base_version IS NULL) = (canonical_snapshot_digest IS NULL)),
  CONSTRAINT discovery_finding_lifecycle_history_discovery_context_ck
    CHECK ((discovery_projection_revision IS NULL) = (discovery_projection_digest IS NULL))
);

CREATE INDEX IF NOT EXISTS discovery_finding_lifecycle_history_identity_idx
  ON discovery.finding_lifecycle_history (
    project_id, finding_id, finding_revision, lifecycle_revision
  );

CREATE OR REPLACE FUNCTION discovery.block_finding_lifecycle_history_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Discovery finding lifecycle history is append-only and immutable';
END;
$$;

DROP TRIGGER IF EXISTS discovery_finding_lifecycle_history_immutable
  ON discovery.finding_lifecycle_history;

CREATE TRIGGER discovery_finding_lifecycle_history_immutable
  BEFORE UPDATE OR DELETE ON discovery.finding_lifecycle_history
  FOR EACH ROW EXECUTE FUNCTION discovery.block_finding_lifecycle_history_mutation();

-- Initialize authority for rows written by WP2 before this migration. Both
-- inserts are idempotent so a partial prior deployment can be safely resumed.
INSERT INTO discovery.finding_lifecycle_current (
  project_id, finding_id, finding_revision, lifecycle_state, lifecycle_revision, updated_at
)
SELECT
  project_id, finding_id, finding_revision, lifecycle_state, 1, created_at
FROM discovery.findings
ON CONFLICT (project_id, finding_id, finding_revision) DO NOTHING;

INSERT INTO discovery.finding_lifecycle_history (
  project_id, finding_id, finding_revision, lifecycle_revision,
  from_state, to_state, cause, reason_code,
  canonical_base_version, canonical_snapshot_digest,
  discovery_projection_revision, discovery_projection_digest, occurred_at
)
SELECT
  project_id, finding_id, finding_revision, 1,
  NULL, lifecycle_state, 'MATERIALIZATION', 'FINDING_MATERIALIZED',
  canonical_base_version, canonical_snapshot_digest,
  discovery_projection_revision, discovery_projection_digest, created_at
FROM discovery.findings
ON CONFLICT (project_id, finding_id, finding_revision, lifecycle_revision) DO NOTHING;
