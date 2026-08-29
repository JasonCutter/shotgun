-- AKP-4 WP1: durable Discovery trigger/job/run/attempt/stage authority.
-- This migration creates no outbox, scheduler, Activity ledger, or finding store.

DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '047_akp_3_wp3_discovery_model_profiles.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 048 preflight failed: 047 is missing';
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS discovery;

CREATE TABLE discovery.jobs (
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  job_id text NOT NULL,
  logical_job_identity text NOT NULL CHECK (length(logical_job_identity) BETWEEN 1 AND 512),
  logical_job_identity_version text NOT NULL CHECK (logical_job_identity_version = 'discovery-job-logical:v1'),
  schema_version text NOT NULL CHECK (schema_version = '1.0.0'),
  trigger_id text NOT NULL CHECK (length(trigger_id) BETWEEN 1 AND 512),
  trigger_class text NOT NULL CHECK (trigger_class IN ('CANONICAL_COMMITTED', 'SCHEDULED_FULL_SCAN', 'MANUAL')),
  trigger jsonb NOT NULL CHECK (jsonb_typeof(trigger) = 'object'),
  requested_scan_mode text NOT NULL CHECK (requested_scan_mode IN ('INCREMENTAL', 'FULL_SCAN')),
  effective_scan_mode text NOT NULL CHECK (effective_scan_mode IN ('INCREMENTAL', 'FULL_SCAN')),
  canonical_base_version integer NOT NULL CHECK (canonical_base_version >= 0),
  canonical_snapshot_digest text NOT NULL,
  required_projection_revision text,
  required_projection_digest text,
  policy_revision text NOT NULL,
  strategy_revision text NOT NULL,
  profile_id text,
  profile_revision integer,
  budget_version text NOT NULL CHECK (budget_version = 'discovery-work-budget:v1'),
  budget_id text NOT NULL,
  budget_revision text NOT NULL,
  budget jsonb NOT NULL CHECK (jsonb_typeof(budget) = 'object'),
  lifecycle_state text NOT NULL CHECK (lifecycle_state IN (
    'QUEUED', 'WAITING_FOR_PROJECTION', 'RUNNING', 'PARTIAL', 'SUCCEEDED',
    'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'
  )),
  lifecycle_revision integer NOT NULL CHECK (lifecycle_revision >= 1),
  wait_projection_revision text,
  wait_projection_digest text,
  wait_deadline_at timestamptz,
  wait_fallback_policy_revision text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, job_id),
  UNIQUE (project_id, logical_job_identity_version, logical_job_identity),
  UNIQUE (project_id, job_id, logical_job_identity),
  CHECK ((required_projection_revision IS NULL) = (required_projection_digest IS NULL)),
  CHECK ((trigger_class = 'CANONICAL_COMMITTED' AND requested_scan_mode = 'INCREMENTAL' AND effective_scan_mode = 'INCREMENTAL')
    OR (trigger_class = 'SCHEDULED_FULL_SCAN' AND requested_scan_mode = 'FULL_SCAN' AND effective_scan_mode = 'FULL_SCAN')
    OR (trigger_class = 'MANUAL')),
  CHECK ((profile_id IS NULL) = (profile_revision IS NULL)),
  CHECK ((wait_projection_revision IS NULL AND wait_projection_digest IS NULL AND wait_deadline_at IS NULL AND wait_fallback_policy_revision IS NULL)
    OR (wait_projection_revision IS NOT NULL AND wait_projection_digest IS NOT NULL AND wait_deadline_at IS NOT NULL AND wait_fallback_policy_revision IS NOT NULL)),
  CHECK ((lifecycle_state = 'WAITING_FOR_PROJECTION') = (wait_projection_revision IS NOT NULL))
);

CREATE INDEX discovery_jobs_project_state_idx
  ON discovery.jobs (project_id, lifecycle_state, updated_at DESC);

CREATE TABLE discovery.job_lifecycle_history (
  project_id text NOT NULL,
  job_id text NOT NULL,
  lifecycle_revision integer NOT NULL CHECK (lifecycle_revision >= 1),
  from_state text,
  to_state text NOT NULL CHECK (to_state IN (
    'QUEUED', 'WAITING_FOR_PROJECTION', 'RUNNING', 'PARTIAL', 'SUCCEEDED',
    'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'
  )),
  wait_projection_revision text,
  wait_projection_digest text,
  wait_deadline_at timestamptz,
  wait_fallback_policy_revision text,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, job_id, lifecycle_revision),
  FOREIGN KEY (project_id, job_id) REFERENCES discovery.jobs(project_id, job_id) ON DELETE RESTRICT,
  CHECK ((wait_projection_revision IS NULL AND wait_projection_digest IS NULL AND wait_deadline_at IS NULL AND wait_fallback_policy_revision IS NULL)
    OR (wait_projection_revision IS NOT NULL AND wait_projection_digest IS NOT NULL AND wait_deadline_at IS NOT NULL AND wait_fallback_policy_revision IS NOT NULL))
);

