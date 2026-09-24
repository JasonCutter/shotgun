DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1 FROM runtime.schema_migrations
    WHERE name = '102_t3_activity_erasure.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 103 preflight failed: migration 102 is not registered';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION frontend_history.t3_project_history_impact(target_project_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, frontend_history
AS $$
  WITH scope_rows AS (
    SELECT 'history_projection_index'::text AS relation_name,
           to_jsonb(row_data)::text AS row_data, NULL::integer AS snapshot_revision
    FROM frontend_history.history_projection_index AS row_data
    WHERE row_data.resource_project_id = target_project_id
    UNION ALL
    SELECT 'projection_watermarks', to_jsonb(row_data)::text, row_data.snapshot_revision::integer
    FROM frontend_history.projection_watermarks AS row_data
    WHERE row_data.resource_project_id = target_project_id
  )
  SELECT jsonb_build_object(
    'historyRecordCount', count(*) FILTER (WHERE relation_name = 'history_projection_index')::integer,
    'watermarkCount', count(*) FILTER (WHERE relation_name = 'projection_watermarks')::integer,
    'snapshotRevision', COALESCE(max(snapshot_revision), 0)::integer,
    'fingerprint', encode(pg_catalog.sha256(convert_to(COALESCE(string_agg(
      encode(pg_catalog.sha256(convert_to(relation_name || E'\t' || row_data, 'UTF8')), 'hex'),
      '' ORDER BY relation_name, row_data
    ), ''), 'UTF8')), 'hex')
  )
  FROM scope_rows
$$;
ALTER FUNCTION frontend_history.t3_project_history_impact(text) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_history.t3_project_history_impact(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_history.t3_project_history_status(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, frontend_history, project_admin
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
      USING ERRCODE = '55000', CONSTRAINT = 't3_history_snapshot_missing';
  END IF;
  impact := frontend_history.t3_project_history_impact(target_project_id);
  expected_revision := COALESCE(
    (request_row.step_checkpoints->'t3HistoryFenceSnapshot'->>'snapshotRevision')::integer,
    0
  ) + 1;
  RETURN impact || jsonb_build_object(
    'expectedSnapshotRevision', expected_revision,
    'revisionMismatchCount', (
      SELECT count(*)::integer
      FROM frontend_history.projection_watermarks AS row_data
      WHERE row_data.resource_project_id = target_project_id
        AND row_data.snapshot_revision <> expected_revision
    ),
    'rebuildCompleted', COALESCE(
      (request_row.step_checkpoints->>'t3HistoryRebuildComplete')::boolean,
      false
    )
  );
END
$$;
ALTER FUNCTION frontend_history.t3_project_history_status(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_history.t3_project_history_status(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_history.t3_snapshot_project_history(
  target_project_id text,
  reset_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, frontend_history, project_admin
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
      USING ERRCODE = '55000', CONSTRAINT = 't3_history_snapshot_missing';
  END IF;
  IF request_row.step_checkpoints ? 't3HistoryFenceSnapshot' THEN RETURN; END IF;
  IF request_row.state <> 'FENCING' THEN
    RAISE EXCEPTION 'History fence snapshot is missing after purge began'
      USING ERRCODE = '55000', CONSTRAINT = 't3_history_snapshot_missing';
  END IF;
  snapshot := frontend_history.t3_project_history_impact(target_project_id);
  UPDATE project_admin.project_knowledge_reset_requests AS request
  SET step_checkpoints = jsonb_set(request.step_checkpoints,
        '{t3HistoryFenceSnapshot}', snapshot, true),
      updated_at = now()
  WHERE request.project_id = target_project_id AND request.request_id = reset_request_id;
END
$$;
ALTER FUNCTION frontend_history.t3_snapshot_project_history(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_history.t3_snapshot_project_history(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_history.t3_erase_project_history(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, frontend_history, project_admin
AS $$
DECLARE
  request_row project_admin.project_knowledge_reset_requests%ROWTYPE;
  baseline jsonb;
  current_impact jsonb;
  removed_index integer;
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
  baseline := request_row.step_checkpoints->'t3HistoryFenceSnapshot';
  IF NOT FOUND OR request_row.state NOT IN (
    'PURGING', 'REBUILDING', 'VERIFYING', 'OUTCOME_UNKNOWN', 'ERASURE_UNVERIFIED'
  ) OR request_row.owner_manifest_digest IS NULL OR baseline IS NULL THEN
    RAISE EXCEPTION 'History reset approval or fence snapshot is missing'
      USING ERRCODE = '55000', CONSTRAINT = 't3_history_snapshot_missing';
  END IF;
  IF COALESCE((request_row.step_checkpoints->>'t3HistoryPurged')::boolean, false) THEN
    RETURN jsonb_build_object('removedHistoryRecords', 0, 'removedWatermarks', 0);
  END IF;
  current_impact := frontend_history.t3_project_history_impact(target_project_id);
  IF current_impact->>'fingerprint' <> baseline->>'fingerprint'
     OR current_impact->>'historyRecordCount' <> baseline->>'historyRecordCount'
     OR current_impact->>'watermarkCount' <> baseline->>'watermarkCount'
     OR current_impact->>'snapshotRevision' <> baseline->>'snapshotRevision' THEN
    RAISE EXCEPTION 'History projection changed after approved reset preview'
      USING ERRCODE = '55000', CONSTRAINT = 't3_history_snapshot_stale';
  END IF;
  DELETE FROM frontend_history.history_projection_index AS entry
  WHERE entry.resource_project_id = target_project_id;
  GET DIAGNOSTICS removed_index = ROW_COUNT;
  DELETE FROM frontend_history.projection_watermarks AS watermark
  WHERE watermark.resource_project_id = target_project_id;
  GET DIAGNOSTICS removed_watermarks = ROW_COUNT;
  UPDATE project_admin.project_knowledge_reset_requests AS request
  SET step_checkpoints = jsonb_set(request.step_checkpoints,
        '{t3HistoryPurged}', 'true'::jsonb, true),
      updated_at = now()
  WHERE request.project_id = target_project_id AND request.request_id = reset_request_id;
  RETURN jsonb_build_object('removedHistoryRecords', removed_index,
                            'removedWatermarks', removed_watermarks);
END
$$;
ALTER FUNCTION frontend_history.t3_erase_project_history(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_history.t3_erase_project_history(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_history.t3_rebuild_project_history(
  target_project_id text,
  reset_request_id uuid,
  entries jsonb,
  watermarks jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, frontend_history, project_admin
AS $$
DECLARE
  request_row project_admin.project_knowledge_reset_requests%ROWTYPE;
  snapshot jsonb;
  target_revision integer;
  written_entries integer;
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
  snapshot := request_row.step_checkpoints->'t3HistoryFenceSnapshot';
  IF NOT FOUND OR request_row.state NOT IN ('REBUILDING', 'VERIFYING') OR snapshot IS NULL THEN
    RAISE EXCEPTION 'History rebuild request or fence snapshot is missing'
      USING ERRCODE = '55000', CONSTRAINT = 't3_history_snapshot_missing';
  END IF;
  target_revision := (snapshot->>'snapshotRevision')::integer + 1;
  IF COALESCE((request_row.step_checkpoints->>'t3HistoryRebuildComplete')::boolean, false) THEN
    RETURN frontend_history.t3_project_history_status(target_project_id, reset_request_id);
  END IF;
  IF jsonb_typeof(entries) IS DISTINCT FROM 'array'
     OR jsonb_typeof(watermarks) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'History rebuild payload must be arrays'
      USING ERRCODE = '22023', CONSTRAINT = 't3_history_rebuild_invalid';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(entries) AS item(resource_project_id text)
    WHERE item.resource_project_id IS DISTINCT FROM target_project_id
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(watermarks) AS item(resource_project_id text)
    WHERE item.resource_project_id IS DISTINCT FROM target_project_id
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(entries) AS item(
      payload_availability text, payload_snapshot jsonb
    ) WHERE item.payload_availability = 'PURGED_BY_POLICY'
        AND item.payload_snapshot IS NOT NULL
        AND item.payload_snapshot NOT IN (
          '{"policy":"T3_PROJECT_SOURCE_KNOWLEDGE_RESET","identityOnly":true}'::jsonb,
          '{"schemaVersion":"t3-review-tombstone-v1"}'::jsonb
        )
        AND NOT (
          jsonb_typeof(item.payload_snapshot) = 'object'
          AND item.payload_snapshot->>'policy' = 'T3-ADR-171'
          AND item.payload_snapshot->>'requestId' = reset_request_id::text
          AND item.payload_snapshot - 'policy' - 'requestId' = '{}'::jsonb
        )
  ) THEN
    RAISE EXCEPTION 'History rebuild payload violates scope or purge state'
      USING ERRCODE = '22023', CONSTRAINT = 't3_history_rebuild_invalid';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM jsonb_to_recordset(watermarks) AS item(domain_kind text)
       WHERE item.domain_kind = 'CANONICAL'
     ) OR NOT EXISTS (
       SELECT 1 FROM jsonb_to_recordset(watermarks) AS item(domain_kind text)
       WHERE item.domain_kind = 'REVIEW'
     ) OR NOT EXISTS (
       SELECT 1 FROM jsonb_to_recordset(watermarks) AS item(domain_kind text)
       WHERE item.domain_kind = 'EXTERNAL_ACTION'
     ) OR NOT EXISTS (
       SELECT 1 FROM jsonb_to_recordset(watermarks) AS item(domain_kind text)
       WHERE item.domain_kind = 'POLICY'
     ) THEN
    RAISE EXCEPTION 'History rebuild omitted a required owner watermark'
      USING ERRCODE = '55000', CONSTRAINT = 't3_history_rebuild_invalid';
  END IF;
  DELETE FROM frontend_history.history_projection_index WHERE resource_project_id = target_project_id;
  DELETE FROM frontend_history.projection_watermarks WHERE resource_project_id = target_project_id;
  INSERT INTO frontend_history.history_projection_index (
    resource_project_id, history_entry_id, domain_kind, domain_resource_kind,
    domain_resource_id, source_event_kind, source_event_id, source_sequence,
    occurred_at, payload_availability, payload_snapshot, projected_at
  )
  SELECT item.resource_project_id, item.history_entry_id, item.domain_kind,
         item.domain_resource_kind, item.domain_resource_id, item.source_event_kind,
         item.source_event_id, item.source_sequence, item.occurred_at,
         item.payload_availability, item.payload_snapshot, item.projected_at
  FROM jsonb_to_recordset(entries) AS item(
    resource_project_id text, history_entry_id text, domain_kind text,
    domain_resource_kind text, domain_resource_id text, source_event_kind text,
    source_event_id text, source_sequence bigint, occurred_at timestamptz,
    payload_availability text, payload_snapshot jsonb, projected_at timestamptz
  );
  GET DIAGNOSTICS written_entries = ROW_COUNT;
  INSERT INTO frontend_history.projection_watermarks (
    resource_project_id, adapter_id, domain_kind, source_updated_at, projected_at,
    last_source_position, adapter_status, snapshot_revision
  )
  SELECT item.resource_project_id, item.adapter_id, item.domain_kind,
         item.source_updated_at, item.projected_at, item.last_source_position,
         item.adapter_status, target_revision
  FROM jsonb_to_recordset(watermarks) AS item(
    resource_project_id text, adapter_id text, domain_kind text,
    source_updated_at timestamptz, projected_at timestamptz,
    last_source_position text, adapter_status text, snapshot_revision bigint
  );
  GET DIAGNOSTICS written_watermarks = ROW_COUNT;
  IF written_watermarks < 4 THEN
    RAISE EXCEPTION 'History rebuild omitted a required owner watermark'
      USING ERRCODE = '55000', CONSTRAINT = 't3_history_rebuild_invalid';
  END IF;
  UPDATE project_admin.project_knowledge_reset_requests AS request
  SET step_checkpoints = jsonb_set(request.step_checkpoints,
        '{t3HistoryRebuildComplete}', 'true'::jsonb, true),
      updated_at = now()
  WHERE request.project_id = target_project_id AND request.request_id = reset_request_id;
  RETURN jsonb_build_object('status', 'READY', 'snapshotRevision', target_revision,
                            'historyRecordCount', written_entries,
                            'watermarkCount', written_watermarks);
END
$$;
ALTER FUNCTION frontend_history.t3_rebuild_project_history(text, uuid, jsonb, jsonb)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_history.t3_rebuild_project_history(text, uuid, jsonb, jsonb)
  FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_history.t3_guard_project_history_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
DECLARE
  target_project_id text;
  reset_state text;
BEGIN
  IF TG_OP = 'DELETE' THEN target_project_id := OLD.resource_project_id;
  ELSE target_project_id := NEW.resource_project_id;
  END IF;
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
  RAISE EXCEPTION 'Project knowledge reset fences History writes'
    USING ERRCODE = '55000', CONSTRAINT = 'project_knowledge_reset_write_fence';
END
$$;
ALTER FUNCTION frontend_history.t3_guard_project_history_write() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_history.t3_guard_project_history_write() FROM PUBLIC;
DROP TRIGGER IF EXISTS t3_project_history_write_fence ON frontend_history.history_projection_index;
CREATE TRIGGER t3_project_history_write_fence
  BEFORE INSERT OR UPDATE OR DELETE ON frontend_history.history_projection_index
  FOR EACH ROW EXECUTE FUNCTION frontend_history.t3_guard_project_history_write();
DROP TRIGGER IF EXISTS t3_project_history_watermark_write_fence ON frontend_history.projection_watermarks;
CREATE TRIGGER t3_project_history_watermark_write_fence
  BEFORE INSERT OR UPDATE OR DELETE ON frontend_history.projection_watermarks
  FOR EACH ROW EXECUTE FUNCTION frontend_history.t3_guard_project_history_write();

CREATE OR REPLACE FUNCTION frontend_history.t3_discard_pre_purge_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
BEGIN
  IF NEW.state = 'BLOCKED'
     AND COALESCE(NEW.step_checkpoints->>'purge:history', 'false') <> 'true' THEN
    UPDATE project_admin.project_knowledge_reset_requests AS request
    SET step_checkpoints = request.step_checkpoints - 't3HistoryFenceSnapshot',
        updated_at = now()
    WHERE request.project_id = NEW.project_id AND request.request_id = NEW.request_id;
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION frontend_history.t3_discard_pre_purge_snapshot() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_history.t3_discard_pre_purge_snapshot() FROM PUBLIC;
DROP TRIGGER IF EXISTS t3_history_discard_pre_purge_snapshot
  ON project_admin.project_knowledge_reset_requests;
CREATE TRIGGER t3_history_discard_pre_purge_snapshot
  AFTER UPDATE OF state ON project_admin.project_knowledge_reset_requests
  FOR EACH ROW EXECUTE FUNCTION frontend_history.t3_discard_pre_purge_snapshot();

GRANT USAGE ON SCHEMA frontend_history TO shotgun_schema_owner, shotgun_runtime, shotgun_erasure_executor;
GRANT SELECT, INSERT, UPDATE, DELETE ON frontend_history.history_projection_index,
  frontend_history.projection_watermarks TO shotgun_schema_owner;
GRANT SELECT, UPDATE (step_checkpoints, updated_at)
  ON project_admin.project_knowledge_reset_requests TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION project_admin.t3_reset_write_authorized(text)
  TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION frontend_history.t3_project_history_impact(text)
  TO shotgun_runtime, shotgun_erasure_executor;
GRANT EXECUTE ON FUNCTION frontend_history.t3_project_history_status(text, uuid),
  frontend_history.t3_snapshot_project_history(text, uuid),
  frontend_history.t3_erase_project_history(text, uuid),
  frontend_history.t3_rebuild_project_history(text, uuid, jsonb, jsonb)
  TO shotgun_erasure_executor;
GRANT EXECUTE ON FUNCTION frontend_history.t3_guard_project_history_write(),
  frontend_history.t3_discard_pre_purge_snapshot() TO shotgun_schema_owner;
