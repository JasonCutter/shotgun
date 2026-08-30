-- AKP-4 WP4: durable execution, recovery, fencing, budget continuation and
-- FindingReady publication.  This migration is additive; 048/049/050 remain
-- the source of the existing runtime model and are intentionally untouched.

DO $$
BEGIN
  IF to_regclass('discovery.jobs') IS NULL
     OR to_regclass('discovery.runs') IS NULL
     OR to_regclass('discovery.attempts') IS NULL
     OR to_regclass('discovery.stages') IS NULL
     OR to_regclass('discovery.findings') IS NULL THEN
    RAISE EXCEPTION 'Migration 051 preflight failed: WP1/WP2 runtime tables are missing';
  END IF;
END
$$;

-- A Job has one durable Run lineage when claimed. The Job row lock in
-- PostgresDiscoveryRuntimeRepository is the concurrency guard; this lookup
-- index keeps that path bounded without tightening the pre-existing saveRun
-- contract used by historical runtime tests and repair tooling.
CREATE INDEX IF NOT EXISTS discovery_runs_one_per_job_lookup_idx
  ON discovery.runs (project_id, job_id);

ALTER TABLE discovery.attempts
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_acquired_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS fencing_token bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS failure_classification text,
  ADD COLUMN IF NOT EXISTS failure_retryable boolean,
  ADD COLUMN IF NOT EXISTS failure_safe_message text,
  ADD COLUMN IF NOT EXISTS failure_stage text,
  ADD COLUMN IF NOT EXISTS failure_occurred_at timestamptz,
  ADD COLUMN IF NOT EXISTS retry_not_before timestamptz;

ALTER TABLE discovery.attempts
  DROP CONSTRAINT IF EXISTS discovery_attempts_fencing_token_ck,
  ADD CONSTRAINT discovery_attempts_fencing_token_ck CHECK (fencing_token >= 0),
  DROP CONSTRAINT IF EXISTS discovery_attempts_failure_classification_ck,
  ADD CONSTRAINT discovery_attempts_failure_classification_ck
    CHECK (failure_classification IS NULL OR failure_classification IN ('RETRYABLE', 'TERMINAL')),
  DROP CONSTRAINT IF EXISTS discovery_attempts_failure_binding_ck,
  ADD CONSTRAINT discovery_attempts_failure_binding_ck CHECK (
    (failure_code IS NULL AND failure_classification IS NULL AND failure_retryable IS NULL
      AND failure_safe_message IS NULL AND failure_stage IS NULL AND failure_occurred_at IS NULL
      AND retry_not_before IS NULL)
    OR (failure_code IS NOT NULL AND failure_classification IS NOT NULL
      AND failure_retryable IS NOT NULL AND failure_safe_message IS NOT NULL
      AND failure_stage IS NOT NULL AND failure_occurred_at IS NOT NULL)
  ),
  DROP CONSTRAINT IF EXISTS discovery_attempts_lease_binding_ck,
  ADD CONSTRAINT discovery_attempts_lease_binding_ck CHECK (
    (lease_owner IS NULL AND lease_acquired_at IS NULL AND lease_expires_at IS NULL)
    OR (lease_owner IS NOT NULL AND lease_acquired_at IS NOT NULL AND lease_expires_at IS NOT NULL
      AND lease_expires_at > lease_acquired_at)
  );

CREATE INDEX IF NOT EXISTS discovery_attempts_claim_idx
  ON discovery.attempts (
    project_id, lifecycle_state, retry_not_before, lease_expires_at, updated_at
  );

CREATE INDEX IF NOT EXISTS discovery_attempts_lease_owner_idx
  ON discovery.attempts (project_id, lease_owner, lease_expires_at);

