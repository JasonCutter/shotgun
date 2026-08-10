-- FE-P5-XP Correction Round 3 — Sources Stage 3 post-commit failure recovery.
--
-- A mixed intake submission (duplicate/action-required item + newly
-- materialized item) commits as PARTIAL before the Stage 3 pipeline runs. If
-- Stage 3 fails, the submission must become retryable (OUTCOME_INDETERMINATE)
-- instead of staying PARTIAL forever without Evidence. This migration extends
-- the state machine to allow PARTIAL -> OUTCOME_INDETERMINATE.
--
-- Retry semantics are unchanged: OUTCOME_INDETERMINATE already transitions
-- back to RUNNING/PARTIAL/SUCCEEDED on replay, and the resume path reuses the
-- SAME SourceVersions (no duplicate Source/SourceVersion).

CREATE OR REPLACE FUNCTION source_product.enforce_submission_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allowed boolean := false;
BEGIN
  IF NEW.state = OLD.state THEN
    allowed := true;
  ELSE
    allowed := CASE OLD.state
    WHEN 'VALIDATING' THEN NEW.state IN ('QUEUED', 'ACTION_REQUIRED', 'FAILED', 'CANCEL_REQUESTED')
    WHEN 'QUEUED' THEN NEW.state IN (
      'RUNNING', 'ACTION_REQUIRED', 'FAILED', 'CANCEL_REQUESTED', 'OUTCOME_INDETERMINATE'
    )
    WHEN 'RUNNING' THEN NEW.state IN (
      'PARTIAL', 'ACTION_REQUIRED', 'SUCCEEDED', 'FAILED',
      'CANCEL_REQUESTED', 'OUTCOME_INDETERMINATE'
    )
    WHEN 'PARTIAL' THEN NEW.state IN (
      'QUEUED', 'RUNNING', 'ACTION_REQUIRED', 'SUCCEEDED', 'FAILED',
      'CANCEL_REQUESTED', 'OUTCOME_INDETERMINATE'
    )
    WHEN 'ACTION_REQUIRED' THEN NEW.state IN (
      'QUEUED', 'RUNNING', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED'
    )
    WHEN 'FAILED' THEN NEW.state IN ('QUEUED', 'RUNNING')
    WHEN 'CANCELLED' THEN NEW.state IN ('QUEUED', 'RUNNING')
    WHEN 'CANCEL_REQUESTED' THEN NEW.state IN (
      'CANCELLED', 'PARTIAL', 'SUCCEEDED', 'FAILED', 'OUTCOME_INDETERMINATE'
    )
    WHEN 'OUTCOME_INDETERMINATE' THEN NEW.state IN (
      'QUEUED', 'RUNNING', 'PARTIAL', 'ACTION_REQUIRED', 'SUCCEEDED',
      'FAILED', 'CANCEL_REQUESTED', 'CANCELLED'
    )
      ELSE false
    END;
  END IF;
  IF NOT allowed THEN
    RAISE EXCEPTION 'Invalid Submission transition: % -> %', OLD.state, NEW.state;
  END IF;
  IF OLD.state IN ('FAILED', 'CANCELLED') AND NEW.state IN ('QUEUED', 'RUNNING') AND NOT EXISTS (
    SELECT 1
    FROM source_product.intake_attempts
    WHERE submission_id = OLD.submission_id
      AND attempt_kind IN ('RETRY_SAME_CONTEXT', 'RETRY_CURRENT_POLICY')
      AND state IN ('ACCEPTED', 'RUNNING')
  ) THEN
    RAISE EXCEPTION 'Submission retry transition requires a new Retry Attempt';
  END IF;
  NEW.submission_revision := OLD.submission_revision + 1;
  NEW.updated_at := clock_timestamp();
  IF NEW.state IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN
    NEW.completed_at := COALESCE(NEW.completed_at, clock_timestamp());
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END
$$;
