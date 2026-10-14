-- Generated image observations are Source-derived Ask context even when the
-- question has no explicit Source selection, citation, or text Evidence.
-- A count-only classifier gives Preview and the executor the same fail-closed
-- lineage check without disclosing observation content.
CREATE FUNCTION frontend_ask.t3_unresolved_image_references(target_project_id text)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, frontend_ask, vp AS $$
  WITH image_references AS (
    SELECT jsonb_array_elements(statement.generated_observation_references) AS reference
    FROM frontend_ask.statements AS statement
    JOIN frontend_ask.answer_runs AS run ON run.answer_run_id=statement.answer_run_id
    WHERE run.project_id=target_project_id
    UNION ALL
    SELECT jsonb_array_elements(attempt.generated_image_context) AS reference
    FROM frontend_ask.answer_run_attempts AS attempt
    JOIN frontend_ask.answer_runs AS run
      ON run.answer_run_id=attempt.answer_run_id AND run.project_id=attempt.project_id
    WHERE run.project_id=target_project_id
  )
  SELECT count(*) FROM image_references AS item
  WHERE NOT EXISTS (
    SELECT 1 FROM vp.image_observations AS observation
    WHERE observation.project_id=target_project_id
      AND item.reference->>'kind'='GENERATED_IMAGE_OBSERVATION'
      AND item.reference->>'semanticStatus'='UNVERIFIED'
      AND nullif(item.reference->>'referenceId','') IS NOT NULL
      AND item.reference->>'observationId'=observation.observation_id::text
      AND item.reference->>'projectId'=observation.project_id
      AND item.reference->>'sourceId'=observation.source_id::text
      AND item.reference->>'sourceVersionId'=observation.source_version_id::text
      AND item.reference->>'originalAssetId'=observation.original_asset_id::text
      AND item.reference->>'sourceContentHash'=observation.source_content_hash
      AND item.reference->>'derivationId'=observation.transformation_revision_id::text
      AND item.reference->>'providerExecutionId'=observation.call_id::text
      AND item.reference->>'observationText'=observation.observation_text
      AND item.reference->>'imageMediaType'=observation.payload#>>'{image,mediaType}'
      AND item.reference->>'imageWidth'=observation.payload#>>'{image,width}'
      AND item.reference->>'imageHeight'=observation.payload#>>'{image,height}'
      AND item.reference->'region'=observation.payload#>'{image,region}'
      AND (NOT (item.reference ? 'sensitivity')
           OR item.reference->>'sensitivity'=observation.sensitivity)
  );
