DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1 FROM runtime.schema_migrations
    WHERE name = '094_t3_frontend_command_erasure.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 095 preflight failed: migration 094 is not registered';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION frontend_external_action.t3_jsonb_mentions_source_token(
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
    SELECT 1
    FROM json_values
    WHERE jsonb_typeof(value) = 'string'
      AND value #>> '{}' = ANY(COALESCE(source_tokens, ARRAY[]::text[]))
  )
$$;

ALTER FUNCTION frontend_external_action.t3_jsonb_mentions_source_token(jsonb, text[])
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_external_action.t3_jsonb_mentions_source_token(jsonb, text[])
  FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_external_action.t3_project_action_analysis(
  p_target_project_id text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, frontend_external_action, asset
AS $$
  WITH source_tokens AS (
    SELECT COALESCE(array_agg(token), ARRAY[]::text[]) AS values
    FROM (
      SELECT source.source_id::text AS token
      FROM asset.sources AS source
      WHERE source.project_id = p_target_project_id
      UNION
      SELECT version.source_version_id::text AS token
      FROM asset.source_versions AS version
      JOIN asset.sources AS source ON source.source_id = version.source_id
      WHERE source.project_id = p_target_project_id
    ) AS token_rows
  ),
  snapshot_rows AS (
    SELECT 'aggregates'::text AS table_name, row.action_id, row.action_id AS row_id,
           row.status, row.snapshot AS payload, to_jsonb(row) AS row_data
    FROM frontend_external_action.aggregates AS row
    WHERE row.resource_project_id = p_target_project_id
    UNION ALL
    SELECT 'candidates', row.action_id, row.candidate_id, NULL::text, row.snapshot, to_jsonb(row)
    FROM frontend_external_action.candidates AS row
    WHERE row.resource_project_id = p_target_project_id
    UNION ALL
    SELECT 'risk_decisions', row.action_id, row.risk_decision_id, NULL::text, row.snapshot, to_jsonb(row)
    FROM frontend_external_action.risk_decisions AS row
    WHERE row.resource_project_id = p_target_project_id
    UNION ALL
    SELECT 'manifests', row.action_id, row.manifest_id, NULL::text, row.snapshot, to_jsonb(row)
    FROM frontend_external_action.manifests AS row
    WHERE row.resource_project_id = p_target_project_id
    UNION ALL
    SELECT 'approvals', row.action_id, row.approval_id, row.status, row.snapshot, to_jsonb(row)
    FROM frontend_external_action.approvals AS row
    WHERE row.resource_project_id = p_target_project_id
    UNION ALL
    SELECT 'preflights', row.action_id, row.preflight_id, NULL::text, row.snapshot, to_jsonb(row)
    FROM frontend_external_action.preflights AS row
    WHERE row.resource_project_id = p_target_project_id
    UNION ALL
    SELECT 'executions', row.action_id, row.execution_id, row.status, row.snapshot, to_jsonb(row)
    FROM frontend_external_action.executions AS row
    WHERE row.resource_project_id = p_target_project_id
    UNION ALL
    SELECT 'attempts', row.action_id, row.attempt_id, row.status, row.snapshot, to_jsonb(row)
    FROM frontend_external_action.attempts AS row
    WHERE row.resource_project_id = p_target_project_id
    UNION ALL
    SELECT 'verifications', row.action_id, row.verification_id, NULL::text, row.snapshot, to_jsonb(row)
    FROM frontend_external_action.verifications AS row
    WHERE row.resource_project_id = p_target_project_id
    UNION ALL
    SELECT 'results', row.action_id, row.result_id, NULL::text, row.snapshot, to_jsonb(row)
    FROM frontend_external_action.results AS row
    WHERE row.resource_project_id = p_target_project_id
    UNION ALL
    SELECT 'audit_events', row.action_id, row.audit_event_id, row.category, row.snapshot, to_jsonb(row)
    FROM frontend_external_action.audit_events AS row
    WHERE row.resource_project_id = p_target_project_id
    UNION ALL
    SELECT 'compensations', row.action_id, row.compensation_id, NULL::text, row.snapshot, to_jsonb(row)
    FROM frontend_external_action.compensations AS row
    WHERE row.resource_project_id = p_target_project_id
    UNION ALL
    SELECT 'rollbacks', row.action_id, row.rollback_id, row.status, row.snapshot, to_jsonb(row)
    FROM frontend_external_action.rollbacks AS row
    WHERE row.resource_project_id = p_target_project_id
  ),
  candidate_classification AS (
    SELECT candidate.action_id,
      bool_or(frontend_external_action.t3_jsonb_mentions_source_token(
        candidate.payload, source_tokens.values
      )) AS payload_mentions_source,
      bool_or(
        candidate.payload->>'schemaVersion' IS DISTINCT FROM '1.0.0'
        OR candidate.payload->>'actionId' IS DISTINCT FROM candidate.action_id
        OR NULLIF(candidate.payload->'generatedBy'->>'principalId', '') IS NULL
        OR NULLIF(candidate.payload->'generatedBy'->>'actorId', '') IS NULL
        OR jsonb_typeof(candidate.payload->'sourceRefs') IS DISTINCT FROM 'array'
        OR jsonb_typeof(candidate.payload->'evidenceRefs') IS DISTINCT FROM 'array'
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(candidate.payload->'sourceRefs') = 'array'
              THEN candidate.payload->'sourceRefs' ELSE '[]'::jsonb END
          ) AS source_ref(value)
          WHERE NULLIF(source_ref.value->>'sourceId', '') IS NULL
             OR NOT ((source_ref.value->>'sourceId') = ANY(source_tokens.values))
        )
        OR (
          jsonb_array_length(
            CASE WHEN jsonb_typeof(candidate.payload->'evidenceRefs') = 'array'
              THEN candidate.payload->'evidenceRefs' ELSE '[]'::jsonb END
          ) > 0
          AND jsonb_array_length(
            CASE WHEN jsonb_typeof(candidate.payload->'sourceRefs') = 'array'
              THEN candidate.payload->'sourceRefs' ELSE '[]'::jsonb END
          ) = 0
        )
      ) AS unresolved_lineage,
      bool_or(
        frontend_external_action.t3_jsonb_mentions_source_token(
          candidate.payload, source_tokens.values
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(candidate.payload->'sourceRefs') = 'array'
              THEN candidate.payload->'sourceRefs' ELSE '[]'::jsonb END
          ) AS source_ref(value)
          WHERE (source_ref.value->>'sourceId') = ANY(source_tokens.values)
        )
      ) AS source_linked
    FROM snapshot_rows AS candidate
    CROSS JOIN source_tokens
    WHERE candidate.table_name = 'candidates'
    GROUP BY candidate.action_id
  ),
  action_classification AS (
    SELECT action.action_id,
      bool_or(frontend_external_action.t3_jsonb_mentions_source_token(
        action.payload, source_tokens.values
      )) OR COALESCE(candidate.source_linked, false) AS source_linked,
      COALESCE(candidate.unresolved_lineage, false)
        OR bool_or(action.row_data->>'effective_project_id' IS DISTINCT FROM p_target_project_id)
        OR (
          candidate.action_id IS NULL
          AND NOT bool_and(
            action.table_name = 'audit_events'
            AND action.payload->>'payloadAvailability' = 'PURGED_BY_T3'
          )
        ) AS unresolved_lineage,
      bool_or(
        (action.table_name = 'aggregates'
          AND action.status IN ('EXECUTING', 'OUTCOME_UNKNOWN', 'CANCELLING', 'VERIFYING', 'ROLLING_BACK', 'COMPENSATING'))
        OR (action.table_name = 'executions' AND action.status IN ('PENDING', 'IN_PROGRESS'))
        OR (action.table_name = 'attempts' AND action.status IN ('PENDING', 'IN_PROGRESS'))
        OR (action.table_name = 'rollbacks' AND action.status IN ('EXECUTING', 'OUTCOME_UNKNOWN'))
      ) AS active,
      bool_or(
        action.table_name IN ('executions', 'attempts', 'verifications', 'results')
        OR (action.table_name = 'rollbacks' AND action.status IN (
          'EXECUTING', 'OUTCOME_UNKNOWN', 'ROLLED_BACK', 'FAILED'
        ))
        OR (action.table_name = 'audit_events' AND action.status IN (
          'ACTION_EXECUTION_CLAIMED', 'ACTION_EXECUTED', 'ACTION_OUTCOME_UNKNOWN',
          'ACTION_FAILED', 'ACTION_VERIFIED', 'ACTION_VERIFICATION_FAILED'
        ))
      ) AS external_effect_possible
    FROM snapshot_rows AS action
    CROSS JOIN source_tokens
    LEFT JOIN candidate_classification AS candidate ON candidate.action_id = action.action_id
    GROUP BY action.action_id, candidate.action_id, candidate.source_linked, candidate.unresolved_lineage
  ),
  linked AS (
    SELECT array_agg(action_id ORDER BY action_id) AS ids
    FROM action_classification WHERE source_linked
  ),
  unresolved AS (
    SELECT array_agg(action_id ORDER BY action_id) AS ids
    FROM action_classification WHERE unresolved_lineage AND NOT source_linked
  ),
  active AS (
    SELECT array_agg(action_id ORDER BY action_id) AS ids
    FROM action_classification WHERE active
  ),
  external_effect AS (
    SELECT array_agg(action_id ORDER BY action_id) AS ids
    FROM action_classification WHERE source_linked AND external_effect_possible
  ),
  linked_counts AS (
    SELECT count(*) FILTER (WHERE table_name <> 'audit_events') AS purge_rows,
           count(*) FILTER (WHERE table_name = 'audit_events') AS redacted_audit_rows
    FROM snapshot_rows
    WHERE action_id = ANY(COALESCE((SELECT ids FROM linked), ARRAY[]::text[]))
  ),
  all_rows AS (
    SELECT relation_name, row_id, row_data
    FROM (
      SELECT 'frontend_external_action.' || table_name AS relation_name,
             row_id, row_data
      FROM snapshot_rows
      UNION ALL
      SELECT 'frontend_external_action.history_payload_state',
             state.source_event_kind || ':' || state.source_event_id,
             to_jsonb(state)
      FROM frontend_external_action.history_payload_state AS state
      WHERE state.resource_project_id = p_target_project_id
    ) AS scoped_rows
  ),
  fingerprint AS (
    SELECT encode(pg_catalog.sha256(convert_to(
      COALESCE(string_agg(relation_name || ':' || row_id || ':' || row_data::text,
                          E'\n' ORDER BY relation_name, row_id), ''),
      'UTF8'
    )), 'hex') AS value
    FROM all_rows
  )
  SELECT jsonb_build_object(
    'actionCount', (SELECT count(DISTINCT action_id) FROM snapshot_rows),
    'linkedActionIds', COALESCE((SELECT ids FROM linked), ARRAY[]::text[]),
    'unclassifiedActionIds', COALESCE((SELECT ids FROM unresolved), ARRAY[]::text[]),
    'activeActionIds', COALESCE((SELECT ids FROM active), ARRAY[]::text[]),
    'externalEffectActionIds', COALESCE((SELECT ids FROM external_effect), ARRAY[]::text[]),
    'derivedRecords', (SELECT purge_rows FROM linked_counts),
    'redactedAuditRecords', (SELECT redacted_audit_rows FROM linked_counts),
    'fingerprint', (SELECT value FROM fingerprint)
  )