CREATE TABLE discovery.runs (
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  run_id text NOT NULL,
  job_id text NOT NULL,
  run_revision integer NOT NULL CHECK (run_revision >= 1),
  schema_version text NOT NULL CHECK (schema_version = '1.0.0'),
  requested_scan_mode text NOT NULL CHECK (requested_scan_mode IN ('INCREMENTAL', 'FULL_SCAN')),
  effective_scan_mode text NOT NULL CHECK (effective_scan_mode IN ('INCREMENTAL', 'FULL_SCAN')),
  canonical_base_version integer NOT NULL CHECK (canonical_base_version >= 0),
  canonical_snapshot_digest text NOT NULL,
  required_projection_revision text,
  required_projection_digest text,
  policy_revision text NOT NULL,
  strategy_revision text NOT NULL,
  profile_id text,
  profile_revision integer,
  budget_version text NOT NULL CHECK (budget_version = 'discovery-work-budget:v1'),
  budget_id text NOT NULL,
  budget_revision text NOT NULL,
  budget jsonb NOT NULL CHECK (jsonb_typeof(budget) = 'object'),
  lifecycle_state text NOT NULL CHECK (lifecycle_state IN (
    'QUEUED', 'WAITING_FOR_PROJECTION', 'RUNNING', 'PARTIAL', 'SUCCEEDED',
    'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'
  )),
  lifecycle_revision integer NOT NULL CHECK (lifecycle_revision >= 1),
  wait_projection_revision text,
  wait_projection_digest text,
  wait_deadline_at timestamptz,
  wait_fallback_policy_revision text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (project_id, run_id),
  UNIQUE (project_id, run_id, job_id),
  FOREIGN KEY (project_id, job_id) REFERENCES discovery.jobs(project_id, job_id) ON DELETE RESTRICT,
  CHECK ((required_projection_revision IS NULL) = (required_projection_digest IS NULL)),
  CHECK (completed_at IS NULL OR lifecycle_state IN ('SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED')),
  CHECK ((profile_id IS NULL) = (profile_revision IS NULL)),
  CHECK ((wait_projection_revision IS NULL AND wait_projection_digest IS NULL AND wait_deadline_at IS NULL AND wait_fallback_policy_revision IS NULL)
    OR (wait_projection_revision IS NOT NULL AND wait_projection_digest IS NOT NULL AND wait_deadline_at IS NOT NULL AND wait_fallback_policy_revision IS NOT NULL)),
  CHECK ((lifecycle_state = 'WAITING_FOR_PROJECTION') = (wait_projection_revision IS NOT NULL))
);

CREATE INDEX discovery_runs_project_job_idx
  ON discovery.runs (project_id, job_id, run_revision);

CREATE TABLE discovery.run_lifecycle_history (
  project_id text NOT NULL,
  run_id text NOT NULL,
  job_id text NOT NULL,
  lifecycle_revision integer NOT NULL CHECK (lifecycle_revision >= 1),
  from_state text CHECK (from_state IS NULL OR from_state IN (
    'QUEUED', 'WAITING_FOR_PROJECTION', 'RUNNING', 'PARTIAL', 'SUCCEEDED',
    'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'
  )),
  to_state text NOT NULL CHECK (to_state IN (
    'QUEUED', 'WAITING_FOR_PROJECTION', 'RUNNING', 'PARTIAL', 'SUCCEEDED',
    'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'
  )),
  wait_projection_revision text,
  wait_projection_digest text,
  wait_deadline_at timestamptz,
  wait_fallback_policy_revision text,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, run_id, lifecycle_revision),
  FOREIGN KEY (project_id, run_id, job_id) REFERENCES discovery.runs(project_id, run_id, job_id) ON DELETE RESTRICT,
  CHECK ((wait_projection_revision IS NULL AND wait_projection_digest IS NULL AND wait_deadline_at IS NULL AND wait_fallback_policy_revision IS NULL)
    OR (wait_projection_revision IS NOT NULL AND wait_projection_digest IS NOT NULL AND wait_deadline_at IS NOT NULL AND wait_fallback_policy_revision IS NOT NULL))
);

