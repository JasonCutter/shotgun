DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1 FROM runtime.schema_migrations
    WHERE name = '097_t3_discovery_erasure.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 098 preflight failed: migration 097 is not registered';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION frontend_knowledge_draft.t3_jsonb_mentions_source_token(
  p_payload jsonb,
  p_source_tokens text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  WITH RECURSIVE json_values(value) AS (
    SELECT p_payload
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
      AND value #>> '{}' = ANY(COALESCE(p_source_tokens, ARRAY[]::text[]))
  )
$$;

ALTER FUNCTION frontend_knowledge_draft.t3_jsonb_mentions_source_token(jsonb, text[])
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_knowledge_draft.t3_jsonb_mentions_source_token(jsonb, text[])
  FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_knowledge_draft.t3_jsonb_has_unknown_source_reference(
  p_payload jsonb,
  p_target_project_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, asset, evidence
AS $$
  WITH RECURSIVE json_nodes(value, field_name) AS (
    SELECT p_payload, NULL::text
    UNION ALL
    SELECT child.value, child.field_name
    FROM json_nodes AS parent
    CROSS JOIN LATERAL (
      SELECT object_entry.value, object_entry.key AS field_name
      FROM jsonb_each(
        CASE WHEN jsonb_typeof(parent.value) = 'object' THEN parent.value ELSE '{}'::jsonb END
      ) AS object_entry(key, value)
      UNION ALL
      SELECT element.value, parent.field_name
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(parent.value) = 'array' THEN parent.value ELSE '[]'::jsonb END
      ) AS element(value)
    ) AS child
  )
  SELECT EXISTS (
    SELECT 1
    FROM json_nodes AS node
    WHERE jsonb_typeof(node.value) = 'string'
      AND NULLIF(node.value #>> '{}', '') IS NOT NULL
      AND lower(replace(COALESCE(node.field_name, ''), '_', '')) = ANY(ARRAY[
        'sourceid', 'sourceids', 'sourceversionid', 'sourceversionids',
        'evidenceid', 'evidenceids', 'evidencespanid', 'evidencespanids'
      ]::text[])
      AND NOT (
        EXISTS (
          SELECT 1 FROM asset.sources AS source
          WHERE source.project_id = p_target_project_id
            AND source.source_id::text = node.value #>> '{}'
        )
        OR EXISTS (
          SELECT 1 FROM asset.source_versions AS version
          JOIN asset.sources AS source USING (source_id)
          WHERE source.project_id = p_target_project_id
            AND version.source_version_id::text = node.value #>> '{}'
        )
        OR EXISTS (
          SELECT 1 FROM evidence.spans AS span
          WHERE span.project_id = p_target_project_id
            AND span.evidence_id::text = node.value #>> '{}'
        )
      )
  )
$$;

ALTER FUNCTION frontend_knowledge_draft.t3_jsonb_has_unknown_source_reference(jsonb, text)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_knowledge_draft.t3_jsonb_has_unknown_source_reference(jsonb, text)
  FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_knowledge_draft.t3_classify_project_drafts(
  p_target_project_id text
)
RETURNS TABLE (
  draft_id text,
  disposition text,
  relation_name text,
  row_fingerprint text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, frontend_knowledge_draft, asset, evidence
AS $$
  WITH source_tokens AS (
    SELECT COALESCE(array_agg(token), ARRAY[]::text[]) AS values
    FROM (
      SELECT source.source_id::text AS token
      FROM asset.sources AS source
      WHERE source.project_id = p_target_project_id
      UNION
      SELECT version.source_version_id::text
      FROM asset.source_versions AS version
      JOIN asset.sources AS source USING (source_id)
      WHERE source.project_id = p_target_project_id
      UNION
      SELECT span.evidence_id::text
      FROM evidence.spans AS span
      WHERE span.project_id = p_target_project_id
    ) AS tokens
  ), scoped_drafts AS (
    SELECT draft.*
    FROM frontend_knowledge_draft.drafts AS draft
    WHERE draft.resource_project_id = p_target_project_id
       OR draft.draft_project_id = p_target_project_id
       OR draft.effective_project_id = p_target_project_id
       OR draft.active_project_id = p_target_project_id
  ), raw_content_rows AS (
    SELECT 'frontend_knowledge_draft.drafts'::text AS relation_name,
           draft.draft_id AS row_draft_id,
           draft.resource_project_id = p_target_project_id
             AND draft.draft_project_id = p_target_project_id
             AND draft.effective_project_id = p_target_project_id
             AND draft.active_project_id = p_target_project_id AS binding_valid,
           to_jsonb(draft) AS row_data
    FROM frontend_knowledge_draft.drafts AS draft
    WHERE draft.resource_project_id = p_target_project_id
       OR draft.draft_project_id = p_target_project_id
       OR draft.effective_project_id = p_target_project_id
       OR draft.active_project_id = p_target_project_id
    UNION ALL
    SELECT 'frontend_knowledge_draft.revisions', revision.draft_id,
           revision.resource_project_id = p_target_project_id
             AND revision.draft_project_id = p_target_project_id
             AND revision.effective_project_id = p_target_project_id,
           to_jsonb(revision)
    FROM frontend_knowledge_draft.revisions AS revision
    WHERE revision.resource_project_id = p_target_project_id
       OR revision.draft_project_id = p_target_project_id
       OR revision.effective_project_id = p_target_project_id
    UNION ALL
    SELECT 'frontend_knowledge_draft.operations', operation.draft_id,
           operation.resource_project_id = p_target_project_id,
           to_jsonb(operation)
    FROM frontend_knowledge_draft.operations AS operation
    WHERE operation.resource_project_id = p_target_project_id
    UNION ALL
    SELECT 'frontend_knowledge_draft.materializations', materialization.draft_id,
           materialization.resource_project_id = p_target_project_id
             AND materialization.draft_project_id = p_target_project_id
             AND materialization.effective_project_id = p_target_project_id,
           to_jsonb(materialization)
    FROM frontend_knowledge_draft.materializations AS materialization
    WHERE materialization.resource_project_id = p_target_project_id
       OR materialization.draft_project_id = p_target_project_id
       OR materialization.effective_project_id = p_target_project_id
    UNION ALL
    SELECT 'frontend_knowledge_draft.artifact_refs', artifact.draft_id,
           artifact.resource_project_id = p_target_project_id,
           to_jsonb(artifact)
    FROM frontend_knowledge_draft.artifact_refs AS artifact
    WHERE artifact.resource_project_id = p_target_project_id
  ), scanned_rows AS (
    SELECT raw.*,
           frontend_knowledge_draft.t3_jsonb_mentions_source_token(
             raw.row_data, source_tokens.values
           ) AS mentions_source,
           frontend_knowledge_draft.t3_jsonb_has_unknown_source_reference(
             raw.row_data, p_target_project_id
           ) AS has_unknown_source_reference
    FROM raw_content_rows AS raw
    CROSS JOIN source_tokens
  ), draft_dispositions AS (
    SELECT draft.draft_id,
      CASE
        WHEN bool_or(NOT row.binding_valid OR row.has_unknown_source_reference)
          OR jsonb_typeof(draft.snapshot) IS DISTINCT FROM 'object'
          OR draft.snapshot->>'draftId' IS DISTINCT FROM draft.draft_id
          OR draft.snapshot->>'resourceProjectId' IS DISTINCT FROM p_target_project_id
          OR draft.snapshot->>'revision' IS DISTINCT FROM draft.revision::text
          OR draft.snapshot->>'contentDigest' IS DISTINCT FROM draft.content_digest
          OR draft.snapshot->>'startMode' IS DISTINCT FROM draft.start_mode
          OR jsonb_typeof(draft.snapshot #> '{base,sourceLineage}') IS DISTINCT FROM 'array'
          OR jsonb_typeof(draft.snapshot->'operations') IS DISTINCT FROM 'array'
          OR materialization.draft_id IS NULL
          OR materialization.resource_project_id IS DISTINCT FROM p_target_project_id
          OR materialization.draft_project_id IS DISTINCT FROM p_target_project_id
          OR materialization.effective_project_id IS DISTINCT FROM p_target_project_id
          OR (draft.start_mode = 'SEED_MATERIALIZATION' AND (
            materialization.target_kind <> 'SEED'
            OR materialization.seed_id IS DISTINCT FROM draft.seed_id
          ))
          OR (draft.start_mode = 'KNOWLEDGE_PAGE' AND (
            materialization.target_kind = 'SEED' OR materialization.seed_id IS NOT NULL
          ))
          THEN 'UNKNOWN'
        WHEN bool_or(row.mentions_source)
          OR draft.start_mode = 'SEED_MATERIALIZATION'
          OR NULLIF(draft.snapshot->>'answerRunId', '') IS NOT NULL
          OR COALESCE(draft.snapshot->'discoveryProvenance', 'null'::jsonb) <> 'null'::jsonb
          THEN 'SOURCE_DERIVED'
        WHEN draft.start_mode = 'KNOWLEDGE_PAGE'
          AND materialization.target_kind = 'PAGE'
          AND materialization.page_id IS NOT NULL
          AND materialization.seed_id IS NULL
          AND NULLIF(materialization.replay_principal_id, '') IS NOT NULL
          AND jsonb_array_length(draft.snapshot #> '{base,sourceLineage}') = 0
          AND NULLIF(draft.snapshot->>'answerRunId', '') IS NULL
          AND COALESCE(draft.snapshot->'discoveryProvenance', 'null'::jsonb) = 'null'::jsonb
          THEN 'PRESERVE'
        ELSE 'UNKNOWN'
      END AS disposition
    FROM scoped_drafts AS draft
    LEFT JOIN scanned_rows AS row ON row.row_draft_id = draft.draft_id
    LEFT JOIN frontend_knowledge_draft.materializations AS materialization
      ON materialization.draft_id = draft.draft_id
    GROUP BY draft.draft_id, draft.snapshot, draft.revision, draft.content_digest,
             draft.start_mode, draft.seed_id, materialization.draft_id,
             materialization.resource_project_id, materialization.draft_project_id,
             materialization.effective_project_id, materialization.target_kind,
             materialization.seed_id, materialization.page_id,
             materialization.replay_principal_id
  )
  SELECT row.row_draft_id,
         COALESCE(disposition.disposition, 'UNKNOWN'),
         row.relation_name,
         encode(pg_catalog.sha256(convert_to(row.row_data::text, 'UTF8')), 'hex')
  FROM scanned_rows AS row
  LEFT JOIN draft_dispositions AS disposition ON disposition.draft_id = row.row_draft_id
$$;

ALTER FUNCTION frontend_knowledge_draft.t3_classify_project_drafts(text)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_knowledge_draft.t3_classify_project_drafts(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_knowledge_draft.t3_project_draft_impact(
  p_target_project_id text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, frontend_knowledge_draft
AS $$
  WITH classified AS MATERIALIZED (
    SELECT * FROM frontend_knowledge_draft.t3_classify_project_drafts(p_target_project_id)
  )
  SELECT jsonb_build_object(
    'sourceDerivedDraftCount', count(DISTINCT draft_id)
      FILTER (WHERE disposition = 'SOURCE_DERIVED'),
    'sourceDerivedRecordCount', count(*) FILTER (WHERE disposition = 'SOURCE_DERIVED'),
    'preservedDraftCount', count(DISTINCT draft_id) FILTER (WHERE disposition = 'PRESERVE'),
    'unclassifiedRecordCount', count(*) FILTER (WHERE disposition = 'UNKNOWN'),
    'fingerprint', encode(pg_catalog.sha256(convert_to(
      COALESCE(string_agg(
        relation_name || ':' || COALESCE(draft_id, '') || ':' || row_fingerprint,
        '' ORDER BY relation_name, draft_id, row_fingerprint
      ), ''), 'UTF8')), 'hex')
  )
  FROM classified
$$;

ALTER FUNCTION frontend_knowledge_draft.t3_project_draft_impact(text)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_knowledge_draft.t3_project_draft_impact(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_knowledge_draft.t3_project_draft_status(
  p_target_project_id text,
  p_reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, frontend_knowledge_draft, project_admin
AS $$
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM project_admin.project_knowledge_reset_requests AS request
    WHERE request.project_id = p_target_project_id AND request.request_id = p_reset_request_id
  ) THEN
    RAISE EXCEPTION 'Knowledge Draft reset request is missing'
      USING ERRCODE = '55000', CONSTRAINT = 't3_draft_snapshot_missing';
  END IF;
  RETURN frontend_knowledge_draft.t3_project_draft_impact(p_target_project_id);
END
$$;

ALTER FUNCTION frontend_knowledge_draft.t3_project_draft_status(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_knowledge_draft.t3_project_draft_status(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_knowledge_draft.t3_erase_project_drafts(
  p_target_project_id text,
  p_reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, frontend_knowledge_draft, project_admin
AS $$
DECLARE
  impact jsonb;
  linked_draft_ids text[];
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Approved Knowledge Draft reset request required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  PERFORM set_config('shotgun.t3_reset_request_id', p_reset_request_id::text, true);
  IF NOT project_admin.t3_reset_write_authorized(p_target_project_id) THEN
    RAISE EXCEPTION 'Approved Knowledge Draft reset request required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;

  impact := frontend_knowledge_draft.t3_project_draft_impact(p_target_project_id);
  IF (impact->>'unclassifiedRecordCount')::bigint > 0 THEN
    RAISE EXCEPTION 'Knowledge Draft lineage is incomplete or ambiguous'
      USING ERRCODE = '55000', CONSTRAINT = 't3_draft_unclassified';
  END IF;

  SELECT array_agg(DISTINCT classified.draft_id ORDER BY classified.draft_id)
    INTO linked_draft_ids
  FROM frontend_knowledge_draft.t3_classify_project_drafts(p_target_project_id) AS classified
  WHERE classified.disposition = 'SOURCE_DERIVED';

  DELETE FROM frontend_knowledge_draft.artifact_refs
  WHERE draft_id = ANY(COALESCE(linked_draft_ids, ARRAY[]::text[]));
  DELETE FROM frontend_knowledge_draft.operations
  WHERE draft_id = ANY(COALESCE(linked_draft_ids, ARRAY[]::text[]));
  DELETE FROM frontend_knowledge_draft.revisions
  WHERE draft_id = ANY(COALESCE(linked_draft_ids, ARRAY[]::text[]));
  DELETE FROM frontend_knowledge_draft.materializations
  WHERE draft_id = ANY(COALESCE(linked_draft_ids, ARRAY[]::text[]));
  DELETE FROM frontend_knowledge_draft.drafts
  WHERE draft_id = ANY(COALESCE(linked_draft_ids, ARRAY[]::text[]));

  RETURN frontend_knowledge_draft.t3_project_draft_impact(p_target_project_id);
END
$$;

ALTER FUNCTION frontend_knowledge_draft.t3_erase_project_drafts(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_knowledge_draft.t3_erase_project_drafts(text, uuid)
  FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_knowledge_draft.t3_guard_project_draft_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
DECLARE
  target_project_id text;
  reset_state text;
BEGIN
  target_project_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.resource_project_id
                            ELSE NEW.resource_project_id END;
  SELECT epoch.state INTO reset_state
  FROM project_admin.project_knowledge_epoch AS epoch
  WHERE epoch.project_id = target_project_id;
  IF reset_state IS NULL OR reset_state = 'READY'
     OR project_admin.t3_reset_write_authorized(target_project_id) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Project knowledge reset fences Knowledge Draft writes'
    USING ERRCODE = '55000', CONSTRAINT = 'project_knowledge_reset_write_fence';
END
$$;

ALTER FUNCTION frontend_knowledge_draft.t3_guard_project_draft_write()
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_knowledge_draft.t3_guard_project_draft_write() FROM PUBLIC;

DO $$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'drafts', 'revisions', 'operations', 'materializations', 'artifact_refs'
  ]::text[] LOOP
    EXECUTE format(
      'CREATE TRIGGER t3_project_knowledge_reset_fence '
      'BEFORE INSERT OR UPDATE OR DELETE ON frontend_knowledge_draft.%I '
      'FOR EACH ROW EXECUTE FUNCTION frontend_knowledge_draft.t3_guard_project_draft_write()',
      relation_name
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION frontend_knowledge_draft.block_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND project_admin.t3_reset_write_authorized(OLD.resource_project_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'frontend_knowledge_draft.revisions is append-only and immutable'
    USING ERRCODE = '55000';
END
$$;

CREATE OR REPLACE FUNCTION frontend_knowledge_draft.block_operation_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND project_admin.t3_reset_write_authorized(OLD.resource_project_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'frontend_knowledge_draft.operations is append-only and immutable'
    USING ERRCODE = '55000';
END
$$;

CREATE OR REPLACE FUNCTION frontend_knowledge_draft.block_materialization_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND project_admin.t3_reset_write_authorized(OLD.resource_project_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'frontend_knowledge_draft.materializations is append-only and immutable'
    USING ERRCODE = '55000';
END
$$;

CREATE OR REPLACE FUNCTION frontend_knowledge_draft.block_artifact_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND project_admin.t3_reset_write_authorized(OLD.resource_project_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'frontend_knowledge_draft.artifact_refs is append-only and immutable'
    USING ERRCODE = '55000';
END
$$;

ALTER FUNCTION frontend_knowledge_draft.block_revision_mutation() OWNER TO shotgun_schema_owner;
ALTER FUNCTION frontend_knowledge_draft.block_operation_mutation() OWNER TO shotgun_schema_owner;
ALTER FUNCTION frontend_knowledge_draft.block_materialization_mutation() OWNER TO shotgun_schema_owner;
ALTER FUNCTION frontend_knowledge_draft.block_artifact_mutation() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_knowledge_draft.block_revision_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION frontend_knowledge_draft.block_operation_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION frontend_knowledge_draft.block_materialization_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION frontend_knowledge_draft.block_artifact_mutation() FROM PUBLIC;

GRANT USAGE ON SCHEMA frontend_knowledge_draft, asset, evidence, project_admin
  TO shotgun_schema_owner;
GRANT USAGE ON SCHEMA frontend_knowledge_draft TO shotgun_runtime, shotgun_erasure_executor;
GRANT USAGE ON SCHEMA project_admin TO shotgun_erasure_executor;
GRANT SELECT ON asset.sources, asset.source_versions, evidence.spans,
  project_admin.project_knowledge_epoch, project_admin.project_knowledge_reset_requests
  TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION project_admin.t3_reset_write_authorized(text)
  TO shotgun_schema_owner;
GRANT SELECT, DELETE ON frontend_knowledge_draft.drafts,
  frontend_knowledge_draft.revisions, frontend_knowledge_draft.operations,
  frontend_knowledge_draft.materializations, frontend_knowledge_draft.artifact_refs
  TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION frontend_knowledge_draft.t3_jsonb_mentions_source_token(jsonb, text[]),
  frontend_knowledge_draft.t3_jsonb_has_unknown_source_reference(jsonb, text),
  frontend_knowledge_draft.t3_classify_project_drafts(text),
  frontend_knowledge_draft.t3_project_draft_impact(text)
  TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION frontend_knowledge_draft.t3_project_draft_impact(text)
  TO shotgun_runtime;
GRANT EXECUTE ON FUNCTION frontend_knowledge_draft.t3_project_draft_status(text, uuid),
  frontend_knowledge_draft.t3_erase_project_drafts(text, uuid)
  TO shotgun_erasure_executor;