$$;

ALTER FUNCTION frontend_external_action.t3_project_action_analysis(text)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_external_action.t3_project_action_analysis(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_external_action.t3_project_action_impact(
  p_target_project_id text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, frontend_external_action
AS $$
  SELECT jsonb_build_object(
    'actionCount', analysis->'actionCount',
    'linkedActionCount', jsonb_array_length(analysis->'linkedActionIds'),
    'unclassifiedActionCount', jsonb_array_length(analysis->'unclassifiedActionIds'),
    'activeActionCount', jsonb_array_length(analysis->'activeActionIds'),
    'externalEffectActionCount', jsonb_array_length(analysis->'externalEffectActionIds'),
    'derivedRecords', analysis->'derivedRecords',
    'redactedAuditRecords', analysis->'redactedAuditRecords',
    'fingerprint', analysis->'fingerprint'
  )
  FROM (SELECT frontend_external_action.t3_project_action_analysis(p_target_project_id) AS analysis) AS result
$$;

ALTER FUNCTION frontend_external_action.t3_project_action_impact(text)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_external_action.t3_project_action_impact(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION frontend_external_action.t3_project_action_impact(text) TO shotgun_runtime;

CREATE OR REPLACE FUNCTION frontend_external_action.t3_project_action_status(
  p_target_project_id text,
  p_reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, frontend_external_action
AS $$
DECLARE
  request_state text;
  epoch_state text;
  analysis jsonb;
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
  WHERE request.project_id = p_target_project_id
    AND request.request_id = p_reset_request_id
    AND request.owner_manifest_digest IS NOT NULL;
  IF request_state IS NULL
     OR request_state NOT IN ('FENCING', 'PURGING', 'REBUILDING', 'VERIFYING')
     OR epoch_state IS DISTINCT FROM 'RESET_PENDING' THEN
    RAISE EXCEPTION 'External Action status is unavailable outside active maintenance'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;

  analysis := frontend_external_action.t3_project_action_analysis(p_target_project_id);
  RETURN jsonb_build_object(
    'actionCount', analysis->'actionCount',
    'linkedActionCount', jsonb_array_length(analysis->'linkedActionIds'),
    'unclassifiedActionCount', jsonb_array_length(analysis->'unclassifiedActionIds'),
    'activeActionCount', jsonb_array_length(analysis->'activeActionIds'),
    'externalEffectActionCount', jsonb_array_length(analysis->'externalEffectActionIds'),
    'derivedRecords', analysis->'derivedRecords',
    'redactedAuditRecords', analysis->'redactedAuditRecords',
    'fingerprint', analysis->'fingerprint'
  );
END
$$;

ALTER FUNCTION frontend_external_action.t3_project_action_status(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_external_action.t3_project_action_status(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_external_action.t3_snapshot_project_actions(
  p_target_project_id text,
  p_reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, frontend_external_action
AS $$
DECLARE
  request_state text;
  epoch_state text;
  analysis jsonb;
  active_ids text[];
  external_ids text[];
  unresolved_ids text[];
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
  WHERE request.project_id = p_target_project_id
    AND request.request_id = p_reset_request_id
    AND request.owner_manifest_digest IS NOT NULL;
  IF request_state IS NULL
     OR request_state NOT IN ('FENCING', 'PURGING', 'REBUILDING', 'VERIFYING')
     OR epoch_state IS DISTINCT FROM 'RESET_PENDING' THEN
    RAISE EXCEPTION 'External Action snapshot is unavailable outside active maintenance'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;

  analysis := frontend_external_action.t3_project_action_analysis(p_target_project_id);
  active_ids := ARRAY(SELECT jsonb_array_elements_text(analysis->'activeActionIds'));
  external_ids := ARRAY(SELECT jsonb_array_elements_text(analysis->'externalEffectActionIds'));
  unresolved_ids := ARRAY(SELECT jsonb_array_elements_text(analysis->'unclassifiedActionIds'));
  IF cardinality(active_ids) > 0 THEN
    RAISE EXCEPTION 'External Action work has not reached a known terminal state'
      USING ERRCODE = '55000', CONSTRAINT = 'active_job_outcome_unknown';
  END IF;
  IF cardinality(external_ids) > 0 THEN
    RAISE EXCEPTION 'Source-linked External Action may have produced an external effect'
      USING ERRCODE = '55000', CONSTRAINT = 'external_action_dependency';
  END IF;
  IF cardinality(unresolved_ids) > 0 THEN
    RAISE EXCEPTION 'External Action lineage is ambiguous'
      USING ERRCODE = '55000', CONSTRAINT = 't3_external_action_unclassified';
  END IF;

  UPDATE project_admin.project_knowledge_reset_requests
  SET step_checkpoints = jsonb_set(
        jsonb_set(
          jsonb_set(step_checkpoints, '{externalActionActionIds}', analysis->'linkedActionIds', true),
          '{externalActionFingerprint}', analysis->'fingerprint', true
        ),
        '{externalActionSnapshotComplete}', 'true'::jsonb, true
      ),
      updated_at = clock_timestamp()
  WHERE project_id = p_target_project_id
    AND request_id = p_reset_request_id
    AND state <> 'COMPLETE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'External Action snapshot target was not found'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_found';
  END IF;

  RETURN jsonb_build_object(
    'linkedActionCount', jsonb_array_length(analysis->'linkedActionIds'),
    'derivedRecords', analysis->'derivedRecords',
    'redactedAuditRecords', analysis->'redactedAuditRecords',
    'fingerprint', analysis->'fingerprint'
  );
END
$$;

ALTER FUNCTION frontend_external_action.t3_snapshot_project_actions(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_external_action.t3_snapshot_project_actions(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_external_action.t3_erase_project_actions(
  p_target_project_id text,
  p_reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, frontend_external_action
AS $$
DECLARE
  request project_admin.project_knowledge_reset_requests%ROWTYPE;
  target_action_ids text[];
  affected bigint;
  deleted jsonb := '{}'::jsonb;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;

  PERFORM set_config('shotgun.t3_reset_request_id', p_reset_request_id::text, true);
  IF NOT project_admin.t3_reset_write_authorized(p_target_project_id) THEN
    RAISE EXCEPTION 'Approved Source knowledge reset request is not active'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;

  SELECT * INTO request
  FROM project_admin.project_knowledge_reset_requests
  WHERE project_id = p_target_project_id AND request_id = p_reset_request_id
  FOR UPDATE;
  IF NOT FOUND OR request.step_checkpoints->>'externalActionSnapshotComplete' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'External Action snapshot is missing'
      USING ERRCODE = '55000', CONSTRAINT = 't3_external_action_snapshot_missing';
  END IF;
  target_action_ids := ARRAY(
    SELECT jsonb_array_elements_text(request.step_checkpoints->'externalActionActionIds')
  );

  IF cardinality(target_action_ids) = 0 THEN
    RETURN jsonb_build_object('deleted', deleted, 'redactedAuditRecords', 0);
  END IF;

  IF EXISTS (
    SELECT 1 FROM frontend_external_action.executions
    WHERE resource_project_id = p_target_project_id AND action_id = ANY(target_action_ids)
    UNION ALL
    SELECT 1 FROM frontend_external_action.compensations
    WHERE resource_project_id = p_target_project_id AND action_id = ANY(target_action_ids)
    UNION ALL
    SELECT 1 FROM frontend_external_action.rollbacks
    WHERE resource_project_id = p_target_project_id AND action_id = ANY(target_action_ids)
  ) THEN
    RAISE EXCEPTION 'Source-linked External Action acquired an external effect before purge'
      USING ERRCODE = '55000', CONSTRAINT = 'external_action_dependency';
  END IF;

  UPDATE frontend_external_action.audit_events
  SET snapshot = jsonb_build_object(
        'schemaVersion', '1.0.0',
        'payloadAvailability', 'PURGED_BY_T3'
      )
  WHERE resource_project_id = p_target_project_id
    AND action_id = ANY(target_action_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('redactedAuditRecords', affected);

  UPDATE frontend_external_action.history_payload_state AS state
  SET payload_availability = 'PURGED_BY_POLICY',
      tombstone_metadata = jsonb_build_object(
        'policy', 'T3-ADR-171', 'requestId', p_reset_request_id::text
      ),
      changed_at = clock_timestamp(),
      reason = 'T3_SOURCE_KNOWLEDGE_RESET',
      policy_revision = 'T3-ADR-171'
  WHERE state.resource_project_id = p_target_project_id
    AND state.source_event_id IN (
      SELECT event.audit_event_id
      FROM frontend_external_action.audit_events AS event
      WHERE event.resource_project_id = p_target_project_id
        AND event.action_id = ANY(target_action_ids)
    );
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('redactedHistoryPayloadStates', affected);

  DELETE FROM frontend_external_action.attempts
  WHERE resource_project_id = p_target_project_id AND action_id = ANY(target_action_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('attempts', affected);
  DELETE FROM frontend_external_action.executions
  WHERE resource_project_id = p_target_project_id AND action_id = ANY(target_action_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('executions', affected);
  DELETE FROM frontend_external_action.verifications
  WHERE resource_project_id = p_target_project_id AND action_id = ANY(target_action_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('verifications', affected);
  DELETE FROM frontend_external_action.results
  WHERE resource_project_id = p_target_project_id AND action_id = ANY(target_action_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('results', affected);
  DELETE FROM frontend_external_action.preflights
  WHERE resource_project_id = p_target_project_id AND action_id = ANY(target_action_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('preflights', affected);
  DELETE FROM frontend_external_action.approvals
  WHERE resource_project_id = p_target_project_id AND action_id = ANY(target_action_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('approvals', affected);
  DELETE FROM frontend_external_action.manifests
  WHERE resource_project_id = p_target_project_id AND action_id = ANY(target_action_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('manifests', affected);
  DELETE FROM frontend_external_action.risk_decisions
  WHERE resource_project_id = p_target_project_id AND action_id = ANY(target_action_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('riskDecisions', affected);
  DELETE FROM frontend_external_action.candidates
  WHERE resource_project_id = p_target_project_id AND action_id = ANY(target_action_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('candidates', affected);
  DELETE FROM frontend_external_action.compensations
  WHERE resource_project_id = p_target_project_id AND action_id = ANY(target_action_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('compensations', affected);
  DELETE FROM frontend_external_action.rollbacks
  WHERE resource_project_id = p_target_project_id AND action_id = ANY(target_action_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('rollbacks', affected);
  DELETE FROM frontend_external_action.aggregates
  WHERE resource_project_id = p_target_project_id AND action_id = ANY(target_action_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('aggregates', affected);

  RETURN jsonb_build_object(
    'deleted', deleted,
    'redactedAuditRecords', COALESCE((deleted->>'redactedAuditRecords')::bigint, 0)
  );
END
$$;

ALTER FUNCTION frontend_external_action.t3_erase_project_actions(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_external_action.t3_erase_project_actions(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_external_action.t3_guard_project_knowledge_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
DECLARE
  target_project_id text;
  previous_project_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_project_id := COALESCE(to_jsonb(OLD)->>'resource_project_id', to_jsonb(OLD)->>'project_id');
  ELSE
    target_project_id := COALESCE(to_jsonb(NEW)->>'resource_project_id', to_jsonb(NEW)->>'project_id');
  END IF;
  IF TG_OP = 'UPDATE' THEN
    previous_project_id := COALESCE(to_jsonb(OLD)->>'resource_project_id', to_jsonb(OLD)->>'project_id');
    IF previous_project_id IS DISTINCT FROM target_project_id THEN
      RAISE EXCEPTION 'External Action Project binding is immutable'
        USING ERRCODE = '55000', CONSTRAINT = 't3_external_action_project_binding_immutable';
    END IF;
  END IF;
  IF target_project_id IS NULL THEN
    RAISE EXCEPTION 'External Action write has no Project identity'
      USING ERRCODE = '55000', CONSTRAINT = 't3_external_action_project_scope_missing';
  END IF;
  IF project_admin.t3_reset_write_authorized(target_project_id) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM project_admin.project_knowledge_epoch AS epoch
    WHERE epoch.project_id = target_project_id AND epoch.state <> 'READY'
  ) THEN
    RAISE EXCEPTION 'Project knowledge reset fences External Action writes'
      USING ERRCODE = '55000', CONSTRAINT = 'project_knowledge_reset_write_fence';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
$$;

ALTER FUNCTION frontend_external_action.t3_guard_project_knowledge_write()
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_external_action.t3_guard_project_knowledge_write() FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_external_action.block_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND session_user = 'shotgun_erasure_executor'
     AND OLD.audit_event_id = NEW.audit_event_id
     AND OLD.action_id = NEW.action_id
     AND OLD.resource_project_id = NEW.resource_project_id
     AND OLD.effective_project_id = NEW.effective_project_id
     AND OLD.sequence = NEW.sequence
     AND OLD.category = NEW.category
     AND OLD.occurred_at = NEW.occurred_at
     AND NEW.snapshot = jsonb_build_object(
       'schemaVersion', '1.0.0', 'payloadAvailability', 'PURGED_BY_T3'
     )
     AND project_admin.t3_reset_write_authorized(OLD.resource_project_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'frontend_external_action.audit_events is append-only and immutable'
    USING ERRCODE = '55000';
END
$$;

ALTER FUNCTION frontend_external_action.block_audit_mutation() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_external_action.block_audit_mutation() FROM PUBLIC;

DO $$
DECLARE
  relation record;
BEGIN
  FOR relation IN
    SELECT DISTINCT table_schema, table_name
    FROM information_schema.columns
    WHERE table_schema = 'frontend_external_action'
      AND column_name = 'resource_project_id'
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS t3_project_knowledge_write_fence ON %I.%I',
      relation.table_schema, relation.table_name
    );
    EXECUTE format(
      'CREATE TRIGGER t3_project_knowledge_write_fence '
      'BEFORE INSERT OR UPDATE OR DELETE ON %I.%I '
      'FOR EACH ROW EXECUTE FUNCTION frontend_external_action.t3_guard_project_knowledge_write()',
      relation.table_schema, relation.table_name
    );
  END LOOP;
END
$$;

GRANT USAGE ON SCHEMA frontend_external_action, asset, project_admin TO shotgun_schema_owner;
GRANT USAGE ON SCHEMA frontend_external_action TO shotgun_erasure_executor, shotgun_runtime;
GRANT USAGE ON SCHEMA project_admin TO shotgun_erasure_executor;
GRANT SELECT ON asset.sources, asset.source_versions TO shotgun_schema_owner;
GRANT SELECT, UPDATE ON project_admin.project_knowledge_reset_requests TO shotgun_schema_owner;
GRANT SELECT ON project_admin.project_knowledge_epoch TO shotgun_schema_owner;
GRANT SELECT, DELETE ON frontend_external_action.aggregates,
  frontend_external_action.candidates, frontend_external_action.risk_decisions,
  frontend_external_action.manifests, frontend_external_action.approvals,
  frontend_external_action.preflights, frontend_external_action.executions,
  frontend_external_action.attempts, frontend_external_action.verifications,
  frontend_external_action.results, frontend_external_action.compensations,
  frontend_external_action.rollbacks
  TO shotgun_schema_owner;
GRANT SELECT, UPDATE ON frontend_external_action.history_payload_state TO shotgun_schema_owner;
GRANT SELECT, UPDATE ON frontend_external_action.audit_events TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION project_admin.t3_reset_write_authorized(text)
  TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION frontend_external_action.t3_project_action_status(text, uuid),
  frontend_external_action.t3_snapshot_project_actions(text, uuid),
  frontend_external_action.t3_erase_project_actions(text, uuid)
  TO shotgun_erasure_executor;
GRANT EXECUTE ON FUNCTION frontend_external_action.t3_project_action_analysis(text),
  frontend_external_action.t3_jsonb_mentions_source_token(jsonb, text[])
  TO shotgun_schema_owner;
