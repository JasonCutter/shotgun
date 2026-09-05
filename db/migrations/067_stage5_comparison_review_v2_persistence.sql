-- Issue #203 / ADR-160 WP5: additive v2 Review Draft persistence.
--
-- The historical review.change_sets/decisions/manifests tables are not
-- altered.  v2 Drafts retain their frozen contract JSON and are keyed by the
-- project-scoped durable Comparison v2 aggregate.  Decision and approved
-- manifest evidence are additive, project-scoped, and immutable at the v2
-- boundary; Canonical writes remain outside this migration.

DO $$
BEGIN
  IF to_regclass('comparison.results_v2') IS NULL THEN
    RAISE EXCEPTION 'Migration 067 preflight failed: comparison.results_v2 is missing';
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS review;

CREATE TABLE IF NOT EXISTS review.change_sets_v2 (
  change_set_id text PRIMARY KEY CHECK (length(btrim(change_set_id)) > 0),
  project_id text NOT NULL CHECK (length(btrim(project_id)) BETWEEN 1 AND 200),
  candidate_id uuid NOT NULL,
  comparison_id text NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  status text NOT NULL CHECK (
    status IN ('PENDING_REVIEW', 'ON_HOLD', 'APPROVED', 'REJECTED', 'STALE')
  ),
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  expected_canonical_version integer NOT NULL CHECK (expected_canonical_version >= 0),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[a-f0-9]{64}$'),
  change_set_json jsonb NOT NULL CHECK (jsonb_typeof(change_set_json) = 'object'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (project_id, comparison_id),
  CONSTRAINT change_sets_v2_comparison_scope_fk
    FOREIGN KEY (project_id, comparison_id)
    REFERENCES comparison.results_v2 (project_id, comparison_id)
    ON DELETE RESTRICT,
  CONSTRAINT change_sets_v2_candidate_scope_fk
    FOREIGN KEY (project_id, candidate_id)
    REFERENCES candidate.claim_candidates (project_id, candidate_id)
    ON DELETE RESTRICT,
  CONSTRAINT change_sets_v2_project_change_set_uq
    UNIQUE (project_id, change_set_id)
);

CREATE INDEX IF NOT EXISTS change_sets_v2_candidate_idx
  ON review.change_sets_v2 (project_id, candidate_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS review.decisions_v2 (
  decision_id text PRIMARY KEY CHECK (length(btrim(decision_id)) > 0),
  project_id text NOT NULL CHECK (length(btrim(project_id)) BETWEEN 1 AND 200),
  change_set_id text NOT NULL,
  expected_revision_number integer NOT NULL CHECK (expected_revision_number > 0),
  expected_content_digest text NOT NULL CHECK (expected_content_digest ~ '^sha256:[a-f0-9]{64}$'),
  decision text NOT NULL CHECK (decision IN ('APPROVE', 'REJECT', 'HOLD')),
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'service', 'system')),
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  decision_json jsonb NOT NULL CHECK (jsonb_typeof(decision_json) = 'object'),
  created_at timestamptz NOT NULL,
  CONSTRAINT decisions_v2_change_set_scope_fk
    FOREIGN KEY (project_id, change_set_id)
    REFERENCES review.change_sets_v2 (project_id, change_set_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS decisions_v2_change_set_idx
  ON review.decisions_v2 (project_id, change_set_id, created_at, decision_id);

CREATE TABLE IF NOT EXISTS review.approved_manifests_v2 (
  manifest_id text PRIMARY KEY CHECK (length(btrim(manifest_id)) > 0),
  project_id text NOT NULL CHECK (length(btrim(project_id)) BETWEEN 1 AND 200),
  change_set_id text NOT NULL,
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  manifest_json jsonb NOT NULL CHECK (jsonb_typeof(manifest_json) = 'object'),
  created_at timestamptz NOT NULL,
  CONSTRAINT approved_manifests_v2_change_set_scope_fk
    FOREIGN KEY (project_id, change_set_id)
    REFERENCES review.change_sets_v2 (project_id, change_set_id)
    ON DELETE RESTRICT,
  UNIQUE (project_id, change_set_id)
);

CREATE INDEX IF NOT EXISTS approved_manifests_v2_project_created_idx
  ON review.approved_manifests_v2 (project_id, created_at, manifest_id);
