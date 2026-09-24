DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1 FROM runtime.schema_migrations
    WHERE name = '103_t3_history_erasure.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 104 preflight failed: migration 103 is not registered';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION knowledge.t3_project_knowledge_impact(target_project_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, knowledge, asset
AS $$
  WITH scoped AS (
    SELECT 'review_groups'::text AS relation_name, to_jsonb(row_data)::text AS row_data,
           row_data.source_version_id
    FROM knowledge.review_groups AS row_data
    WHERE row_data.project_id = target_project_id
    UNION ALL
    SELECT 'entity_vault_imports', to_jsonb(row_data)::text, row_data.source_version_id
    FROM knowledge.entity_vault_imports AS row_data
    WHERE row_data.project_id = target_project_id
  ), classified AS (
    SELECT scoped.*,
      EXISTS (
        SELECT 1
        FROM asset.source_versions AS version
        JOIN asset.sources AS source USING (source_id)
        WHERE version.source_version_id = scoped.source_version_id
          AND source.project_id = target_project_id
      ) AS valid_source_lineage
    FROM scoped
  )
  SELECT jsonb_build_object(
    'sourceDerivedRecordCount', count(*) FILTER (WHERE valid_source_lineage)::integer,
    'unclassifiedRecordCount', count(*) FILTER (WHERE NOT valid_source_lineage)::integer,
    'fingerprint', encode(pg_catalog.sha256(convert_to(COALESCE(string_agg(
      encode(pg_catalog.sha256(convert_to(relation_name || E'\t' || row_data, 'UTF8')), 'hex'),
      '' ORDER BY relation_name, row_data
    ), ''), 'UTF8')), 'hex')
  )
  FROM classified
$$;
ALTER FUNCTION knowledge.t3_project_knowledge_impact(text) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION knowledge.t3_project_knowledge_impact(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION knowledge.t3_project_knowledge_status(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, knowledge, project_admin
AS $$
DECLARE
  impact jsonb;
  request_row project_admin.project_knowledge_reset_requests%ROWTYPE;
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
      USING ERRCODE = '55000', CONSTRAINT = 't3_knowledge_snapshot_missing';
  END IF;
  impact := knowledge.t3_project_knowledge_impact(target_project_id);
  RETURN impact || jsonb_build_object(
    'remainingRecordCount', (
      SELECT count(*)::integer FROM knowledge.review_groups WHERE project_id = target_project_id
    ) + (
      SELECT count(*)::integer FROM knowledge.entity_vault_imports WHERE project_id = target_project_id
    ),
    'purgeCompleted', COALESCE(
      (request_row.step_checkpoints->>'t3KnowledgePurged')::boolean,
      false
    )
  );
END
$$;
ALTER FUNCTION knowledge.t3_project_knowledge_status(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION knowledge.t3_project_knowledge_status(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION knowledge.t3_snapshot_project_knowledge(
  target_project_id text,
  reset_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, knowledge, project_admin
AS $$
DECLARE
  request_row project_admin.project_knowledge_reset_requests%ROWTYPE;
  impact jsonb;
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
      USING ERRCODE = '55000', CONSTRAINT = 't3_knowledge_snapshot_missing';
  END IF;
  IF request_row.step_checkpoints ? 't3KnowledgeFenceSnapshot' THEN RETURN; END IF;
  IF request_row.state <> 'FENCING' THEN
    RAISE EXCEPTION 'Knowledge Model fence snapshot is missing after purge began'
      USING ERRCODE = '55000', CONSTRAINT = 't3_knowledge_snapshot_missing';
  END IF;
  impact := knowledge.t3_project_knowledge_impact(target_project_id);
  IF (impact->>'unclassifiedRecordCount')::integer > 0 THEN
    RAISE EXCEPTION 'Knowledge Model Source lineage is incomplete'
      USING ERRCODE = '55000', CONSTRAINT = 't3_knowledge_unclassified';
  END IF;
  UPDATE project_admin.project_knowledge_reset_requests AS request
  SET step_checkpoints = jsonb_set(request.step_checkpoints,
        '{t3KnowledgeFenceSnapshot}', impact, true),
      updated_at = now()
  WHERE request.project_id = target_project_id AND request.request_id = reset_request_id;
END
$$;
ALTER FUNCTION knowledge.t3_snapshot_project_knowledge(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION knowledge.t3_snapshot_project_knowledge(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION knowledge.t3_erase_project_knowledge(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, knowledge, project_admin
AS $$
DECLARE
  request_row project_admin.project_knowledge_reset_requests%ROWTYPE;
  baseline jsonb;
  current_impact jsonb;
  removed_groups integer;
  removed_imports integer;
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
  baseline := request_row.step_checkpoints->'t3KnowledgeFenceSnapshot';
  IF NOT FOUND OR request_row.state NOT IN (
    'PURGING', 'REBUILDING', 'VERIFYING', 'OUTCOME_UNKNOWN', 'ERASURE_UNVERIFIED'
  ) OR request_row.owner_manifest_digest IS NULL OR baseline IS NULL THEN
    RAISE EXCEPTION 'Knowledge Model reset approval or fence snapshot is missing'
      USING ERRCODE = '55000', CONSTRAINT = 't3_knowledge_snapshot_missing';
  END IF;
  IF COALESCE((request_row.step_checkpoints->>'t3KnowledgePurged')::boolean, false) THEN
    RETURN jsonb_build_object('removedReviewGroups', 0, 'removedEntityVaultImports', 0);
  END IF;
  current_impact := knowledge.t3_project_knowledge_impact(target_project_id);
  IF current_impact->>'fingerprint' <> baseline->>'fingerprint'
     OR current_impact->>'sourceDerivedRecordCount' <> baseline->>'sourceDerivedRecordCount'
     OR current_impact->>'unclassifiedRecordCount' <> baseline->>'unclassifiedRecordCount' THEN
    RAISE EXCEPTION 'Knowledge Model changed after approved reset preview'
      USING ERRCODE = '55000', CONSTRAINT = 't3_knowledge_snapshot_stale';
  END IF;
  IF (current_impact->>'unclassifiedRecordCount')::integer > 0 THEN
    RAISE EXCEPTION 'Knowledge Model Source lineage is incomplete'
      USING ERRCODE = '55000', CONSTRAINT = 't3_knowledge_unclassified';
  END IF;
  DELETE FROM knowledge.entity_vault_imports WHERE project_id = target_project_id;
  GET DIAGNOSTICS removed_imports = ROW_COUNT;
  DELETE FROM knowledge.review_groups WHERE project_id = target_project_id;
  GET DIAGNOSTICS removed_groups = ROW_COUNT;
  UPDATE project_admin.project_knowledge_reset_requests AS request
  SET step_checkpoints = jsonb_set(request.step_checkpoints,
        '{t3KnowledgePurged}', 'true'::jsonb, true),
      updated_at = now()
  WHERE request.project_id = target_project_id AND request.request_id = reset_request_id;
  RETURN jsonb_build_object('removedReviewGroups', removed_groups,
                            'removedEntityVaultImports', removed_imports);
END
$$;
ALTER FUNCTION knowledge.t3_erase_project_knowledge(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION knowledge.t3_erase_project_knowledge(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION knowledge.t3_discard_pre_purge_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
BEGIN
  IF NEW.state = 'BLOCKED'
     AND COALESCE(NEW.step_checkpoints->>'purge:knowledge', 'false') <> 'true' THEN
    UPDATE project_admin.project_knowledge_reset_requests AS request
    SET step_checkpoints = request.step_checkpoints - 't3KnowledgeFenceSnapshot',
        updated_at = now()
    WHERE request.project_id = NEW.project_id AND request.request_id = NEW.request_id;
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION knowledge.t3_discard_pre_purge_snapshot() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION knowledge.t3_discard_pre_purge_snapshot() FROM PUBLIC;
DROP TRIGGER IF EXISTS t3_knowledge_discard_pre_purge_snapshot
  ON project_admin.project_knowledge_reset_requests;
CREATE TRIGGER t3_knowledge_discard_pre_purge_snapshot
  AFTER UPDATE OF state ON project_admin.project_knowledge_reset_requests
  FOR EACH ROW EXECUTE FUNCTION knowledge.t3_discard_pre_purge_snapshot();

GRANT USAGE ON SCHEMA knowledge TO shotgun_schema_owner, shotgun_runtime, shotgun_erasure_executor;
GRANT SELECT, DELETE ON knowledge.review_groups, knowledge.entity_vault_imports
  TO shotgun_schema_owner;
GRANT SELECT ON asset.sources, asset.source_versions TO shotgun_schema_owner;
GRANT SELECT, UPDATE (step_checkpoints, updated_at)
  ON project_admin.project_knowledge_reset_requests TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION project_admin.t3_reset_write_authorized(text)
  TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION knowledge.t3_project_knowledge_impact(text)
  TO shotgun_runtime, shotgun_erasure_executor;
GRANT EXECUTE ON FUNCTION knowledge.t3_project_knowledge_status(text, uuid),
  knowledge.t3_snapshot_project_knowledge(text, uuid),
  knowledge.t3_erase_project_knowledge(text, uuid)
  TO shotgun_erasure_executor;
GRANT EXECUTE ON FUNCTION knowledge.t3_discard_pre_purge_snapshot() TO shotgun_schema_owner;