CREATE TABLE discovery.attempts (
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  attempt_id text NOT NULL,
  run_id text NOT NULL,
  job_id text NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  lifecycle_revision integer NOT NULL CHECK (lifecycle_revision >= 1),
  attempt_kind text NOT NULL CHECK (attempt_kind IN ('INITIAL', 'DOMAIN_RETRY')),
  lifecycle_state text NOT NULL CHECK (lifecycle_state IN (
    'QUEUED', 'WAITING_FOR_PROJECTION', 'RUNNING', 'PARTIAL', 'SUCCEEDED',
    'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'
  )),
  previous_attempt_id text,
  schema_version text NOT NULL CHECK (schema_version = '1.0.0'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (project_id, attempt_id),
  UNIQUE (project_id, run_id, attempt_number),
  UNIQUE (project_id, run_id, attempt_id),
  UNIQUE (project_id, run_id, attempt_id, job_id),
  FOREIGN KEY (project_id, run_id, job_id) REFERENCES discovery.runs(project_id, run_id, job_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, run_id, previous_attempt_id, job_id) REFERENCES discovery.attempts(project_id, run_id, attempt_id, job_id) ON DELETE RESTRICT,
  CHECK ((attempt_kind = 'INITIAL' AND attempt_number = 1 AND previous_attempt_id IS NULL)
    OR (attempt_kind = 'DOMAIN_RETRY' AND attempt_number >= 2 AND previous_attempt_id IS NOT NULL)),
  CHECK (updated_at >= created_at),
  CHECK (completed_at IS NULL OR completed_at >= created_at)
);

CREATE INDEX discovery_attempts_project_run_idx
  ON discovery.attempts (project_id, run_id, attempt_number);

CREATE UNIQUE INDEX discovery_attempts_one_initial_idx
  ON discovery.attempts (project_id, run_id)
  WHERE attempt_kind = 'INITIAL';

CREATE TABLE discovery.attempt_lifecycle_history (
  project_id text NOT NULL,
  attempt_id text NOT NULL,
  run_id text NOT NULL,
  job_id text NOT NULL,
  lifecycle_revision integer NOT NULL CHECK (lifecycle_revision >= 1),
  from_state text CHECK (from_state IS NULL OR from_state IN (
    'QUEUED', 'WAITING_FOR_PROJECTION', 'RUNNING', 'PARTIAL', 'SUCCEEDED',
    'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'
  )),
  to_state text NOT NULL CHECK (to_state IN (
    'QUEUED', 'WAITING_FOR_PROJECTION', 'RUNNING', 'PARTIAL', 'SUCCEEDED',
    'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'
  )),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, attempt_id, lifecycle_revision),
  FOREIGN KEY (project_id, run_id, attempt_id, job_id) REFERENCES discovery.attempts(project_id, run_id, attempt_id, job_id) ON DELETE RESTRICT
);

CREATE TABLE discovery.stages (
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  stage_id text NOT NULL,
  run_id text NOT NULL,
  attempt_id text NOT NULL,
  job_id text NOT NULL,
  stage_ordinal integer NOT NULL CHECK (stage_ordinal BETWEEN 1 AND 7),
  stage_type text NOT NULL CHECK (stage_type IN (
    'WAIT_FOR_PROJECTION', 'LOAD_SIGNALS', 'GENERATE_FINDINGS', 'QUALITY_GATE',
    'PERSIST_FINDINGS', 'PUBLISH_REENTRY', 'RECONCILE_FINDINGS'
  )),
  stage_revision integer NOT NULL CHECK (stage_revision >= 1),
  state text NOT NULL CHECK (state IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED')),
  schema_version text NOT NULL CHECK (schema_version = '1.0.0'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (project_id, stage_id),
  UNIQUE (project_id, run_id, attempt_id, stage_ordinal),
  FOREIGN KEY (project_id, run_id, job_id) REFERENCES discovery.runs(project_id, run_id, job_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, run_id, attempt_id, job_id) REFERENCES discovery.attempts(project_id, run_id, attempt_id, job_id) ON DELETE RESTRICT,
  CHECK ((stage_type = 'WAIT_FOR_PROJECTION' AND stage_ordinal = 1)
    OR (stage_type = 'LOAD_SIGNALS' AND stage_ordinal = 2)
    OR (stage_type = 'GENERATE_FINDINGS' AND stage_ordinal = 3)
    OR (stage_type = 'QUALITY_GATE' AND stage_ordinal = 4)
    OR (stage_type = 'PERSIST_FINDINGS' AND stage_ordinal = 5)
    OR (stage_type = 'PUBLISH_REENTRY' AND stage_ordinal = 6)
    OR (stage_type = 'RECONCILE_FINDINGS' AND stage_ordinal = 7)),
  CHECK (updated_at >= created_at),
  CHECK (completed_at IS NULL OR completed_at >= created_at)
);

CREATE INDEX discovery_stages_project_run_idx
  ON discovery.stages (project_id, run_id, attempt_id, stage_ordinal);

CREATE TABLE discovery.stage_history (
  project_id text NOT NULL,
  stage_id text NOT NULL,
  run_id text NOT NULL,
  attempt_id text NOT NULL,
  stage_revision integer NOT NULL CHECK (stage_revision >= 1),
  state text NOT NULL CHECK (state IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED')),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, stage_id, stage_revision),
  FOREIGN KEY (project_id, stage_id) REFERENCES discovery.stages(project_id, stage_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, run_id, attempt_id) REFERENCES discovery.attempts(project_id, run_id, attempt_id) ON DELETE RESTRICT
);