CREATE TABLE IF NOT EXISTS discovery.work_budget_checkpoints (
  project_id text NOT NULL,
  job_id text NOT NULL,
  run_id text NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  fencing_token bigint NOT NULL CHECK (fencing_token >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, run_id),
  CONSTRAINT discovery_work_budget_checkpoint_run_fk
    FOREIGN KEY (project_id, run_id, job_id)
    REFERENCES discovery.runs (project_id, run_id, job_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS discovery_work_budget_checkpoint_job_idx
  ON discovery.work_budget_checkpoints (project_id, job_id, revision);

-- Completed stage values are a recovery checkpoint, not a second Finding
-- authority.  The payload is intentionally bounded JSON owned by the stage
-- adapter; prompts, credentials, headers, and arbitrary provider responses
-- must never be written here.
CREATE TABLE IF NOT EXISTS discovery.stage_outputs (
  project_id text NOT NULL,
  job_id text NOT NULL,
  run_id text NOT NULL,
  attempt_id text NOT NULL,
  stage_id text NOT NULL,
  stage_type text NOT NULL,
  stage_revision integer NOT NULL CHECK (stage_revision >= 1),
  output jsonb NOT NULL CHECK (jsonb_typeof(output) IN ('object', 'array')),
  fencing_token bigint NOT NULL CHECK (fencing_token >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, attempt_id, stage_id),
  UNIQUE (project_id, run_id, attempt_id, stage_type),
  CONSTRAINT discovery_stage_output_stage_fk
    FOREIGN KEY (project_id, stage_id)
    REFERENCES discovery.stages (project_id, stage_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS discovery_stage_outputs_run_idx
  ON discovery.stage_outputs (project_id, run_id, attempt_id, stage_type);

-- Provider admission is recorded before an external call is dispatched. A
-- RESERVED row is deliberately recoverable after a process crash; it is not a
-- provider response or a credential store.
CREATE TABLE IF NOT EXISTS discovery.provider_budget_reservations (
  project_id text NOT NULL,
  job_id text NOT NULL,
  run_id text NOT NULL,
  attempt_id text NOT NULL,
  reservation_id text NOT NULL,
  provider_id text NOT NULL,
  model_id text NOT NULL,
  input_token_upper_bound integer NOT NULL CHECK (input_token_upper_bound > 0),
  max_output_tokens integer NOT NULL CHECK (max_output_tokens > 0),
  estimated_cost_micros bigint NOT NULL CHECK (estimated_cost_micros >= 0),
  actual_input_tokens integer CHECK (actual_input_tokens >= 0),
  actual_output_tokens integer CHECK (actual_output_tokens >= 0),
  actual_cost_micros bigint CHECK (actual_cost_micros >= 0),
  state text NOT NULL CHECK (state IN ('RESERVED', 'FINALIZED', 'CANCELLED')),
  fencing_token bigint NOT NULL CHECK (fencing_token >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, reservation_id),
  CONSTRAINT discovery_provider_budget_reservation_attempt_fk
    FOREIGN KEY (project_id, attempt_id)
    REFERENCES discovery.attempts (project_id, attempt_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS discovery_provider_budget_reservations_active_idx
  ON discovery.provider_budget_reservations (project_id, run_id, attempt_id, state);

CREATE TABLE IF NOT EXISTS discovery.finding_ready (
  publication_id text NOT NULL,
  project_id text NOT NULL,
  finding_id text NOT NULL,
  finding_revision integer NOT NULL CHECK (finding_revision >= 1),
  fingerprint text NOT NULL,
  fingerprint_version text NOT NULL,
  job_id text NOT NULL,
  run_id text NOT NULL,
  attempt_id text NOT NULL,
  canonical_base_version integer NOT NULL CHECK (canonical_base_version >= 0),
  canonical_snapshot_digest text NOT NULL,
  required_projection_revision text,
  required_projection_digest text,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (publication_id),
  UNIQUE (project_id, finding_id, finding_revision),
  CONSTRAINT discovery_finding_ready_finding_fk
    FOREIGN KEY (project_id, finding_id, finding_revision)
    REFERENCES discovery.findings (project_id, finding_id, finding_revision)
    ON DELETE RESTRICT,
  CONSTRAINT discovery_finding_ready_attempt_fk
    FOREIGN KEY (project_id, run_id, attempt_id, job_id)
    REFERENCES discovery.attempts (project_id, run_id, attempt_id, job_id)
    ON DELETE RESTRICT,
  CHECK ((required_projection_revision IS NULL) = (required_projection_digest IS NULL))
);

CREATE INDEX IF NOT EXISTS discovery_finding_ready_run_idx
  ON discovery.finding_ready (project_id, run_id, attempt_id, occurred_at);

CREATE INDEX IF NOT EXISTS discovery_finding_ready_fingerprint_idx
  ON discovery.finding_ready (project_id, fingerprint_version, fingerprint);
