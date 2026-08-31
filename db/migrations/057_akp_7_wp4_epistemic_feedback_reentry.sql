-- AKP-7 WP4: server-owned EPISTEMIC feedback re-entry trigger state.
-- This is a bounded durable hand-off ledger, not a second queue or Outbox.
-- The existing Canonical Outbox remains CanonicalCommitted-only because its
-- aggregate FK and ownership are intentionally Canonical-scoped.

DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '056_akp_7_wp3_semantic_family_projection.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 057 preflight failed: 056 is missing';
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS discovery;

-- Existing WP2 manifests/candidates are reused for the correction lane. The
-- optional feedback identity keeps the original Finding/candidate lineage
-- immutable while allowing more than one EPISTEMIC event for one revision.
ALTER TABLE discovery.reentry_manifests
  ADD COLUMN IF NOT EXISTS feedback_id text;

ALTER TABLE discovery.reentry_manifests
  DROP CONSTRAINT IF EXISTS reentry_manifests_logical_identity_version_check,
  DROP CONSTRAINT IF EXISTS reentry_manifests_requested_reentry_purpose_check,
  DROP CONSTRAINT IF EXISTS reentry_manifests_project_id_finding_id_finding_revision_requested_reentry_purpose_key;

ALTER TABLE discovery.reentry_manifests
  ADD CONSTRAINT discovery_reentry_manifests_identity_version_check CHECK (
    logical_identity_version IN (
      'discovery-reentry-identity:v1',
      'discovery-epistemic-reentry-identity:v1'
    )
  ),
  ADD CONSTRAINT discovery_reentry_manifests_purpose_check CHECK (
    requested_reentry_purpose IN (
      'DERIVED_PROVENANCE_VALIDATION',
      'EPISTEMIC_FEEDBACK_CORRECTION'
    )
  ),
  ADD CONSTRAINT discovery_reentry_manifests_feedback_shape_check CHECK (
    (requested_reentry_purpose = 'EPISTEMIC_FEEDBACK_CORRECTION') = (feedback_id IS NOT NULL)
  ),
  ADD CONSTRAINT discovery_reentry_manifests_feedback_fk
    FOREIGN KEY (project_id, feedback_id)
    REFERENCES discovery.feedback_events (project_id, feedback_id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS discovery_reentry_manifests_finding_validation_identity_idx
  ON discovery.reentry_manifests (project_id, finding_id, finding_revision)
  WHERE requested_reentry_purpose = 'DERIVED_PROVENANCE_VALIDATION';

CREATE UNIQUE INDEX IF NOT EXISTS discovery_reentry_manifests_feedback_identity_idx
  ON discovery.reentry_manifests (project_id, feedback_id)
  WHERE requested_reentry_purpose = 'EPISTEMIC_FEEDBACK_CORRECTION';

CREATE INDEX IF NOT EXISTS discovery_reentry_manifests_correction_pending_idx
  ON discovery.reentry_manifests (project_id, finding_id, finding_revision, created_at)
  WHERE requested_reentry_purpose = 'EPISTEMIC_FEEDBACK_CORRECTION';

-- The row is the durable hand-off created in the same application
-- transaction as feedback_events. It records processing/disposition only;
-- all Finding, validation and Review authority remains in existing tables.
CREATE TABLE IF NOT EXISTS discovery.epistemic_reentry_triggers (
  schema_version text NOT NULL CHECK (schema_version = '1.0.0'),
  identity_version text NOT NULL CHECK (
    identity_version = 'discovery-epistemic-reentry-identity:v1'
  ),
  logical_identity_key text NOT NULL,
  feedback_id text NOT NULL,
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  finding_id text NOT NULL,
  finding_revision integer NOT NULL CHECK (finding_revision >= 1),
  feedback_class text NOT NULL CHECK (feedback_class = 'EPISTEMIC'),
  feedback_kind text NOT NULL CHECK (feedback_kind IN (
    'INCORRECT_RELATION', 'INSUFFICIENT_EVIDENCE', 'WRONG_ENTITY',
    'TEMPORAL_ERROR', 'MISLEADING_PATTERN', 'MISIDENTIFIED_CONFLICT'
  )),
  occurred_at timestamptz NOT NULL,
  status text NOT NULL CHECK (
    status IN ('PENDING', 'PROCESSED', 'INELIGIBLE', 'BLOCKED_NON_RETRYABLE', 'RETRYABLE')
  ),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_eligible_at timestamptz,
  reason_code text,
  reason_detail text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, logical_identity_key),
  UNIQUE (project_id, feedback_id),
  CONSTRAINT discovery_epistemic_reentry_trigger_feedback_fk
    FOREIGN KEY (project_id, feedback_id)
    REFERENCES discovery.feedback_events (project_id, feedback_id)
    ON DELETE RESTRICT,
  CONSTRAINT discovery_epistemic_reentry_trigger_finding_fk
    FOREIGN KEY (project_id, finding_id, finding_revision)
    REFERENCES discovery.findings (project_id, finding_id, finding_revision)
    ON DELETE RESTRICT,
  CHECK ((status = 'RETRYABLE') = (next_eligible_at IS NOT NULL)),
  CHECK (status IN ('PENDING', 'RETRYABLE') OR processed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS discovery_epistemic_reentry_triggers_pending_idx
  ON discovery.epistemic_reentry_triggers (next_eligible_at, occurred_at, logical_identity_key)
  WHERE status IN ('PENDING', 'RETRYABLE');

CREATE INDEX IF NOT EXISTS discovery_epistemic_reentry_triggers_finding_idx
  ON discovery.epistemic_reentry_triggers (project_id, finding_id, finding_revision, occurred_at);
