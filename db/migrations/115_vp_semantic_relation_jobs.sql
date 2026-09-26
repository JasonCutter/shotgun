-- Durable, source-bound pair decisions. Jobs are mutable execution state;
-- assertions, decisions, relations and history remain append-only.
ALTER TABLE vp.decision_receipts
  DROP CONSTRAINT decision_receipts_method_check,
  DROP CONSTRAINT decision_receipts_task_kind_check,
  DROP CONSTRAINT decision_receipts_outcome_check,
  ADD COLUMN left_assertion_id uuid,
  ADD COLUMN right_assertion_id uuid,
  ADD COLUMN confidence double precision CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  ADD COLUMN provider_model text CHECK (provider_model IS NULL OR length(provider_model) BETWEEN 1 AND 256),
  ADD COLUMN input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  ADD COLUMN output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  ADD CONSTRAINT decision_receipts_method_check
    CHECK (method IN ('DETERMINISTIC', 'JEV', 'GENERAL_AI')),
  ADD CONSTRAINT decision_receipts_task_kind_check
    CHECK (task_kind IN ('EXACT_TEXT_EQUIVALENCE', 'SEMANTIC_RELATION')),
  ADD CONSTRAINT decision_receipts_outcome_check
    CHECK (outcome IN ('EQUIVALENT', 'QUALIFIES', 'CONTRADICTS', 'RELATED', 'UNRESOLVED')),
  ADD CONSTRAINT decision_receipts_semantic_pair_check
    CHECK (task_kind <> 'SEMANTIC_RELATION' OR
      (left_assertion_id IS NOT NULL AND right_assertion_id IS NOT NULL AND
       left_assertion_id < right_assertion_id AND method IN ('JEV', 'GENERAL_AI') AND
       confidence IS NOT NULL AND provider_model IS NOT NULL AND
       input_tokens IS NOT NULL AND output_tokens IS NOT NULL)),
  ADD CONSTRAINT decision_receipts_left_assertion_fk
    FOREIGN KEY (project_id, left_assertion_id)
    REFERENCES vp.assertions(project_id, assertion_id) ON DELETE RESTRICT,
  ADD CONSTRAINT decision_receipts_right_assertion_fk
    FOREIGN KEY (project_id, right_assertion_id)
    REFERENCES vp.assertions(project_id, assertion_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX vp_semantic_decision_pair_policy_unique
  ON vp.decision_receipts (project_id, left_assertion_id, right_assertion_id, policy_revision)
  WHERE task_kind = 'SEMANTIC_RELATION';

ALTER TABLE vp.relations DROP CONSTRAINT relations_relation_kind_check;
ALTER TABLE vp.relations ADD CONSTRAINT relations_relation_kind_check
  CHECK (relation_kind IN ('EQUIVALENT', 'QUALIFIES', 'CONTRADICTS', 'RELATED'));
ALTER TABLE vp.history_events DROP CONSTRAINT history_events_event_kind_check;
ALTER TABLE vp.history_events ADD CONSTRAINT history_events_event_kind_check
  CHECK (event_kind IN ('DIRECT_ASSERTION_RECORDED', 'SEMANTIC_RELATION_RECORDED'));

CREATE TABLE vp.relation_jobs (
  job_id uuid PRIMARY KEY,
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  left_assertion_id uuid NOT NULL,
  right_assertion_id uuid NOT NULL,
  policy_revision text NOT NULL CHECK (length(policy_revision) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'RUNNING', 'RETRYABLE', 'COMPLETED', 'SUPERSEDED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz,
  last_failure_code text CHECK (last_failure_code IS NULL OR length(last_failure_code) <= 100),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (left_assertion_id < right_assertion_id),
  CHECK ((status = 'RUNNING') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  UNIQUE (project_id, left_assertion_id, right_assertion_id, policy_revision),
  FOREIGN KEY (project_id, left_assertion_id)
    REFERENCES vp.assertions(project_id, assertion_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, right_assertion_id)
    REFERENCES vp.assertions(project_id, assertion_id) ON DELETE RESTRICT
);
CREATE INDEX vp_relation_jobs_ready_idx
  ON vp.relation_jobs (status, next_attempt_at, created_at, job_id)
  WHERE status IN ('PENDING', 'RUNNING', 'RETRYABLE');

GRANT SELECT, INSERT, UPDATE ON vp.relation_jobs TO shotgun_runtime;
GRANT SELECT, DELETE ON vp.relation_jobs TO shotgun_schema_owner;
CREATE TRIGGER vp_relation_jobs_write_fence
  BEFORE INSERT OR UPDATE ON vp.relation_jobs
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
    'assertions', (SELECT count(*) FROM vp.assertions WHERE project_id = target_project_id),
    'relations', (SELECT count(*) FROM vp.relations WHERE project_id = target_project_id),
    'decisions', (SELECT count(*) FROM vp.decision_receipts WHERE project_id = target_project_id),
    'events', (SELECT count(*) FROM vp.history_events WHERE project_id = target_project_id),
    'epochs', (SELECT count(*) FROM vp.project_epochs WHERE project_id = target_project_id)
  );
END
$$;

CREATE OR REPLACE FUNCTION vp.t3_erase_project(target_project_id text, reset_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, project_admin, vp AS $$
DECLARE
  affected bigint;
  deleted jsonb := '{}'::jsonb;
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
  DELETE FROM vp.relation_jobs WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('jobs', affected);
  DELETE FROM vp.history_events WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('events', affected);
  DELETE FROM vp.relations WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('relations', affected);
  DELETE FROM vp.decision_receipts WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('decisions', affected);
  DELETE FROM vp.assertions WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('assertions', affected);
  DELETE FROM vp.project_epochs WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('epochs', affected);
  RETURN deleted;
END
$$;

ALTER FUNCTION vp.t3_project_status(text, uuid) OWNER TO shotgun_schema_owner;
ALTER FUNCTION vp.t3_erase_project(text, uuid) OWNER TO shotgun_schema_owner;
