DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1 FROM runtime.schema_migrations
    WHERE name = '093_t3_project_audit_reset_guard.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 094 preflight failed: migration 093 is not registered';
  END IF;
END
$$;

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

CREATE OR REPLACE FUNCTION frontend_command.t3_guard_project_knowledge_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
DECLARE
  bound_project_id text;
  reset_state text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    FOREACH bound_project_id IN ARRAY ARRAY[OLD.target_project_id, OLD.resource_project_id]
    LOOP
      IF bound_project_id IS NOT NULL THEN
        SELECT epoch.state INTO reset_state
        FROM project_admin.project_knowledge_epoch AS epoch
        WHERE epoch.project_id = bound_project_id;
        IF reset_state IS NOT NULL AND reset_state <> 'READY'
           AND NOT project_admin.t3_reset_write_authorized(bound_project_id) THEN
          RAISE EXCEPTION 'Project knowledge reset fences command-ledger writes'
            USING ERRCODE = '55000', CONSTRAINT = 'project_knowledge_reset_write_fence';
        END IF;
      END IF;
    END LOOP;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  FOREACH bound_project_id IN ARRAY ARRAY[NEW.target_project_id, NEW.resource_project_id]
  LOOP
    IF bound_project_id IS NOT NULL THEN
      SELECT epoch.state INTO reset_state
      FROM project_admin.project_knowledge_epoch AS epoch
      WHERE epoch.project_id = bound_project_id;
      IF reset_state IS NOT NULL AND reset_state <> 'READY'
         AND NOT project_admin.t3_reset_write_authorized(bound_project_id) THEN
        RAISE EXCEPTION 'Project knowledge reset fences command-ledger writes'
          USING ERRCODE = '55000', CONSTRAINT = 'project_knowledge_reset_write_fence';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;
ALTER FUNCTION frontend_command.t3_guard_project_knowledge_write()
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_command.t3_guard_project_knowledge_write() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION project_admin.t3_reset_write_authorized(text)
  TO shotgun_schema_owner;
DROP TRIGGER IF EXISTS frontend_command_ledger_t3_write_fence
  ON frontend_command.command_ledger;
CREATE TRIGGER frontend_command_ledger_t3_write_fence
  BEFORE INSERT OR UPDATE OR DELETE ON frontend_command.command_ledger
  FOR EACH ROW EXECUTE FUNCTION frontend_command.t3_guard_project_knowledge_write();

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

