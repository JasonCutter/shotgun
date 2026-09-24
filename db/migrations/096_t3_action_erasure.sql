DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1 FROM runtime.schema_migrations
    WHERE name = '095_t3_external_action_erasure.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 096 preflight failed: migration 095 is not registered';
  END IF;
END
$$;

-- Keep the governed Action identity and append-only audit identity while
-- allowing the T3 erasure request to tombstone a Source-derived execution.
ALTER TABLE action.executions DROP CONSTRAINT executions_status_check;

ALTER TABLE action.executions
  ADD CONSTRAINT action_executions_status_t3_check CHECK (status IN (
    'PREVIEW_READY', 'APPROVED', 'EXECUTING', 'PREFLIGHT_FAILED', 'EXECUTED',
    'OUTCOME_UNKNOWN', 'FAILED', 'VERIFIED', 'VERIFICATION_FAILED', 'SOURCE_RESET'
  ));

-- A reset tombstone preserves the old Action identity for append-only audit
-- foreign keys. It must not prevent a newly ingested Source from producing a
-- fresh execution for the same candidate revision.
ALTER TABLE action.executions
  DROP CONSTRAINT executions_project_id_candidate_id_candidate_revision_key;
CREATE UNIQUE INDEX action_executions_live_candidate_revision_key
  ON action.executions (project_id, candidate_id, candidate_revision)
  WHERE status <> 'SOURCE_RESET';