$$;
ALTER FUNCTION frontend_ask.t3_unresolved_image_references(text) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_ask.t3_unresolved_image_references(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION frontend_ask.t3_unresolved_image_references(text) TO shotgun_runtime;

-- Preserve the 086 authorization and whole-conversation owner; extend only its scope.
CREATE OR REPLACE FUNCTION frontend_ask.t3_project_ask_status(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, asset, frontend_ask
AS $$
DECLARE
  request_state text;
  epoch_state text;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;

  SELECT request.state, epoch.state
    INTO request_state, epoch_state
  FROM project_admin.project_knowledge_reset_requests AS request
  JOIN project_admin.project_knowledge_epoch AS epoch
    ON epoch.project_id = request.project_id
   AND epoch.epoch = request.resulting_knowledge_epoch
  WHERE request.project_id = target_project_id
    AND request.request_id = reset_request_id
    AND request.owner_manifest_digest IS NOT NULL;
  IF request_state IS NULL
     OR request_state NOT IN ('FENCING', 'PURGING', 'REBUILDING', 'VERIFYING')
     OR epoch_state IS DISTINCT FROM 'RESET_PENDING' THEN
    RAISE EXCEPTION 'Ask status is unavailable outside active maintenance'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;

  RETURN (
    WITH affected_conversations AS (
      SELECT DISTINCT answer_run.conversation_id
      FROM frontend_ask.source_selections AS selection
      JOIN frontend_ask.answer_runs AS answer_run
        ON answer_run.answer_run_id = selection.answer_run_id
       AND answer_run.project_id = selection.project_id
      WHERE selection.project_id = target_project_id
        AND EXISTS (
          SELECT 1 FROM asset.sources AS source
          WHERE source.project_id = target_project_id
            AND source.source_id = selection.source_id
        )
      UNION
      SELECT DISTINCT answer_run.conversation_id
      FROM frontend_ask.citations AS citation
      JOIN frontend_ask.statements AS statement
        ON statement.statement_id = citation.statement_id
      JOIN frontend_ask.answer_runs AS answer_run
        ON answer_run.answer_run_id = statement.answer_run_id
      JOIN asset.source_versions AS version
        ON version.source_id = citation.source_id
       AND version.source_version_id = citation.source_version_id
      JOIN asset.sources AS source
        ON source.source_id = version.source_id
       AND source.project_id = target_project_id
      WHERE answer_run.project_id = target_project_id
      UNION
      SELECT DISTINCT answer_run.conversation_id
      FROM frontend_ask.answer_attempt_evidence AS evidence
      JOIN frontend_ask.answer_run_attempts AS attempt
        ON attempt.attempt_id = evidence.attempt_id
      JOIN frontend_ask.answer_runs AS answer_run
        ON answer_run.project_id = attempt.project_id
       AND answer_run.answer_run_id = attempt.answer_run_id
      JOIN asset.sources AS source
        ON source.project_id = target_project_id
       AND source.source_id::text = evidence.source_id
      JOIN asset.source_versions AS version
        ON version.source_id = source.source_id
       AND version.source_version_id::text = evidence.source_version_id
      WHERE answer_run.project_id = target_project_id
      UNION
      SELECT DISTINCT answer_run.conversation_id
      FROM frontend_ask.answer_runs AS answer_run
      WHERE answer_run.project_id = target_project_id
        AND (EXISTS (
          SELECT 1 FROM frontend_ask.statements AS statement
          WHERE statement.answer_run_id = answer_run.answer_run_id
            AND statement.generated_observation_references <> '[]'::jsonb
        ) OR EXISTS (
          SELECT 1 FROM frontend_ask.answer_run_attempts AS attempt
          WHERE attempt.answer_run_id = answer_run.answer_run_id
            AND attempt.project_id = answer_run.project_id
            AND attempt.generated_image_context <> '[]'::jsonb
        ))
    ), affected_runs AS (
      SELECT answer_run.*
      FROM frontend_ask.answer_runs AS answer_run
      JOIN affected_conversations AS affected USING (conversation_id)
      WHERE answer_run.project_id = target_project_id
    )
    SELECT jsonb_build_object(
      'affectedConversations', (SELECT count(*) FROM affected_conversations),
      'answerRuns', (SELECT count(*) FROM affected_runs),
      'activeAnswerRuns', (
        SELECT count(*) FROM affected_runs
        WHERE state IN (
          'QUEUED', 'RUNNING', 'STREAMING', 'ACTION_REQUIRED', 'PARTIAL',
          'CANCEL_REQUESTED', 'OUTCOME_UNKNOWN'
        )
      ),
      'activeAttempts', (
        SELECT count(*)
        FROM frontend_ask.answer_run_attempts AS attempt
        JOIN affected_runs AS answer_run
          ON answer_run.answer_run_id = attempt.answer_run_id
         AND answer_run.project_id = attempt.project_id
        WHERE attempt.state IN ('RUNNING', 'CANCEL_REQUESTED', 'OUTCOME_UNKNOWN')
           OR attempt.lease_expires_at > clock_timestamp()
      ),
      'unresolvedEvidence', (
        SELECT count(*)
        FROM frontend_ask.answer_attempt_evidence AS evidence
        JOIN frontend_ask.answer_run_attempts AS attempt
          ON attempt.attempt_id = evidence.attempt_id
        JOIN frontend_ask.answer_runs AS answer_run
          ON answer_run.project_id = attempt.project_id
         AND answer_run.answer_run_id = attempt.answer_run_id
        WHERE answer_run.project_id = target_project_id
          AND NOT EXISTS (
            SELECT 1
            FROM asset.sources AS source
            JOIN asset.source_versions AS version USING (source_id)
            WHERE source.project_id = target_project_id
              AND source.source_id::text = evidence.source_id
              AND version.source_version_id::text = evidence.source_version_id
          )
      ) + frontend_ask.t3_unresolved_image_references(target_project_id),
      'derivedRecords',
        (SELECT count(*) FROM affected_conversations)
         + (SELECT count(*) FROM frontend_ask.branches AS record_row
           JOIN affected_conversations AS affected USING (conversation_id))
        + (SELECT count(*) FROM frontend_ask.turns AS record_row
           JOIN affected_conversations AS affected USING (conversation_id))
        + (SELECT count(*) FROM affected_runs)
        + (SELECT count(*) FROM frontend_ask.source_selections AS record_row
           JOIN affected_runs AS answer_run USING (answer_run_id))
        + (SELECT count(*) FROM frontend_ask.source_selection_evidence AS record_row
           JOIN frontend_ask.source_selections AS selection USING (selection_id)
           JOIN affected_runs AS answer_run USING (answer_run_id))
        + (SELECT count(*) FROM frontend_ask.statements AS record_row
           JOIN affected_runs AS answer_run USING (answer_run_id))
        + (SELECT count(*) FROM frontend_ask.citations AS record_row
           JOIN frontend_ask.statements AS statement USING (statement_id)
           JOIN affected_runs AS answer_run USING (answer_run_id))
        + (SELECT count(*) FROM frontend_ask.answer_run_attempts AS record_row
           JOIN affected_runs AS answer_run USING (answer_run_id, project_id))
        + (SELECT count(*) FROM frontend_ask.answer_attempt_evidence AS record_row
           JOIN frontend_ask.answer_run_attempts AS attempt USING (attempt_id)
           JOIN affected_runs AS answer_run USING (answer_run_id, project_id))
        + (SELECT count(*) FROM frontend_ask.answer_run_events AS record_row
           JOIN affected_runs AS answer_run USING (answer_run_id, project_id))
        + (SELECT count(*) FROM frontend_ask.answer_exports AS record_row
           JOIN affected_runs AS answer_run USING (answer_run_id, project_id))
        + (SELECT count(*) FROM frontend_ask.answer_feedback AS record_row
           JOIN affected_runs AS answer_run USING (answer_run_id, project_id))
        + (SELECT count(*) FROM frontend_ask.transition_seeds AS record_row
           JOIN affected_runs AS answer_run USING (answer_run_id, project_id))
    )
  );
END
$$;

ALTER FUNCTION frontend_ask.t3_project_ask_status(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_ask.t3_project_ask_status(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_ask.t3_erase_project_ask(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, asset, frontend_ask
AS $$
DECLARE
  conversation_ids text[];
  active_runs bigint;
  active_attempts bigint;
  deleted_runs bigint;
  deleted_conversations bigint;
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
    SELECT 1
    FROM frontend_ask.answer_attempt_evidence AS evidence
    JOIN frontend_ask.answer_run_attempts AS attempt
      ON attempt.attempt_id = evidence.attempt_id
    JOIN frontend_ask.answer_runs AS answer_run
      ON answer_run.project_id = attempt.project_id
     AND answer_run.answer_run_id = attempt.answer_run_id
    WHERE answer_run.project_id = target_project_id
      AND NOT EXISTS (
        SELECT 1
        FROM asset.sources AS source
        JOIN asset.source_versions AS version USING (source_id)
        WHERE source.project_id = target_project_id
          AND source.source_id::text = evidence.source_id
          AND version.source_version_id::text = evidence.source_version_id
      )
  ) THEN
    RAISE EXCEPTION 'Ask contains evidence references that cannot be tied to a Project Source'
      USING ERRCODE = '55000', CONSTRAINT = 't3_ask_unclassified_content';
  END IF;

  IF frontend_ask.t3_unresolved_image_references(target_project_id) > 0 THEN
    RAISE EXCEPTION 'Ask contains image references without exact Project Source lineage'
      USING ERRCODE = '55000', CONSTRAINT = 't3_ask_unclassified_content';
  END IF;

  SELECT array_agg(affected.conversation_id ORDER BY affected.conversation_id)
    INTO conversation_ids
  FROM (
    SELECT DISTINCT answer_run.conversation_id
    FROM frontend_ask.source_selections AS selection
    JOIN frontend_ask.answer_runs AS answer_run
      ON answer_run.answer_run_id = selection.answer_run_id
     AND answer_run.project_id = selection.project_id
    WHERE selection.project_id = target_project_id
      AND EXISTS (
        SELECT 1 FROM asset.sources AS source
        WHERE source.project_id = target_project_id
          AND source.source_id = selection.source_id
      )
    UNION
    SELECT DISTINCT answer_run.conversation_id
    FROM frontend_ask.citations AS citation
    JOIN frontend_ask.statements AS statement
      ON statement.statement_id = citation.statement_id
    JOIN frontend_ask.answer_runs AS answer_run
      ON answer_run.answer_run_id = statement.answer_run_id
    JOIN asset.source_versions AS version
      ON version.source_id = citation.source_id
     AND version.source_version_id = citation.source_version_id
    JOIN asset.sources AS source
      ON source.source_id = version.source_id
     AND source.project_id = target_project_id
    WHERE answer_run.project_id = target_project_id
    UNION
    SELECT DISTINCT answer_run.conversation_id
    FROM frontend_ask.answer_attempt_evidence AS evidence
    JOIN frontend_ask.answer_run_attempts AS attempt
      ON attempt.attempt_id = evidence.attempt_id
    JOIN frontend_ask.answer_runs AS answer_run
      ON answer_run.project_id = attempt.project_id
     AND answer_run.answer_run_id = attempt.answer_run_id
    JOIN asset.sources AS source
      ON source.project_id = target_project_id
     AND source.source_id::text = evidence.source_id
    JOIN asset.source_versions AS version
      ON version.source_id = source.source_id
     AND version.source_version_id::text = evidence.source_version_id
    WHERE answer_run.project_id = target_project_id
      UNION
      SELECT DISTINCT answer_run.conversation_id
      FROM frontend_ask.answer_runs AS answer_run
      WHERE answer_run.project_id = target_project_id
        AND (EXISTS (
          SELECT 1 FROM frontend_ask.statements AS statement
          WHERE statement.answer_run_id = answer_run.answer_run_id
            AND statement.generated_observation_references <> '[]'::jsonb
        ) OR EXISTS (
          SELECT 1 FROM frontend_ask.answer_run_attempts AS attempt
          WHERE attempt.answer_run_id = answer_run.answer_run_id
            AND attempt.project_id = answer_run.project_id
            AND attempt.generated_image_context <> '[]'::jsonb
        ))
  ) AS affected;

  IF COALESCE(cardinality(conversation_ids), 0) = 0 THEN
    RETURN jsonb_build_object('affectedConversations', 0, 'answerRuns', 0);
  END IF;

  SELECT count(*) INTO active_runs
  FROM frontend_ask.answer_runs
  WHERE project_id = target_project_id
    AND conversation_id = ANY(conversation_ids)
    AND state IN (
      'QUEUED', 'RUNNING', 'STREAMING', 'ACTION_REQUIRED', 'PARTIAL',
      'CANCEL_REQUESTED', 'OUTCOME_UNKNOWN'
    );
  SELECT count(*) INTO active_attempts
  FROM frontend_ask.answer_run_attempts AS attempt
  JOIN frontend_ask.answer_runs AS answer_run
    ON answer_run.project_id = attempt.project_id
   AND answer_run.answer_run_id = attempt.answer_run_id
  WHERE answer_run.project_id = target_project_id
    AND answer_run.conversation_id = ANY(conversation_ids)
    AND (
      attempt.state IN ('RUNNING', 'CANCEL_REQUESTED', 'OUTCOME_UNKNOWN')
      OR attempt.lease_expires_at > clock_timestamp()
    );
  IF active_runs > 0 OR active_attempts > 0 THEN
    RAISE EXCEPTION 'Selected Ask conversations contain work without a terminal outcome'
      USING ERRCODE = '55000', CONSTRAINT = 'active_job_outcome_unknown';
  END IF;

  -- Break the deferred branch/turn cycle before deleting the conversation root.
  UPDATE frontend_ask.branches
  SET parent_branch_id = NULL, origin_turn_id = NULL
  WHERE conversation_id = ANY(conversation_ids)
    AND EXISTS (
      SELECT 1 FROM frontend_ask.conversations AS conversation
      WHERE conversation.conversation_id = branches.conversation_id
        AND conversation.project_id = target_project_id
    )
    AND (parent_branch_id IS NOT NULL OR origin_turn_id IS NOT NULL);

  DELETE FROM frontend_ask.answer_runs
  WHERE project_id = target_project_id
    AND conversation_id = ANY(conversation_ids);
  GET DIAGNOSTICS deleted_runs = ROW_COUNT;

  DELETE FROM frontend_ask.conversations
  WHERE project_id = target_project_id
    AND conversation_id = ANY(conversation_ids);
  GET DIAGNOSTICS deleted_conversations = ROW_COUNT;

  RETURN jsonb_build_object(
    'affectedConversations', deleted_conversations,
    'answerRuns', deleted_runs
  );
END
$$;

ALTER FUNCTION frontend_ask.t3_erase_project_ask(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_ask.t3_erase_project_ask(text, uuid) FROM PUBLIC;

-- Extend command snapshots and Connector token closure before Ask content is purged.
CREATE OR REPLACE FUNCTION frontend_command.t3_project_source_command_impact(
  p_target_project_id text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, asset, frontend_ask, frontend_command, source_product
AS $$
  WITH affected_conversations AS MATERIALIZED (
    SELECT DISTINCT answer_run.conversation_id
    FROM frontend_ask.source_selections AS selection
    JOIN frontend_ask.answer_runs AS answer_run
      ON answer_run.answer_run_id = selection.answer_run_id
     AND answer_run.project_id = selection.project_id
    WHERE selection.project_id = p_target_project_id
      AND EXISTS (
        SELECT 1 FROM asset.sources AS source
        WHERE source.project_id = p_target_project_id
          AND source.source_id = selection.source_id
      )
    UNION
    SELECT DISTINCT answer_run.conversation_id
    FROM frontend_ask.citations AS citation
    JOIN frontend_ask.statements AS statement
      ON statement.statement_id = citation.statement_id
    JOIN frontend_ask.answer_runs AS answer_run
      ON answer_run.answer_run_id = statement.answer_run_id
    JOIN asset.source_versions AS version
      ON version.source_id = citation.source_id
     AND version.source_version_id = citation.source_version_id
    JOIN asset.sources AS source
      ON source.source_id = version.source_id
     AND source.project_id = p_target_project_id
    WHERE answer_run.project_id = p_target_project_id
    UNION
    SELECT DISTINCT answer_run.conversation_id
    FROM frontend_ask.answer_attempt_evidence AS evidence
    JOIN frontend_ask.answer_run_attempts AS attempt
      ON attempt.attempt_id = evidence.attempt_id
    JOIN frontend_ask.answer_runs AS answer_run
      ON answer_run.project_id = attempt.project_id
     AND answer_run.answer_run_id = attempt.answer_run_id
    JOIN asset.sources AS source
      ON source.project_id = p_target_project_id
     AND source.source_id::text = evidence.source_id
    JOIN asset.source_versions AS version
      ON version.source_id = source.source_id
     AND version.source_version_id::text = evidence.source_version_id
    WHERE answer_run.project_id = p_target_project_id
    UNION
    SELECT DISTINCT answer_run.conversation_id
    FROM frontend_ask.answer_runs AS answer_run
    WHERE answer_run.project_id = p_target_project_id
      AND (EXISTS (
        SELECT 1 FROM frontend_ask.statements AS statement
        WHERE statement.answer_run_id = answer_run.answer_run_id
          AND statement.generated_observation_references <> '[]'::jsonb
      ) OR EXISTS (
        SELECT 1 FROM frontend_ask.answer_run_attempts AS attempt
        WHERE attempt.answer_run_id = answer_run.answer_run_id
          AND attempt.project_id = answer_run.project_id
          AND attempt.generated_image_context <> '[]'::jsonb
      ))
  ), affected_runs AS MATERIALIZED (
    SELECT answer_run.answer_run_id
    FROM frontend_ask.answer_runs AS answer_run
    JOIN affected_conversations AS affected USING (conversation_id)
    WHERE answer_run.project_id = p_target_project_id
  ), source_commands AS MATERIALIZED (
    SELECT ledger.*
    FROM frontend_command.command_ledger AS ledger
    WHERE ledger.command_type = ANY(ARRAY[
      'sources.intake.submit.v1', 'sources.intake.cancel.v1',
      'sources.intake.retry.v1', 'sources.duplicate.resolve.v1',
      'sources.candidate.reextract.v1'
    ]::text[])
      AND ledger.target_project_id = p_target_project_id
      AND (ledger.resource_project_id IS NULL OR ledger.resource_project_id = p_target_project_id)
    UNION
    SELECT ledger.*
    FROM frontend_command.command_ledger AS ledger
    JOIN source_product.intake_submissions AS submission
      ON submission.create_command_id = ledger.command_id
    WHERE submission.project_id = p_target_project_id
  ), ask_commands AS MATERIALIZED (
    SELECT ledger.*
    FROM frontend_command.command_ledger AS ledger
    WHERE ledger.command_type = ANY(ARRAY[
      'SUBMIT_QUESTION', 'ask.answer-run.cancel.v1', 'ask.answer-run.retry.v1',
      'ask.answer-run.export.v1', 'ask.answer-run.feedback.v1',
      'ask.answer-run.transition-seed.v1'
    ]::text[])
      AND ledger.target_project_id = p_target_project_id
      AND (ledger.resource_project_id IS NULL OR ledger.resource_project_id = p_target_project_id)
      AND (
        (ledger.command_type = 'SUBMIT_QUESTION' AND (
          COALESCE(jsonb_typeof(ledger.command_payload->'sourceSelections') = 'array', false)
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(ledger.command_payload->'sourceSelections') = 'array'
                THEN ledger.command_payload->'sourceSelections' ELSE '[]'::jsonb END
            ) AS selection(value)
            JOIN asset.sources AS source
              ON source.source_id::text = selection.value->>'sourceId'
             AND source.project_id = p_target_project_id
          )
        ))
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(ledger.preconditions) = 'array'
              THEN ledger.preconditions ELSE '[]'::jsonb END
          ) AS precondition(value)
          WHERE EXISTS (SELECT 1 FROM affected_runs AS affected
            WHERE affected.answer_run_id::text = precondition.value #>> '{subject,resourceId}')
            OR EXISTS (SELECT 1 FROM affected_conversations AS affected
            WHERE affected.conversation_id::text = precondition.value #>> '{subject,resourceId}')
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(ledger.produced_resources) = 'array'
              THEN ledger.produced_resources ELSE '[]'::jsonb END
          ) AS resource(value)
          WHERE EXISTS (SELECT 1 FROM affected_runs AS affected
            WHERE affected.answer_run_id::text = resource.value->>'resourceId')
            OR EXISTS (SELECT 1 FROM affected_conversations AS affected
            WHERE affected.conversation_id::text = resource.value->>'resourceId')
        )
      )
  ), selected_commands AS MATERIALIZED (
    SELECT * FROM source_commands
    UNION ALL
    SELECT * FROM ask_commands
  ), relevant_scope AS MATERIALIZED (
    SELECT ledger.*
    FROM frontend_command.command_ledger AS ledger
    WHERE (ledger.target_project_id = p_target_project_id OR ledger.resource_project_id = p_target_project_id)
      AND (
        ledger.command_type LIKE 'sources.%'
        OR ledger.command_type = 'SOURCE_SUBMIT'
        OR ledger.command_type LIKE 'ask.answer-run.%'
        OR ledger.command_type = 'SUBMIT_QUESTION'
        OR ledger.command_type LIKE 'knowledge.draft.%'
        OR ledger.command_type LIKE 'frontend.review.%'
        OR ledger.command_type LIKE 'frontend.external-action.%'
        OR ledger.command_type LIKE 'action.%'
      )
  ), ask_unresolved AS (
    SELECT ledger.command_id
    FROM frontend_command.command_ledger AS ledger
    WHERE ledger.command_type LIKE 'ask.answer-run.%'
      AND (ledger.target_project_id = p_target_project_id OR ledger.resource_project_id = p_target_project_id)
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(ledger.preconditions) = 'array'
            THEN ledger.preconditions ELSE '[]'::jsonb END
        ) AS precondition(value)
        JOIN frontend_ask.answer_runs AS answer_run
          ON answer_run.answer_run_id::text = precondition.value #>> '{subject,resourceId}'
         AND answer_run.project_id = p_target_project_id
        WHERE precondition.value #>> '{subject,resourceKind}' = 'ASK_ANSWER_RUN'
      )
  ), submit_unresolved AS (
    SELECT ledger.command_id
    FROM frontend_command.command_ledger AS ledger
    WHERE ledger.command_type = 'SUBMIT_QUESTION'
      AND (ledger.target_project_id = p_target_project_id OR ledger.resource_project_id = p_target_project_id)
      AND jsonb_array_length(CASE
        WHEN jsonb_typeof(ledger.command_payload->'sourceSelections') = 'array'
          THEN ledger.command_payload->'sourceSelections' ELSE '[]'::jsonb END) > 0
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(ledger.command_payload->'sourceSelections') = 'array'
            THEN ledger.command_payload->'sourceSelections' ELSE '[]'::jsonb END
        ) AS selection(value)
        WHERE NOT EXISTS (
          SELECT 1 FROM asset.sources AS source
          WHERE source.source_id::text = selection.value->>'sourceId'
            AND source.project_id = p_target_project_id
        )
      )
  ), mixed_scope AS (
    SELECT ledger.command_id
    FROM frontend_command.command_ledger AS ledger
    WHERE (ledger.target_project_id = p_target_project_id OR ledger.resource_project_id = p_target_project_id)
      AND (ledger.command_type LIKE 'sources.%' OR ledger.command_type LIKE 'ask.answer-run.%'
        OR ledger.command_type = 'SUBMIT_QUESTION' OR ledger.command_type = 'SOURCE_SUBMIT')
      AND (ledger.target_project_id <> p_target_project_id
        OR (ledger.resource_project_id IS NOT NULL AND ledger.resource_project_id <> p_target_project_id))
  ), unsupported_commands AS (
    SELECT ledger.command_id
    FROM frontend_command.command_ledger AS ledger
    WHERE (ledger.target_project_id = p_target_project_id OR ledger.resource_project_id = p_target_project_id)
      AND (
        ledger.command_type LIKE 'sources.%'
        OR ledger.command_type = 'SOURCE_SUBMIT'
        OR ledger.command_type LIKE 'ask.answer-run.%'
        OR ledger.command_type LIKE 'knowledge.draft.%'
        OR ledger.command_type LIKE 'frontend.review.%'
        OR ledger.command_type LIKE 'frontend.external-action.%'
        OR ledger.command_type LIKE 'action.%'
      )
      AND NOT (
        ledger.command_type = ANY(ARRAY[
          'sources.intake.submit.v1', 'sources.intake.cancel.v1',
          'sources.intake.retry.v1', 'sources.duplicate.resolve.v1',
          'sources.candidate.reextract.v1',
          'SOURCE_SUBMIT', 'SUBMIT_QUESTION',
          'ask.answer-run.cancel.v1', 'ask.answer-run.retry.v1',
          'ask.answer-run.export.v1', 'ask.answer-run.feedback.v1',
          'ask.answer-run.transition-seed.v1'
        ]::text[])
      )
  ), scoped_counts AS (
    SELECT
      (SELECT count(*) FROM source_commands) AS source_commands,
      (SELECT count(*) FROM ask_commands) AS ask_commands,
      (SELECT count(*) FROM selected_commands
        WHERE outcome_state IN ('ACCEPTED', 'OUTCOME_UNKNOWN')) AS active_commands,
      (SELECT count(*) FROM unsupported_commands)
        + (SELECT count(*) FROM ask_unresolved)
        + (SELECT count(*) FROM submit_unresolved)
        + (SELECT count(*) FROM mixed_scope) AS unclassified_commands,
      (SELECT count(*) FROM selected_commands) AS derived_records,
      encode(pg_catalog.sha256(convert_to(COALESCE((
        SELECT string_agg(
          encode(pg_catalog.sha256(convert_to(to_jsonb(ledger)::text, 'UTF8')), 'hex'),
          '' ORDER BY ledger.command_id
        ) FROM relevant_scope AS ledger
      ), ''), 'UTF8')), 'hex') AS fingerprint
  )
  SELECT jsonb_build_object(
    'sourceCommands', source_commands,
    'askCommands', ask_commands,
    'activeCommands', active_commands,
    'unclassifiedCommands', unclassified_commands,
    'derivedRecords', derived_records,
    'fingerprint', fingerprint
  ) FROM scoped_counts;
