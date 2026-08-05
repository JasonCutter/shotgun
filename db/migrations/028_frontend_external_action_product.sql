-- Additive FE-P4-S2 External Action Product persistence (WP3).
-- Bounded additive migration ONLY: no Stage 11 table is rewritten and no
-- existing schema is modified. Creates a new `frontend_external_action`
-- schema for the External Action Product resources (aggregate, candidate,
-- risk decision, manifest, approval, preflight, execution, ordered append-only
-- attempts, verification, result, append-only audit, compensation, rollback,
-- server-owned credential and budget).

DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '027_frontend_review_center.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 028 preflight failed: 027 is missing';
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS frontend_external_action;

-- External Action aggregate. `snapshot` is the authoritative full aggregate
-- round-trip; scalar columns mirror key fields for project-scoped lookups,
-- ordering and revision checks only.
CREATE TABLE frontend_external_action.aggregates (
  action_id text PRIMARY KEY,
  resource_project_id text NOT NULL,
  effective_project_id text NOT NULL,
  status text NOT NULL,
  aggregate_state text NOT NULL,
  action_revision integer NOT NULL CHECK (action_revision > 0),
  access_revision text NOT NULL,
  policy_context_revision text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX frontend_external_action_aggregates_project_idx
  ON frontend_external_action.aggregates (resource_project_id, updated_at DESC, action_id);

-- Candidate revisions: one authoritative candidate per (action_id, candidate_id),
-- latest candidate_revision wins for findByActionId.
CREATE TABLE frontend_external_action.candidates (
  action_id text NOT NULL,
  candidate_id text NOT NULL,
  candidate_revision integer NOT NULL CHECK (candidate_revision > 0),
  resource_project_id text NOT NULL,
  effective_project_id text NOT NULL,
  candidate_digest text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (action_id, candidate_id)
);

CREATE INDEX frontend_external_action_candidates_project_idx
  ON frontend_external_action.candidates (resource_project_id, action_id, candidate_revision DESC);

-- Risk decisions: one per (action_id, risk_decision_id), immutable.
CREATE TABLE frontend_external_action.risk_decisions (
  action_id text NOT NULL,
  risk_decision_id text NOT NULL,
  resource_project_id text NOT NULL,
  effective_project_id text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (action_id, risk_decision_id)
);

-- Manifests: immutable per revision; latest manifest_revision is current.
CREATE TABLE frontend_external_action.manifests (
  manifest_id text PRIMARY KEY,
  action_id text NOT NULL,
  resource_project_id text NOT NULL,
  effective_project_id text NOT NULL,
  manifest_revision integer NOT NULL CHECK (manifest_revision > 0),
  manifest_digest text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (action_id, manifest_revision)
);

CREATE INDEX frontend_external_action_manifests_action_idx
  ON frontend_external_action.manifests (action_id, manifest_revision DESC);

-- Approvals: latest ACTIVE by issued_at is the binding approval.
CREATE TABLE frontend_external_action.approvals (
  approval_id text PRIMARY KEY,
  action_id text NOT NULL,
  resource_project_id text NOT NULL,
  effective_project_id text NOT NULL,
  status text NOT NULL,
  issued_at timestamptz NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX frontend_external_action_approvals_action_idx
  ON frontend_external_action.approvals (action_id, status, issued_at DESC);

-- Preflights: latest by run_at is current.
CREATE TABLE frontend_external_action.preflights (
  preflight_id text PRIMARY KEY,
  action_id text NOT NULL,
  resource_project_id text NOT NULL,
  effective_project_id text NOT NULL,
  run_at timestamptz NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX frontend_external_action_preflights_action_idx
  ON frontend_external_action.preflights (action_id, run_at DESC);

-- Executions: one or more per action; current is the first inserted.
CREATE TABLE frontend_external_action.executions (
  execution_id text PRIMARY KEY,
  action_id text NOT NULL,
  resource_project_id text NOT NULL,
  effective_project_id text NOT NULL,
  status text NOT NULL,
  manifest_revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX frontend_external_action_executions_action_idx
  ON frontend_external_action.executions (action_id);

-- Ordered append-only execution attempts (AC-07): numbered and immutable in
-- ordering — UNIQUE (execution_id, attempt_number) prevents reordering or
-- duplicate numbers. The attempt row itself is upserted from IN_PROGRESS to
-- its terminal state by the same attemptId (never a second record per attempt).
CREATE TABLE frontend_external_action.attempts (
  attempt_id text PRIMARY KEY,
  execution_id text NOT NULL,
  action_id text NOT NULL,
  resource_project_id text NOT NULL,
  effective_project_id text NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  status text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (execution_id, attempt_number)
);

CREATE INDEX frontend_external_action_attempts_execution_idx
  ON frontend_external_action.attempts (execution_id, attempt_number);

-- Verifications and Results: first inserted per action is current.
CREATE TABLE frontend_external_action.verifications (
  verification_id text PRIMARY KEY,
  action_id text NOT NULL,
  resource_project_id text NOT NULL,
  effective_project_id text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX frontend_external_action_verifications_action_idx
  ON frontend_external_action.verifications (action_id);

CREATE TABLE frontend_external_action.results (
  result_id text PRIMARY KEY,
  action_id text NOT NULL,
  resource_project_id text NOT NULL,
  effective_project_id text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX frontend_external_action_results_action_idx
  ON frontend_external_action.results (action_id);

-- Append-only audit events with monotonic per-action sequence (AC-10).
CREATE TABLE frontend_external_action.audit_events (
  audit_event_id text PRIMARY KEY,
  action_id text NOT NULL,
  resource_project_id text NOT NULL,
  effective_project_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  category text NOT NULL,
  snapshot jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (action_id, sequence)
);

CREATE INDEX frontend_external_action_audit_action_idx
  ON frontend_external_action.audit_events (action_id, sequence);

CREATE OR REPLACE FUNCTION frontend_external_action.block_audit_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'frontend_external_action.audit_events is append-only and immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER frontend_external_action_audit_immutable
  BEFORE UPDATE OR DELETE ON frontend_external_action.audit_events
  FOR EACH ROW EXECUTE FUNCTION frontend_external_action.block_audit_mutation();

-- Compensating Action and Rollback (separate governed resources).
CREATE TABLE frontend_external_action.compensations (
  compensation_id text PRIMARY KEY,
  action_id text NOT NULL,
  resource_project_id text NOT NULL,
  effective_project_id text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX frontend_external_action_compensations_action_idx
  ON frontend_external_action.compensations (action_id);

CREATE TABLE frontend_external_action.rollbacks (
  rollback_id text PRIMARY KEY,
  action_id text NOT NULL,
  resource_project_id text NOT NULL,
  effective_project_id text NOT NULL,
  status text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX frontend_external_action_rollbacks_action_idx
  ON frontend_external_action.rollbacks (action_id);

-- Server-owned credential and budget views (AC-13/AC-14).
CREATE TABLE frontend_external_action.credentials (
  connector_id text PRIMARY KEY,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE frontend_external_action.budgets (
  project_id text PRIMARY KEY,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
