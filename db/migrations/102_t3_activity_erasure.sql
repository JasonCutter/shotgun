DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1 FROM runtime.schema_migrations
    WHERE name = '101_t3_canonical_erasure.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 102 preflight failed: migration 101 is not registered';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION frontend_activity.t3_project_activity_impact(target_project_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, frontend_activity
AS $$
  WITH scope_rows AS (
    SELECT 'activity_index'::text AS relation_name, to_jsonb(row_data)::text AS row_data,
           row_data.snapshot_revision
    FROM frontend_activity.activity_index AS row_data
    WHERE row_data.resource_project_id = target_project_id
    UNION ALL
    SELECT 'projection_watermarks', to_jsonb(row_data)::text, row_data.snapshot_revision
    FROM frontend_activity.projection_watermarks AS row_data
    WHERE row_data.resource_project_id = target_project_id
  )
  SELECT jsonb_build_object(
    'activityRecordCount', count(*) FILTER (WHERE relation_name = 'activity_index')::integer,
    'watermarkCount', count(*) FILTER (WHERE relation_name = 'projection_watermarks')::integer,
    'sourceDomainRecordCount', count(*) FILTER (
      WHERE relation_name = 'activity_index'
        AND row_data::jsonb->>'domain_kind' = 'SOURCES'
    )::integer,
    'snapshotRevision', COALESCE(max(snapshot_revision), 0)::integer,
    'fingerprint', encode(pg_catalog.sha256(convert_to(COALESCE(string_agg(
      encode(pg_catalog.sha256(convert_to(relation_name || E'\t' || row_data, 'UTF8')), 'hex'),
      '' ORDER BY relation_name, row_data
    ), ''), 'UTF8')), 'hex')
  )
  FROM scope_rows
$$;
ALTER FUNCTION frontend_activity.t3_project_activity_impact(text) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_activity.t3_project_activity_impact(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_activity.t3_project_activity_status(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, frontend_activity, project_admin
AS $$
DECLARE
  impact jsonb;
  request_row project_admin.project_knowledge_reset_requests%ROWTYPE;
  expected_revision integer;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  SELECT * INTO request_row
  FROM project_admin.project_knowledge_reset_requests AS request
  WHERE request.project_id = target_project_id AND request.request_id = reset_request_id;
  IF NOT FOUND OR request_row.owner_manifest_digest IS NULL THEN
    RAISE EXCEPTION 'Approved reset request is missing'
      USING ERRCODE = '55000', CONSTRAINT = 't3_activity_snapshot_missing';
  END IF;
  impact := frontend_activity.t3_project_activity_impact(target_project_id);
  expected_revision := COALESCE(
    (request_row.step_checkpoints->'t3ActivityFenceSnapshot'->>'snapshotRevision')::integer,
    0
  ) + 1;
  RETURN impact || jsonb_build_object(
    'expectedSnapshotRevision', expected_revision,
    'revisionMismatchCount', (
      SELECT count(*)::integer
      FROM frontend_activity.activity_index AS row_data
      WHERE row_data.resource_project_id = target_project_id
        AND row_data.snapshot_revision <> expected_revision
    ) + (
      SELECT count(*)::integer
      FROM frontend_activity.projection_watermarks AS row_data
      WHERE row_data.resource_project_id = target_project_id
        AND row_data.snapshot_revision <> expected_revision
    ),
    'rebuildCompleted', COALESCE(
      (request_row.step_checkpoints->>'t3ActivityRebuildComplete')::boolean,
      false
    )
  );
END
$$;
ALTER FUNCTION frontend_activity.t3_project_activity_status(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_activity.t3_project_activity_status(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_activity.t3_snapshot_project_activity(
  target_project_id text,
  reset_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, frontend_activity, project_admin
AS $$
DECLARE
  request_row project_admin.project_knowledge_reset_requests%ROWTYPE;
  snapshot jsonb;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  SELECT * INTO request_row
  FROM project_admin.project_knowledge_reset_requests AS request
  WHERE request.project_id = target_project_id AND request.request_id = reset_request_id
  FOR UPDATE;
  IF NOT FOUND OR request_row.state NOT IN (
    'FENCING', 'PURGING', 'REBUILDING', 'VERIFYING', 'OUTCOME_UNKNOWN', 'ERASURE_UNVERIFIED'
  ) OR request_row.owner_manifest_digest IS NULL THEN
    RAISE EXCEPTION 'Approved reset request is missing or stale'
      USING ERRCODE = '55000', CONSTRAINT = 't3_activity_snapshot_missing';
  END IF;
  IF request_row.step_checkpoints ? 't3ActivityFenceSnapshot' THEN
    RETURN;
  END IF;
  IF request_row.state <> 'FENCING' THEN
    RAISE EXCEPTION 'Activity fence snapshot is missing after purge began'
      USING ERRCODE = '55000', CONSTRAINT = 't3_activity_snapshot_missing';
  END IF;
  snapshot := frontend_activity.t3_project_activity_impact(target_project_id);
  UPDATE project_admin.project_knowledge_reset_requests AS request
  SET step_checkpoints = jsonb_set(
        request.step_checkpoints,
        '{t3ActivityFenceSnapshot}', snapshot,
        true
      ),
      updated_at = now()
  WHERE request.project_id = target_project_id AND request.request_id = reset_request_id;
END
$$;
ALTER FUNCTION frontend_activity.t3_snapshot_project_activity(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_activity.t3_snapshot_project_activity(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_activity.t3_erase_project_activity(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, frontend_activity, project_admin
AS $$
DECLARE
  request_row project_admin.project_knowledge_reset_requests%ROWTYPE;
  baseline jsonb;
  current_impact jsonb;
  removed_activity integer;
  removed_watermarks integer;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  PERFORM set_config('shotgun.t3_reset_request_id', reset_request_id::text, true);
  SELECT * INTO request_row
  FROM project_admin.project_knowledge_reset_requests AS request
  WHERE request.project_id = target_project_id AND request.request_id = reset_request_id
  FOR UPDATE;
  baseline := request_row.step_checkpoints->'t3ActivityFenceSnapshot';
  IF NOT FOUND OR request_row.state NOT IN (
    'PURGING', 'REBUILDING', 'VERIFYING', 'OUTCOME_UNKNOWN', 'ERASURE_UNVERIFIED'
  ) OR request_row.owner_manifest_digest IS NULL OR baseline IS NULL THEN
    RAISE EXCEPTION 'Activity reset approval or fence snapshot is missing'
      USING ERRCODE = '55000', CONSTRAINT = 't3_activity_snapshot_missing';
  END IF;
  IF COALESCE((request_row.step_checkpoints->>'t3ActivityPurged')::boolean, false) THEN
    RETURN jsonb_build_object('removedActivityRecords', 0, 'removedWatermarks', 0);
  END IF;
  current_impact := frontend_activity.t3_project_activity_impact(target_project_id);
  IF current_impact->>'fingerprint' <> baseline->>'fingerprint'
     OR current_impact->>'activityRecordCount' <> baseline->>'activityRecordCount'
     OR current_impact->>'watermarkCount' <> baseline->>'watermarkCount'
     OR current_impact->>'snapshotRevision' <> baseline->>'snapshotRevision' THEN
    RAISE EXCEPTION 'Activity projection changed after approved reset preview'
      USING ERRCODE = '55000', CONSTRAINT = 't3_activity_snapshot_stale';
  END IF;
  DELETE FROM frontend_activity.activity_index AS activity
  WHERE activity.resource_project_id = target_project_id;
  GET DIAGNOSTICS removed_activity = ROW_COUNT;
  DELETE FROM frontend_activity.projection_watermarks AS watermark
  WHERE watermark.resource_project_id = target_project_id;
  GET DIAGNOSTICS removed_watermarks = ROW_COUNT;
  UPDATE project_admin.project_knowledge_reset_requests AS request
  SET step_checkpoints = jsonb_set(
        request.step_checkpoints, '{t3ActivityPurged}', 'true'::jsonb, true
      ),
      updated_at = now()
  WHERE request.project_id = target_project_id AND request.request_id = reset_request_id;
  RETURN jsonb_build_object(
    'removedActivityRecords', removed_activity,
    'removedWatermarks', removed_watermarks
  );
END
$$;
ALTER FUNCTION frontend_activity.t3_erase_project_activity(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_activity.t3_erase_project_activity(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_activity.t3_rebuild_project_activity(
  target_project_id text,
  reset_request_id uuid,
  records jsonb,
  watermarks jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, frontend_activity, project_admin
AS $$
DECLARE
  request_row project_admin.project_knowledge_reset_requests%ROWTYPE;
  snapshot jsonb;
  target_revision integer;
  written_activity integer;
  written_watermarks integer;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  PERFORM set_config('shotgun.t3_reset_request_id', reset_request_id::text, true);
  SELECT * INTO request_row
  FROM project_admin.project_knowledge_reset_requests AS request
  WHERE request.project_id = target_project_id AND request.request_id = reset_request_id
  FOR UPDATE;
  snapshot := request_row.step_checkpoints->'t3ActivityFenceSnapshot';
  IF NOT FOUND OR request_row.state NOT IN ('REBUILDING', 'VERIFYING') OR snapshot IS NULL THEN
    RAISE EXCEPTION 'Activity rebuild request or fence snapshot is missing'
      USING ERRCODE = '55000', CONSTRAINT = 't3_activity_snapshot_missing';
  END IF;
  target_revision := (snapshot->>'snapshotRevision')::integer + 1;
  IF COALESCE((request_row.step_checkpoints->>'t3ActivityRebuildComplete')::boolean, false) THEN
    RETURN frontend_activity.t3_project_activity_status(target_project_id, reset_request_id);
  END IF;
  IF jsonb_typeof(records) IS DISTINCT FROM 'array'
     OR jsonb_typeof(watermarks) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Activity rebuild payload must be arrays'
      USING ERRCODE = '22023', CONSTRAINT = 't3_activity_rebuild_invalid';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(records) AS item(resource_project_id text)
    WHERE item.resource_project_id IS DISTINCT FROM target_project_id
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(watermarks) AS item(resource_project_id text)
    WHERE item.resource_project_id IS DISTINCT FROM target_project_id
  ) THEN
    RAISE EXCEPTION 'Activity rebuild payload crosses Project scope'
      USING ERRCODE = '22023', CONSTRAINT = 't3_activity_rebuild_invalid';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(records) AS item(domain_kind text)
    WHERE item.domain_kind = 'SOURCES'
  ) THEN
    RAISE EXCEPTION 'Source Activity remains after Source owner purge'
      USING ERRCODE = '55000', CONSTRAINT = 't3_activity_source_projection_remaining';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM jsonb_to_recordset(watermarks) AS item(domain_kind text)
       WHERE item.domain_kind = 'SOURCES'
     ) OR NOT EXISTS (
       SELECT 1 FROM jsonb_to_recordset(watermarks) AS item(domain_kind text)
       WHERE item.domain_kind = 'ASK'
     ) OR NOT EXISTS (
       SELECT 1 FROM jsonb_to_recordset(watermarks) AS item(domain_kind text)
       WHERE item.domain_kind = 'EXTERNAL_ACTION'
     ) OR NOT EXISTS (
       SELECT 1 FROM jsonb_to_recordset(watermarks) AS item(domain_kind text)
       WHERE item.domain_kind = 'DISCOVERY'
     ) THEN
    RAISE EXCEPTION 'Activity rebuild omitted a required owner watermark'
      USING ERRCODE = '55000', CONSTRAINT = 't3_activity_rebuild_invalid';
  END IF;

  DELETE FROM frontend_activity.activity_index WHERE resource_project_id = target_project_id;
  DELETE FROM frontend_activity.projection_watermarks WHERE resource_project_id = target_project_id;
  INSERT INTO frontend_activity.activity_index (
    resource_project_id, activity_id, domain_kind, root_kind,
    domain_resource_kind, domain_resource_id, domain_resource_revision,
    resource_href, job_id, run_id, summary, state, attention, retryability,
    freshness, adapter_status, snapshot_revision, snapshot, projected_at, updated_at
  )
  SELECT item.resource_project_id, item.activity_id, item.domain_kind, item.root_kind,
         item.domain_resource_kind, item.domain_resource_id, item.domain_resource_revision,
         item.resource_href, item.job_id, item.run_id, item.summary, item.state,
         item.attention, item.retryability, item.freshness, item.adapter_status,
         target_revision, item.snapshot, item.projected_at, item.updated_at
  FROM jsonb_to_recordset(records) AS item(
    resource_project_id text, activity_id text, domain_kind text, root_kind text,
    domain_resource_kind text, domain_resource_id text, domain_resource_revision text,
    resource_href text, job_id text, run_id text, summary text, state text,
    attention text, retryability text, freshness text, adapter_status text,
    snapshot_revision bigint, snapshot jsonb, projected_at timestamptz, updated_at timestamptz
  );
  GET DIAGNOSTICS written_activity = ROW_COUNT;
  INSERT INTO frontend_activity.projection_watermarks (
    resource_project_id, adapter_id, domain_kind, source_updated_at, projected_at,
    lag_milliseconds, adapter_status, snapshot_revision, cursor, updated_at
  )
  SELECT item.resource_project_id, item.adapter_id, item.domain_kind, item.source_updated_at,
         item.projected_at, item.lag_milliseconds, item.adapter_status, target_revision,
         item.cursor, item.updated_at
  FROM jsonb_to_recordset(watermarks) AS item(
    resource_project_id text, adapter_id text, domain_kind text,
    source_updated_at timestamptz, projected_at timestamptz,
    lag_milliseconds bigint, adapter_status text, snapshot_revision bigint,
    cursor text, updated_at timestamptz
  );
  GET DIAGNOSTICS written_watermarks = ROW_COUNT;
  IF written_watermarks = 0 THEN
    RAISE EXCEPTION 'Activity rebuild has no adapter watermarks'
      USING ERRCODE = '55000', CONSTRAINT = 't3_activity_rebuild_invalid';
  END IF;
  UPDATE project_admin.project_knowledge_reset_requests AS request
  SET step_checkpoints = jsonb_set(
        request.step_checkpoints, '{t3ActivityRebuildComplete}', 'true'::jsonb, true
      ),
      updated_at = now()
  WHERE request.project_id = target_project_id AND request.request_id = reset_request_id;
  RETURN jsonb_build_object(
    'status', 'READY', 'snapshotRevision', target_revision,
    'activityRecordCount', written_activity, 'watermarkCount', written_watermarks
  );
END
$$;
ALTER FUNCTION frontend_activity.t3_rebuild_project_activity(text, uuid, jsonb, jsonb)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_activity.t3_rebuild_project_activity(text, uuid, jsonb, jsonb)
  FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_activity.t3_guard_project_activity_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
DECLARE
  target_project_id text;
  reset_state text;
BEGIN
  target_project_id := COALESCE(NEW.resource_project_id, OLD.resource_project_id);
  IF target_project_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF project_admin.t3_reset_write_authorized(target_project_id) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  SELECT epoch.state INTO reset_state
  FROM project_admin.project_knowledge_epoch AS epoch
  WHERE epoch.project_id = target_project_id;
  IF reset_state IS NULL OR reset_state = 'READY' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Project knowledge reset fences Activity writes'
    USING ERRCODE = '55000', CONSTRAINT = 'project_knowledge_reset_write_fence';
END
$$;
ALTER FUNCTION frontend_activity.t3_guard_project_activity_write() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_activity.t3_guard_project_activity_write() FROM PUBLIC;
DROP TRIGGER IF EXISTS t3_project_activity_write_fence ON frontend_activity.activity_index;
CREATE TRIGGER t3_project_activity_write_fence
  BEFORE INSERT OR UPDATE OR DELETE ON frontend_activity.activity_index
  FOR EACH ROW EXECUTE FUNCTION frontend_activity.t3_guard_project_activity_write();
DROP TRIGGER IF EXISTS t3_project_activity_watermark_write_fence ON frontend_activity.projection_watermarks;
CREATE TRIGGER t3_project_activity_watermark_write_fence
  BEFORE INSERT OR UPDATE OR DELETE ON frontend_activity.projection_watermarks
  FOR EACH ROW EXECUTE FUNCTION frontend_activity.t3_guard_project_activity_write();

CREATE OR REPLACE FUNCTION frontend_activity.t3_discard_pre_purge_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
BEGIN
  IF NEW.state = 'BLOCKED'
     AND COALESCE(NEW.step_checkpoints->>'purge:activity', 'false') <> 'true' THEN
    UPDATE project_admin.project_knowledge_reset_requests AS request
    SET step_checkpoints = request.step_checkpoints - 't3ActivityFenceSnapshot',
        updated_at = now()
    WHERE request.project_id = NEW.project_id AND request.request_id = NEW.request_id;
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION frontend_activity.t3_discard_pre_purge_snapshot() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_activity.t3_discard_pre_purge_snapshot() FROM PUBLIC;
DROP TRIGGER IF EXISTS t3_activity_discard_pre_purge_snapshot
  ON project_admin.project_knowledge_reset_requests;
CREATE TRIGGER t3_activity_discard_pre_purge_snapshot
  AFTER UPDATE OF state ON project_admin.project_knowledge_reset_requests
  FOR EACH ROW EXECUTE FUNCTION frontend_activity.t3_discard_pre_purge_snapshot();

GRANT USAGE ON SCHEMA frontend_activity TO shotgun_schema_owner, shotgun_runtime, shotgun_erasure_executor;
GRANT SELECT ON frontend_activity.activity_index, frontend_activity.projection_watermarks
  TO shotgun_schema_owner;
GRANT INSERT, UPDATE, DELETE ON frontend_activity.activity_index,
  frontend_activity.projection_watermarks TO shotgun_schema_owner;
GRANT SELECT, UPDATE (step_checkpoints, updated_at)
  ON project_admin.project_knowledge_reset_requests TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION project_admin.t3_reset_write_authorized(text)
  TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION frontend_activity.t3_project_activity_impact(text)
  TO shotgun_runtime, shotgun_erasure_executor;
GRANT EXECUTE ON FUNCTION frontend_activity.t3_project_activity_status(text, uuid),
  frontend_activity.t3_snapshot_project_activity(text, uuid),
  frontend_activity.t3_erase_project_activity(text, uuid),
  frontend_activity.t3_rebuild_project_activity(text, uuid, jsonb, jsonb)
  TO shotgun_erasure_executor;
GRANT EXECUTE ON FUNCTION frontend_activity.t3_guard_project_activity_write(),
  frontend_activity.t3_discard_pre_purge_snapshot() TO shotgun_schema_owner;
