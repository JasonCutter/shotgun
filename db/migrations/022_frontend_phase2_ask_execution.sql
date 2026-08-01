-- Additive I03 execution persistence. Existing ACTION_REQUIRED rows remain valid.

DO $$
BEGIN
  IF to_regclass('frontend_ask.answer_runs') IS NULL THEN
    RAISE EXCEPTION 'Migration 022 preflight failed: frontend_ask.answer_runs is missing';
  END IF;
END
$$;

ALTER TABLE frontend_ask.answer_runs
  ADD COLUMN failure_code text,
  ADD COLUMN failure_message text,
  ADD COLUMN failure_retryable boolean,
  ADD COLUMN failure_outcome_unknown boolean,
  ADD COLUMN partial_text text,
  ADD COLUMN provider_name text,
  ADD COLUMN provider_model text,
  ADD COLUMN provider_adapter_version text,
  ADD COLUMN input_tokens integer,
  ADD COLUMN output_tokens integer,
  ADD COLUMN total_tokens integer,
  ADD COLUMN cost_micros bigint,
  ADD COLUMN attempt_number integer NOT NULL DEFAULT 0,
  ADD COLUMN event_revision integer NOT NULL DEFAULT 0;

ALTER TABLE frontend_ask.answer_runs
  ADD CONSTRAINT frontend_ask_answer_runs_failure_shape_check CHECK (
    (failure_code IS NULL AND failure_message IS NULL AND failure_retryable IS NULL AND failure_outcome_unknown IS NULL)
    OR (failure_code IS NOT NULL AND failure_message IS NOT NULL AND failure_retryable IS NOT NULL AND failure_outcome_unknown IS NOT NULL)
  ),
  ADD CONSTRAINT frontend_ask_answer_runs_usage_bounds_check CHECK (
    (input_tokens IS NULL OR input_tokens >= 0)
    AND (output_tokens IS NULL OR output_tokens >= 0)
    AND (total_tokens IS NULL OR total_tokens >= 0)
    AND (cost_micros IS NULL OR cost_micros >= 0)
  ),
  ADD CONSTRAINT frontend_ask_answer_runs_attempt_bounds_check CHECK (attempt_number >= 0),
  ADD CONSTRAINT frontend_ask_answer_runs_event_revision_bounds_check CHECK (event_revision >= 0);

CREATE TABLE frontend_ask.answer_run_attempts (
  attempt_id text PRIMARY KEY,
  answer_run_id text NOT NULL,
  project_id text NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  attempt_kind text NOT NULL CHECK (attempt_kind IN ('INITIAL', 'RETRY_SAME_CONTEXT', 'RETRY_CURRENT_POLICY')),
  state text NOT NULL CHECK (
    state IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED', 'OUTCOME_UNKNOWN')
  ),
  access_revision text NOT NULL CHECK (length(access_revision) BETWEEN 1 AND 512),
  policy_context_revision text NOT NULL CHECK (length(policy_context_revision) BETWEEN 1 AND 512),
  provider_name text,
  provider_model text,
  provider_adapter_version text,
  failure_code text,
  failure_message text,
  failure_retryable boolean,
  failure_outcome_unknown boolean,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (answer_run_id, attempt_number),
  FOREIGN KEY (project_id, answer_run_id)
    REFERENCES frontend_ask.answer_runs(project_id, answer_run_id)
    ON DELETE CASCADE,
  CHECK (updated_at >= created_at),
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  CHECK (
    (failure_code IS NULL AND failure_message IS NULL AND failure_retryable IS NULL AND failure_outcome_unknown IS NULL)
    OR (failure_code IS NOT NULL AND failure_message IS NOT NULL AND failure_retryable IS NOT NULL AND failure_outcome_unknown IS NOT NULL)
  )
);

CREATE INDEX frontend_ask_answer_run_attempts_project_run_idx
  ON frontend_ask.answer_run_attempts (project_id, answer_run_id, attempt_number DESC);

CREATE TABLE frontend_ask.answer_run_events (
  event_id text PRIMARY KEY,
  answer_run_id text NOT NULL,
  project_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  kind text NOT NULL CHECK (kind IN ('STATE', 'PARTIAL', 'COMPLETED', 'FAILED', 'CANCELLED')),
  state text NOT NULL CHECK (
    state IN ('QUEUED', 'RUNNING', 'STREAMING', 'ACTION_REQUIRED', 'PARTIAL', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED', 'OUTCOME_UNKNOWN')
  ),
  partial_text text,
  answer_revision text NOT NULL CHECK (length(answer_revision) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL,
  UNIQUE (answer_run_id, ordinal),
  FOREIGN KEY (project_id, answer_run_id)
    REFERENCES frontend_ask.answer_runs(project_id, answer_run_id)
    ON DELETE CASCADE
);

CREATE INDEX frontend_ask_answer_run_events_project_run_idx
  ON frontend_ask.answer_run_events (project_id, answer_run_id, ordinal);

CREATE TABLE frontend_ask.answer_exports (
  export_id text PRIMARY KEY,
  answer_run_id text NOT NULL,
  project_id text NOT NULL,
  principal_id text NOT NULL,
  format text NOT NULL CHECK (format IN ('MARKDOWN', 'JSON')),
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 1000000),
  request_id text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (principal_id, answer_run_id, request_id),
  FOREIGN KEY (project_id, answer_run_id)
    REFERENCES frontend_ask.answer_runs(project_id, answer_run_id)
    ON DELETE CASCADE
);

CREATE TABLE frontend_ask.answer_feedback (
  feedback_id text PRIMARY KEY,
  answer_run_id text NOT NULL,
  project_id text NOT NULL,
  principal_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('HELPFUL', 'NOT_HELPFUL', 'REPORT_ISSUE')),
  comment text CHECK (comment IS NULL OR length(comment) <= 2000),
  request_id text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (principal_id, answer_run_id, request_id),
  FOREIGN KEY (project_id, answer_run_id)
    REFERENCES frontend_ask.answer_runs(project_id, answer_run_id)
    ON DELETE CASCADE
);

CREATE TABLE frontend_ask.transition_seeds (
  seed_id text PRIMARY KEY,
  answer_run_id text NOT NULL,
  project_id text NOT NULL,
  principal_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('INTAKE_DRAFT', 'DRAFT_CHANGE_SET', 'USER_DIRECTIVE')),
  state text NOT NULL CHECK (state = 'PROPOSED'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  request_id text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (principal_id, answer_run_id, kind, request_id),
  FOREIGN KEY (project_id, answer_run_id)
    REFERENCES frontend_ask.answer_runs(project_id, answer_run_id)
    ON DELETE CASCADE
);

CREATE INDEX frontend_ask_transition_seeds_project_run_idx
  ON frontend_ask.transition_seeds (project_id, answer_run_id, created_at);
