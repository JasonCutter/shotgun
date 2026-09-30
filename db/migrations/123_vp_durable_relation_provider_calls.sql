-- Persist one provider egress decision per relation job and provider identity.
-- A committed RUNNING row fences retries after an unknown response outcome.
ALTER TABLE vp.relation_jobs
  DROP CONSTRAINT relation_jobs_status_check,
  ADD CONSTRAINT relation_jobs_status_check
    CHECK (status IN ('PENDING', 'RUNNING', 'RETRYABLE', 'COMPLETED', 'SUPERSEDED', 'FAILED', 'OUTCOME_UNKNOWN')),
  ADD CONSTRAINT relation_jobs_project_job_unique UNIQUE (project_id, job_id);

CREATE TABLE vp.relation_provider_calls (
  call_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL,
  job_id uuid NOT NULL,
  execution_key text NOT NULL CHECK (execution_key ~ '^sha256:[a-f0-9]{64}$'),
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  provider_identity text NOT NULL CHECK (length(provider_identity) BETWEEN 1 AND 256),
  state text NOT NULL CHECK (state IN ('RUNNING', 'OUTPUT_STORED', 'OUTCOME_UNKNOWN')),
  output_json jsonb,
  failure_code text CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((state = 'OUTPUT_STORED') = (output_json IS NOT NULL)),
  UNIQUE (job_id, execution_key),
  FOREIGN KEY (project_id, job_id)
    REFERENCES vp.relation_jobs(project_id, job_id) ON DELETE CASCADE
);

CREATE INDEX vp_relation_provider_calls_recovery_idx
  ON vp.relation_provider_calls (project_id, state, updated_at);

GRANT SELECT, INSERT, UPDATE ON vp.relation_provider_calls TO shotgun_runtime;
GRANT SELECT, DELETE ON vp.relation_provider_calls TO shotgun_schema_owner;

CREATE TRIGGER vp_relation_provider_calls_write_fence
  BEFORE INSERT OR UPDATE ON vp.relation_provider_calls
  FOR EACH ROW EXECUTE FUNCTION project_admin.t3_guard_project_knowledge_write();

CREATE OR REPLACE FUNCTION vp.t3_project_status(target_project_id text, reset_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, project_admin, vp AS $$
DECLARE
  authorized boolean;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM project_admin.project_knowledge_reset_requests AS request
    JOIN project_admin.project_knowledge_epoch AS epoch
      ON epoch.project_id = request.project_id
     AND epoch.epoch = request.resulting_knowledge_epoch
    WHERE request.project_id = target_project_id
      AND request.request_id = reset_request_id
      AND request.owner_manifest_digest IS NOT NULL
      AND request.state IN ('FENCING', 'PURGING', 'REBUILDING', 'VERIFYING')
      AND epoch.state = 'RESET_PENDING'
  ) INTO authorized;
  IF NOT authorized THEN
    RAISE EXCEPTION 'VP ledger status is unavailable outside active maintenance'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;
  RETURN jsonb_build_object(
    'jobs', (SELECT count(*) FROM vp.relation_jobs WHERE project_id = target_project_id),
    'provider_calls', (SELECT count(*) FROM vp.relation_provider_calls WHERE project_id = target_project_id),
    'assertions', (SELECT count(*) FROM vp.assertions WHERE project_id = target_project_id),
    'relations', (SELECT count(*) FROM vp.relations WHERE project_id = target_project_id),
    'decisions', (SELECT count(*) FROM vp.decision_receipts WHERE project_id = target_project_id),
    'events', (SELECT count(*) FROM vp.history_events WHERE project_id = target_project_id),
    'epochs', (SELECT count(*) FROM vp.project_epochs WHERE project_id = target_project_id)
  );
END
$$;

ALTER FUNCTION vp.t3_project_status(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION vp.t3_project_status(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vp.t3_project_status(text, uuid) TO shotgun_erasure_executor;
