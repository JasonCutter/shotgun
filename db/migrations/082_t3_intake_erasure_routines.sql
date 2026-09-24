DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '081_t3_source_product_erasure_routines.sql'
  ) THEN
    RAISE EXCEPTION
      'Migration 082 preflight failed: migration 081 is not registered';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION intake.t3_project_submission_status(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, intake
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
    RAISE EXCEPTION 'Intake status is unavailable outside active maintenance'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;

  RETURN jsonb_build_object(
    'submissions', (
      SELECT count(*) FROM intake.submissions WHERE project_id = target_project_id
    )
  );
END
$$;

ALTER FUNCTION intake.t3_project_submission_status(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION intake.t3_project_submission_status(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION intake.t3_erase_project_submissions(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, intake
AS $$
DECLARE
  affected bigint;
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

  DELETE FROM intake.submissions
  WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;

  RETURN jsonb_build_object('submissions', affected);
END
$$;

ALTER FUNCTION intake.t3_erase_project_submissions(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION intake.t3_erase_project_submissions(text, uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA intake TO shotgun_schema_owner, shotgun_erasure_executor;
GRANT SELECT, DELETE ON intake.submissions TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION project_admin.t3_reset_write_authorized(text)
  TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION intake.t3_project_submission_status(text, uuid),
  intake.t3_erase_project_submissions(text, uuid) TO shotgun_erasure_executor;
