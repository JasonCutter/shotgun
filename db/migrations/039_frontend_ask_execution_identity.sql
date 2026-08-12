-- A5 additive execution identity persistence.
-- Historical AnswerRuns and attempts remain valid and unpinned. New managed
-- executions persist the server-resolved identity before provider invocation.

DO $$
BEGIN
  IF to_regclass('frontend_ask.answer_runs') IS NULL
     OR to_regclass('frontend_ask.answer_run_attempts') IS NULL THEN
    RAISE EXCEPTION 'Migration 039 preflight failed: A3/A4 Ask execution tables are missing';
  END IF;
END
$$;

ALTER TABLE frontend_ask.answer_runs
  ADD COLUMN provider_id text,
  ADD COLUMN model_id text,
  ADD COLUMN ai_configuration_revision integer,
  ADD COLUMN credential_id text,
  ADD COLUMN credential_revision integer,
  ADD COLUMN initial_provider_policy_fingerprint text,
  ADD COLUMN ai_execution_pin_created_at timestamptz;

ALTER TABLE frontend_ask.answer_runs
  ADD CONSTRAINT frontend_ask_answer_runs_execution_pin_shape_check CHECK (
    (
      provider_id IS NULL AND model_id IS NULL
      AND ai_configuration_revision IS NULL AND credential_id IS NULL
      AND credential_revision IS NULL AND initial_provider_policy_fingerprint IS NULL
      AND ai_execution_pin_created_at IS NULL
    )
    OR (
      length(btrim(provider_id)) BETWEEN 1 AND 128
      AND length(btrim(model_id)) BETWEEN 1 AND 256
      AND ai_configuration_revision > 0
      AND length(btrim(credential_id)) BETWEEN 1 AND 256
      AND credential_revision > 0
      AND length(btrim(initial_provider_policy_fingerprint)) BETWEEN 1 AND 512
      AND ai_execution_pin_created_at IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION frontend_ask.reject_answer_run_execution_pin_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.provider_id IS NOT NULL AND (
    OLD.provider_id IS DISTINCT FROM NEW.provider_id
    OR OLD.model_id IS DISTINCT FROM NEW.model_id
    OR OLD.ai_configuration_revision IS DISTINCT FROM NEW.ai_configuration_revision
    OR OLD.credential_id IS DISTINCT FROM NEW.credential_id
    OR OLD.credential_revision IS DISTINCT FROM NEW.credential_revision
    OR OLD.initial_provider_policy_fingerprint IS DISTINCT FROM NEW.initial_provider_policy_fingerprint
    OR OLD.ai_execution_pin_created_at IS DISTINCT FROM NEW.ai_execution_pin_created_at
  ) THEN
    RAISE EXCEPTION 'AnswerRun AI execution identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER frontend_ask_answer_runs_execution_pin_immutable
  BEFORE UPDATE ON frontend_ask.answer_runs
  FOR EACH ROW EXECUTE FUNCTION frontend_ask.reject_answer_run_execution_pin_mutation();

ALTER TABLE frontend_ask.answer_run_attempts
  ADD COLUMN provider_id text,
  ADD COLUMN model_id text,
  ADD COLUMN ai_configuration_revision integer,
  ADD COLUMN credential_id text,
  ADD COLUMN credential_revision integer,
  ADD COLUMN initial_provider_policy_fingerprint text,
  ADD COLUMN effective_provider_policy_fingerprint text,
  ADD COLUMN ai_execution_pin_created_at timestamptz;

ALTER TABLE frontend_ask.answer_run_attempts
  ADD CONSTRAINT frontend_ask_answer_run_attempts_execution_identity_shape_check CHECK (
    (
      provider_id IS NULL AND model_id IS NULL
      AND ai_configuration_revision IS NULL AND credential_id IS NULL
      AND credential_revision IS NULL AND initial_provider_policy_fingerprint IS NULL
      AND ai_execution_pin_created_at IS NULL
    )
    OR (
      length(btrim(provider_id)) BETWEEN 1 AND 128
      AND length(btrim(model_id)) BETWEEN 1 AND 256
      AND ai_configuration_revision > 0
      AND length(btrim(credential_id)) BETWEEN 1 AND 256
      AND credential_revision > 0
      AND length(btrim(initial_provider_policy_fingerprint)) BETWEEN 1 AND 512
      AND length(btrim(effective_provider_policy_fingerprint)) BETWEEN 1 AND 512
      AND ai_execution_pin_created_at IS NOT NULL
    )
  );

CREATE OR REPLACE FUNCTION frontend_ask.reject_answer_attempt_execution_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.provider_id IS NOT NULL AND (
    OLD.provider_id IS DISTINCT FROM NEW.provider_id
    OR OLD.model_id IS DISTINCT FROM NEW.model_id
    OR OLD.ai_configuration_revision IS DISTINCT FROM NEW.ai_configuration_revision
    OR OLD.credential_id IS DISTINCT FROM NEW.credential_id
    OR OLD.credential_revision IS DISTINCT FROM NEW.credential_revision
    OR OLD.initial_provider_policy_fingerprint IS DISTINCT FROM NEW.initial_provider_policy_fingerprint
    OR OLD.ai_execution_pin_created_at IS DISTINCT FROM NEW.ai_execution_pin_created_at
  ) THEN
    RAISE EXCEPTION 'AnswerRun attempt AI execution identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER frontend_ask_answer_run_attempts_execution_identity_immutable
  BEFORE UPDATE ON frontend_ask.answer_run_attempts
  FOR EACH ROW EXECUTE FUNCTION frontend_ask.reject_answer_attempt_execution_identity_mutation();

CREATE INDEX frontend_ask_answer_run_attempts_execution_identity_idx
  ON frontend_ask.answer_run_attempts (project_id, answer_run_id, attempt_number);
