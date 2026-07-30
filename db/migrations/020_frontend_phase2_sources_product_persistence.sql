BEGIN;

DO $$
DECLARE
  intake_definition text;
  receipt_definition text;
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '019_frontend_section3_principal_bootstrap.sql'
  ) THEN
    RAISE EXCEPTION
      'Migration 020 preflight failed: migrations 001-019 are not registered';
  END IF;

  IF to_regnamespace('source_product') IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 020 preflight failed: source_product already exists';
  END IF;

  SELECT pg_get_constraintdef(oid)
  INTO intake_definition
  FROM pg_constraint
  WHERE conrelid = 'intake.submissions'::regclass
    AND conname = 'submissions_channel_check'
    AND contype = 'c';

  SELECT pg_get_constraintdef(oid)
  INTO receipt_definition
  FROM pg_constraint
  WHERE conrelid = 'asset.storage_receipts'::regclass
    AND conname = 'storage_receipts_channel_check'
    AND contype = 'c';

  IF intake_definition IS NULL
     OR intake_definition NOT LIKE '%direct_text%'
     OR intake_definition NOT LIKE '%file_upload%'
     OR intake_definition LIKE '%url_acquisition%' THEN
    RAISE EXCEPTION
      'Migration 020 preflight failed: intake.submissions channel constraint differs from Migration 002';
  END IF;

  IF receipt_definition IS NULL
     OR receipt_definition NOT LIKE '%direct_text%'
     OR receipt_definition NOT LIKE '%file_upload%'
     OR receipt_definition LIKE '%url_acquisition%' THEN
    RAISE EXCEPTION
      'Migration 020 preflight failed: asset.storage_receipts channel constraint differs from Migration 002';
  END IF;
END
$$;

ALTER TABLE intake.submissions
  DROP CONSTRAINT submissions_channel_check,
  ADD CONSTRAINT submissions_channel_check
    CHECK (channel IN ('direct_text', 'file_upload', 'url_acquisition'));

ALTER TABLE asset.storage_receipts
  DROP CONSTRAINT storage_receipts_channel_check,
  ADD CONSTRAINT storage_receipts_channel_check
    CHECK (channel IN ('direct_text', 'file_upload', 'url_acquisition'));

CREATE UNIQUE INDEX IF NOT EXISTS asset_sources_project_source_uidx
  ON asset.sources (project_id, source_id);

CREATE UNIQUE INDEX IF NOT EXISTS asset_source_versions_source_version_uidx
  ON asset.source_versions (source_id, source_version_id);

CREATE UNIQUE INDEX IF NOT EXISTS asset_source_versions_asset_version_uidx
  ON asset.source_versions (original_asset_id, source_version_id);

CREATE SCHEMA source_product;

