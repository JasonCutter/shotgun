DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1 FROM runtime.schema_migrations
    WHERE name = '105_t3_connector_erasure.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 106 preflight failed: migration 105 is not registered';
  END IF;
END
$$;

-- Settings are preserved by default. The only removable rows are resource
-- settings whose resource_id is an exact identity owned by a Source in the
-- approved Project. Proposal lineage that touches a Source is ambiguous and
-- blocks rather than changing a privacy/provider approval.
CREATE OR REPLACE FUNCTION settings.t3_jsonb_mentions_source_token(
  payload jsonb,
  source_tokens text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  WITH RECURSIVE json_values(value) AS (
    SELECT payload
    UNION ALL
    SELECT child.value
    FROM json_values AS parent
    CROSS JOIN LATERAL (
      SELECT element.value
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(parent.value) = 'array' THEN parent.value ELSE '[]'::jsonb END
      ) AS element(value)
      UNION ALL
      SELECT object_entry.value
      FROM jsonb_each(
        CASE WHEN jsonb_typeof(parent.value) = 'object' THEN parent.value ELSE '{}'::jsonb END
      ) AS object_entry(key, value)
    ) AS child
  )
  SELECT EXISTS (
    SELECT 1 FROM json_values
    WHERE jsonb_typeof(value) = 'string'
      AND value #>> '{}' = ANY(COALESCE(source_tokens, ARRAY[]::text[]))
  )