$$;

ALTER FUNCTION frontend_command.t3_project_source_command_impact(text)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_command.t3_project_source_command_impact(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_command.t3_snapshot_project_source_commands(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, asset, frontend_ask, source_product, frontend_command
AS $$
#variable_conflict use_variable
DECLARE
  request_state text;
  epoch_state text;
  impact jsonb;
  command_ids text[];
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
    RAISE EXCEPTION 'Command-ledger snapshot is unavailable outside active maintenance'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;

  IF request_state <> 'FENCING' THEN
    SELECT request.step_checkpoints->'t3FrontendCommandSnapshot'
      INTO impact
    FROM project_admin.project_knowledge_reset_requests AS request
    WHERE request.project_id = target_project_id AND request.request_id = reset_request_id;
    IF impact IS NULL THEN
      RAISE EXCEPTION 'Command-ledger snapshot is missing after purge began'
        USING ERRCODE = '55000', CONSTRAINT = 't3_command_snapshot_missing';
    END IF;
    RETURN impact - 'commandIds';
  END IF;

  WITH affected_conversations AS MATERIALIZED (
    SELECT DISTINCT answer_run.conversation_id
    FROM frontend_ask.source_selections AS selection
    JOIN frontend_ask.answer_runs AS answer_run
      ON answer_run.answer_run_id = selection.answer_run_id
     AND answer_run.project_id = selection.project_id
    WHERE selection.project_id = target_project_id
      AND EXISTS (SELECT 1 FROM asset.sources AS source
        WHERE source.project_id = target_project_id AND source.source_id = selection.source_id)
    UNION
    SELECT DISTINCT answer_run.conversation_id
    FROM frontend_ask.citations AS citation
    JOIN frontend_ask.statements AS statement ON statement.statement_id = citation.statement_id
    JOIN frontend_ask.answer_runs AS answer_run ON answer_run.answer_run_id = statement.answer_run_id
    JOIN asset.source_versions AS version
      ON version.source_id = citation.source_id AND version.source_version_id = citation.source_version_id
    JOIN asset.sources AS source
      ON source.source_id = version.source_id AND source.project_id = target_project_id
    WHERE answer_run.project_id = target_project_id
    UNION
    SELECT DISTINCT answer_run.conversation_id
    FROM frontend_ask.answer_attempt_evidence AS evidence
    JOIN frontend_ask.answer_run_attempts AS attempt ON attempt.attempt_id = evidence.attempt_id
    JOIN frontend_ask.answer_runs AS answer_run
      ON answer_run.project_id = attempt.project_id AND answer_run.answer_run_id = attempt.answer_run_id
    JOIN asset.sources AS source
      ON source.project_id = target_project_id AND source.source_id::text = evidence.source_id
    JOIN asset.source_versions AS version
      ON version.source_id = source.source_id
     AND version.source_version_id::text = evidence.source_version_id
    WHERE answer_run.project_id = target_project_id
    UNION
    SELECT DISTINCT answer_run.conversation_id
    FROM frontend_ask.answer_runs AS answer_run
    WHERE answer_run.project_id = target_project_id
      AND (EXISTS (
        SELECT 1 FROM frontend_ask.statements AS statement
        WHERE statement.answer_run_id = answer_run.answer_run_id
          AND statement.generated_observation_references <> '[]'::jsonb
      ) OR EXISTS (
        SELECT 1 FROM frontend_ask.answer_run_attempts AS attempt
        WHERE attempt.answer_run_id = answer_run.answer_run_id
          AND attempt.project_id = answer_run.project_id
          AND attempt.generated_image_context <> '[]'::jsonb
      ))
  ), affected_runs AS MATERIALIZED (
    SELECT answer_run.answer_run_id
    FROM frontend_ask.answer_runs AS answer_run
    JOIN affected_conversations AS affected USING (conversation_id)
    WHERE answer_run.project_id = target_project_id
  ), selected AS MATERIALIZED (
    SELECT ledger.command_id
    FROM frontend_command.command_ledger AS ledger
    WHERE ledger.command_type = ANY(ARRAY[
      'sources.intake.submit.v1', 'sources.intake.cancel.v1',
      'sources.intake.retry.v1', 'sources.duplicate.resolve.v1',
      'sources.candidate.reextract.v1'
    ]::text[])
      AND ledger.target_project_id = target_project_id
      AND (ledger.resource_project_id IS NULL OR ledger.resource_project_id = target_project_id)
    UNION
    SELECT ledger.command_id
    FROM frontend_command.command_ledger AS ledger
    JOIN source_product.intake_submissions AS submission
      ON submission.create_command_id = ledger.command_id
    WHERE submission.project_id = target_project_id
    UNION
    SELECT ledger.command_id
    FROM frontend_command.command_ledger AS ledger
    WHERE ledger.command_type = ANY(ARRAY[
      'SUBMIT_QUESTION', 'ask.answer-run.cancel.v1', 'ask.answer-run.retry.v1',
      'ask.answer-run.export.v1', 'ask.answer-run.feedback.v1',
      'ask.answer-run.transition-seed.v1'
    ]::text[])
      AND ledger.target_project_id = target_project_id
      AND (ledger.resource_project_id IS NULL OR ledger.resource_project_id = target_project_id)
      AND (
        (ledger.command_type = 'SUBMIT_QUESTION' AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(ledger.command_payload->'sourceSelections') = 'array'
              THEN ledger.command_payload->'sourceSelections' ELSE '[]'::jsonb END
          ) AS selection(value)
          JOIN asset.sources AS source
            ON source.source_id::text = selection.value->>'sourceId'
           AND source.project_id = target_project_id
        ))
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(ledger.preconditions) = 'array'
              THEN ledger.preconditions ELSE '[]'::jsonb END
          ) AS precondition(value)
          WHERE EXISTS (SELECT 1 FROM affected_runs AS affected
            WHERE affected.answer_run_id::text = precondition.value #>> '{subject,resourceId}')
            OR EXISTS (SELECT 1 FROM affected_conversations AS affected
            WHERE affected.conversation_id::text = precondition.value #>> '{subject,resourceId}')
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(ledger.produced_resources) = 'array'
              THEN ledger.produced_resources ELSE '[]'::jsonb END
          ) AS resource(value)
          WHERE EXISTS (SELECT 1 FROM affected_runs AS affected
            WHERE affected.answer_run_id::text = resource.value->>'resourceId')
            OR EXISTS (SELECT 1 FROM affected_conversations AS affected
            WHERE affected.conversation_id::text = resource.value->>'resourceId')
        )
      )
  )
  SELECT COALESCE(array_agg(selected.command_id ORDER BY selected.command_id), '{}'::text[])
    INTO command_ids
  FROM selected;

  impact := frontend_command.t3_project_source_command_impact(target_project_id);
  impact := impact || jsonb_build_object('commandIds', to_jsonb(command_ids));
  UPDATE project_admin.project_knowledge_reset_requests AS request
  SET step_checkpoints = jsonb_set(
        request.step_checkpoints,
        '{t3FrontendCommandSnapshot}',
        impact,
        true
      ),
      updated_at = now()
  WHERE request.project_id = target_project_id
    AND request.request_id = reset_request_id
    AND request.state = 'FENCING'
    AND request.owner_manifest_digest IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Command-ledger snapshot request changed during fencing'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;
  RETURN impact - 'commandIds';
