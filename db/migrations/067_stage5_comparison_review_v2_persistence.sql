-- Issue #203 / ADR-160 WP5: additive v2 Review Draft persistence.
--
-- The historical review.change_sets/decisions/manifests tables are not
-- altered.  v2 Drafts retain their frozen contract JSON and are keyed by the
-- project-scoped durable Comparison v2 aggregate.  Approval/manifest writes
-- remain user-only and are deliberately outside this orchestration migration.

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
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS change_sets_v2_candidate_idx
  ON review.change_sets_v2 (project_id, candidate_id, updated_at DESC);
