DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '083_t3_executor_control_plane_routines.sql'
  ) THEN
    RAISE EXCEPTION
      'Migration 084 preflight failed: migration 083 is not registered';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION evidence.t3_project_evidence_status(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, evidence
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
    RAISE EXCEPTION 'Evidence status is unavailable outside active maintenance'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;

  RETURN jsonb_build_object(
    'indexingResults', (
      SELECT count(*) FROM evidence.indexing_results WHERE project_id = target_project_id
    ),
    'spans', (
      SELECT count(*) FROM evidence.spans WHERE project_id = target_project_id
    ),
    'stage4Continuations', (
      SELECT count(*) FROM evidence.stage4_continuations WHERE project_id = target_project_id
    ),
    'activeContinuations', (
      SELECT count(*)
      FROM evidence.stage4_continuations
      WHERE project_id = target_project_id
        AND state IN ('PENDING', 'RUNNING', 'RETRYABLE_FAILED', 'OUTCOME_UNKNOWN')
    )
  );
END
$$;

ALTER FUNCTION evidence.t3_project_evidence_status(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION evidence.t3_project_evidence_status(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION evidence.t3_erase_project_evidence(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, evidence
AS $$
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

  IF EXISTS (
    SELECT 1
    FROM evidence.stage4_continuations
    WHERE project_id = target_project_id
      AND state IN ('PENDING', 'RUNNING', 'RETRYABLE_FAILED', 'OUTCOME_UNKNOWN')
  ) THEN
    RAISE EXCEPTION 'Evidence continuation work has not reached a safe terminal outcome'
      USING ERRCODE = '55000', CONSTRAINT = 'active_job_outcome_unknown';
  END IF;

  DELETE FROM evidence.stage4_continuations WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('stage4Continuations', affected);

  DELETE FROM evidence.spans WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('spans', affected);

  DELETE FROM evidence.indexing_results WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('indexingResults', affected);

  RETURN deleted;
END
$$;

ALTER FUNCTION evidence.t3_erase_project_evidence(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION evidence.t3_erase_project_evidence(text, uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA evidence TO shotgun_schema_owner, shotgun_erasure_executor;
GRANT SELECT, DELETE ON evidence.indexing_results, evidence.spans,
  evidence.stage4_continuations TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION project_admin.t3_reset_write_authorized(text)
  TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION evidence.t3_project_evidence_status(text, uuid),
  evidence.t3_erase_project_evidence(text, uuid) TO shotgun_erasure_executor;