CREATE OR REPLACE FUNCTION action.t3_jsonb_mentions_source_token(
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

ALTER FUNCTION action.t3_jsonb_mentions_source_token(jsonb, text[])
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION action.t3_jsonb_mentions_source_token(jsonb, text[])
  FROM PUBLIC;

CREATE OR REPLACE FUNCTION action.t3_project_action_analysis(p_target_project_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, action, asset, evidence
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
      JOIN asset.sources AS source ON source.source_id = version.source_id
      WHERE source.project_id = p_target_project_id
      UNION
      SELECT span.evidence_id::text
      FROM evidence.spans AS span
      WHERE span.project_id = p_target_project_id
    ) AS tokens
  ),
  candidate_rows AS (
    SELECT candidate.project_id, candidate.candidate_id, candidate.candidate_json AS payload,
           to_jsonb(candidate) AS row_data
    FROM action.candidates AS candidate
    WHERE candidate.project_id = p_target_project_id
  ),
  candidate_classification AS (
    SELECT candidate.project_id, candidate.candidate_id,
      action.t3_jsonb_mentions_source_token(candidate.payload, source_tokens.values)
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(candidate.payload->'evidence') = 'array'
              THEN candidate.payload->'evidence' ELSE '[]'::jsonb END
          ) AS evidence_ref(value)
          WHERE evidence_ref.value->>'evidenceId' = ANY(source_tokens.values)
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(candidate.payload #> '{candidate,validation,evidenceIds}') = 'array'
              THEN candidate.payload #> '{candidate,validation,evidenceIds}' ELSE '[]'::jsonb END
          ) AS evidence_id(value)
          WHERE evidence_id.value = ANY(source_tokens.values)
        ) AS source_linked,
      (
        candidate.payload->>'projectId' IS DISTINCT FROM p_target_project_id
        OR candidate.payload->'candidate'->>'candidateId' IS DISTINCT FROM candidate.candidate_id
        OR jsonb_typeof(candidate.payload->'evidence') IS DISTINCT FROM 'array'
        OR jsonb_typeof(candidate.payload #> '{candidate,validation,evidenceIds}') IS DISTINCT FROM 'array'
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(candidate.payload->'evidence') = 'array'
              THEN candidate.payload->'evidence' ELSE '[]'::jsonb END
          ) AS evidence_ref(value)
          WHERE NULLIF(evidence_ref.value->>'evidenceId', '') IS NULL
             OR NOT ((evidence_ref.value->>'evidenceId') = ANY(source_tokens.values))
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(
            CASE WHEN jsonb_typeof(candidate.payload #> '{candidate,validation,evidenceIds}') = 'array'
              THEN candidate.payload #> '{candidate,validation,evidenceIds}' ELSE '[]'::jsonb END
          ) AS evidence_id(value)
          WHERE evidence_id.value <> ALL(source_tokens.values)
        )
      ) AS unclassified
    FROM candidate_rows AS candidate
    CROSS JOIN source_tokens
  ),
  action_rows AS (
    SELECT 'executions'::text AS table_name, execution.action_id::text AS action_id,
           execution.action_id::text AS row_id, execution.status,
           execution.candidate_id, execution.record_json AS payload, to_jsonb(execution) AS row_data
    FROM action.executions AS execution
    WHERE execution.project_id = p_target_project_id
    UNION ALL
    SELECT 'preview_snapshots', snapshot.action_id::text, snapshot.snapshot_id::text,
           NULL::text, execution.candidate_id, snapshot.snapshot_json, to_jsonb(snapshot)
    FROM action.preview_snapshots AS snapshot
    JOIN action.executions AS execution ON execution.action_id = snapshot.action_id
    WHERE snapshot.project_id = p_target_project_id
    UNION ALL
    SELECT 'approvals', approval.action_id::text, approval.token_id::text,
           NULL::text, execution.candidate_id, approval.approval_json, to_jsonb(approval)
    FROM action.approvals AS approval
    JOIN action.executions AS execution ON execution.action_id = approval.action_id
    WHERE execution.project_id = p_target_project_id
    UNION ALL
    SELECT 'approval_records', approval.action_id::text, approval.approval_id::text,
           NULL::text, execution.candidate_id, approval.approval_json, to_jsonb(approval)
    FROM action.approval_records AS approval
    JOIN action.executions AS execution ON execution.action_id = approval.action_id
    WHERE execution.project_id = p_target_project_id
    UNION ALL
    SELECT 'audit_events', audit.action_id::text, audit.audit_event_id::text,
           audit.category, execution.candidate_id, audit.event_json, to_jsonb(audit)
    FROM action.audit_events AS audit
    JOIN action.executions AS execution ON execution.action_id = audit.action_id
    WHERE audit.project_id = p_target_project_id
    UNION ALL
    SELECT 'feedback_outbox', outbox.action_id::text, outbox.outbox_id,
           outbox.status, execution.candidate_id, outbox.payload_json, to_jsonb(outbox)
    FROM action.action_feedback_outbox AS outbox
    JOIN action.executions AS execution ON execution.action_id = outbox.action_id
    WHERE outbox.project_id = p_target_project_id
    UNION ALL
    SELECT 'review_work_items', work_item.action_id, work_item.work_item_id::text,
           work_item.status, work_item.action_id,
           jsonb_build_object('evidenceRef', work_item.evidence_ref, 'status', work_item.status),
           to_jsonb(work_item)
    FROM action.action_review_work_items AS work_item
    WHERE work_item.project_id = p_target_project_id
  ),
  action_classification AS (
    SELECT action_row.action_id,
      bool_or(
        action.t3_jsonb_mentions_source_token(action_row.payload, source_tokens.values)
        OR COALESCE(candidate.source_linked, false)
      ) AS source_linked,
      bool_or(
        (action_row.table_name = 'executions' AND (
          candidate.candidate_id IS NULL OR COALESCE(candidate.unclassified, true)
          OR action_row.payload->>'projectId' IS DISTINCT FROM p_target_project_id
          OR action_row.payload->'preview'->>'projectId' IS DISTINCT FROM p_target_project_id
        ))
      ) AS unclassified,
      bool_or(
        (action_row.table_name = 'executions'
          AND action_row.status IN ('EXECUTING', 'OUTCOME_UNKNOWN'))
        OR (action_row.table_name = 'feedback_outbox' AND action_row.status = 'processing')
      ) AS active,
      bool_or(
        (action_row.table_name = 'executions' AND action_row.status IN (
          'EXECUTED', 'OUTCOME_UNKNOWN', 'FAILED', 'VERIFIED', 'VERIFICATION_FAILED'
        ))
        OR (action_row.table_name = 'executions' AND (
          action_row.payload ? 'providerResult' OR action_row.payload ? 'verification'
        ))
        OR (action_row.table_name = 'audit_events' AND action_row.status IN (
          'ACTION_EXECUTION_CLAIMED', 'ACTION_EXECUTED', 'ACTION_OUTCOME_UNKNOWN',
          'ACTION_FAILED', 'ACTION_VERIFIED', 'ACTION_VERIFICATION_FAILED'
        ))
      ) AS external_effect_possible,
      bool_and(
        action_row.table_name IN ('executions', 'audit_events')
        AND action_row.payload->>'payloadAvailability' = 'PURGED_BY_T3'
      ) AS t3_tombstoned
    FROM action_rows AS action_row
    CROSS JOIN source_tokens
    LEFT JOIN candidate_classification AS candidate
      ON candidate.project_id = p_target_project_id
     AND candidate.candidate_id = action_row.candidate_id
    GROUP BY action_row.action_id
  ),
  linked_candidates AS (
    SELECT array_agg(candidate_id ORDER BY candidate_id) AS ids
    FROM candidate_classification WHERE source_linked
  ),
  unresolved_candidates AS (
    SELECT array_agg(candidate_id ORDER BY candidate_id) AS ids
    FROM candidate_classification WHERE unclassified
  ),
  linked_actions AS (
    SELECT array_agg(action_id ORDER BY action_id) AS ids
    FROM action_classification WHERE source_linked
  ),
  unresolved_actions AS (
    SELECT array_agg(action_id ORDER BY action_id) AS ids
    FROM action_classification WHERE unclassified AND NOT t3_tombstoned
  ),
  active_actions AS (
    SELECT array_agg(action_id ORDER BY action_id) AS ids
    FROM action_classification WHERE active AND source_linked
  ),
  external_effect_actions AS (
    SELECT array_agg(action_id ORDER BY action_id) AS ids
    FROM action_classification WHERE external_effect_possible AND source_linked AND NOT t3_tombstoned
  ),
  linked_work_items AS (
    SELECT array_agg(work_item.work_item_id::text ORDER BY work_item.work_item_id::text) AS ids
    FROM action.action_review_work_items AS work_item
    LEFT JOIN action_classification AS action_status ON action_status.action_id = work_item.action_id
    CROSS JOIN source_tokens
    WHERE work_item.project_id = p_target_project_id
      AND (COALESCE(action_status.source_linked, false)
        OR work_item.evidence_ref = ANY(source_tokens.values))
  ),
  unresolved_work_items AS (
    SELECT array_agg(work_item.work_item_id::text ORDER BY work_item.work_item_id::text) AS ids
    FROM action.action_review_work_items AS work_item
    LEFT JOIN action_classification AS action_status ON action_status.action_id = work_item.action_id
    CROSS JOIN source_tokens
    WHERE work_item.project_id = p_target_project_id
      AND action_status.action_id IS NULL
      AND work_item.evidence_ref <> ALL(source_tokens.values)
  ),
  linked_counts AS (
    SELECT
      (SELECT count(*) FROM candidate_classification WHERE source_linked)
        + (SELECT count(*) FROM action_rows AS action_row
            WHERE action_row.table_name <> 'audit_events'
              AND action_row.action_id = ANY(
                COALESCE((SELECT ids FROM linked_actions), ARRAY[]::text[])
              )) AS derived_records,
      (SELECT count(*) FROM action.audit_events AS audit
        WHERE audit.project_id = p_target_project_id
          AND audit.action_id::text = ANY(COALESCE((SELECT ids FROM linked_actions), ARRAY[]::text[])))
        AS audit_records
  ),
  all_rows AS (
    SELECT relation_name, row_id, row_data
    FROM (
      SELECT 'action.candidates'::text AS relation_name,
             candidate_id AS row_id, row_data
      FROM candidate_rows
      UNION ALL
      SELECT 'action.' || table_name, row_id, row_data FROM action_rows
      UNION ALL
      SELECT 'action.action_review_work_items', work_item.work_item_id::text, to_jsonb(work_item)
      FROM action.action_review_work_items AS work_item
      WHERE work_item.project_id = p_target_project_id
    ) AS scoped
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
    'candidateCount', (SELECT count(*) FROM candidate_rows),
    'actionCount', (SELECT count(*) FROM action.executions WHERE project_id = p_target_project_id),
    'linkedCandidateIds', COALESCE((SELECT ids FROM linked_candidates), ARRAY[]::text[]),
    'unclassifiedCandidateIds', COALESCE((SELECT ids FROM unresolved_candidates), ARRAY[]::text[]),
    'linkedActionIds', COALESCE((SELECT ids FROM linked_actions), ARRAY[]::text[]),
    'unclassifiedActionIds', COALESCE((SELECT ids FROM unresolved_actions), ARRAY[]::text[]),
    'activeActionIds', COALESCE((SELECT ids FROM active_actions), ARRAY[]::text[]),
    'externalEffectActionIds', COALESCE((SELECT ids FROM external_effect_actions), ARRAY[]::text[]),
    'linkedWorkItemIds', COALESCE((SELECT ids FROM linked_work_items), ARRAY[]::text[]),
    'unclassifiedWorkItemIds', COALESCE((SELECT ids FROM unresolved_work_items), ARRAY[]::text[]),
    'derivedRecords', (SELECT derived_records FROM linked_counts),
    'redactedAuditRecords', (SELECT audit_records FROM linked_counts),
    'fingerprint', (SELECT value FROM fingerprint)
  )