CREATE OR REPLACE FUNCTION frontend_command.t3_erase_project_source_commands(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, frontend_command
AS $$
#variable_conflict use_variable
DECLARE
  snapshot jsonb;
  command_ids text[];
  affected bigint;
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
  SELECT request.step_checkpoints->'t3FrontendCommandSnapshot'
    INTO snapshot
  FROM project_admin.project_knowledge_reset_requests AS request
  WHERE request.project_id = target_project_id AND request.request_id = reset_request_id;
  IF snapshot IS NULL THEN
    RAISE EXCEPTION 'Command-ledger snapshot is missing'
      USING ERRCODE = '55000', CONSTRAINT = 't3_command_snapshot_missing';
  END IF;
  IF (snapshot->>'activeCommands')::bigint > 0 THEN
    RAISE EXCEPTION 'Active command outcomes must resolve before erasure'
      USING ERRCODE = '55000', CONSTRAINT = 't3_command_active_outcome';
  END IF;
  IF (snapshot->>'unclassifiedCommands')::bigint > 0 THEN
    RAISE EXCEPTION 'Command-ledger lineage is not classified'
      USING ERRCODE = '55000', CONSTRAINT = 't3_command_unclassified';
  END IF;
  SELECT COALESCE(array_agg(value), '{}'::text[])
    INTO command_ids
  FROM jsonb_array_elements_text(snapshot->'commandIds') AS selected(value);

  UPDATE frontend_command.command_ledger AS ledger
  SET command_revision = ledger.command_revision + 1,
      command_semantic_digest = 't3-content-purged',
      policy_binding = '{}'::jsonb,
      accepted_principal_context = '{}'::jsonb,
      accepted_project_context = '{}'::jsonb,
      accepted_policy_context = '{}'::jsonb,
      preconditions = '[]'::jsonb,
      command_payload = '{}'::jsonb,
      produced_resources = '[]'::jsonb,
      rejection = NULL,
      last_updated_at = now()
  WHERE ledger.command_id = ANY(command_ids)
    AND (ledger.target_project_id = target_project_id OR ledger.resource_project_id = target_project_id);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> cardinality(command_ids) THEN
    RAISE EXCEPTION 'Command-ledger purge target closure changed'
      USING ERRCODE = '55000', CONSTRAINT = 't3_command_target_closure_incomplete';
  END IF;
  RETURN jsonb_build_object('scrubbedCommands', affected);
END
$$;
ALTER FUNCTION frontend_command.t3_erase_project_source_commands(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_command.t3_erase_project_source_commands(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION frontend_command.t3_verify_project_source_commands(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, frontend_command
AS $$
#variable_conflict use_variable
DECLARE
  snapshot jsonb;
  command_ids text[];
  targeted bigint;
  unsanitized bigint;
  active bigint;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  SELECT request.step_checkpoints->'t3FrontendCommandSnapshot'
    INTO snapshot
  FROM project_admin.project_knowledge_reset_requests AS request
  WHERE request.project_id = target_project_id AND request.request_id = reset_request_id;
  IF snapshot IS NULL THEN
    RETURN jsonb_build_object('targetedCommands', 0, 'unsanitizedCommands', 0, 'activeCommands', 0);
  END IF;
  SELECT COALESCE(array_agg(value), '{}'::text[])
    INTO command_ids
  FROM jsonb_array_elements_text(snapshot->'commandIds') AS selected(value);
  SELECT count(*), count(*) FILTER (WHERE
      command_semantic_digest <> 't3-content-purged'
      OR policy_binding <> '{}'::jsonb
      OR accepted_principal_context <> '{}'::jsonb
      OR accepted_project_context <> '{}'::jsonb
      OR accepted_policy_context <> '{}'::jsonb
      OR preconditions <> '[]'::jsonb
      OR command_payload <> '{}'::jsonb
      OR produced_resources <> '[]'::jsonb
      OR rejection IS NOT NULL
    ), count(*) FILTER (WHERE outcome_state IN ('ACCEPTED', 'OUTCOME_UNKNOWN'))
    INTO targeted, unsanitized, active
  FROM frontend_command.command_ledger AS ledger
  WHERE ledger.command_id = ANY(command_ids)
    AND (ledger.target_project_id = target_project_id OR ledger.resource_project_id = target_project_id);
  IF targeted <> cardinality(command_ids) THEN
    unsanitized := unsanitized + 1;
  END IF;
  IF unsanitized = 0 AND active = 0 THEN
    UPDATE project_admin.project_knowledge_reset_requests AS request
    SET step_checkpoints = request.step_checkpoints - 't3FrontendCommandSnapshot',
        updated_at = now()
    WHERE request.project_id = target_project_id AND request.request_id = reset_request_id;
  END IF;
  RETURN jsonb_build_object(
    'targetedCommands', targeted,
    'unsanitizedCommands', unsanitized,
    'activeCommands', active
  );
END
$$;
ALTER FUNCTION frontend_command.t3_verify_project_source_commands(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_command.t3_verify_project_source_commands(text, uuid) FROM PUBLIC;

GRANT USAGE ON SCHEMA frontend_command TO shotgun_schema_owner, shotgun_erasure_executor, shotgun_runtime;
GRANT SELECT, UPDATE ON frontend_command.command_ledger TO shotgun_schema_owner;
GRANT SELECT ON asset.sources, asset.source_versions, source_product.intake_submissions,
  frontend_ask.answer_runs, frontend_ask.source_selections,
  frontend_ask.citations, frontend_ask.statements,
  frontend_ask.answer_run_attempts, frontend_ask.answer_attempt_evidence
  TO shotgun_schema_owner;
GRANT USAGE ON SCHEMA asset, frontend_ask, source_product TO shotgun_schema_owner;
GRANT SELECT ON project_admin.project_knowledge_epoch,
  project_admin.project_knowledge_reset_requests TO shotgun_schema_owner;
GRANT UPDATE (step_checkpoints, updated_at)
  ON project_admin.project_knowledge_reset_requests TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION frontend_command.t3_project_source_command_impact(text)
  TO shotgun_runtime, shotgun_erasure_executor;
GRANT EXECUTE ON FUNCTION frontend_command.t3_snapshot_project_source_commands(text, uuid),
  frontend_command.t3_erase_project_source_commands(text, uuid),
  frontend_command.t3_verify_project_source_commands(text, uuid)
  TO shotgun_erasure_executor;