$$;
ALTER FUNCTION settings.t3_jsonb_mentions_source_token(jsonb, text[])
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION settings.t3_jsonb_mentions_source_token(jsonb, text[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION settings.t3_project_settings_impact(p_target_project_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, settings, asset, transformation, evidence
AS $$
DECLARE
  source_tokens text[];
  all_source_tokens text[];
  result jsonb;
BEGIN
  IF p_target_project_id IS NULL OR p_target_project_id = '' THEN
    RAISE EXCEPTION 'Settings reset Project is required'
      USING ERRCODE = '22023', CONSTRAINT = 't3_settings_project_required';
  END IF;
  SELECT COALESCE(array_agg(token), ARRAY[]::text[]) INTO source_tokens
  FROM (
    SELECT source.source_id::text AS token
    FROM asset.sources AS source WHERE source.project_id = p_target_project_id
    UNION
    SELECT version.source_version_id::text
    FROM asset.source_versions AS version
    JOIN asset.sources AS source ON source.source_id = version.source_id
    WHERE source.project_id = p_target_project_id
    UNION
    SELECT revision.revision_id::text
    FROM transformation.revisions AS revision WHERE revision.project_id = p_target_project_id
    UNION
    SELECT span.evidence_id::text FROM evidence.spans AS span WHERE span.project_id = p_target_project_id
  ) AS tokens;
  SELECT COALESCE(array_agg(token), ARRAY[]::text[]) INTO all_source_tokens
  FROM (
    SELECT source.source_id::text AS token FROM asset.sources AS source
    UNION SELECT version.source_version_id::text FROM asset.source_versions AS version
    UNION SELECT revision.revision_id::text FROM transformation.revisions AS revision
    UNION SELECT span.evidence_id::text FROM evidence.spans AS span
  ) AS tokens;

  WITH source_resources AS MATERIALIZED (
    SELECT resource.resource_id, resource.key
    FROM settings.resource_settings AS resource
    WHERE resource.resource_id = ANY(source_tokens)
  ),
  project_proposals AS MATERIALIZED (
    SELECT proposal.* FROM settings.settings_review_proposals AS proposal
    WHERE proposal.project_id = p_target_project_id
  ),
  aggregates AS (
    SELECT
      (SELECT count(*) FROM source_resources) AS source_derived_record_count,
      (SELECT count(*) FROM settings.resource_settings AS resource
       WHERE resource.resource_id <> ALL(all_source_tokens)
          OR (settings.t3_jsonb_mentions_source_token(resource.value, source_tokens)
              AND resource.resource_id <> ALL(source_tokens)))
      + (SELECT count(*) FROM project_proposals AS proposal
         WHERE proposal.directive_type NOT IN (
           'PRIVACY_EXTERNAL_TRANSFER', 'PROVIDER_EXTERNAL_TRANSFER_APPROVAL'
         ) OR proposal.resource_id = ANY(source_tokens)
            OR settings.t3_jsonb_mentions_source_token(proposal.payload, source_tokens)
            OR settings.t3_jsonb_mentions_source_token(to_jsonb(proposal), source_tokens))
        AS unclassified_record_count,
      encode(pg_catalog.sha256(convert_to(
        COALESCE((SELECT string_agg(to_jsonb(resource)::text, E'\n' ORDER BY resource.resource_id, resource.key)
          FROM settings.resource_settings AS resource), '') || E'\n' ||
        COALESCE((SELECT string_agg(to_jsonb(proposal)::text, E'\n' ORDER BY proposal.proposal_id)
          FROM project_proposals AS proposal), ''),
        'UTF8')), 'hex') AS fingerprint,
      encode(pg_catalog.sha256(convert_to(
        COALESCE((SELECT string_agg(to_jsonb(proposal)::text, E'\n' ORDER BY proposal.proposal_id)
          FROM project_proposals AS proposal), ''), 'UTF8')), 'hex') AS proposals_fingerprint
  )
  SELECT jsonb_build_object(
    'sourceDerivedRecordCount', aggregates.source_derived_record_count,
    'unclassifiedRecordCount', aggregates.unclassified_record_count,
    'fingerprint', aggregates.fingerprint,
    'proposalsFingerprint', aggregates.proposals_fingerprint
  ) INTO result FROM aggregates;
  RETURN result;
END
$$;
ALTER FUNCTION settings.t3_project_settings_impact(text) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION settings.t3_project_settings_impact(text) FROM PUBLIC;
GRANT USAGE ON SCHEMA settings TO shotgun_schema_owner, shotgun_runtime, shotgun_erasure_executor;
GRANT USAGE ON SCHEMA asset, transformation, evidence
  TO shotgun_schema_owner;
GRANT SELECT ON settings.resource_settings, settings.settings_review_proposals,
  asset.sources, asset.source_versions, transformation.revisions, evidence.spans
  TO shotgun_schema_owner;
GRANT DELETE ON settings.resource_settings TO shotgun_schema_owner;

CREATE OR REPLACE FUNCTION settings.t3_reset_request_authorized(
  p_target_project_id text,
  p_reset_request_id uuid,
  allowed_states text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
  SELECT session_user = 'shotgun_erasure_executor'
    AND EXISTS (
      SELECT 1 FROM project_admin.project_knowledge_reset_requests AS request
      JOIN project_admin.project_knowledge_epoch AS epoch
        ON epoch.project_id = request.project_id
       AND epoch.epoch = request.resulting_knowledge_epoch
      WHERE request.project_id = p_target_project_id
        AND request.request_id = p_reset_request_id
        AND request.state = ANY(allowed_states)
        AND request.owner_manifest_digest IS NOT NULL
        AND epoch.state = 'RESET_PENDING'
    )
$$;
ALTER FUNCTION settings.t3_reset_request_authorized(text, uuid, text[])
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION settings.t3_reset_request_authorized(text, uuid, text[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION settings.t3_guard_resource_setting_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, settings, project_admin, asset, transformation, evidence
AS $$
DECLARE
  request_id_text text;
  reset_request_uuid uuid;
  target_project_id text;
  resource_id_value text;
  key_value text;
  value_data jsonb;
  active_source_tokens text[];
  is_source_linked boolean := false;
BEGIN
  request_id_text := current_setting('shotgun.t3_reset_request_id', true);
  BEGIN
    reset_request_uuid := NULLIF(request_id_text, '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    reset_request_uuid := NULL;
  END;
  IF TG_OP = 'DELETE' THEN
    resource_id_value := OLD.resource_id;
    key_value := OLD.key;
    value_data := OLD.value;
  ELSE
    resource_id_value := NEW.resource_id;
    key_value := NEW.key;
    value_data := NEW.value;
  END IF;
  IF TG_OP = 'DELETE' AND session_user = 'shotgun_erasure_executor' AND reset_request_uuid IS NOT NULL THEN
    SELECT request.project_id INTO target_project_id
    FROM project_admin.project_knowledge_reset_requests AS request
    WHERE request.request_id = reset_request_uuid AND request.state = 'PURGING'
      AND request.step_checkpoints->'t3SettingsFenceSnapshot'->'resourceRows' @>
        jsonb_build_array(jsonb_build_object('resource_id', resource_id_value, 'key', key_value));
    IF target_project_id IS NOT NULL AND settings.t3_reset_request_authorized(
      target_project_id, reset_request_uuid, ARRAY['PURGING']
    ) THEN RETURN OLD; END IF;
  END IF;

  SELECT COALESCE(array_agg(token), ARRAY[]::text[]) INTO active_source_tokens
  FROM (
    SELECT source.source_id::text AS token
    FROM asset.sources AS source
    JOIN project_admin.project_knowledge_epoch AS epoch ON epoch.project_id = source.project_id
    WHERE epoch.state IN ('RESET_PENDING', 'RESET_UNVERIFIED')
    UNION
    SELECT version.source_version_id::text
    FROM asset.source_versions AS version
    JOIN asset.sources AS source ON source.source_id = version.source_id
    JOIN project_admin.project_knowledge_epoch AS epoch ON epoch.project_id = source.project_id
    WHERE epoch.state IN ('RESET_PENDING', 'RESET_UNVERIFIED')
    UNION
    SELECT revision.revision_id::text
    FROM transformation.revisions AS revision
    JOIN project_admin.project_knowledge_epoch AS epoch ON epoch.project_id = revision.project_id
    WHERE epoch.state IN ('RESET_PENDING', 'RESET_UNVERIFIED')
    UNION
    SELECT span.evidence_id::text
    FROM evidence.spans AS span
    JOIN project_admin.project_knowledge_epoch AS epoch ON epoch.project_id = span.project_id
    WHERE epoch.state IN ('RESET_PENDING', 'RESET_UNVERIFIED')
  ) AS tokens;
  is_source_linked := resource_id_value = ANY(active_source_tokens)
    OR settings.t3_jsonb_mentions_source_token(value_data, active_source_tokens)
    OR EXISTS (
      SELECT 1 FROM project_admin.project_knowledge_reset_requests AS request
      WHERE request.state IN (
        'FENCING', 'PURGING', 'REBUILDING', 'VERIFYING', 'OUTCOME_UNKNOWN', 'ERASURE_UNVERIFIED'
      )
        AND request.step_checkpoints->'t3SettingsFenceSnapshot'->'resourceRows' @>
          jsonb_build_array(jsonb_build_object('resource_id', resource_id_value, 'key', key_value))
    );
  IF is_source_linked THEN
    RAISE EXCEPTION 'Source Resource Settings are fenced for an active Project reset'
      USING ERRCODE = '55000', CONSTRAINT = 'project_knowledge_reset_write_fence';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION settings.t3_guard_resource_setting_write() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION settings.t3_guard_resource_setting_write() FROM PUBLIC;
DROP TRIGGER IF EXISTS t3_resource_settings_reset_fence ON settings.resource_settings;
CREATE TRIGGER t3_resource_settings_reset_fence
  BEFORE INSERT OR UPDATE OR DELETE ON settings.resource_settings
  FOR EACH ROW EXECUTE FUNCTION settings.t3_guard_resource_setting_write();

CREATE OR REPLACE FUNCTION settings.t3_snapshot_project_settings(
  p_target_project_id text,
  p_reset_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, settings, project_admin, asset, transformation, evidence
AS $$
DECLARE
  analysis jsonb;
  source_tokens text[];
  snapshot jsonb;
BEGIN
  IF NOT settings.t3_reset_request_authorized(
    p_target_project_id, p_reset_request_id, ARRAY['FENCING']::text[]
  ) THEN
    RAISE EXCEPTION 'Settings reset is not authorized'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  analysis := settings.t3_project_settings_impact(p_target_project_id);
  IF (analysis->>'unclassifiedRecordCount')::bigint > 0 THEN
    RAISE EXCEPTION 'Settings resource or proposal lineage is incomplete'
      USING ERRCODE = '55000', CONSTRAINT = 't3_settings_unclassified';
  END IF;
  SELECT COALESCE(array_agg(token), ARRAY[]::text[]) INTO source_tokens
  FROM (
    SELECT source.source_id::text AS token FROM asset.sources AS source WHERE source.project_id = p_target_project_id
    UNION SELECT version.source_version_id::text FROM asset.source_versions AS version
      JOIN asset.sources AS source ON source.source_id = version.source_id WHERE source.project_id = p_target_project_id
    UNION SELECT revision.revision_id::text FROM transformation.revisions AS revision WHERE revision.project_id = p_target_project_id
    UNION SELECT span.evidence_id::text FROM evidence.spans AS span WHERE span.project_id = p_target_project_id
  ) AS tokens;
  SELECT jsonb_build_object(
    'resourceRows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'resource_id', resource.resource_id, 'key', resource.key
    ) ORDER BY resource.resource_id, resource.key)
      FROM settings.resource_settings AS resource
      WHERE resource.resource_id = ANY(source_tokens)), '[]'::jsonb),
    'fingerprint', analysis->>'fingerprint',
    'proposalsFingerprint', analysis->>'proposalsFingerprint',
    'recordCount', (analysis->>'sourceDerivedRecordCount')::bigint
  ) INTO snapshot;
  UPDATE project_admin.project_knowledge_reset_requests AS request
  SET step_checkpoints = jsonb_set(request.step_checkpoints,
        '{t3SettingsFenceSnapshot}', snapshot, true), updated_at = now()
  WHERE request.project_id = p_target_project_id AND request.request_id = p_reset_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Settings reset request was not found'
      USING ERRCODE = '55000', CONSTRAINT = 't3_settings_snapshot_missing';
  END IF;
END
$$;
ALTER FUNCTION settings.t3_snapshot_project_settings(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION settings.t3_snapshot_project_settings(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION settings.t3_erase_project_settings(
  p_target_project_id text,
  p_reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, settings, project_admin
AS $$
DECLARE
  request_row project_admin.project_knowledge_reset_requests%ROWTYPE;
  snapshot jsonb;
  current_analysis jsonb;
  deleted_count bigint;
  receipt jsonb;
BEGIN
  IF NOT settings.t3_reset_request_authorized(
    p_target_project_id, p_reset_request_id, ARRAY['PURGING']::text[]
  ) THEN
    RAISE EXCEPTION 'Settings reset is not authorized'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  PERFORM set_config('shotgun.t3_reset_request_id', p_reset_request_id::text, true);
  SELECT * INTO request_row FROM project_admin.project_knowledge_reset_requests AS request
  WHERE request.project_id = p_target_project_id AND request.request_id = p_reset_request_id FOR UPDATE;
  snapshot := request_row.step_checkpoints->'t3SettingsFenceSnapshot';
  receipt := request_row.step_checkpoints->'t3SettingsPurgeReceipt';
  IF snapshot IS NULL AND receipt IS NOT NULL THEN RETURN receipt; END IF;
  IF snapshot IS NULL OR snapshot->>'fingerprint' IS NULL THEN
    RAISE EXCEPTION 'Settings fence snapshot is missing'
      USING ERRCODE = '55000', CONSTRAINT = 't3_settings_snapshot_missing';
  END IF;
  current_analysis := settings.t3_project_settings_impact(p_target_project_id);
  IF current_analysis->>'fingerprint' IS DISTINCT FROM snapshot->>'fingerprint' THEN
    RAISE EXCEPTION 'Settings rows changed after reset approval'
      USING ERRCODE = '55000', CONSTRAINT = 't3_settings_snapshot_stale';
  END IF;
  DELETE FROM settings.resource_settings AS resource
  USING jsonb_to_recordset(snapshot->'resourceRows') AS keyset(resource_id text, key text)
  WHERE resource.resource_id = keyset.resource_id AND resource.key = keyset.key;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  IF deleted_count <> (snapshot->>'recordCount')::bigint THEN
    RAISE EXCEPTION 'Settings source resource set changed during reset'
      USING ERRCODE = '55000', CONSTRAINT = 't3_settings_snapshot_stale';
  END IF;
  IF EXISTS (
    SELECT 1 FROM settings.resource_settings AS resource
    JOIN jsonb_to_recordset(snapshot->'resourceRows') AS keyset(resource_id text, key text)
      ON resource.resource_id = keyset.resource_id AND resource.key = keyset.key
  ) THEN
    RAISE EXCEPTION 'Source resource settings remain after purge'
      USING ERRCODE = '55000', CONSTRAINT = 't3_settings_snapshot_missing';
  END IF;
  receipt := jsonb_build_object(
    'purgeCompleted', true,
    'sourceDerivedRecordCount', deleted_count,
    'fingerprint', snapshot->>'fingerprint',
    'proposalsFingerprint', snapshot->>'proposalsFingerprint'
  );
  UPDATE project_admin.project_knowledge_reset_requests AS request
  SET step_checkpoints = jsonb_set(
        request.step_checkpoints - 't3SettingsFenceSnapshot',
        '{t3SettingsPurgeReceipt}', receipt, true
      ), updated_at = now()
  WHERE request.project_id = p_target_project_id AND request.request_id = p_reset_request_id;
  RETURN receipt;
END
$$;
ALTER FUNCTION settings.t3_erase_project_settings(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION settings.t3_erase_project_settings(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION settings.t3_project_settings_status(
  p_target_project_id text,
  p_reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, settings, project_admin
AS $$
DECLARE
  request_row project_admin.project_knowledge_reset_requests%ROWTYPE;
  analysis jsonb;
  receipt jsonb;
BEGIN
  IF NOT settings.t3_reset_request_authorized(
    p_target_project_id, p_reset_request_id, ARRAY['VERIFYING']::text[]
  ) THEN
    RAISE EXCEPTION 'Settings reset status is unavailable outside verification'
      USING ERRCODE = '55000', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  SELECT * INTO request_row FROM project_admin.project_knowledge_reset_requests AS request
  WHERE request.project_id = p_target_project_id AND request.request_id = p_reset_request_id;
  receipt := request_row.step_checkpoints->'t3SettingsPurgeReceipt';
  analysis := settings.t3_project_settings_impact(p_target_project_id);
  RETURN jsonb_build_object(
    'purgeCompleted', COALESCE((receipt->>'purgeCompleted')::boolean, false),
    'sourceDerivedRecordCount', COALESCE((receipt->>'sourceDerivedRecordCount')::bigint, 0),
    'remainingSourceResourceCount', CASE
      WHEN COALESCE((receipt->>'purgeCompleted')::boolean, false) THEN 0
      ELSE 1
    END,
    'proposalsFingerprint', analysis->>'proposalsFingerprint',
    'expectedProposalsFingerprint', receipt->>'proposalsFingerprint'
  );
END
$$;
ALTER FUNCTION settings.t3_project_settings_status(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION settings.t3_project_settings_status(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION settings.t3_discard_pre_purge_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
BEGIN
  IF NEW.state = 'BLOCKED' AND OLD.state IS DISTINCT FROM NEW.state THEN
    UPDATE project_admin.project_knowledge_reset_requests AS request
    SET step_checkpoints = request.step_checkpoints - 't3SettingsFenceSnapshot'
    WHERE request.project_id = NEW.project_id AND request.request_id = NEW.request_id;
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION settings.t3_discard_pre_purge_snapshot() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION settings.t3_discard_pre_purge_snapshot() FROM PUBLIC;
DROP TRIGGER IF EXISTS t3_settings_discard_pre_purge_snapshot
  ON project_admin.project_knowledge_reset_requests;
CREATE TRIGGER t3_settings_discard_pre_purge_snapshot
  AFTER UPDATE OF state ON project_admin.project_knowledge_reset_requests
  FOR EACH ROW EXECUTE FUNCTION settings.t3_discard_pre_purge_snapshot();

GRANT EXECUTE ON FUNCTION settings.t3_project_settings_impact(text) TO shotgun_runtime;
GRANT EXECUTE ON FUNCTION settings.t3_project_settings_impact(text) TO shotgun_erasure_executor;
GRANT EXECUTE ON FUNCTION settings.t3_snapshot_project_settings(text, uuid),
  settings.t3_erase_project_settings(text, uuid),
  settings.t3_project_settings_status(text, uuid),
  settings.t3_discard_pre_purge_snapshot()
  TO shotgun_erasure_executor, shotgun_schema_owner;