$$;

ALTER FUNCTION action.t3_project_action_analysis(text) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION action.t3_project_action_analysis(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION action.t3_project_action_impact(p_target_project_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, action
AS $$
  SELECT jsonb_build_object(
    'candidateCount', analysis->'candidateCount',
    'actionCount', analysis->'actionCount',
    'linkedCandidateCount', jsonb_array_length(analysis->'linkedCandidateIds'),
    'linkedActionCount', jsonb_array_length(analysis->'linkedActionIds'),
    'unclassifiedCandidateCount', jsonb_array_length(analysis->'unclassifiedCandidateIds'),
    'unclassifiedActionCount', jsonb_array_length(analysis->'unclassifiedActionIds'),
    'unclassifiedWorkItemCount', jsonb_array_length(analysis->'unclassifiedWorkItemIds'),
    'activeActionCount', jsonb_array_length(analysis->'activeActionIds'),
    'externalEffectActionCount', jsonb_array_length(analysis->'externalEffectActionIds'),
    'derivedRecords', analysis->'derivedRecords',
    'redactedAuditRecords', analysis->'redactedAuditRecords',
    'fingerprint', analysis->'fingerprint'
  )
  FROM (SELECT action.t3_project_action_analysis(p_target_project_id) AS analysis) AS result
$$;

ALTER FUNCTION action.t3_project_action_impact(text) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION action.t3_project_action_impact(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION action.t3_project_action_impact(text) TO shotgun_runtime;

CREATE OR REPLACE FUNCTION action.t3_project_action_status(
  p_target_project_id text,
  p_reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, action
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
    RAISE EXCEPTION 'Action status is unavailable outside active maintenance'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;
  analysis := action.t3_project_action_analysis(p_target_project_id);
  RETURN jsonb_build_object(
    'candidateCount', analysis->'candidateCount',
    'actionCount', analysis->'actionCount',
    'linkedCandidateCount', jsonb_array_length(analysis->'linkedCandidateIds'),
    'linkedActionCount', jsonb_array_length(analysis->'linkedActionIds'),
    'unclassifiedCandidateCount', jsonb_array_length(analysis->'unclassifiedCandidateIds'),
    'unclassifiedActionCount', jsonb_array_length(analysis->'unclassifiedActionIds'),
    'unclassifiedWorkItemCount', jsonb_array_length(analysis->'unclassifiedWorkItemIds'),
    'activeActionCount', jsonb_array_length(analysis->'activeActionIds'),
    'externalEffectActionCount', jsonb_array_length(analysis->'externalEffectActionIds'),
    'derivedRecords', analysis->'derivedRecords',
    'redactedAuditRecords', analysis->'redactedAuditRecords',
    'fingerprint', analysis->'fingerprint'
  );
END
$$;

ALTER FUNCTION action.t3_project_action_status(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION action.t3_project_action_status(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION action.t3_snapshot_project_actions(
  p_target_project_id text,
  p_reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, action
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
    RAISE EXCEPTION 'Action snapshot is unavailable outside active maintenance'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;
  analysis := action.t3_project_action_analysis(p_target_project_id);
  IF jsonb_array_length(analysis->'activeActionIds') > 0 THEN
    RAISE EXCEPTION 'Action work has not reached a known terminal state'
      USING ERRCODE = '55000', CONSTRAINT = 'active_job_outcome_unknown';
  END IF;
  IF jsonb_array_length(analysis->'externalEffectActionIds') > 0 THEN
    RAISE EXCEPTION 'Source-linked Action may have produced an external effect'
      USING ERRCODE = '55000', CONSTRAINT = 'external_action_dependency';
  END IF;
  IF jsonb_array_length(analysis->'unclassifiedCandidateIds') > 0
     OR jsonb_array_length(analysis->'unclassifiedActionIds') > 0
     OR jsonb_array_length(analysis->'unclassifiedWorkItemIds') > 0 THEN
    RAISE EXCEPTION 'Action lineage is incomplete or ambiguous'
      USING ERRCODE = '55000', CONSTRAINT = 't3_action_unclassified';
  END IF;

  UPDATE project_admin.project_knowledge_reset_requests
  SET step_checkpoints = jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(step_checkpoints, '{actionCandidateIds}', analysis->'linkedCandidateIds', true),
              '{actionActionIds}', analysis->'linkedActionIds', true
            ),
            '{actionWorkItemIds}', analysis->'linkedWorkItemIds', true
          ),
          '{actionFingerprint}', analysis->'fingerprint', true
        ),
        '{actionSnapshotComplete}', 'true'::jsonb, true
      ),
      updated_at = clock_timestamp()
  WHERE project_id = p_target_project_id
    AND request_id = p_reset_request_id
    AND state <> 'COMPLETE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Action snapshot target was not found'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_found';
  END IF;
  RETURN jsonb_build_object(
    'linkedCandidateCount', jsonb_array_length(analysis->'linkedCandidateIds'),
    'linkedActionCount', jsonb_array_length(analysis->'linkedActionIds'),
    'linkedWorkItemCount', jsonb_array_length(analysis->'linkedWorkItemIds'),
    'derivedRecords', analysis->'derivedRecords',
    'redactedAuditRecords', analysis->'redactedAuditRecords',
    'fingerprint', analysis->'fingerprint'
  );
END
$$;

ALTER FUNCTION action.t3_snapshot_project_actions(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION action.t3_snapshot_project_actions(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION action.t3_erase_project_actions(
  p_target_project_id text,
  p_reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, action
AS $$
DECLARE
  request project_admin.project_knowledge_reset_requests%ROWTYPE;
  target_action_ids text[];
  target_candidate_ids text[];
  target_work_item_ids text[];
  affected bigint;
  reset_digest text := 'sha256:' || repeat('0', 64);
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
  IF NOT FOUND OR request.step_checkpoints->>'actionSnapshotComplete' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Action snapshot is missing'
      USING ERRCODE = '55000', CONSTRAINT = 't3_action_snapshot_missing';
  END IF;
  target_action_ids := ARRAY(
    SELECT jsonb_array_elements_text(request.step_checkpoints->'actionActionIds')
  );
  target_candidate_ids := ARRAY(
    SELECT jsonb_array_elements_text(request.step_checkpoints->'actionCandidateIds')
  );
  target_work_item_ids := ARRAY(
    SELECT jsonb_array_elements_text(request.step_checkpoints->'actionWorkItemIds')
  );

  IF EXISTS (
    SELECT 1 FROM action.executions
    WHERE project_id = p_target_project_id
      AND action_id::text = ANY(target_action_ids)
      AND status IN ('EXECUTING', 'EXECUTED', 'OUTCOME_UNKNOWN', 'FAILED', 'VERIFIED', 'VERIFICATION_FAILED')
  ) OR EXISTS (
    SELECT 1 FROM action.audit_events
    WHERE project_id = p_target_project_id
      AND action_id::text = ANY(target_action_ids)
      AND category IN (
        'ACTION_EXECUTION_CLAIMED', 'ACTION_EXECUTED', 'ACTION_OUTCOME_UNKNOWN',
        'ACTION_FAILED', 'ACTION_VERIFIED', 'ACTION_VERIFICATION_FAILED'
      )
  ) THEN
    RAISE EXCEPTION 'Source-linked Action acquired an external effect before purge'
      USING ERRCODE = '55000', CONSTRAINT = 'external_action_dependency';
  END IF;

  UPDATE action.executions AS execution
  SET status = 'SOURCE_RESET',
      candidate_digest = reset_digest,
      target_digest = reset_digest,
      parameter_digest = reset_digest,
      preview_digest = reset_digest,
      record_json = jsonb_build_object(
        'schemaVersion', 't3-action-reset-tombstone-v1',
        'actionId', execution.action_id::text,
        'projectId', execution.project_id,
        'status', 'SOURCE_RESET',
        'payloadAvailability', 'PURGED_BY_T3',
        'resetRequestId', p_reset_request_id::text,
        'createdAt', execution.created_at,
        'updatedAt', execution.updated_at,
        'canonicalWrite', false
      )
  WHERE execution.project_id = p_target_project_id
    AND execution.action_id::text = ANY(target_action_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('tombstonedExecutions', affected);

  UPDATE action.audit_events AS audit
  SET event_json = jsonb_build_object(
        'schemaVersion', '1.0.0',
        'payloadAvailability', 'PURGED_BY_T3',
        'resetRequestId', p_reset_request_id::text
      )
  WHERE audit.project_id = p_target_project_id
    AND audit.action_id::text = ANY(target_action_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('redactedAuditEvents', affected);

  DELETE FROM action.action_feedback_outbox
  WHERE project_id = p_target_project_id AND action_id::text = ANY(target_action_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('feedbackOutbox', affected);
  DELETE FROM action.action_review_work_items
  WHERE project_id = p_target_project_id
    AND work_item_id::text = ANY(target_work_item_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('reviewWorkItems', affected);
  DELETE FROM action.approval_records AS approval
  USING action.executions AS execution
  WHERE execution.action_id = approval.action_id
    AND execution.project_id = p_target_project_id
    AND execution.action_id::text = ANY(target_action_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('approvalRecords', affected);
  DELETE FROM action.approvals AS approval
  USING action.executions AS execution
  WHERE approval.action_id = execution.action_id
    AND execution.project_id = p_target_project_id
    AND execution.action_id::text = ANY(target_action_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('approvals', affected);
  DELETE FROM action.preview_snapshots
  WHERE project_id = p_target_project_id AND action_id::text = ANY(target_action_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('previewSnapshots', affected);
  DELETE FROM action.candidates
  WHERE project_id = p_target_project_id AND candidate_id = ANY(target_candidate_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('candidates', affected);

  RETURN jsonb_build_object(
    'deleted', deleted,
    'tombstonedExecutions', COALESCE((deleted->>'tombstonedExecutions')::bigint, 0),
    'redactedAuditEvents', COALESCE((deleted->>'redactedAuditEvents')::bigint, 0)
  );
END
$$;

ALTER FUNCTION action.t3_erase_project_actions(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION action.t3_erase_project_actions(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION action.t3_guard_project_action_write()
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
    target_project_id := to_jsonb(OLD)->>'project_id';
  ELSE
    target_project_id := to_jsonb(NEW)->>'project_id';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    previous_project_id := to_jsonb(OLD)->>'project_id';
    IF previous_project_id IS DISTINCT FROM target_project_id THEN
      RAISE EXCEPTION 'Action Project binding is immutable'
        USING ERRCODE = '55000', CONSTRAINT = 't3_action_project_binding_immutable';
    END IF;
  END IF;
  IF target_project_id IS NULL THEN
    RAISE EXCEPTION 'Action write has no Project identity'
      USING ERRCODE = '55000', CONSTRAINT = 't3_action_project_scope_missing';
  END IF;
  IF project_admin.t3_reset_write_authorized(target_project_id) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM project_admin.project_knowledge_epoch AS epoch
    WHERE epoch.project_id = target_project_id AND epoch.state <> 'READY'
  ) THEN
    RAISE EXCEPTION 'Project knowledge reset fences Action writes'
      USING ERRCODE = '55000', CONSTRAINT = 'project_knowledge_reset_write_fence';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
$$;

ALTER FUNCTION action.t3_guard_project_action_write() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION action.t3_guard_project_action_write() FROM PUBLIC;

CREATE OR REPLACE FUNCTION action.t3_guard_project_action_approval_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, action
AS $$
DECLARE
  target_action_id uuid;
  target_project_id text;
BEGIN
  target_action_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.action_id ELSE NEW.action_id END;
  SELECT execution.project_id INTO target_project_id
  FROM action.executions AS execution WHERE execution.action_id = target_action_id;
  IF target_project_id IS NULL THEN
    RAISE EXCEPTION 'Action approval Project scope is missing'
      USING ERRCODE = '55000', CONSTRAINT = 't3_action_approval_scope_missing';
  END IF;
  IF project_admin.t3_reset_write_authorized(target_project_id) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM project_admin.project_knowledge_epoch AS epoch
    WHERE epoch.project_id = target_project_id AND epoch.state <> 'READY'
  ) THEN
    RAISE EXCEPTION 'Project knowledge reset fences Action approval writes'
      USING ERRCODE = '55000', CONSTRAINT = 'project_knowledge_reset_write_fence';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
$$;

ALTER FUNCTION action.t3_guard_project_action_approval_write() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION action.t3_guard_project_action_approval_write() FROM PUBLIC;

DROP TRIGGER IF EXISTS t3_action_project_knowledge_write_fence ON action.approval_records;
CREATE TRIGGER t3_action_project_knowledge_write_fence
  BEFORE INSERT OR UPDATE OR DELETE ON action.approval_records
  FOR EACH ROW EXECUTE FUNCTION action.t3_guard_project_action_approval_write();

CREATE OR REPLACE FUNCTION action.reject_append_only_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, action
AS $$
DECLARE
  target_project_id text;
  target_action_id text;
BEGIN
  target_action_id := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD)->>'action_id'
                           ELSE to_jsonb(NEW)->>'action_id' END;
  IF TG_TABLE_NAME IN ('approvals', 'approval_records') THEN
    SELECT execution.project_id INTO target_project_id
    FROM action.executions AS execution
    WHERE execution.action_id::text = target_action_id;
  ELSE
    target_project_id := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD)->>'project_id'
                              ELSE to_jsonb(NEW)->>'project_id' END;
  END IF;

  IF session_user = 'shotgun_erasure_executor'
     AND target_project_id IS NOT NULL
     AND project_admin.t3_reset_write_authorized(target_project_id)
     AND EXISTS (
       SELECT 1
       FROM project_admin.project_knowledge_reset_requests AS request
       WHERE request.project_id = target_project_id
         AND request.request_id = NULLIF(current_setting('shotgun.t3_reset_request_id', true), '')::uuid
         AND request.step_checkpoints->>'actionSnapshotComplete' = 'true'
         AND target_action_id = ANY(ARRAY(
           SELECT jsonb_array_elements_text(request.step_checkpoints->'actionActionIds')
         ))
     ) THEN
    IF TG_OP = 'DELETE' AND TG_TABLE_NAME IN ('approvals', 'approval_records', 'preview_snapshots') THEN
      RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'audit_events'
       AND OLD.audit_event_id = NEW.audit_event_id
       AND OLD.action_id = NEW.action_id
       AND OLD.project_id = NEW.project_id
       AND OLD.sequence = NEW.sequence
       AND OLD.category = NEW.category
       AND OLD.occurred_at = NEW.occurred_at
       AND NEW.event_json = jsonb_build_object(
         'schemaVersion', '1.0.0',
         'payloadAvailability', 'PURGED_BY_T3',
         'resetRequestId', current_setting('shotgun.t3_reset_request_id', true)
       ) THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END
$$;

ALTER FUNCTION action.reject_append_only_change() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION action.reject_append_only_change() FROM PUBLIC;

DO $$
DECLARE
  relation record;
BEGIN
  FOR relation IN
    SELECT DISTINCT table_schema, table_name
    FROM information_schema.columns
    WHERE table_schema = 'action' AND column_name = 'project_id'
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS t3_action_project_knowledge_write_fence ON %I.%I',
      relation.table_schema, relation.table_name
    );
    EXECUTE format(
      'CREATE TRIGGER t3_action_project_knowledge_write_fence '
      'BEFORE INSERT OR UPDATE OR DELETE ON %I.%I '
      'FOR EACH ROW EXECUTE FUNCTION action.t3_guard_project_action_write()',
      relation.table_schema, relation.table_name
    );
  END LOOP;
END
$$;

DROP TRIGGER IF EXISTS t3_action_project_knowledge_write_fence ON action.approvals;
CREATE TRIGGER t3_action_project_knowledge_write_fence
  BEFORE INSERT OR UPDATE OR DELETE ON action.approvals
  FOR EACH ROW EXECUTE FUNCTION action.t3_guard_project_action_approval_write();

GRANT USAGE ON SCHEMA action, asset, evidence, project_admin TO shotgun_schema_owner;
GRANT USAGE ON SCHEMA action TO shotgun_runtime, shotgun_erasure_executor;
GRANT USAGE ON SCHEMA project_admin TO shotgun_erasure_executor;
GRANT SELECT ON asset.sources, asset.source_versions, evidence.spans TO shotgun_schema_owner;
GRANT SELECT, UPDATE ON project_admin.project_knowledge_reset_requests TO shotgun_schema_owner;
GRANT SELECT ON project_admin.project_knowledge_epoch TO shotgun_schema_owner;
GRANT SELECT, UPDATE ON action.executions TO shotgun_schema_owner;
GRANT SELECT, DELETE ON action.candidates, action.approvals, action.preview_snapshots,
  action.approval_records, action.action_feedback_outbox, action.action_review_work_items
  TO shotgun_schema_owner;
GRANT SELECT, UPDATE ON action.audit_events TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION project_admin.t3_reset_write_authorized(text)
  TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION action.t3_project_action_status(text, uuid),
  action.t3_snapshot_project_actions(text, uuid),
  action.t3_erase_project_actions(text, uuid)
  TO shotgun_erasure_executor;
GRANT EXECUTE ON FUNCTION action.t3_project_action_analysis(text),
  action.t3_jsonb_mentions_source_token(jsonb, text[])
  TO shotgun_schema_owner;