CREATE FUNCTION source_product.text_array_is_unique(values text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT cardinality(values) = (
    SELECT count(DISTINCT value)
    FROM unnest(values) AS value
  )
$$;

CREATE FUNCTION source_product.jsonb_is_object(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(value) = 'object'
$$;

CREATE FUNCTION source_product.jsonb_is_array(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(value) = 'array'
$$;

CREATE TABLE source_product.intake_submissions (
  submission_id uuid PRIMARY KEY,
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  principal_id uuid NOT NULL REFERENCES auth.principals(principal_id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES auth.sessions(session_id) ON DELETE RESTRICT,
  create_command_id text NOT NULL UNIQUE
    REFERENCES frontend_command.command_ledger(command_id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (
    state IN (
      'VALIDATING', 'QUEUED', 'RUNNING', 'PARTIAL', 'ACTION_REQUIRED',
      'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED',
      'OUTCOME_INDETERMINATE'
    )
  ),
  origin_kind text NOT NULL DEFAULT 'NATIVE'
    CHECK (origin_kind IN ('NATIVE', 'LEGACY_COMPATIBILITY')),
  accepted_policy_context_id text NOT NULL
    CHECK (length(accepted_policy_context_id) BETWEEN 1 AND 512),
  accepted_policy_binding jsonb NOT NULL
    CHECK (source_product.jsonb_is_object(accepted_policy_binding)),
  access_revision text NOT NULL CHECK (length(access_revision) BETWEEN 1 AND 512),
  policy_context_revision text NOT NULL
    CHECK (length(policy_context_revision) BETWEEN 1 AND 512),
  submission_revision bigint NOT NULL DEFAULT 1 CHECK (submission_revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (project_id, submission_id),
  CHECK (updated_at >= created_at),
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  CHECK (
    (state IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND completed_at IS NOT NULL)
    OR
    (state NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND completed_at IS NULL)
  )
);

CREATE INDEX source_product_intake_submissions_project_updated_idx
  ON source_product.intake_submissions (project_id, updated_at DESC, submission_id);

CREATE INDEX source_product_intake_submissions_attention_idx
  ON source_product.intake_submissions (project_id, updated_at DESC, submission_id)
  WHERE state IN ('PARTIAL', 'ACTION_REQUIRED', 'FAILED', 'OUTCOME_INDETERMINATE');

CREATE TABLE source_product.intake_submission_items (
  submission_item_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  submission_id uuid NOT NULL,
  client_item_id text NOT NULL CHECK (length(client_item_id) BETWEEN 1 AND 200),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  input_kind text NOT NULL CHECK (input_kind IN ('DIRECT_TEXT', 'FILE', 'URL')),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 500),
  input_manifest jsonb NOT NULL CHECK (source_product.jsonb_is_object(input_manifest)),
  state text NOT NULL CHECK (
    state IN (
      'VALIDATING', 'QUEUED', 'RUNNING', 'ACTION_REQUIRED', 'SUCCEEDED',
      'FAILED', 'CANCEL_REQUESTED', 'CANCELLED', 'OUTCOME_INDETERMINATE'
    )
  ),
  validation_results jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (source_product.jsonb_is_array(validation_results)),
  content_hash text CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  media_type text CHECK (media_type IS NULL OR length(media_type) BETWEEN 1 AND 255),
  size_bytes bigint CHECK (size_bytes IS NULL OR (size_bytes > 0 AND size_bytes <= 1048576)),
  stage2_submission_id text,
  produced_source_id uuid,
  produced_source_version_id uuid,
  active_duplicate_decision_id uuid,
  attention_reason text CHECK (attention_reason IS NULL OR length(attention_reason) <= 2000),
  safe_failure_code text CHECK (safe_failure_code IS NULL OR length(safe_failure_code) <= 200),
  safe_failure_message text CHECK (
    safe_failure_message IS NULL OR length(safe_failure_message) <= 2000
  ),
  safe_failure_retryable boolean,
  item_revision bigint NOT NULL DEFAULT 1 CHECK (item_revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  FOREIGN KEY (project_id, submission_id)
    REFERENCES source_product.intake_submissions(project_id, submission_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (project_id, stage2_submission_id)
    REFERENCES intake.submissions(project_id, submission_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (project_id, stage2_submission_id)
    REFERENCES asset.storage_receipts(project_id, submission_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (project_id, produced_source_id)
    REFERENCES asset.sources(project_id, source_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (produced_source_id, produced_source_version_id)
    REFERENCES asset.source_versions(source_id, source_version_id)
    ON DELETE RESTRICT,
  UNIQUE (submission_id, client_item_id),
  UNIQUE (submission_id, ordinal),
  UNIQUE (project_id, stage2_submission_id),
  UNIQUE (project_id, submission_id, submission_item_id),
  UNIQUE (submission_item_id, content_hash),
  CHECK (
    (produced_source_id IS NULL AND produced_source_version_id IS NULL)
    OR
    (produced_source_id IS NOT NULL AND produced_source_version_id IS NOT NULL)
  ),
  CHECK (
    (safe_failure_code IS NULL AND safe_failure_message IS NULL
      AND safe_failure_retryable IS NULL)
    OR
    (safe_failure_code IS NOT NULL AND safe_failure_message IS NOT NULL
      AND safe_failure_retryable IS NOT NULL)
  ),
  CHECK (stage2_submission_id IS NULL OR stage2_submission_id = submission_item_id::text),
  CHECK (updated_at >= created_at),
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  CHECK (
    (state IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND completed_at IS NOT NULL)
    OR
    (state NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND completed_at IS NULL)
  ),
  CHECK (
    state <> 'SUCCEEDED'
    OR (
      stage2_submission_id IS NOT NULL
      AND produced_source_id IS NOT NULL
      AND produced_source_version_id IS NOT NULL
    )
  )
);

CREATE INDEX source_product_items_submission_state_idx
  ON source_product.intake_submission_items
    (project_id, submission_id, state, ordinal, submission_item_id);

CREATE TABLE source_product.intake_attempts (
  intake_attempt_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  submission_id uuid NOT NULL,
  submission_item_id uuid NOT NULL,
  command_id text NOT NULL
    REFERENCES frontend_command.command_ledger(command_id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  attempt_kind text NOT NULL CHECK (
    attempt_kind IN ('SUBMIT', 'RETRY_SAME_CONTEXT', 'RETRY_CURRENT_POLICY', 'CANCEL')
  ),
  state text NOT NULL CHECK (
    state IN (
      'ACCEPTED', 'RUNNING', 'CANCEL_REQUESTED', 'SUCCEEDED', 'FAILED',
      'CANCELLED', 'OUTCOME_INDETERMINATE'
    )
  ),
  correlation_id text NOT NULL CHECK (length(correlation_id) BETWEEN 1 AND 512),
  causation_attempt_id uuid,
  accepted_policy_context_id text NOT NULL
    CHECK (length(accepted_policy_context_id) BETWEEN 1 AND 512),
  accepted_policy_binding jsonb NOT NULL
    CHECK (source_product.jsonb_is_object(accepted_policy_binding)),
  safe_failure_code text CHECK (safe_failure_code IS NULL OR length(safe_failure_code) <= 200),
  safe_failure_message text CHECK (
    safe_failure_message IS NULL OR length(safe_failure_message) <= 2000
  ),
  safe_failure_retryable boolean,
  attempt_revision bigint NOT NULL DEFAULT 1 CHECK (attempt_revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  FOREIGN KEY (project_id, submission_id, submission_item_id)
    REFERENCES source_product.intake_submission_items
      (project_id, submission_id, submission_item_id)
    ON DELETE RESTRICT,
  UNIQUE (command_id, submission_item_id),
  UNIQUE (submission_item_id, attempt_number),
  UNIQUE (submission_item_id, intake_attempt_id),
  FOREIGN KEY (submission_item_id, causation_attempt_id)
    REFERENCES source_product.intake_attempts(submission_item_id, intake_attempt_id)
    ON DELETE RESTRICT,
  CHECK (
    (attempt_kind = 'SUBMIT' AND causation_attempt_id IS NULL)
    OR
    (
      attempt_kind IN ('RETRY_SAME_CONTEXT', 'RETRY_CURRENT_POLICY', 'CANCEL')
      AND causation_attempt_id IS NOT NULL
      AND causation_attempt_id <> intake_attempt_id
    )
  ),
  CHECK (
    (safe_failure_code IS NULL AND safe_failure_message IS NULL
      AND safe_failure_retryable IS NULL)
    OR
    (safe_failure_code IS NOT NULL AND safe_failure_message IS NOT NULL
      AND safe_failure_retryable IS NOT NULL)
  ),
  CHECK (updated_at >= created_at),
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  CHECK (
    (state IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND completed_at IS NOT NULL)
    OR
    (state NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND completed_at IS NULL)
  )
);

CREATE INDEX source_product_intake_attempts_recovery_idx
  ON source_product.intake_attempts (command_id, state);

CREATE INDEX source_product_intake_attempts_history_idx
  ON source_product.intake_attempts
    (project_id, submission_id, submission_item_id, attempt_number DESC);

CREATE TABLE source_product.exact_duplicate_decisions (
  decision_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  submission_id uuid NOT NULL,
  submission_item_id uuid NOT NULL,
  decision_revision bigint NOT NULL CHECK (decision_revision > 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  existing_source_id uuid NOT NULL,
  existing_source_version_id uuid NOT NULL,
  allowed_dispositions text[] NOT NULL CHECK (
    cardinality(allowed_dispositions) > 0
    AND source_product.text_array_is_unique(allowed_dispositions)
    AND allowed_dispositions <@ ARRAY[
      'REUSE_EXISTING_VERSION',
      'CREATE_VERSION_CANDIDATE',
      'CREATE_SEPARATE_SOURCE',
      'CANCEL_SUBMISSION'
    ]::text[]
  ),
  observed_source_revision text NOT NULL
    CHECK (length(observed_source_revision) BETWEEN 1 AND 512),
  access_revision text NOT NULL CHECK (length(access_revision) BETWEEN 1 AND 512),
  policy_context_revision text NOT NULL
    CHECK (length(policy_context_revision) BETWEEN 1 AND 512),
  supersedes_decision_id uuid,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (project_id, submission_id, submission_item_id)
    REFERENCES source_product.intake_submission_items
      (project_id, submission_id, submission_item_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (submission_item_id, content_hash)
    REFERENCES source_product.intake_submission_items(submission_item_id, content_hash)
    ON DELETE RESTRICT,
  FOREIGN KEY (project_id, existing_source_id)
    REFERENCES asset.sources(project_id, source_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (existing_source_id, existing_source_version_id)
    REFERENCES asset.source_versions(source_id, source_version_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_decision_id)
    REFERENCES source_product.exact_duplicate_decisions(decision_id)
    ON DELETE RESTRICT,
  UNIQUE (submission_item_id, decision_revision),
  UNIQUE (submission_item_id, decision_id),
  UNIQUE (decision_id, decision_revision),
  UNIQUE (
    project_id,
    submission_id,
    submission_item_id,
    decision_id,
    decision_revision
  ),
  CHECK (supersedes_decision_id IS NULL OR supersedes_decision_id <> decision_id)
);

ALTER TABLE source_product.intake_submission_items
  ADD CONSTRAINT source_product_item_active_decision_fk
  FOREIGN KEY (submission_item_id, active_duplicate_decision_id)
  REFERENCES source_product.exact_duplicate_decisions(submission_item_id, decision_id)
  ON DELETE RESTRICT;

CREATE TABLE source_product.exact_duplicate_dispositions (
  disposition_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  submission_id uuid NOT NULL,
  submission_item_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  observed_decision_revision bigint NOT NULL CHECK (observed_decision_revision > 0),
  command_id text NOT NULL UNIQUE
    REFERENCES frontend_command.command_ledger(command_id) ON DELETE RESTRICT,
  disposition text NOT NULL CHECK (
    disposition IN (
      'REUSE_EXISTING_VERSION',
      'CREATE_VERSION_CANDIDATE',
      'CREATE_SEPARATE_SOURCE',
      'CANCEL_SUBMISSION'
    )
  ),
  target_source_id uuid,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (
    project_id,
    submission_id,
    submission_item_id,
    decision_id,
    observed_decision_revision
  )
  REFERENCES source_product.exact_duplicate_decisions (
    project_id,
    submission_id,
    submission_item_id,
    decision_id,
    decision_revision
  )
  ON DELETE RESTRICT,
  FOREIGN KEY (project_id, target_source_id)
    REFERENCES asset.sources(project_id, source_id)
    ON DELETE RESTRICT,
  UNIQUE (decision_id),
  CHECK (
    (disposition = 'CREATE_VERSION_CANDIDATE' AND target_source_id IS NOT NULL)
    OR
    (disposition <> 'CREATE_VERSION_CANDIDATE' AND target_source_id IS NULL)
  )
);

CREATE TABLE source_product.url_acquisition_attempts (
  url_acquisition_attempt_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  submission_id uuid NOT NULL,
  submission_item_id uuid NOT NULL,
  intake_attempt_id uuid NOT NULL,
  normalized_requested_url text NOT NULL
    CHECK (length(normalized_requested_url) BETWEEN 1 AND 8192),
  redacted_requested_url text NOT NULL
    CHECK (length(redacted_requested_url) BETWEEN 1 AND 8192),
  state text NOT NULL CHECK (
    state IN (
      'VALIDATING', 'CONNECTING', 'READING', 'CANCEL_REQUESTED',
      'SUCCEEDED', 'FAILED', 'CANCELLED', 'OUTCOME_INDETERMINATE'
    )
  ),
  max_redirects integer NOT NULL CHECK (max_redirects BETWEEN 0 AND 20),
  connect_timeout_ms integer NOT NULL CHECK (connect_timeout_ms > 0),
  header_timeout_ms integer NOT NULL CHECK (header_timeout_ms > 0),
  body_timeout_ms integer NOT NULL CHECK (body_timeout_ms > 0),
  total_timeout_ms integer NOT NULL CHECK (total_timeout_ms > 0),
  max_compressed_bytes bigint NOT NULL
    CHECK (max_compressed_bytes > 0 AND max_compressed_bytes <= 1048576),
  max_decompressed_bytes bigint NOT NULL
    CHECK (max_decompressed_bytes > 0 AND max_decompressed_bytes <= 1048576),
  accepted_policy_context_id text NOT NULL
    CHECK (length(accepted_policy_context_id) BETWEEN 1 AND 512),
  policy_context_revision text NOT NULL
    CHECK (length(policy_context_revision) BETWEEN 1 AND 512),
  retention_class text NOT NULL CHECK (length(retention_class) BETWEEN 1 AND 200),
  retention_expires_at timestamptz,
  safe_failure_code text CHECK (safe_failure_code IS NULL OR length(safe_failure_code) <= 200),
  safe_failure_message text CHECK (
    safe_failure_message IS NULL OR length(safe_failure_message) <= 2000
  ),
  safe_failure_retryable boolean,
  acquisition_revision bigint NOT NULL DEFAULT 1 CHECK (acquisition_revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  FOREIGN KEY (project_id, submission_id, submission_item_id)
    REFERENCES source_product.intake_submission_items
      (project_id, submission_id, submission_item_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (submission_item_id, intake_attempt_id)
    REFERENCES source_product.intake_attempts(submission_item_id, intake_attempt_id)
    ON DELETE RESTRICT,
  UNIQUE (intake_attempt_id),
  UNIQUE (
    project_id,
    submission_id,
    submission_item_id,
    url_acquisition_attempt_id
  ),
  CHECK (
    (safe_failure_code IS NULL AND safe_failure_message IS NULL
      AND safe_failure_retryable IS NULL)
    OR
    (safe_failure_code IS NOT NULL AND safe_failure_message IS NOT NULL
      AND safe_failure_retryable IS NOT NULL)
  ),
  CHECK (updated_at >= created_at),
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  CHECK (retention_expires_at IS NULL OR retention_expires_at >= created_at),
  CHECK (
    (state IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND completed_at IS NOT NULL)
    OR
    (state NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND completed_at IS NULL)
  )
);

CREATE TABLE source_product.url_provenance_receipts (
  url_provenance_receipt_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  submission_id uuid NOT NULL,
  submission_item_id uuid NOT NULL,
  url_acquisition_attempt_id uuid NOT NULL UNIQUE,
  receipt_revision bigint NOT NULL DEFAULT 1 CHECK (receipt_revision = 1),
  outcome text NOT NULL CHECK (outcome IN ('SUCCEEDED', 'FAILED', 'CANCELLED')),
  redacted_requested_url text NOT NULL
    CHECK (length(redacted_requested_url) BETWEEN 1 AND 8192),
  redacted_final_url text CHECK (
    redacted_final_url IS NULL OR length(redacted_final_url) BETWEEN 1 AND 8192
  ),
  redirect_chain_digest text NOT NULL CHECK (
    redirect_chain_digest ~ '^sha256:[a-f0-9]{64}$'
  ),
  redirect_observations jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (source_product.jsonb_is_array(redirect_observations)),
  dns_observations jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (source_product.jsonb_is_array(dns_observations)),
  response_status integer CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
  response_content_type text CHECK (
    response_content_type IS NULL OR length(response_content_type) BETWEEN 1 AND 255
  ),
  response_content_length bigint CHECK (
    response_content_length IS NULL OR response_content_length >= 0
  ),
  compressed_bytes bigint CHECK (compressed_bytes IS NULL OR compressed_bytes >= 0),
  decompressed_bytes bigint CHECK (decompressed_bytes IS NULL OR decompressed_bytes >= 0),
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (source_product.jsonb_is_object(response_metadata)),
  content_hash text CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  original_asset_id uuid,
  source_version_id uuid,
  failure_code text CHECK (failure_code IS NULL OR length(failure_code) <= 200),
  retention_class text NOT NULL CHECK (length(retention_class) BETWEEN 1 AND 200),
  retention_expires_at timestamptz,
  retrieved_at timestamptz,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (
    project_id,
    submission_id,
    submission_item_id,
    url_acquisition_attempt_id
  )
  REFERENCES source_product.url_acquisition_attempts (
    project_id,
    submission_id,
    submission_item_id,
    url_acquisition_attempt_id
  )
  ON DELETE RESTRICT,
  FOREIGN KEY (original_asset_id, source_version_id)
    REFERENCES asset.source_versions(original_asset_id, source_version_id)
    ON DELETE RESTRICT,
  CHECK (retention_expires_at IS NULL OR retention_expires_at >= created_at),
  CHECK (
    (
      outcome = 'SUCCEEDED'
      AND redacted_final_url IS NOT NULL
      AND content_hash IS NOT NULL
      AND original_asset_id IS NOT NULL
      AND source_version_id IS NOT NULL
      AND retrieved_at IS NOT NULL
      AND failure_code IS NULL
    )
    OR
    (
      outcome = 'FAILED'
      AND failure_code IS NOT NULL
      AND original_asset_id IS NULL
      AND source_version_id IS NULL
    )
    OR
    (
      outcome = 'CANCELLED'
      AND original_asset_id IS NULL
      AND source_version_id IS NULL
    )
  )
);

CREATE FUNCTION source_product.retry_attempt_exists(item_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM source_product.intake_attempts
    WHERE submission_item_id = item_id
      AND attempt_kind IN ('RETRY_SAME_CONTEXT', 'RETRY_CURRENT_POLICY')
      AND state IN ('ACCEPTED', 'RUNNING')
  )
$$;

CREATE FUNCTION source_product.enforce_submission_transition()
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
      'QUEUED', 'RUNNING', 'ACTION_REQUIRED', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED'
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

CREATE FUNCTION source_product.enforce_item_transition()
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

CREATE FUNCTION source_product.enforce_attempt_transition()
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
    WHEN 'ACCEPTED' THEN NEW.state IN (
      'RUNNING', 'CANCEL_REQUESTED', 'FAILED', 'OUTCOME_INDETERMINATE'
    )
    WHEN 'RUNNING' THEN NEW.state IN (
      'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'OUTCOME_INDETERMINATE'
    )
    WHEN 'CANCEL_REQUESTED' THEN NEW.state IN (
      'CANCELLED', 'SUCCEEDED', 'FAILED', 'OUTCOME_INDETERMINATE'
    )
    WHEN 'OUTCOME_INDETERMINATE' THEN NEW.state IN (
      'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'
    )
      ELSE false
    END;
  END IF;
  IF NOT allowed THEN
    RAISE EXCEPTION 'Invalid Attempt transition: % -> %', OLD.state, NEW.state;
  END IF;
  NEW.attempt_revision := OLD.attempt_revision + 1;
  NEW.updated_at := clock_timestamp();
  IF NEW.state IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN
    NEW.completed_at := COALESCE(NEW.completed_at, clock_timestamp());
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION source_product.enforce_url_attempt_transition()
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
    WHEN 'VALIDATING' THEN NEW.state IN ('CONNECTING', 'FAILED', 'CANCEL_REQUESTED')
    WHEN 'CONNECTING' THEN NEW.state IN (
      'READING', 'FAILED', 'CANCEL_REQUESTED', 'OUTCOME_INDETERMINATE'
    )
    WHEN 'READING' THEN NEW.state IN (
      'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'OUTCOME_INDETERMINATE'
    )
    WHEN 'CANCEL_REQUESTED' THEN NEW.state IN (
      'CANCELLED', 'SUCCEEDED', 'FAILED', 'OUTCOME_INDETERMINATE'
    )
    WHEN 'OUTCOME_INDETERMINATE' THEN NEW.state IN (
      'CONNECTING', 'READING', 'SUCCEEDED', 'FAILED', 'CANCELLED'
    )
      ELSE false
    END;
  END IF;
  IF NOT allowed THEN
    RAISE EXCEPTION 'Invalid URL Attempt transition: % -> %', OLD.state, NEW.state;
  END IF;
  NEW.acquisition_revision := OLD.acquisition_revision + 1;
  NEW.updated_at := clock_timestamp();
  IF NEW.state IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN
    NEW.completed_at := COALESCE(NEW.completed_at, clock_timestamp());
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION source_product.validate_duplicate_decision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous source_product.exact_duplicate_decisions%ROWTYPE;
BEGIN
  SELECT *
  INTO previous
  FROM source_product.exact_duplicate_decisions
  WHERE submission_item_id = NEW.submission_item_id
  ORDER BY decision_revision DESC
  LIMIT 1
  FOR UPDATE;

  IF previous.decision_id IS NULL THEN
    IF NEW.decision_revision <> 1 OR NEW.supersedes_decision_id IS NOT NULL THEN
      RAISE EXCEPTION 'Initial Duplicate Decision must use revision 1 without supersedes';
    END IF;
  ELSE
    IF NEW.decision_revision <> previous.decision_revision + 1
       OR NEW.supersedes_decision_id IS DISTINCT FROM previous.decision_id THEN
      RAISE EXCEPTION 'Duplicate Decision revision/supersedes mismatch';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE FUNCTION source_product.validate_duplicate_disposition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  decision source_product.exact_duplicate_decisions%ROWTYPE;
  active_decision uuid;
BEGIN
  SELECT *
  INTO decision
  FROM source_product.exact_duplicate_decisions
  WHERE decision_id = NEW.decision_id
    AND decision_revision = NEW.observed_decision_revision
  FOR UPDATE;

  SELECT active_duplicate_decision_id
  INTO active_decision
  FROM source_product.intake_submission_items
  WHERE submission_item_id = NEW.submission_item_id
  FOR UPDATE;

  IF decision.decision_id IS NULL OR active_decision IS DISTINCT FROM NEW.decision_id THEN
    RAISE EXCEPTION 'Duplicate Decision is stale or not active';
  END IF;
  IF NOT (NEW.disposition = ANY(decision.allowed_dispositions)) THEN
    RAISE EXCEPTION 'Duplicate disposition is not allowed by the Decision';
  END IF;
  IF NEW.disposition = 'CREATE_VERSION_CANDIDATE'
     AND NEW.target_source_id IS DISTINCT FROM decision.existing_source_id THEN
    RAISE EXCEPTION 'CREATE_VERSION_CANDIDATE target must equal the existing Source';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION source_product.clear_resolved_duplicate_pointer()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE source_product.intake_submission_items
  SET active_duplicate_decision_id = NULL
  WHERE submission_item_id = NEW.submission_item_id
    AND active_duplicate_decision_id = NEW.decision_id;
  RETURN NEW;
END
$$;

CREATE FUNCTION source_product.validate_url_attempt_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  item_kind text;
  attempt_item uuid;
BEGIN
  SELECT input_kind
  INTO item_kind
  FROM source_product.intake_submission_items
  WHERE submission_item_id = NEW.submission_item_id
  FOR UPDATE;

  SELECT submission_item_id
  INTO attempt_item
  FROM source_product.intake_attempts
  WHERE intake_attempt_id = NEW.intake_attempt_id;

  IF item_kind IS DISTINCT FROM 'URL' OR attempt_item IS DISTINCT FROM NEW.submission_item_id THEN
    RAISE EXCEPTION 'URL Acquisition Attempt must reference a URL Item and same-Item Attempt';
  END IF;
  IF NEW.normalized_requested_url !~ '^https?://'
     OR NEW.normalized_requested_url ~ '#'
     OR NEW.normalized_requested_url ~ '^https?://[^/]*@' THEN
    RAISE EXCEPTION 'URL Acquisition requested URL is not activation-safe';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION source_product.reject_immutable_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME;
END
$$;

CREATE TRIGGER source_product_submission_transition
BEFORE UPDATE ON source_product.intake_submissions
FOR EACH ROW EXECUTE FUNCTION source_product.enforce_submission_transition();

CREATE TRIGGER source_product_item_transition
BEFORE UPDATE ON source_product.intake_submission_items
FOR EACH ROW EXECUTE FUNCTION source_product.enforce_item_transition();

CREATE TRIGGER source_product_attempt_transition
BEFORE UPDATE ON source_product.intake_attempts
FOR EACH ROW EXECUTE FUNCTION source_product.enforce_attempt_transition();

CREATE TRIGGER source_product_url_attempt_transition
BEFORE UPDATE ON source_product.url_acquisition_attempts
FOR EACH ROW EXECUTE FUNCTION source_product.enforce_url_attempt_transition();

CREATE TRIGGER source_product_duplicate_decision_validate
BEFORE INSERT ON source_product.exact_duplicate_decisions
FOR EACH ROW EXECUTE FUNCTION source_product.validate_duplicate_decision();

CREATE TRIGGER source_product_duplicate_disposition_validate
BEFORE INSERT ON source_product.exact_duplicate_dispositions
FOR EACH ROW EXECUTE FUNCTION source_product.validate_duplicate_disposition();

CREATE TRIGGER source_product_duplicate_disposition_clear
AFTER INSERT ON source_product.exact_duplicate_dispositions
FOR EACH ROW EXECUTE FUNCTION source_product.clear_resolved_duplicate_pointer();

CREATE TRIGGER source_product_url_attempt_validate
BEFORE INSERT OR UPDATE OF submission_item_id, intake_attempt_id, normalized_requested_url
ON source_product.url_acquisition_attempts
FOR EACH ROW EXECUTE FUNCTION source_product.validate_url_attempt_item();

CREATE TRIGGER source_product_duplicate_decision_immutable
BEFORE UPDATE OR DELETE ON source_product.exact_duplicate_decisions
FOR EACH ROW EXECUTE FUNCTION source_product.reject_immutable_change();

CREATE TRIGGER source_product_duplicate_disposition_immutable
BEFORE UPDATE OR DELETE ON source_product.exact_duplicate_dispositions
FOR EACH ROW EXECUTE FUNCTION source_product.reject_immutable_change();

CREATE TRIGGER source_product_url_receipt_immutable
BEFORE UPDATE OR DELETE ON source_product.url_provenance_receipts
FOR EACH ROW EXECUTE FUNCTION source_product.reject_immutable_change();

COMMIT;
