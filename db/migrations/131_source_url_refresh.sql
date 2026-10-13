-- Additive URL refresh journal. Existing acquisition receipts and SourceVersion
-- authority are retained; no authority/configuration or old row is rewritten.
CREATE TABLE source_product.url_refresh_jobs (
  job_id uuid PRIMARY KEY,
  project_id text NOT NULL REFERENCES project_admin.projects(id),
  source_id uuid NOT NULL REFERENCES asset.sources(source_id),
  source_version_id uuid NOT NULL REFERENCES asset.source_versions(source_version_id),
  principal_id text NOT NULL,
  session_id uuid NOT NULL REFERENCES auth.sessions(session_id),
  provenance_receipt_id uuid NOT NULL REFERENCES source_product.url_provenance_receipts(url_provenance_receipt_id) ON DELETE CASCADE,
  requested_url text NOT NULL,
  label text NOT NULL,
  sensitivity text NOT NULL CHECK (sensitivity IN ('public','internal','private','restricted')),
  access_scope text[] NOT NULL CHECK (cardinality(access_scope) > 0),
  phase text NOT NULL CHECK (phase IN ('READY','ACQUIRING','STAGED','SUBMITTING','SUCCEEDED','FAILED','OUTCOME_UNKNOWN')),
  staging_reference text,
  submission_id uuid NOT NULL UNIQUE,
  item_id uuid NOT NULL UNIQUE,
  command_id uuid NOT NULL UNIQUE,
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  safe_failure_code text,
  produced_source_version_id uuid REFERENCES asset.source_versions(source_version_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (source_id, provenance_receipt_id),
  FOREIGN KEY (project_id, source_id) REFERENCES asset.sources(project_id, source_id),
  FOREIGN KEY (source_id, source_version_id) REFERENCES asset.source_versions(source_id, source_version_id),
  CHECK ((lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL)
    OR (lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (phase NOT IN ('STAGED','SUBMITTING','SUCCEEDED') OR staging_reference IS NOT NULL),
  CHECK (phase <> 'SUCCEEDED' OR produced_source_version_id IS NOT NULL)
);
CREATE INDEX url_refresh_jobs_due ON source_product.url_refresh_jobs(next_attempt_at)
  WHERE phase IN ('READY','STAGED','SUBMITTING','FAILED');
CREATE INDEX url_refresh_jobs_project_phase ON source_product.url_refresh_jobs(project_id,phase);
CREATE INDEX url_refresh_jobs_receipt ON source_product.url_refresh_jobs(provenance_receipt_id);
GRANT SELECT, INSERT, UPDATE ON source_product.url_refresh_jobs TO shotgun_runtime;
GRANT SELECT, DELETE ON source_product.url_refresh_jobs TO shotgun_schema_owner;
CREATE TRIGGER url_refresh_jobs_write_fence BEFORE INSERT OR UPDATE OR DELETE ON source_product.url_refresh_jobs
  FOR EACH ROW EXECUTE FUNCTION project_admin.t3_guard_project_knowledge_write();

CREATE OR REPLACE FUNCTION source_product.t3_source_product_status(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, source_product
AS $$
DECLARE
  request_state text;
  epoch_state text;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;

  SELECT request.state, epoch.state
    INTO request_state, epoch_state
  FROM project_admin.project_knowledge_reset_requests AS request
  JOIN project_admin.project_knowledge_epoch AS epoch
    ON epoch.project_id = request.project_id
   AND epoch.epoch = request.resulting_knowledge_epoch
  WHERE request.project_id = target_project_id
    AND request.request_id = reset_request_id
    AND request.owner_manifest_digest IS NOT NULL;

  IF request_state IS NULL
     OR request_state NOT IN ('FENCING', 'PURGING', 'REBUILDING', 'VERIFYING')
     OR epoch_state IS DISTINCT FROM 'RESET_PENDING' THEN
    RAISE EXCEPTION 'Source Product status is unavailable outside active maintenance'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;

  RETURN jsonb_build_object(
    'intakeSubmissions', (SELECT count(*) FROM source_product.intake_submissions WHERE project_id = target_project_id),
    'intakeSubmissionItems', (SELECT count(*) FROM source_product.intake_submission_items WHERE project_id = target_project_id),
    'intakeAttempts', (SELECT count(*) FROM source_product.intake_attempts WHERE project_id = target_project_id),
    'duplicateDecisions', (SELECT count(*) FROM source_product.exact_duplicate_decisions WHERE project_id = target_project_id),
    'duplicateDispositions', (SELECT count(*) FROM source_product.exact_duplicate_dispositions WHERE project_id = target_project_id),
    'urlAcquisitionAttempts', (SELECT count(*) FROM source_product.url_acquisition_attempts WHERE project_id = target_project_id),
    'urlRefreshJobs', (SELECT count(*) FROM source_product.url_refresh_jobs WHERE project_id = target_project_id),
    'urlProvenanceReceipts', (SELECT count(*) FROM source_product.url_provenance_receipts WHERE project_id = target_project_id),
    'sourceStage3Progress', (SELECT count(*) FROM source_product.source_stage3_progress WHERE project_id = target_project_id),
    'activeSubmissions', (SELECT count(*) FROM source_product.intake_submissions WHERE project_id = target_project_id AND state NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED')),
    'activeAttempts', (SELECT count(*) FROM source_product.intake_attempts WHERE project_id = target_project_id AND state IN ('ACCEPTED', 'RUNNING', 'CANCEL_REQUESTED', 'OUTCOME_INDETERMINATE')),
    'activeUrlAcquisitions', (SELECT count(*) FROM source_product.url_refresh_jobs WHERE project_id = target_project_id AND phase IN ('ACQUIRING','SUBMITTING','OUTCOME_UNKNOWN')) + (SELECT count(*) FROM source_product.url_acquisition_attempts WHERE project_id = target_project_id AND state IN ('VALIDATING', 'CONNECTING', 'READING', 'CANCEL_REQUESTED', 'OUTCOME_INDETERMINATE'))
  );
END
$$;

ALTER FUNCTION source_product.t3_source_product_status(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION source_product.t3_source_product_status(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION source_product.t3_source_product_status(text, uuid)
  TO shotgun_erasure_executor;

CREATE OR REPLACE FUNCTION source_product.t3_erase_project_source_product(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, source_product
AS $$
DECLARE
  affected bigint;
  deleted jsonb := '{}'::jsonb;
  loop_deleted bigint;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;

  PERFORM set_config('shotgun.t3_reset_request_id', reset_request_id::text, true);
  IF NOT project_admin.t3_reset_write_authorized(target_project_id) THEN
    RAISE EXCEPTION 'Approved Source knowledge reset request is not active'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;

  IF EXISTS (
    SELECT 1 FROM source_product.intake_submissions
    WHERE project_id = target_project_id
      AND state NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
  ) OR EXISTS (
    SELECT 1 FROM source_product.intake_attempts
    WHERE project_id = target_project_id
      AND state IN ('ACCEPTED', 'RUNNING', 'CANCEL_REQUESTED', 'OUTCOME_INDETERMINATE')
  ) OR EXISTS (
    SELECT 1 FROM source_product.url_acquisition_attempts
    WHERE project_id = target_project_id
      AND state IN ('VALIDATING', 'CONNECTING', 'READING', 'CANCEL_REQUESTED', 'OUTCOME_INDETERMINATE')
  ) THEN
    RAISE EXCEPTION 'Source Product work has not reached a known terminal outcome'
      USING ERRCODE = '55000', CONSTRAINT = 'active_job_outcome_unknown';
  END IF;

  DELETE FROM source_product.url_provenance_receipts
  WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('urlProvenanceReceipts', affected);

  DELETE FROM source_product.url_acquisition_attempts
  WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('urlAcquisitionAttempts', affected);

  DELETE FROM source_product.exact_duplicate_dispositions
  WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('duplicateDispositions', affected);

  UPDATE source_product.intake_submission_items
  SET active_duplicate_decision_id = NULL
  WHERE project_id = target_project_id
    AND active_duplicate_decision_id IS NOT NULL;

  affected := 0;
  LOOP
    DELETE FROM source_product.exact_duplicate_decisions AS decision
    WHERE decision.project_id = target_project_id
      AND NOT EXISTS (
        SELECT 1 FROM source_product.exact_duplicate_decisions AS child
        WHERE child.supersedes_decision_id = decision.decision_id
      );
    GET DIAGNOSTICS loop_deleted = ROW_COUNT;
    affected := COALESCE(affected, 0) + loop_deleted;
    EXIT WHEN loop_deleted = 0;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM source_product.exact_duplicate_decisions
    WHERE project_id = target_project_id
  ) THEN
    RAISE EXCEPTION 'Duplicate-decision lineage did not close'
      USING ERRCODE = '55000', CONSTRAINT = 't3_duplicate_decision_closure_incomplete';
  END IF;
  deleted := deleted || jsonb_build_object('duplicateDecisions', affected);

  affected := 0;
  LOOP
    DELETE FROM source_product.intake_attempts AS attempt
    WHERE attempt.project_id = target_project_id
      AND NOT EXISTS (
        SELECT 1 FROM source_product.intake_attempts AS child
        WHERE child.submission_item_id = attempt.submission_item_id
          AND child.causation_attempt_id = attempt.intake_attempt_id
      );
    GET DIAGNOSTICS loop_deleted = ROW_COUNT;
    affected := affected + loop_deleted;
    EXIT WHEN loop_deleted = 0;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM source_product.intake_attempts
    WHERE project_id = target_project_id
  ) THEN
    RAISE EXCEPTION 'Intake attempt lineage did not close'
      USING ERRCODE = '55000', CONSTRAINT = 't3_intake_attempt_closure_incomplete';
  END IF;
  deleted := deleted || jsonb_build_object('intakeAttempts', affected);

  DELETE FROM source_product.source_stage3_progress
  WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('sourceStage3Progress', affected);

  DELETE FROM source_product.intake_submission_items
  WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('intakeSubmissionItems', affected);

  DELETE FROM source_product.intake_submissions
  WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('intakeSubmissions', affected);

  RETURN deleted;
END
$$;


ALTER FUNCTION source_product.t3_erase_project_source_product(text,uuid) OWNER TO shotgun_schema_owner;
