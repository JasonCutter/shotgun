-- WP-04 follow-up: harden recovery invariants without rewriting migration 062.
-- These named checks supplement the original anonymous checks and therefore
-- remain safe when this migration is applied to a database where 062 already
-- exists.

ALTER TABLE evidence.stage4_continuations
  ADD CONSTRAINT evidence_stage4_continuation_lease_state_ck
  CHECK (
    (state = 'RUNNING'
      AND lease_owner IS NOT NULL AND lease_token IS NOT NULL
      AND lease_acquired_at IS NOT NULL AND lease_expires_at IS NOT NULL
      AND lease_expires_at > lease_acquired_at)
    OR (state <> 'RUNNING'
      AND lease_owner IS NULL AND lease_token IS NULL
      AND lease_acquired_at IS NULL AND lease_expires_at IS NULL)
  );

ALTER TABLE source_product.source_stage3_progress
  ADD CONSTRAINT source_stage3_progress_lease_state_ck
  CHECK (
    (state = 'STAGE3_RUNNING'
      AND lease_owner IS NOT NULL AND lease_token IS NOT NULL
      AND lease_acquired_at IS NOT NULL AND lease_expires_at IS NOT NULL
      AND lease_expires_at > lease_acquired_at)
    OR (state <> 'STAGE3_RUNNING'
      AND lease_owner IS NULL AND lease_token IS NULL
      AND lease_acquired_at IS NULL AND lease_expires_at IS NULL)
  );

CREATE OR REPLACE FUNCTION source_product.enforce_item_transition()
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
        'ACTION_REQUIRED', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'OUTCOME_INDETERMINATE'
      )
      WHEN 'ACTION_REQUIRED' THEN NEW.state IN (
        'QUEUED', 'RUNNING', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED'
      )
      WHEN 'FAILED' THEN NEW.state IN ('QUEUED', 'RUNNING')
      WHEN 'CANCELLED' THEN NEW.state IN ('QUEUED', 'RUNNING')
      WHEN 'CANCEL_REQUESTED' THEN NEW.state IN (
        'CANCELLED', 'SUCCEEDED', 'FAILED', 'OUTCOME_INDETERMINATE'
      )
      WHEN 'SUCCEEDED' THEN NEW.state IN ('OUTCOME_INDETERMINATE')
      WHEN 'OUTCOME_INDETERMINATE' THEN NEW.state IN (
        'QUEUED', 'RUNNING', 'ACTION_REQUIRED', 'SUCCEEDED',
        'FAILED', 'CANCEL_REQUESTED', 'CANCELLED'
      )
      ELSE false
    END;
  END IF;
  IF NOT allowed THEN
    RAISE EXCEPTION 'Invalid Item transition: % -> %', OLD.state, NEW.state;
  END IF;
  IF OLD.state IN ('FAILED', 'CANCELLED') AND NEW.state IN ('QUEUED', 'RUNNING')
     AND NOT source_product.retry_attempt_exists(OLD.submission_item_id) THEN
    RAISE EXCEPTION 'Item retry transition requires a new Retry Attempt';
  END IF;
  IF (OLD.produced_source_id IS NOT NULL OR OLD.produced_source_version_id IS NOT NULL) AND (
    NEW.produced_source_id IS DISTINCT FROM OLD.produced_source_id
    OR NEW.produced_source_version_id IS DISTINCT FROM OLD.produced_source_version_id
  ) THEN
    RAISE EXCEPTION 'A materialized Item resource binding is immutable';
  END IF;
  NEW.item_revision := OLD.item_revision + 1;
  NEW.updated_at := clock_timestamp();
  IF NEW.state IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN
    NEW.completed_at := COALESCE(NEW.completed_at, clock_timestamp());
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END
$$;
