-- WP-10 governed Action feedback review and Discovery safe diagnostics.
-- This migration is additive and owns no existing Canonical, Evidence, or
-- frontend Review state. Both tables are replay-safe through database keys.
CREATE SCHEMA IF NOT EXISTS action;
CREATE SCHEMA IF NOT EXISTS discovery;

CREATE TABLE IF NOT EXISTS action.action_review_work_items (
  work_item_id uuid PRIMARY KEY,
  project_id text NOT NULL CHECK (length(btrim(project_id)) BETWEEN 1 AND 200),
  semantic_key text NOT NULL CHECK (length(btrim(semantic_key)) BETWEEN 1 AND 500),
  action_id text NOT NULL CHECK (length(btrim(action_id)) BETWEEN 1 AND 200),
  outcome text NOT NULL CHECK (outcome IN ('VERIFIED', 'OUTCOME_UNKNOWN', 'FAILED')),
  phase text NOT NULL CHECK (phase = 'ACTION_REVIEW'),
  status text NOT NULL CHECK (status = 'PENDING'),
  evidence_ref text NOT NULL CHECK (length(btrim(evidence_ref)) BETWEEN 1 AND 500),
  feedback_occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (project_id, semantic_key),
  CHECK (updated_at >= created_at)
);
CREATE INDEX IF NOT EXISTS action_review_work_items_action_idx
  ON action.action_review_work_items (project_id, action_id, created_at DESC);

CREATE TABLE IF NOT EXISTS discovery.semantic_essence_diagnostics (
  diagnostic_id uuid PRIMARY KEY,
  project_id text NOT NULL CHECK (length(btrim(project_id)) BETWEEN 1 AND 200),
  job_id text NOT NULL CHECK (length(btrim(job_id)) BETWEEN 1 AND 200),
  run_id text NOT NULL CHECK (length(btrim(run_id)) BETWEEN 1 AND 200),
  attempt_id text NOT NULL CHECK (length(btrim(attempt_id)) BETWEEN 1 AND 200),
  finding_identity text NOT NULL CHECK (finding_identity ~ '^sha256:[a-f0-9]{64}$'),
  stage text NOT NULL CHECK (stage = 'SEMANTIC_ESSENCE'),
  reason_code text NOT NULL CHECK (reason_code = 'DISCOVERY_SEMANTIC_ESSENCE_INVALID'),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  occurred_at timestamptz NOT NULL,
  completion text NOT NULL CHECK (completion = 'PARTIAL'),
  excluded_count integer NOT NULL CHECK (excluded_count > 0),
  candidate_count integer CHECK (candidate_count IS NULL OR candidate_count BETWEEN 1 AND 100000),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (project_id, run_id, attempt_id, finding_identity, reason_code),
  CHECK (updated_at >= created_at)
);
CREATE INDEX IF NOT EXISTS discovery_semantic_essence_diagnostics_run_idx
  ON discovery.semantic_essence_diagnostics (project_id, run_id, occurred_at DESC);