END
$$;
ALTER FUNCTION frontend_command.t3_snapshot_project_source_commands(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_command.t3_snapshot_project_source_commands(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION connector.t3_project_source_tokens(p_target_project_id text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, asset, transformation, evidence, ai, candidate,
  validation, comparison, review, canonical, projection, frontend_command,
  source_product, frontend_ask, knowledge
AS $$
BEGIN
  RETURN (
  WITH source_scope AS MATERIALIZED (
    SELECT source.source_id, version.source_version_id
    FROM asset.sources AS source
    JOIN asset.source_versions AS version USING (source_id)
    WHERE source.project_id = p_target_project_id
  ), affected_conversations AS MATERIALIZED (
    SELECT DISTINCT answer_run.conversation_id
    FROM frontend_ask.source_selections AS selection
    JOIN frontend_ask.answer_runs AS answer_run
      ON answer_run.answer_run_id = selection.answer_run_id
     AND answer_run.project_id = selection.project_id
    WHERE selection.project_id = p_target_project_id
      AND EXISTS (SELECT 1 FROM source_scope WHERE source_id = selection.source_id)
    UNION
    SELECT DISTINCT answer_run.conversation_id
    FROM frontend_ask.citations AS citation
    JOIN frontend_ask.statements AS statement USING (statement_id)
    JOIN frontend_ask.answer_runs AS answer_run USING (answer_run_id)
    WHERE answer_run.project_id = p_target_project_id
      AND EXISTS (SELECT 1 FROM source_scope WHERE source_version_id = citation.source_version_id)
    UNION
    SELECT DISTINCT answer_run.conversation_id
    FROM frontend_ask.answer_attempt_evidence AS attempt_evidence
    JOIN frontend_ask.answer_run_attempts AS attempt USING (attempt_id)
    JOIN frontend_ask.answer_runs AS answer_run
      ON answer_run.project_id = attempt.project_id
     AND answer_run.answer_run_id = attempt.answer_run_id
    WHERE answer_run.project_id = p_target_project_id
      AND EXISTS (
        SELECT 1 FROM source_scope
        WHERE source_id::text = attempt_evidence.source_id
          AND source_version_id::text = attempt_evidence.source_version_id
      )
    UNION
    SELECT DISTINCT answer_run.conversation_id
    FROM frontend_ask.answer_runs AS answer_run
    WHERE answer_run.project_id = p_target_project_id
      AND (EXISTS (
        SELECT 1 FROM frontend_ask.statements AS statement
        WHERE statement.answer_run_id = answer_run.answer_run_id
          AND statement.generated_observation_references <> '[]'::jsonb
      ) OR EXISTS (
        SELECT 1 FROM frontend_ask.answer_run_attempts AS attempt
        WHERE attempt.answer_run_id = answer_run.answer_run_id
          AND attempt.project_id = answer_run.project_id
          AND attempt.generated_image_context <> '[]'::jsonb
      ))
  ), affected_candidates AS MATERIALIZED (
    SELECT candidate.candidate_id, candidate.batch_id, candidate.provider_call
    FROM candidate.claim_candidates AS candidate
    JOIN source_scope USING (source_version_id)
    WHERE candidate.project_id = p_target_project_id
  ), affected_changes AS MATERIALIZED (
    SELECT change_set.change_set_id, change_set.content_digest, change_set.snapshot_digest,
           change_set.candidate_id, change_set.comparison_id
    FROM review.change_sets AS change_set
    JOIN source_scope USING (source_version_id)
    WHERE change_set.project_id = p_target_project_id
  ), affected_commits AS MATERIALIZED (
    SELECT commit.commit_id, commit.manifest_id, commit.manifest_digest, commit.result_json
    FROM canonical.commits AS commit
    JOIN affected_changes AS change_set ON change_set.change_set_id = commit.change_set_id
    WHERE commit.project_id = p_target_project_id
  ), tokens(token) AS (
    SELECT source_id::text FROM source_scope
    UNION SELECT source_version_id::text FROM source_scope
    -- Stage 3 connectors use one correlation id for the whole SourceVersion
    -- pipeline. Query outcomes can be terminal failures with no source token in
    -- their result or dead-letter payload, so preserve this exact owner lineage.
    UNION SELECT 'sources-stage3:' || p_target_project_id || ':' || source_version_id::text
      FROM source_scope
    UNION SELECT revision.revision_id::text
      FROM transformation.revisions AS revision
      JOIN source_scope USING (source_version_id)
      WHERE revision.project_id = p_target_project_id
    UNION SELECT span.evidence_id::text
      FROM evidence.spans AS span
      JOIN source_scope USING (source_version_id)
      WHERE span.project_id = p_target_project_id
    UNION SELECT call.call_id::text
      FROM ai.provider_calls AS call
      JOIN source_scope USING (source_version_id)
      WHERE call.project_id = p_target_project_id
    UNION SELECT call.request_id
      FROM ai.provider_calls AS call
      JOIN source_scope USING (source_version_id)
      WHERE call.project_id = p_target_project_id
    UNION SELECT output.output_id::text
      FROM ai.provider_outputs AS output
      JOIN ai.provider_calls AS call USING (call_id)
      JOIN source_scope USING (source_version_id)
      WHERE output.project_id = p_target_project_id AND call.project_id = p_target_project_id
    UNION SELECT output.attempt_id::text
      FROM ai.provider_outputs AS output
      JOIN ai.provider_calls AS call USING (call_id)
      JOIN source_scope USING (source_version_id)
      WHERE output.project_id = p_target_project_id AND call.project_id = p_target_project_id
    UNION SELECT output.content_digest
      FROM ai.provider_outputs AS output
      JOIN ai.provider_calls AS call USING (call_id)
      JOIN source_scope USING (source_version_id)
      WHERE output.project_id = p_target_project_id AND call.project_id = p_target_project_id
    UNION SELECT batch.batch_id::text
      FROM candidate.batches AS batch
      JOIN source_scope USING (source_version_id)
      WHERE batch.project_id = p_target_project_id
    UNION SELECT candidate.candidate_id::text FROM affected_candidates AS candidate
    UNION SELECT candidate.batch_id::text FROM affected_candidates AS candidate
    UNION SELECT materialization.materialization_id::text
      FROM candidate.materializations AS materialization
      JOIN candidate.batches AS batch USING (batch_id)
      JOIN source_scope USING (source_version_id)
      WHERE materialization.project_id = p_target_project_id
    UNION SELECT validation.validation_id::text
      FROM validation.results AS validation
      JOIN source_scope USING (source_version_id)
      WHERE validation.project_id = p_target_project_id
    UNION SELECT comparison.comparison_id::text
      FROM comparison.results AS comparison
      JOIN source_scope USING (source_version_id)
      WHERE comparison.project_id = p_target_project_id
    UNION SELECT comparison.snapshot_digest
      FROM comparison.results AS comparison
      JOIN source_scope USING (source_version_id)
      WHERE comparison.project_id = p_target_project_id
    UNION SELECT comparison.candidate_digest
      FROM comparison.results AS comparison
      JOIN source_scope USING (source_version_id)
      WHERE comparison.project_id = p_target_project_id
    UNION SELECT comparison.diff_digest
      FROM comparison.results AS comparison
      JOIN source_scope USING (source_version_id)
      WHERE comparison.project_id = p_target_project_id
    UNION SELECT change_set.change_set_id::text FROM affected_changes AS change_set
    UNION SELECT change_set.content_digest FROM affected_changes AS change_set
    UNION SELECT change_set.snapshot_digest FROM affected_changes AS change_set
    UNION SELECT decision.decision_id::text
      FROM review.decisions AS decision
      JOIN affected_changes AS change_set USING (change_set_id)
      WHERE decision.project_id = p_target_project_id
    UNION SELECT decision.decision_id
      FROM review.decisions_v2 AS decision
      JOIN review.change_sets_v2 AS change_set USING (project_id, change_set_id)
      JOIN affected_candidates AS candidate USING (candidate_id)
      WHERE decision.project_id = p_target_project_id
    UNION SELECT change_set.change_set_id
      FROM review.change_sets_v2 AS change_set
      JOIN affected_candidates AS candidate USING (candidate_id)
      WHERE change_set.project_id = p_target_project_id
    UNION SELECT manifest.manifest_id
      FROM review.approved_manifests_v2 AS manifest
      JOIN review.change_sets_v2 AS change_set USING (project_id, change_set_id)
      JOIN affected_candidates AS candidate USING (candidate_id)
      WHERE manifest.project_id = p_target_project_id
    UNION SELECT claim.claim_id
      FROM canonical.claims AS claim
      JOIN source_scope
        ON claim.source_version_id = source_scope.source_version_id::text
      WHERE claim.project_id = p_target_project_id
    UNION SELECT commit.commit_id::text FROM affected_commits AS commit
    UNION SELECT commit.manifest_id::text FROM affected_commits AS commit
    UNION SELECT commit.manifest_digest FROM affected_commits AS commit
    UNION SELECT revision.revision_id
      FROM canonical.revisions AS revision
      JOIN affected_commits AS commit USING (commit_id)
      WHERE revision.project_id = p_target_project_id
    UNION SELECT event.history_event_id
      FROM canonical.history_events AS event
      JOIN affected_commits AS commit USING (commit_id)
      WHERE event.project_id = p_target_project_id
    UNION SELECT outbox.outbox_id
      FROM canonical.outbox AS outbox
      JOIN affected_commits AS commit ON commit.commit_id = outbox.aggregate_id
      WHERE outbox.project_id = p_target_project_id
    UNION SELECT document.claim_id
      FROM projection.search_documents AS document
      JOIN source_scope USING (source_version_id)
      WHERE document.project_id = p_target_project_id
    UNION SELECT document.commit_id::text
      FROM projection.search_documents AS document
      JOIN source_scope USING (source_version_id)
      WHERE document.project_id = p_target_project_id
    UNION SELECT document.revision_id
      FROM projection.search_documents AS document
      JOIN source_scope USING (source_version_id)
      WHERE document.project_id = p_target_project_id
    UNION SELECT unnest(document.evidence_ids)
      FROM projection.search_documents AS document
      JOIN source_scope USING (source_version_id)
      WHERE document.project_id = p_target_project_id
    UNION SELECT watermark.last_commit_id::text
      FROM projection.watermarks AS watermark
      WHERE watermark.project_id = p_target_project_id
        AND EXISTS (
          SELECT 1 FROM projection.search_documents AS document
          JOIN source_scope USING (source_version_id)
          WHERE document.project_id = p_target_project_id
        )
    UNION SELECT watermark.snapshot_digest
      FROM projection.watermarks AS watermark
      WHERE watermark.project_id = p_target_project_id
        AND EXISTS (
          SELECT 1 FROM projection.search_documents AS document
          JOIN source_scope USING (source_version_id)
          WHERE document.project_id = p_target_project_id
        )
    UNION SELECT compiled.source_snapshot_digest
      FROM projection.compiled_truth AS compiled
      WHERE compiled.project_id = p_target_project_id
        AND EXISTS (
          SELECT 1 FROM canonical.claims AS claim
          JOIN source_scope
            ON claim.source_version_id = source_scope.source_version_id::text
          WHERE claim.project_id = p_target_project_id
        )
    UNION SELECT compiled.logical_digest
      FROM projection.compiled_truth AS compiled
      WHERE compiled.project_id = p_target_project_id
        AND EXISTS (
          SELECT 1 FROM canonical.claims AS claim
          JOIN source_scope
            ON claim.source_version_id = source_scope.source_version_id::text
          WHERE claim.project_id = p_target_project_id
        )
    UNION SELECT submission.submission_id::text
      FROM source_product.intake_submissions AS submission
      WHERE submission.project_id = p_target_project_id
    UNION SELECT submission.create_command_id
      FROM source_product.intake_submissions AS submission
      WHERE submission.project_id = p_target_project_id
    UNION SELECT item.submission_item_id::text
      FROM source_product.intake_submission_items AS item
      WHERE item.project_id = p_target_project_id
        AND EXISTS (
          SELECT 1 FROM source_product.intake_submissions AS submission
          WHERE submission.project_id = p_target_project_id
            AND submission.submission_id = item.submission_id
        )
    UNION SELECT item.stage2_submission_id
      FROM source_product.intake_submission_items AS item
      WHERE item.project_id = p_target_project_id AND item.stage2_submission_id IS NOT NULL
    UNION SELECT command.command_id
      FROM frontend_command.command_ledger AS command
      WHERE command.target_project_id = p_target_project_id
        AND command.command_type = ANY(ARRAY[
          'sources.intake.submit.v1', 'sources.intake.cancel.v1',
          'sources.intake.retry.v1', 'sources.duplicate.resolve.v1',
          'sources.candidate.reextract.v1'
        ]::text[])
    UNION SELECT command.client_request_id
      FROM frontend_command.command_ledger AS command
      WHERE command.target_project_id = p_target_project_id
        AND command.command_type = ANY(ARRAY[
          'sources.intake.submit.v1', 'sources.intake.cancel.v1',
          'sources.intake.retry.v1', 'sources.duplicate.resolve.v1',
          'sources.candidate.reextract.v1'
        ]::text[])
    UNION SELECT command.idempotency_key
      FROM frontend_command.command_ledger AS command
      WHERE command.target_project_id = p_target_project_id
        AND command.command_type = ANY(ARRAY[
          'sources.intake.submit.v1', 'sources.intake.cancel.v1',
          'sources.intake.retry.v1', 'sources.duplicate.resolve.v1',
          'sources.candidate.reextract.v1'
        ]::text[])
    UNION SELECT conversation.conversation_id
      FROM frontend_ask.conversations AS conversation
      JOIN affected_conversations AS affected USING (conversation_id)
      WHERE conversation.project_id = p_target_project_id
    UNION SELECT branch.branch_id
      FROM frontend_ask.branches AS branch
      JOIN affected_conversations AS affected USING (conversation_id)
    UNION SELECT turn.turn_id
      FROM frontend_ask.turns AS turn
      JOIN affected_conversations AS affected USING (conversation_id)
    UNION SELECT run.answer_run_id
      FROM frontend_ask.answer_runs AS run
      JOIN affected_conversations AS affected USING (conversation_id)
      WHERE run.project_id = p_target_project_id
    UNION SELECT run.create_command_id
      FROM frontend_ask.answer_runs AS run
      JOIN affected_conversations AS affected USING (conversation_id)
      WHERE run.project_id = p_target_project_id
    UNION SELECT selection.selection_id
      FROM frontend_ask.source_selections AS selection
      JOIN frontend_ask.answer_runs AS run USING (answer_run_id)
      JOIN affected_conversations AS affected USING (conversation_id)
      WHERE selection.project_id = p_target_project_id
    UNION SELECT statement.statement_id
      FROM frontend_ask.statements AS statement
      JOIN frontend_ask.answer_runs AS run USING (answer_run_id)
      JOIN affected_conversations AS affected USING (conversation_id)
      WHERE run.project_id = p_target_project_id
    UNION SELECT citation.citation_id
      FROM frontend_ask.citations AS citation
      JOIN frontend_ask.statements AS statement USING (statement_id)
      JOIN frontend_ask.answer_runs AS run USING (answer_run_id)
      JOIN affected_conversations AS affected USING (conversation_id)
      WHERE run.project_id = p_target_project_id
    UNION SELECT group_row.group_id
      FROM knowledge.review_groups AS group_row
      JOIN source_scope USING (source_version_id)
      WHERE group_row.project_id = p_target_project_id
    UNION SELECT import.import_id::text
      FROM knowledge.entity_vault_imports AS import
      JOIN source_scope USING (source_version_id)
      WHERE import.project_id = p_target_project_id
  )
  SELECT COALESCE(array_agg(DISTINCT token) FILTER (WHERE token IS NOT NULL), ARRAY[]::text[])
  FROM tokens
  );
END
$$;
ALTER FUNCTION connector.t3_project_source_tokens(text) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION connector.t3_project_source_tokens(text) FROM PUBLIC;
