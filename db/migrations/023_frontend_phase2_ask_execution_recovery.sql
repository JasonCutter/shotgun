-- Durable AnswerRun context, provider audit, and worker recovery metadata.

DO $$
BEGIN
  IF to_regclass('frontend_ask.answer_run_attempts') IS NULL
     OR to_regclass('frontend_ask.answer_run_events') IS NULL THEN
    RAISE EXCEPTION 'Migration 023 preflight failed: migration 022 is not applied';
  END IF;
END
$$;

ALTER TABLE frontend_ask.answer_run_attempts
  ADD COLUMN data_policy_version text,
  ADD COLUMN resolved_context_digest text,
  ADD COLUMN query_plan_revision text,
  ADD COLUMN provider_response_id text,
  ADD COLUMN lease_owner text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN heartbeat_at timestamptz,
  ADD COLUMN started_at timestamptz,
  ADD COLUMN context_supported boolean NOT NULL DEFAULT true;

ALTER TABLE frontend_ask.answer_runs
  ADD COLUMN access_scope text[] NOT NULL DEFAULT ARRAY['owner']::text[];

ALTER TABLE frontend_ask.answer_runs
  ADD COLUMN sensitivity_clearance text NOT NULL DEFAULT 'public';

ALTER TABLE frontend_ask.answer_runs
  ADD CONSTRAINT frontend_ask_answer_runs_access_scope_check
  CHECK (cardinality(access_scope) > 0);

ALTER TABLE frontend_ask.answer_runs
  ADD CONSTRAINT frontend_ask_answer_runs_sensitivity_clearance_check
  CHECK (sensitivity_clearance IN ('public', 'internal', 'private', 'restricted'));

ALTER TABLE frontend_ask.answer_run_events
  ADD COLUMN attempt_id text REFERENCES frontend_ask.answer_run_attempts(attempt_id) ON DELETE SET NULL;

CREATE TABLE frontend_ask.answer_attempt_evidence (
  attempt_id text NOT NULL REFERENCES frontend_ask.answer_run_attempts(attempt_id) ON DELETE CASCADE,
  evidence_ordinal integer NOT NULL CHECK (evidence_ordinal >= 0),
  evidence_id text NOT NULL,
  source_id text NOT NULL,
  source_version_id text NOT NULL,
  exact_quote text NOT NULL,
  sensitivity text NOT NULL CHECK (sensitivity IN ('public', 'internal', 'private', 'restricted')),
  PRIMARY KEY (attempt_id, evidence_ordinal),
  UNIQUE (attempt_id, evidence_id)
);

CREATE INDEX frontend_ask_answer_attempt_evidence_lookup_idx
  ON frontend_ask.answer_attempt_evidence (attempt_id, evidence_ordinal);

CREATE INDEX frontend_ask_answer_run_attempts_lease_idx
  ON frontend_ask.answer_run_attempts (state, lease_expires_at, attempt_number);

ALTER TABLE frontend_ask.answer_run_attempts
  ADD CONSTRAINT frontend_ask_answer_run_attempts_context_audit_check CHECK (
    (context_supported = false AND resolved_context_digest IS NOT NULL AND query_plan_revision IS NOT NULL)
    OR (context_supported = true)
  );
