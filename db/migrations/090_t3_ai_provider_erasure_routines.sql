DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1 FROM runtime.schema_migrations
    WHERE name = '089_t3_candidate_erasure_routines.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 090 preflight failed: migration 089 is not registered';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION ai.reject_provider_output_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND project_admin.t3_reset_write_authorized(OLD.project_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ai.provider_outputs is append-only outside approved T3 erasure'
    USING ERRCODE = '55000', CONSTRAINT = 'ai_provider_output_immutable';
END
$$;
ALTER FUNCTION ai.reject_provider_output_change() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION ai.reject_provider_output_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION project_admin.t3_reset_write_authorized(text) TO shotgun_schema_owner;

CREATE OR REPLACE FUNCTION ai.t3_guard_provider_attempt_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, ai
AS $$
DECLARE
  new_project_id text;
  old_project_id text;
  reset_state text;
BEGIN
  SELECT call.project_id INTO new_project_id
  FROM ai.provider_calls AS call WHERE call.call_id = NEW.call_id;
  IF new_project_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT epoch.state INTO reset_state
  FROM project_admin.project_knowledge_epoch AS epoch
  WHERE epoch.project_id = new_project_id;
  IF reset_state IS NOT NULL AND reset_state <> 'READY'
     AND NOT project_admin.t3_reset_write_authorized(new_project_id) THEN
    RAISE EXCEPTION 'Project knowledge reset fences AI provider attempt writes'
      USING ERRCODE = '55000', CONSTRAINT = 'project_knowledge_reset_write_fence';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT call.project_id INTO old_project_id
    FROM ai.provider_calls AS call WHERE call.call_id = OLD.call_id;
    IF old_project_id IS NOT NULL AND old_project_id IS DISTINCT FROM new_project_id THEN
      SELECT epoch.state INTO reset_state
      FROM project_admin.project_knowledge_epoch AS epoch
      WHERE epoch.project_id = old_project_id;
      IF reset_state IS NOT NULL AND reset_state <> 'READY'
         AND NOT project_admin.t3_reset_write_authorized(old_project_id) THEN
        RAISE EXCEPTION 'Project knowledge reset fences AI provider attempt writes'
          USING ERRCODE = '55000', CONSTRAINT = 'project_knowledge_reset_write_fence';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION ai.t3_guard_provider_attempt_write() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION ai.t3_guard_provider_attempt_write() FROM PUBLIC;
GRANT USAGE ON SCHEMA ai TO shotgun_schema_owner;
GRANT SELECT ON ai.provider_calls TO shotgun_schema_owner;
GRANT SELECT ON project_admin.project_knowledge_epoch TO shotgun_schema_owner;
DROP TRIGGER IF EXISTS ai_provider_attempts_t3_write_fence ON ai.provider_attempts;
CREATE TRIGGER ai_provider_attempts_t3_write_fence
  BEFORE INSERT OR UPDATE ON ai.provider_attempts
  FOR EACH ROW EXECUTE FUNCTION ai.t3_guard_provider_attempt_write();

CREATE OR REPLACE FUNCTION ai.t3_project_provider_status(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, asset, transformation, evidence, ai
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
    RAISE EXCEPTION 'AI provider status is unavailable outside active maintenance'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;

  RETURN (
    WITH valid_calls AS MATERIALIZED (
      SELECT call.*
      FROM ai.provider_calls AS call
      JOIN asset.source_versions AS version
        ON version.source_version_id = call.source_version_id
      JOIN asset.sources AS source
        ON source.source_id = version.source_id
       AND source.project_id = target_project_id
      JOIN transformation.revisions AS revision
        ON revision.project_id = target_project_id
       AND revision.source_version_id = version.source_version_id
       AND revision.revision_id = call.revision_id
      WHERE call.project_id = target_project_id
        AND call.schema_name = 'ClaimCandidateBatch.v1'
        AND call.source_version_id IS NOT NULL
        AND call.revision_id IS NOT NULL
        AND cardinality(call.input_evidence_ids) > 0
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(call.input_evidence_ids) AS input(evidence_id)
          LEFT JOIN evidence.spans AS span
            ON span.evidence_id = input.evidence_id
           AND span.project_id = target_project_id
           AND span.source_version_id = version.source_version_id
           AND span.revision_id = revision.revision_id
          WHERE span.evidence_id IS NULL
        )
    ), source_attempts AS MATERIALIZED (
      SELECT attempt.*
      FROM ai.provider_attempts AS attempt
      JOIN valid_calls AS call USING (call_id)
    ), source_outputs AS MATERIALIZED (
      SELECT output.*
      FROM ai.provider_outputs AS output
      JOIN valid_calls AS call USING (call_id)
      JOIN ai.provider_attempts AS attempt
        ON attempt.attempt_id = output.attempt_id AND attempt.call_id = call.call_id
      WHERE output.project_id = target_project_id
    )
    SELECT jsonb_build_object(
      'providerCalls', (SELECT count(*) FROM valid_calls),
      'providerAttempts', (SELECT count(*) FROM source_attempts),
      'providerOutputs', (SELECT count(*) FROM source_outputs),
      'activeWork', (
        (SELECT count(*) FROM valid_calls
          WHERE durable_state IN (
            'REQUESTED', 'PROVIDER_RUNNING', 'OUTPUT_MATERIALIZED',
            'MATERIALIZATION_FAILED', 'OUTCOME_UNKNOWN'
          ))
        + (SELECT count(*) FROM source_attempts
          WHERE status IN ('running', 'outcome_unknown')
             OR lease_expires_at > clock_timestamp())
      ),
      'unresolvedRecords', (
        (SELECT count(*) FROM ai.provider_calls AS call
          WHERE call.project_id = target_project_id
            AND NOT EXISTS (SELECT 1 FROM valid_calls AS valid WHERE valid.call_id = call.call_id))
        + (SELECT count(*) FROM ai.provider_attempts AS attempt
          JOIN ai.provider_calls AS call USING (call_id)
          WHERE call.project_id = target_project_id
            AND NOT EXISTS (SELECT 1 FROM valid_calls AS valid WHERE valid.call_id = call.call_id))
        + (SELECT count(*) FROM ai.provider_outputs AS output
          WHERE output.project_id = target_project_id
            AND NOT EXISTS (
              SELECT 1
              FROM valid_calls AS valid
              JOIN ai.provider_attempts AS attempt
                ON attempt.attempt_id = output.attempt_id AND attempt.call_id = valid.call_id
              WHERE valid.call_id = output.call_id
            ))
      ),
      'derivedRecords',
        (SELECT count(*) FROM valid_calls)
        + (SELECT count(*) FROM source_attempts)
        + (SELECT count(*) FROM source_outputs)
    )
  );
END
$$;
ALTER FUNCTION ai.t3_project_provider_status(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION ai.t3_project_provider_status(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION ai.t3_erase_project_provider_data(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, asset, transformation, evidence, ai
AS $$
DECLARE
  selected_call_ids uuid[];
  selected_output_ids uuid[];
  active_work bigint;
  unresolved_records bigint;
  deleted_outputs bigint;
  deleted_calls bigint;
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

  WITH valid_calls AS MATERIALIZED (
    SELECT call.*
    FROM ai.provider_calls AS call
    JOIN asset.source_versions AS version
      ON version.source_version_id = call.source_version_id
    JOIN asset.sources AS source
      ON source.source_id = version.source_id
     AND source.project_id = target_project_id
    JOIN transformation.revisions AS revision
      ON revision.project_id = target_project_id
     AND revision.source_version_id = version.source_version_id
     AND revision.revision_id = call.revision_id
    WHERE call.project_id = target_project_id
      AND call.schema_name = 'ClaimCandidateBatch.v1'
      AND call.source_version_id IS NOT NULL
      AND call.revision_id IS NOT NULL
      AND cardinality(call.input_evidence_ids) > 0
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(call.input_evidence_ids) AS input(evidence_id)
        LEFT JOIN evidence.spans AS span
          ON span.evidence_id = input.evidence_id
         AND span.project_id = target_project_id
         AND span.source_version_id = version.source_version_id
         AND span.revision_id = revision.revision_id
        WHERE span.evidence_id IS NULL
      )
  ), source_outputs AS MATERIALIZED (
    SELECT output.*
    FROM ai.provider_outputs AS output
    JOIN valid_calls AS call USING (call_id)
    JOIN ai.provider_attempts AS attempt
      ON attempt.attempt_id = output.attempt_id AND attempt.call_id = call.call_id
    WHERE output.project_id = target_project_id
  )
  SELECT array_agg(call.call_id ORDER BY call.call_id),
         (SELECT array_agg(output.output_id ORDER BY output.output_id) FROM source_outputs AS output)
    INTO selected_call_ids, selected_output_ids
  FROM valid_calls AS call;

  SELECT count(*) INTO unresolved_records
  FROM (
    SELECT call.call_id
    FROM ai.provider_calls AS call
    WHERE call.project_id = target_project_id
      AND NOT (call.call_id = ANY(COALESCE(selected_call_ids, ARRAY[]::uuid[])))
    UNION ALL
    SELECT output.output_id
    FROM ai.provider_outputs AS output
    WHERE output.project_id = target_project_id
      AND NOT (output.output_id = ANY(COALESCE(selected_output_ids, ARRAY[]::uuid[])))
  ) AS unresolved;
  IF unresolved_records > 0 THEN
    RAISE EXCEPTION 'AI provider records do not have exact Project Source lineage'
      USING ERRCODE = '55000', CONSTRAINT = 't3_ai_unclassified_content';
  END IF;

  SELECT count(*) INTO active_work
  FROM ai.provider_calls AS call
  WHERE call.call_id = ANY(COALESCE(selected_call_ids, ARRAY[]::uuid[]))
    AND call.durable_state IN (
      'REQUESTED', 'PROVIDER_RUNNING', 'OUTPUT_MATERIALIZED',
      'MATERIALIZATION_FAILED', 'OUTCOME_UNKNOWN'
    );
  SELECT active_work + count(*) INTO active_work
  FROM ai.provider_attempts AS attempt
  WHERE attempt.call_id = ANY(COALESCE(selected_call_ids, ARRAY[]::uuid[]))
    AND (attempt.status IN ('running', 'outcome_unknown')
      OR attempt.lease_expires_at > clock_timestamp());
  IF active_work > 0 THEN
    RAISE EXCEPTION 'AI provider work has not reached a terminal outcome'
      USING ERRCODE = '55000', CONSTRAINT = 'active_job_outcome_unknown';
  END IF;

  UPDATE ai.provider_calls
  SET accepted_output_id = NULL, updated_at = clock_timestamp()
  WHERE call_id = ANY(COALESCE(selected_call_ids, ARRAY[]::uuid[]))
    AND accepted_output_id IS NOT NULL;
  DELETE FROM ai.provider_outputs
  WHERE output_id = ANY(COALESCE(selected_output_ids, ARRAY[]::uuid[]))
    AND project_id = target_project_id;
  GET DIAGNOSTICS deleted_outputs = ROW_COUNT;
  DELETE FROM ai.provider_calls
  WHERE call_id = ANY(COALESCE(selected_call_ids, ARRAY[]::uuid[]))
    AND project_id = target_project_id;
  GET DIAGNOSTICS deleted_calls = ROW_COUNT;

  RETURN jsonb_build_object('providerCalls', deleted_calls, 'providerOutputs', deleted_outputs);
END
$$;
ALTER FUNCTION ai.t3_erase_project_provider_data(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION ai.t3_erase_project_provider_data(text, uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA ai, asset, evidence, transformation TO shotgun_schema_owner;
GRANT USAGE ON SCHEMA ai TO shotgun_erasure_executor;
GRANT SELECT ON asset.sources, asset.source_versions, transformation.revisions, evidence.spans TO shotgun_schema_owner;
GRANT SELECT, DELETE ON ai.provider_calls, ai.provider_attempts, ai.provider_outputs TO shotgun_schema_owner;
GRANT UPDATE (accepted_output_id, updated_at) ON ai.provider_calls TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION ai.t3_project_provider_status(text, uuid),
  ai.t3_erase_project_provider_data(text, uuid) TO shotgun_erasure_executor;
