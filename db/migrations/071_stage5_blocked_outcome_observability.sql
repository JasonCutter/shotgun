-- Issue #245: durable, comparison-owned pre-terminal Stage 5 blocks.
-- This is operational state only. It never represents a ComparisonResult,
-- AnalysisRevision, Review decision or Canonical authority.

DO $$
BEGIN
  IF to_regclass('comparison.results_v2') IS NULL
     OR to_regclass('comparison.analysis_revisions_v2') IS NULL THEN
    RAISE EXCEPTION 'Migration 071 preflight failed: Stage 5 v2 tables are missing';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS comparison.blocked_outcomes_v2 (
  blocked_outcome_id text PRIMARY KEY CHECK (length(btrim(blocked_outcome_id)) > 0),
  project_id text NOT NULL CHECK (length(btrim(project_id)) > 0),
  candidate_id text NOT NULL CHECK (length(btrim(candidate_id)) > 0),
  candidate_revision integer NOT NULL CHECK (candidate_revision > 0),
  candidate_digest text NOT NULL CHECK (candidate_digest ~ '^sha256:[a-f0-9]{64}$'),
  blocked_phase text NOT NULL CHECK (
    blocked_phase IN ('CANDIDATE_RESOLUTION', 'SHORTLIST', 'SEMANTIC_IDENTITY', 'SEMANTIC_ANALYSIS', 'CONTRACT')
  ),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  safe_code text NOT NULL CHECK (length(btrim(safe_code)) > 0),
  governing_input_digest text NOT NULL CHECK (governing_input_digest ~ '^sha256:[a-f0-9]{64}$'),
  access_scope text[] NOT NULL CHECK (cardinality(access_scope) > 0),
  sensitivity text NOT NULL CHECK (sensitivity IN ('public', 'internal', 'private', 'restricted')),
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('ACTIVE', 'RESOLVED', 'SUPERSEDED')),
  resolved_at timestamptz,
  resolution_identity text,
  UNIQUE (
    project_id, candidate_id, candidate_revision, candidate_digest,
    blocked_phase, reason, governing_input_digest
  )
);

CREATE INDEX IF NOT EXISTS blocked_outcomes_v2_active_idx
  ON comparison.blocked_outcomes_v2 (project_id, state, last_observed_at DESC)
  WHERE state = 'ACTIVE';

CREATE INDEX IF NOT EXISTS blocked_outcomes_v2_candidate_idx
  ON comparison.blocked_outcomes_v2 (project_id, candidate_id, candidate_revision, last_observed_at DESC);
