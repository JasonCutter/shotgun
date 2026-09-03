-- WP-04 5A: Source → Evidence → Stage 4 durable state authority.
--
-- This migration is additive.  Migrations 020/035 remain the authority for
-- submission/item/attempt lifecycle; these tables add only the per-
-- SourceVersion Stage 3 execution position and Evidence/Stage 4 handoff that
-- those tables cannot express.  No provider call or historical NO_EVIDENCE
-- inference is performed here.

DO $$
BEGIN
  IF to_regclass('asset.sources') IS NULL
     OR to_regclass('asset.source_versions') IS NULL
     OR to_regclass('transformation.revisions') IS NULL
     OR to_regclass('evidence.spans') IS NULL
     OR to_regclass('source_product.intake_submission_items') IS NULL THEN
    RAISE EXCEPTION 'Migration 062 preflight failed: Source/Transformation/Evidence authorities are missing';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS evidence.indexing_results (
  indexing_result_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  source_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  transformer_id text NOT NULL CHECK (length(btrim(transformer_id)) BETWEEN 1 AND 200),
  transformer_version text NOT NULL CHECK (length(btrim(transformer_version)) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('INDEXED', 'NO_EVIDENCE')),
  evidence_count integer NOT NULL CHECK (evidence_count >= 0),
  reused_count integer NOT NULL CHECK (reused_count >= 0 AND reused_count <= evidence_count),
  evidence_set_digest text NOT NULL CHECK (evidence_set_digest ~ '^sha256:[a-f0-9]{64}$'),
  contract_version text NOT NULL CHECK (length(btrim(contract_version)) BETWEEN 1 AND 100),
  security_scope_digest text NOT NULL CHECK (security_scope_digest ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT evidence_indexing_results_source_fk
    FOREIGN KEY (project_id, source_id)
    REFERENCES asset.sources(project_id, source_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_indexing_results_version_fk
    FOREIGN KEY (source_id, source_version_id)
    REFERENCES asset.source_versions(source_id, source_version_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_indexing_results_revision_fk
    FOREIGN KEY (revision_id)
    REFERENCES transformation.revisions(revision_id)
    ON DELETE RESTRICT,
  UNIQUE (
    project_id, source_version_id, revision_id, transformer_id, transformer_version
  ),
  CHECK (
    (status = 'NO_EVIDENCE' AND evidence_count = 0)
    OR (status = 'INDEXED' AND evidence_count > 0)
  ),
  CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS evidence_indexing_results_source_version_idx
  ON evidence.indexing_results (project_id, source_version_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS evidence.stage4_continuations (
  continuation_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  source_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  indexing_result_id uuid NOT NULL,
  continuation_key text NOT NULL CHECK (length(btrim(continuation_key)) BETWEEN 1 AND 512),
  evidence_snapshot jsonb NOT NULL CHECK (jsonb_typeof(evidence_snapshot) IN ('array', 'object')),
  evidence_set_digest text NOT NULL CHECK (evidence_set_digest ~ '^sha256:[a-f0-9]{64}$'),
  evidence_count integer NOT NULL CHECK (evidence_count > 0),
  access_scope text[] NOT NULL CHECK (cardinality(access_scope) > 0),
  sensitivity text NOT NULL CHECK (sensitivity IN ('public', 'internal', 'private', 'restricted')),
  data_classification text NOT NULL CHECK (length(btrim(data_classification)) BETWEEN 1 AND 200),
  state text NOT NULL CHECK (
    state IN (
      'PENDING', 'RUNNING', 'RETRYABLE_FAILED', 'TERMINAL_FAILED',
      'OUTCOME_UNKNOWN', 'COMPLETED'
    )
  ),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz,
  lease_owner text,
  lease_token text,
  lease_acquired_at timestamptz,
  lease_expires_at timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  generation_request_id text,
  execution_pin_ref text,
  safe_failure_code text CHECK (safe_failure_code IS NULL OR length(safe_failure_code) <= 200),
  safe_failure_message text CHECK (
    safe_failure_message IS NULL OR length(safe_failure_message) <= 2000
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  CONSTRAINT evidence_stage4_continuation_source_fk
    FOREIGN KEY (project_id, source_id)
    REFERENCES asset.sources(project_id, source_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_stage4_continuation_version_fk
    FOREIGN KEY (source_id, source_version_id)
    REFERENCES asset.source_versions(source_id, source_version_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_stage4_continuation_revision_fk
    FOREIGN KEY (revision_id)
    REFERENCES transformation.revisions(revision_id)
    ON DELETE RESTRICT,
  CONSTRAINT evidence_stage4_continuation_result_fk
    FOREIGN KEY (indexing_result_id)
    REFERENCES evidence.indexing_results(indexing_result_id)
    ON DELETE RESTRICT,
  UNIQUE (project_id, continuation_key),
  UNIQUE (project_id, source_version_id, revision_id, indexing_result_id),
  CHECK (updated_at >= created_at),
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  CHECK (
    (state IN ('COMPLETED', 'TERMINAL_FAILED') AND completed_at IS NOT NULL)
    OR (state NOT IN ('COMPLETED', 'TERMINAL_FAILED') AND completed_at IS NULL)
  ),
  CHECK (
    (lease_owner IS NULL AND lease_token IS NULL AND lease_acquired_at IS NULL
      AND lease_expires_at IS NULL)
    OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_acquired_at IS NOT NULL
      AND lease_expires_at IS NOT NULL AND lease_expires_at > lease_acquired_at)
  ),
  CHECK (
    state <> 'RUNNING'
    OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL
      AND lease_acquired_at IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS evidence_stage4_continuations_claim_idx
  ON evidence.stage4_continuations
    (state, next_attempt_at, lease_expires_at, updated_at, continuation_id);

CREATE INDEX IF NOT EXISTS evidence_stage4_continuations_source_version_idx
  ON evidence.stage4_continuations (project_id, source_version_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS source_product.source_stage3_progress (
  project_id text NOT NULL,
  source_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  state text NOT NULL CHECK (
    state IN (
      'MATERIALIZED', 'STAGE3_RUNNING', 'STAGE3_COMPLETED', 'NO_EVIDENCE',
      'STAGE3_RETRYABLE', 'RECONCILIATION_REQUIRED'
    )
  ),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz,
  lease_owner text,
  lease_token text,
  lease_acquired_at timestamptz,
  lease_expires_at timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  indexing_result_id uuid,
  safe_failure_code text CHECK (safe_failure_code IS NULL OR length(safe_failure_code) <= 200),
  safe_failure_message text CHECK (
    safe_failure_message IS NULL OR length(safe_failure_message) <= 2000
  ),
  progress_revision bigint NOT NULL DEFAULT 1 CHECK (progress_revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, source_version_id),
  CONSTRAINT source_stage3_progress_source_fk
    FOREIGN KEY (project_id, source_id)
    REFERENCES asset.sources(project_id, source_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_stage3_progress_version_fk
    FOREIGN KEY (source_id, source_version_id)
    REFERENCES asset.source_versions(source_id, source_version_id)
    ON DELETE RESTRICT,
  CONSTRAINT source_stage3_progress_result_fk
    FOREIGN KEY (indexing_result_id)
    REFERENCES evidence.indexing_results(indexing_result_id)
    ON DELETE RESTRICT,
  CHECK (updated_at >= created_at),
  CHECK (
    (state IN ('STAGE3_COMPLETED', 'NO_EVIDENCE') AND indexing_result_id IS NOT NULL)
    OR (state NOT IN ('STAGE3_COMPLETED', 'NO_EVIDENCE'))
  ),
  CHECK (
    (lease_owner IS NULL AND lease_token IS NULL AND lease_acquired_at IS NULL
      AND lease_expires_at IS NULL)
    OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_acquired_at IS NOT NULL
      AND lease_expires_at IS NOT NULL AND lease_expires_at > lease_acquired_at)
  ),
  CHECK (
    state <> 'STAGE3_RUNNING'
    OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL
      AND lease_acquired_at IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS source_stage3_progress_recovery_idx
  ON source_product.source_stage3_progress
    (state, next_attempt_at, lease_expires_at, updated_at, project_id, source_version_id);

-- Stage 2 has already succeeded when a SourceVersion is materialized.  A
-- failed Stage 3 therefore needs an additive retryable transition without
-- changing the immutable produced Source/SourceVersion binding.
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
  IF OLD.state = 'SUCCEEDED' AND (
    NEW.produced_source_id IS DISTINCT FROM OLD.produced_source_id
    OR NEW.produced_source_version_id IS DISTINCT FROM OLD.produced_source_version_id
  ) THEN
    RAISE EXCEPTION 'A successful Item resource binding is immutable';
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

-- Progress transitions are database-owned.  Same-state updates are allowed
-- for lease heartbeats/CAS metadata; terminal states cannot be reopened.
CREATE OR REPLACE FUNCTION source_product.enforce_stage3_progress_transition()
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
      WHEN 'MATERIALIZED' THEN NEW.state IN ('STAGE3_RUNNING', 'RECONCILIATION_REQUIRED')
      WHEN 'STAGE3_RUNNING' THEN NEW.state IN (
        'STAGE3_COMPLETED', 'NO_EVIDENCE', 'STAGE3_RETRYABLE', 'RECONCILIATION_REQUIRED'
      )
      WHEN 'STAGE3_RETRYABLE' THEN NEW.state IN ('STAGE3_RUNNING', 'RECONCILIATION_REQUIRED')
      WHEN 'RECONCILIATION_REQUIRED' THEN NEW.state IN (
        'STAGE3_RUNNING', 'STAGE3_COMPLETED', 'NO_EVIDENCE', 'STAGE3_RETRYABLE'
      )
      WHEN 'STAGE3_COMPLETED' THEN false
      WHEN 'NO_EVIDENCE' THEN false
      ELSE false
    END;
  END IF;
  IF NOT allowed THEN
    RAISE EXCEPTION 'Invalid Source Stage3 transition: % -> %', OLD.state, NEW.state;
  END IF;
  NEW.progress_revision := OLD.progress_revision + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS source_product_stage3_progress_transition
  ON source_product.source_stage3_progress;
CREATE TRIGGER source_product_stage3_progress_transition
BEFORE UPDATE ON source_product.source_stage3_progress
FOR EACH ROW EXECUTE FUNCTION source_product.enforce_stage3_progress_transition();
