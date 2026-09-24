DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '091_t3_asset_erasure_routines.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 092 preflight failed: migration 091 is not registered';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION frontend_knowledge_graph.block_snapshot_context_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND session_user = 'shotgun_erasure_executor'
     AND project_admin.t3_reset_write_authorized(OLD.project_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'frontend_knowledge_graph.snapshot_context is immutable outside approved T3 erasure'
    USING ERRCODE = '55000', CONSTRAINT = 'frontend_graph_snapshot_context_immutable';
END
$$;
ALTER FUNCTION frontend_knowledge_graph.block_snapshot_context_mutation()
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_knowledge_graph.block_snapshot_context_mutation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION project_admin.t3_reset_write_authorized(text) TO shotgun_schema_owner;

CREATE OR REPLACE FUNCTION frontend_knowledge_graph.t3_project_graph_status(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, frontend_knowledge_graph
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
    RAISE EXCEPTION 'Knowledge graph status is unavailable outside active maintenance'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;

  RETURN jsonb_build_object(
    'snapshotContexts', (
      SELECT count(*) FROM frontend_knowledge_graph.snapshot_context WHERE project_id = target_project_id
    ),
    'projectionHealth', (
      SELECT count(*) FROM frontend_knowledge_graph.projection_health WHERE project_id = target_project_id
    ),
    'overlayHealth', (
      SELECT count(*) FROM frontend_knowledge_graph.overlay_health WHERE project_id = target_project_id
    ),
    'continuations', (
      SELECT count(*) FROM frontend_knowledge_graph.continuation WHERE project_id = target_project_id
    )
  );
END
$$;
ALTER FUNCTION frontend_knowledge_graph.t3_project_graph_status(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_knowledge_graph.t3_project_graph_status(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_knowledge_graph.t3_erase_project_graph_views(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, frontend_knowledge_graph
AS $$
DECLARE
  deleted_continuations bigint;
  deleted_overlays bigint;
  deleted_projection_health bigint;
  deleted_snapshots bigint;
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

  DELETE FROM frontend_knowledge_graph.continuation WHERE project_id = target_project_id;
  GET DIAGNOSTICS deleted_continuations = ROW_COUNT;
  DELETE FROM frontend_knowledge_graph.overlay_health WHERE project_id = target_project_id;
  GET DIAGNOSTICS deleted_overlays = ROW_COUNT;
  DELETE FROM frontend_knowledge_graph.projection_health WHERE project_id = target_project_id;
  GET DIAGNOSTICS deleted_projection_health = ROW_COUNT;
  DELETE FROM frontend_knowledge_graph.snapshot_context WHERE project_id = target_project_id;
  GET DIAGNOSTICS deleted_snapshots = ROW_COUNT;

  RETURN jsonb_build_object(
    'continuations', deleted_continuations,
    'overlayHealth', deleted_overlays,
    'projectionHealth', deleted_projection_health,
    'snapshotContexts', deleted_snapshots
  );
END
$$;
ALTER FUNCTION frontend_knowledge_graph.t3_erase_project_graph_views(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_knowledge_graph.t3_erase_project_graph_views(text, uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA frontend_knowledge_graph TO shotgun_schema_owner, shotgun_erasure_executor;
GRANT SELECT, DELETE ON frontend_knowledge_graph.snapshot_context,
  frontend_knowledge_graph.projection_health, frontend_knowledge_graph.overlay_health,
  frontend_knowledge_graph.continuation TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION frontend_knowledge_graph.t3_project_graph_status(text, uuid),
  frontend_knowledge_graph.t3_erase_project_graph_views(text, uuid) TO shotgun_erasure_executor;
