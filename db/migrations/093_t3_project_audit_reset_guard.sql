DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '092_t3_knowledge_graph_projection_erasure.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 093 preflight failed: migration 092 is not registered';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION project_audit.t3_project_reset_guard_status(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, project_audit
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
    RAISE EXCEPTION 'Project audit status is unavailable outside active maintenance'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;

  RETURN jsonb_build_object(
    'projectTombstones', (
      SELECT count(*) FROM project_audit.project_tombstones WHERE project_id = target_project_id
    ),
    'deletedProjectAuditScopes', (
      SELECT count(*) FROM project_audit.deleted_project_audit_scopes WHERE project_id = target_project_id
    )
  );
END
$$;
ALTER FUNCTION project_audit.t3_project_reset_guard_status(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION project_audit.t3_project_reset_guard_status(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION project_audit.t3_assert_project_reset_audit_empty(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, project_audit
AS $$
DECLARE
  status jsonb;
BEGIN
  status := project_audit.t3_project_reset_guard_status(target_project_id, reset_request_id);
  IF (status->>'projectTombstones')::bigint > 0
     OR (status->>'deletedProjectAuditScopes')::bigint > 0 THEN
    RAISE EXCEPTION 'Project audit rows require their own retention disposition'
      USING ERRCODE = '55000', CONSTRAINT = 't3_project_audit_unclassified';
  END IF;
  RETURN status;
END
$$;
ALTER FUNCTION project_audit.t3_assert_project_reset_audit_empty(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION project_audit.t3_assert_project_reset_audit_empty(text, uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA project_audit TO shotgun_schema_owner, shotgun_erasure_executor;
GRANT SELECT ON project_audit.project_tombstones,
  project_audit.deleted_project_audit_scopes TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION project_audit.t3_project_reset_guard_status(text, uuid),
  project_audit.t3_assert_project_reset_audit_empty(text, uuid) TO shotgun_erasure_executor;
