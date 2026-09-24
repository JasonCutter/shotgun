DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '099_t3_review_erasure.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 100 preflight failed: migration 099 is not registered';
  END IF;
END
$$;

-- Project projections are disposable derivations of Canonical state. Keep
-- semantic embedding profiles as user configuration; remove every generated
-- document, inference, generation, pointer and watermark for the reset Project.
CREATE OR REPLACE FUNCTION projection.t3_project_projection_impact(target_project_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, projection
AS $$
DECLARE
  projection_records bigint := 0;
  active_generation_count bigint := 0;
  fingerprint_material text := '';
  relation_name text;
  relation_count bigint;
  relation_fingerprint text;
  relations text[] := ARRAY[
    'projection.search_documents',
    'projection.watermarks',
    'projection.compiled_truth',
    'projection.discovery_inferences',
    'projection.semantic_generation_pointers',
    'projection.semantic_generations',
    'projection.semantic_items'
  ];
BEGIN
  IF target_project_id IS NULL OR target_project_id = '' THEN
    RAISE EXCEPTION 'Projection reset Project is required'
      USING ERRCODE = '22023', CONSTRAINT = 't3_projection_project_required';
  END IF;

  FOREACH relation_name IN ARRAY relations LOOP
    EXECUTE format(
      'SELECT count(*)::bigint,
              COALESCE(string_agg(encode(pg_catalog.sha256(convert_to(to_jsonb(row_data)::text, ''UTF8'')), ''hex''), '''' ORDER BY to_jsonb(row_data)::text), '''')
         FROM %s AS row_data WHERE project_id = $1',
      relation_name
    ) INTO relation_count, relation_fingerprint USING target_project_id;
    projection_records := projection_records + relation_count;
    fingerprint_material := fingerprint_material || relation_name || ':' || relation_count::text
      || ':' || COALESCE(relation_fingerprint, '') || E'\n';
  END LOOP;

  SELECT count(*) INTO active_generation_count
  FROM projection.semantic_generations AS generation
  WHERE generation.project_id = target_project_id
    AND generation.build_status = 'BUILDING';

  SELECT active_generation_count + count(*) INTO active_generation_count
  FROM projection.semantic_embedding_profiles AS profile
  WHERE profile.project_id = target_project_id AND profile.status = 'BUILDING';

  RETURN jsonb_build_object(
    'projectionRecordCount', projection_records,
    'activeGenerationCount', active_generation_count,
    'fingerprint', encode(pg_catalog.sha256(convert_to(fingerprint_material, 'UTF8')), 'hex')
  );
END
$$;

ALTER FUNCTION projection.t3_project_projection_impact(text) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION projection.t3_project_projection_impact(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION projection.t3_project_projection_status(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, projection
AS $$
DECLARE
  request_state text;
  epoch_state text;
  impact jsonb;
  expected_canonical_version integer;
  expected_canonical_digest text;
  stale_projection_count bigint := 0;
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
    RAISE EXCEPTION 'Projection status is unavailable outside active maintenance'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;

  impact := projection.t3_project_projection_impact(target_project_id);

  SELECT state.version, state.snapshot_digest
  INTO expected_canonical_version, expected_canonical_digest
  FROM canonical.project_state AS state
  WHERE state.project_id = target_project_id;

  IF expected_canonical_version IS NULL OR expected_canonical_digest IS NULL THEN
    stale_projection_count := 1;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM projection.watermarks AS watermark
      WHERE watermark.project_id = target_project_id
        AND watermark.canonical_version = expected_canonical_version
        AND watermark.snapshot_digest = expected_canonical_digest
        AND watermark.status = 'READY'
    ) THEN
      stale_projection_count := stale_projection_count + 1;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM projection.compiled_truth AS compiled
      WHERE compiled.project_id = target_project_id
        AND compiled.canonical_version = expected_canonical_version
        AND compiled.status = 'READY'
        AND compiled.last_error IS NULL
        AND compiled.projection->>'projectId' = target_project_id
        AND (compiled.projection->>'canonicalVersion')::integer = expected_canonical_version
        AND compiled.projection->>'sourceSnapshotDigest' = compiled.source_snapshot_digest
    ) THEN
      stale_projection_count := stale_projection_count + 1;
    END IF;
    IF EXISTS (
      SELECT 1 FROM projection.search_documents AS document
      WHERE document.project_id = target_project_id
        AND document.canonical_version <> expected_canonical_version
    ) THEN
      stale_projection_count := stale_projection_count + 1;
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM projection.semantic_generation_pointers AS pointer
    WHERE pointer.project_id = target_project_id
    UNION ALL
    SELECT 1 FROM projection.semantic_generations AS generation
    WHERE generation.project_id = target_project_id
    UNION ALL
    SELECT 1 FROM projection.semantic_items AS item
    WHERE item.project_id = target_project_id
    UNION ALL
    SELECT 1 FROM projection.discovery_inferences AS inference
    WHERE inference.project_id = target_project_id
  ) THEN
    stale_projection_count := stale_projection_count + 1;
  END IF;

  RETURN impact || jsonb_build_object(
    'canonicalVersion', COALESCE(expected_canonical_version, -1),
    'staleProjectionCount', stale_projection_count
  );
END
$$;

ALTER FUNCTION projection.t3_project_projection_status(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION projection.t3_project_projection_status(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION projection.t3_erase_project_projections(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, projection
AS $$
DECLARE
  impact jsonb;
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

  impact := projection.t3_project_projection_impact(target_project_id);
  IF (impact->>'activeGenerationCount')::bigint > 0 THEN
    RAISE EXCEPTION 'Semantic projection work must reach a known terminal state before reset'
      USING ERRCODE = '55000', CONSTRAINT = 'active_job_outcome_unknown';
  END IF;

  DELETE FROM projection.semantic_generation_pointers WHERE project_id = target_project_id;
  DELETE FROM projection.semantic_items WHERE project_id = target_project_id;
  DELETE FROM projection.semantic_generations WHERE project_id = target_project_id;
  DELETE FROM projection.discovery_inferences WHERE project_id = target_project_id;
  DELETE FROM projection.search_documents WHERE project_id = target_project_id;
  DELETE FROM projection.watermarks WHERE project_id = target_project_id;
  DELETE FROM projection.compiled_truth WHERE project_id = target_project_id;

  RETURN projection.t3_project_projection_impact(target_project_id);
END
$$;

ALTER FUNCTION projection.t3_erase_project_projections(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION projection.t3_erase_project_projections(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION projection.t3_rebuild_project_projection_snapshot(
  target_project_id text,
  reset_request_id uuid,
  search_documents jsonb,
  compiled_projection jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, asset, canonical, project_admin, projection
AS $$
DECLARE
  canonical_state record;
  projected_at timestamptz;
  document jsonb;
  document_count bigint := 0;
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
  IF jsonb_typeof(search_documents) IS DISTINCT FROM 'array'
     OR jsonb_typeof(compiled_projection) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Projection rebuild snapshot is malformed'
      USING ERRCODE = '22023', CONSTRAINT = 't3_projection_snapshot_invalid';
  END IF;

  SELECT state.version, state.snapshot_digest INTO canonical_state
  FROM canonical.project_state AS state
  WHERE state.project_id = target_project_id;
  IF canonical_state.version IS NULL
     OR (compiled_projection->>'projectId') IS DISTINCT FROM target_project_id
     OR (compiled_projection->>'canonicalVersion')::integer IS DISTINCT FROM canonical_state.version
     OR (compiled_projection->>'sourceSnapshotDigest') !~ '^sha256:[a-f0-9]{64}$'
     OR (compiled_projection->>'projectorVersion') IS NULL
     OR (compiled_projection->>'logicalDigest') !~ '^sha256:[a-f0-9]{64}$'
     OR (compiled_projection->>'buildMode') NOT IN ('FULL_REBUILD', 'INCREMENTAL')
     OR (compiled_projection->>'projectedAt') IS NULL THEN
    RAISE EXCEPTION 'Projection rebuild snapshot does not match current Canonical state'
      USING ERRCODE = '55000', CONSTRAINT = 't3_projection_snapshot_stale';
  END IF;
  projected_at := (compiled_projection->>'projectedAt')::timestamptz;

  DELETE FROM projection.search_documents WHERE project_id = target_project_id;
  FOR document IN SELECT value FROM jsonb_array_elements(search_documents) AS item(value) LOOP
    IF (document->>'projectId') IS DISTINCT FROM target_project_id
       OR (document->>'canonicalVersion')::integer IS DISTINCT FROM canonical_state.version
       OR (document->>'claimId') IS NULL
       OR (document->>'commitId') IS NULL
       OR (document->>'revisionId') IS NULL
       OR (document->>'sourceVersionId') IS NULL
       OR jsonb_typeof(document->'evidenceIds') IS DISTINCT FROM 'array'
       OR jsonb_typeof(document->'accessScope') IS DISTINCT FROM 'array'
       OR NOT EXISTS (
         SELECT 1 FROM canonical.claims AS claim
         WHERE claim.project_id = target_project_id
           AND claim.claim_id = document->>'claimId'
           AND claim.source_version_id = (document->>'sourceVersionId')::uuid
       )
       OR NOT EXISTS (
         SELECT 1
         FROM asset.source_versions AS version
         JOIN asset.sources AS source ON source.source_id = version.source_id
         WHERE source.project_id = target_project_id
           AND version.source_version_id = (document->>'sourceVersionId')::uuid
       ) THEN
      RAISE EXCEPTION 'Search projection row does not match current Project Canonical state'
        USING ERRCODE = '55000', CONSTRAINT = 't3_projection_snapshot_stale';
    END IF;
    INSERT INTO projection.search_documents (
      project_id, claim_id, commit_id, revision_id, canonical_version, claim_text,
      source_version_id, evidence_ids, access_scope, sensitivity, projected_at
    ) VALUES (
      target_project_id,
      document->>'claimId',
      (document->>'commitId')::uuid,
      document->>'revisionId',
      canonical_state.version,
      document->>'claimText',
      (document->>'sourceVersionId')::uuid,
      ARRAY(SELECT jsonb_array_elements_text(document->'evidenceIds')),
      ARRAY(SELECT jsonb_array_elements_text(document->'accessScope')),
      document->>'sensitivity',
      COALESCE((document->>'projectedAt')::timestamptz, projected_at)
    );
    document_count := document_count + 1;
  END LOOP;

  INSERT INTO projection.watermarks (
    project_id, last_commit_id, canonical_version, snapshot_digest, status, last_error, updated_at
  ) VALUES (
    target_project_id,
    NULLIF(compiled_projection->>'lastCommitId', '')::uuid,
    canonical_state.version,
    canonical_state.snapshot_digest,
    'READY',
    NULL,
    projected_at
  ) ON CONFLICT (project_id) DO UPDATE SET
    last_commit_id = EXCLUDED.last_commit_id,
    canonical_version = EXCLUDED.canonical_version,
    snapshot_digest = EXCLUDED.snapshot_digest,
    status = 'READY',
    last_error = NULL,
    updated_at = EXCLUDED.updated_at;

  INSERT INTO projection.compiled_truth (
    project_id, projector_version, source_snapshot_digest, logical_digest,
    canonical_version, build_mode, projection, status, last_error, updated_at
  ) VALUES (
    target_project_id,
    compiled_projection->>'projectorVersion',
    compiled_projection->>'sourceSnapshotDigest',
    compiled_projection->>'logicalDigest',
    canonical_state.version,
    compiled_projection->>'buildMode',
    compiled_projection,
    'READY',
    NULL,
    projected_at
  ) ON CONFLICT (project_id) DO UPDATE SET
    projector_version = EXCLUDED.projector_version,
    source_snapshot_digest = EXCLUDED.source_snapshot_digest,
    logical_digest = EXCLUDED.logical_digest,
    canonical_version = EXCLUDED.canonical_version,
    build_mode = EXCLUDED.build_mode,
    projection = EXCLUDED.projection,
    status = 'READY',
    last_error = NULL,
    updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'projectId', target_project_id,
    'canonicalVersion', canonical_state.version,
    'canonicalSnapshotDigest', canonical_state.snapshot_digest,
    'sourceSnapshotDigest', compiled_projection->>'sourceSnapshotDigest',
    'searchDocumentCount', document_count,
    'status', 'READY'
  );
END
$$;

ALTER FUNCTION projection.t3_rebuild_project_projection_snapshot(text, uuid, jsonb, jsonb)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION projection.t3_rebuild_project_projection_snapshot(text, uuid, jsonb, jsonb)
  FROM PUBLIC;

GRANT USAGE ON SCHEMA projection TO shotgun_schema_owner, shotgun_runtime, shotgun_erasure_executor;
GRANT USAGE ON SCHEMA asset, canonical, project_admin TO shotgun_schema_owner;
GRANT SELECT ON asset.sources, asset.source_versions,
  canonical.claims, canonical.project_state TO shotgun_schema_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON projection.search_documents, projection.watermarks,
  projection.compiled_truth, projection.discovery_inferences,
  projection.semantic_generation_pointers, projection.semantic_generations,
  projection.semantic_items TO shotgun_schema_owner;
GRANT SELECT ON projection.semantic_embedding_profiles TO shotgun_schema_owner;
GRANT SELECT ON projection.semantic_embedding_profiles TO shotgun_runtime;
GRANT EXECUTE ON FUNCTION project_admin.t3_reset_write_authorized(text) TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION projection.t3_project_projection_impact(text) TO shotgun_runtime;
GRANT EXECUTE ON FUNCTION projection.t3_project_projection_impact(text),
  projection.t3_project_projection_status(text, uuid),
  projection.t3_erase_project_projections(text, uuid),
  projection.t3_rebuild_project_projection_snapshot(text, uuid, jsonb, jsonb)
  TO shotgun_erasure_executor;
