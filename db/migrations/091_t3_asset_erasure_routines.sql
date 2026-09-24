DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '090_t3_ai_provider_erasure_routines.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 091 preflight failed: migration 090 is not registered';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION asset.t3_project_asset_status(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, asset
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
    RAISE EXCEPTION 'Asset status is unavailable outside active maintenance'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;

  RETURN jsonb_build_object(
    'sources', (SELECT count(*) FROM asset.sources WHERE project_id = target_project_id),
    'sourceVersions', (
      SELECT count(*) FROM asset.source_versions AS version
      JOIN asset.sources AS source USING (source_id)
      WHERE source.project_id = target_project_id
    ),
    'storageReceipts', (SELECT count(*) FROM asset.storage_receipts WHERE project_id = target_project_id),
    'stagingLeases', (SELECT count(*) FROM asset.staging_asset_leases WHERE project_id = target_project_id),
    'activeStagingLeases', (
      SELECT count(*) FROM asset.staging_asset_leases
      WHERE project_id = target_project_id AND expires_at > clock_timestamp()
    ),
    'sharedAssets', (
      SELECT count(DISTINCT version.original_asset_id)
      FROM asset.source_versions AS version
      JOIN asset.sources AS source USING (source_id)
      WHERE source.project_id = target_project_id
        AND (
          EXISTS (
            SELECT 1
            FROM asset.source_versions AS other_version
            JOIN asset.sources AS other_source USING (source_id)
            WHERE other_version.original_asset_id = version.original_asset_id
              AND other_source.project_id <> target_project_id
          ) OR EXISTS (
            SELECT 1 FROM asset.staging_asset_leases AS lease
            JOIN asset.original_assets AS original
              ON original.storage_key = lease.storage_key
             AND original.asset_id = version.original_asset_id
            WHERE lease.project_id <> target_project_id
              AND lease.expires_at > clock_timestamp()
          )
        )
    )
  );
END
$$;
ALTER FUNCTION asset.t3_project_asset_status(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION asset.t3_project_asset_status(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION asset.t3_erase_project_asset_data(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, asset
AS $$
DECLARE
  selected_asset_ids uuid[];
  affected bigint;
  deleted_receipts bigint;
  deleted_leases bigint;
  deleted_versions bigint;
  deleted_sources bigint;
  deleted_original_assets bigint;
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
    SELECT 1 FROM asset.staging_asset_leases
    WHERE project_id = target_project_id AND expires_at > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'Active staging asset lease has not expired'
      USING ERRCODE = '55000', CONSTRAINT = 'active_staging_asset_lease';
  END IF;

  SELECT array_agg(DISTINCT version.original_asset_id ORDER BY version.original_asset_id)
    INTO selected_asset_ids
  FROM asset.source_versions AS version
  JOIN asset.sources AS source USING (source_id)
  WHERE source.project_id = target_project_id;

  DELETE FROM asset.storage_receipts WHERE project_id = target_project_id;
  GET DIAGNOSTICS deleted_receipts = ROW_COUNT;
  DELETE FROM asset.staging_asset_leases WHERE project_id = target_project_id;
  GET DIAGNOSTICS deleted_leases = ROW_COUNT;
  DELETE FROM asset.source_versions AS version
  USING asset.sources AS source
  WHERE version.source_id = source.source_id AND source.project_id = target_project_id;
  GET DIAGNOSTICS deleted_versions = ROW_COUNT;
  DELETE FROM asset.sources WHERE project_id = target_project_id;
  GET DIAGNOSTICS deleted_sources = ROW_COUNT;

  DELETE FROM asset.original_assets AS original
  WHERE original.asset_id = ANY(COALESCE(selected_asset_ids, ARRAY[]::uuid[]))
    AND NOT EXISTS (
      SELECT 1 FROM asset.source_versions AS version
      WHERE version.original_asset_id = original.asset_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM asset.staging_asset_leases AS lease
      WHERE lease.storage_key = original.storage_key
        AND lease.expires_at > clock_timestamp()
    );
  GET DIAGNOSTICS deleted_original_assets = ROW_COUNT;

  RETURN jsonb_build_object(
    'storageReceipts', deleted_receipts,
    'stagingLeases', deleted_leases,
    'sourceVersions', deleted_versions,
    'sources', deleted_sources,
    'unreferencedOriginalAssets', deleted_original_assets
  );
END
$$;
ALTER FUNCTION asset.t3_erase_project_asset_data(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION asset.t3_erase_project_asset_data(text, uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA asset TO shotgun_schema_owner, shotgun_erasure_executor;
GRANT SELECT, DELETE ON asset.sources, asset.source_versions, asset.storage_receipts,
  asset.staging_asset_leases, asset.original_assets TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION project_admin.t3_reset_write_authorized(text) TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION asset.t3_project_asset_status(text, uuid),
  asset.t3_erase_project_asset_data(text, uuid) TO shotgun_erasure_executor;
