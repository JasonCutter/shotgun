DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1 FROM runtime.schema_migrations
    WHERE name = '086_t3_ask_conversation_erasure.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 087 preflight failed: migration 086 is not registered';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION comparison.t3_project_comparison_status(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, comparison
AS $$
DECLARE
  request_state text;
  epoch_state text;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  SELECT request.state, epoch.state INTO request_state, epoch_state
  FROM project_admin.project_knowledge_reset_requests AS request
  JOIN project_admin.project_knowledge_epoch AS epoch
    ON epoch.project_id = request.project_id
   AND epoch.epoch = request.resulting_knowledge_epoch
  WHERE request.project_id = target_project_id
    AND request.request_id = reset_request_id
    AND request.owner_manifest_digest IS NOT NULL;
  IF request_state IS NULL OR request_state NOT IN ('FENCING', 'PURGING', 'REBUILDING', 'VERIFYING')
     OR epoch_state IS DISTINCT FROM 'RESET_PENDING' THEN
    RAISE EXCEPTION 'Comparison status is unavailable outside active maintenance'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;
  RETURN jsonb_build_object(
    'results', (SELECT count(*) FROM comparison.results WHERE project_id = target_project_id),
    'resultsV2', (SELECT count(*) FROM comparison.results_v2 WHERE project_id = target_project_id),
    'analysisRevisionsV2', (SELECT count(*) FROM comparison.analysis_revisions_v2 WHERE project_id = target_project_id),
    'relationshipsV2', (SELECT count(*) FROM comparison.relationships_v2 WHERE project_id = target_project_id),
    'blockedOutcomesV2', (SELECT count(*) FROM comparison.blocked_outcomes_v2 WHERE project_id = target_project_id),
    'activeAnalyses', (
      SELECT count(*) FROM comparison.analysis_revisions_v2
      WHERE project_id = target_project_id AND state IN ('PENDING', 'ANALYZING', 'FAILED_RETRYABLE')
    )
  );
END
$$;
ALTER FUNCTION comparison.t3_project_comparison_status(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION comparison.t3_project_comparison_status(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION comparison.t3_erase_project_comparison(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, comparison
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
    SELECT 1 FROM comparison.analysis_revisions_v2
    WHERE project_id = target_project_id AND state IN ('PENDING', 'ANALYZING', 'FAILED_RETRYABLE')
  ) THEN
    RAISE EXCEPTION 'Comparison analysis has not reached a terminal outcome'
      USING ERRCODE = '55000', CONSTRAINT = 'active_job_outcome_unknown';
  END IF;

  DELETE FROM comparison.relationships_v2 WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('relationshipsV2', affected);
  DELETE FROM comparison.results_v2 WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('resultsV2', affected);
  DELETE FROM comparison.analysis_revisions_v2 WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('analysisRevisionsV2', affected);
  DELETE FROM comparison.blocked_outcomes_v2 WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('blockedOutcomesV2', affected);
  DELETE FROM comparison.results WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('results', affected);
  RETURN deleted;
END
$$;
ALTER FUNCTION comparison.t3_erase_project_comparison(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION comparison.t3_erase_project_comparison(text, uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA comparison TO shotgun_schema_owner, shotgun_erasure_executor;
GRANT SELECT, DELETE ON comparison.results, comparison.results_v2,
  comparison.analysis_revisions_v2, comparison.relationships_v2,
  comparison.blocked_outcomes_v2 TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION project_admin.t3_reset_write_authorized(text) TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION comparison.t3_project_comparison_status(text, uuid),
  comparison.t3_erase_project_comparison(text, uuid) TO shotgun_erasure_executor;
