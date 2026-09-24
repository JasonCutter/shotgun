DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '085_t3_transformation_erasure_routines.sql'
  ) THEN
    RAISE EXCEPTION
      'Migration 086 preflight failed: migration 085 is not registered';
  END IF;
END
$$;

-- A deleted conversation cascades its active branch. NO ACTION is deferred,
-- so the cyclic active-branch reference is checked after the same transaction
-- removes both sides; ordinary dangling references still fail at commit.
ALTER TABLE frontend_ask.conversations
  DROP CONSTRAINT frontend_ask_conversation_active_branch_fk;
ALTER TABLE frontend_ask.conversations
  ADD CONSTRAINT frontend_ask_conversation_active_branch_fk
  FOREIGN KEY (conversation_id, active_branch_id)
  REFERENCES frontend_ask.branches(conversation_id, branch_id)
  ON DELETE NO ACTION
  DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION frontend_ask.t3_guard_project_knowledge_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, frontend_ask
AS $$
DECLARE
  target_project_id text;
  reset_state text;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'branches', 'turns' THEN
      SELECT conversation.project_id INTO target_project_id
      FROM frontend_ask.conversations AS conversation
      WHERE conversation.conversation_id = NEW.conversation_id;
    WHEN 'statements' THEN
      SELECT answer_run.project_id INTO target_project_id
      FROM frontend_ask.answer_runs AS answer_run
      WHERE answer_run.answer_run_id = NEW.answer_run_id;
    WHEN 'citations' THEN
      SELECT answer_run.project_id INTO target_project_id
      FROM frontend_ask.statements AS statement
      JOIN frontend_ask.answer_runs AS answer_run
        ON answer_run.answer_run_id = statement.answer_run_id
      WHERE statement.statement_id = NEW.statement_id;
    WHEN 'source_selection_evidence' THEN
      SELECT selection.project_id INTO target_project_id
      FROM frontend_ask.source_selections AS selection
      WHERE selection.selection_id = NEW.selection_id;
    WHEN 'answer_attempt_evidence' THEN
      SELECT attempt.project_id INTO target_project_id
      FROM frontend_ask.answer_run_attempts AS attempt
      WHERE attempt.attempt_id = NEW.attempt_id;
    ELSE
      RAISE EXCEPTION 'Unsupported T3 Ask write-fence table: %', TG_TABLE_NAME
        USING ERRCODE = '55000', CONSTRAINT = 't3_ask_write_fence_unclassified';
  END CASE;

  IF target_project_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT epoch.state INTO reset_state
  FROM project_admin.project_knowledge_epoch AS epoch
  WHERE epoch.project_id = target_project_id;
  IF reset_state IS NULL OR reset_state = 'READY' THEN
    RETURN NEW;
  END IF;
  IF project_admin.t3_reset_write_authorized(target_project_id) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Project knowledge reset fences Ask writes for this Project'
    USING ERRCODE = '55000', CONSTRAINT = 'project_knowledge_reset_write_fence';
END
$$;

ALTER FUNCTION frontend_ask.t3_guard_project_knowledge_write()
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_ask.t3_guard_project_knowledge_write() FROM PUBLIC;
GRANT USAGE ON SCHEMA frontend_ask, asset TO shotgun_schema_owner;
GRANT SELECT ON project_admin.project_knowledge_epoch TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION project_admin.t3_reset_write_authorized(text)
  TO shotgun_schema_owner;
GRANT SELECT ON frontend_ask.conversations, frontend_ask.branches,
  frontend_ask.turns, frontend_ask.answer_runs, frontend_ask.answer_run_attempts,
  frontend_ask.source_selections, frontend_ask.statements TO shotgun_schema_owner;

CREATE TRIGGER frontend_ask_branches_t3_write_fence
  BEFORE INSERT OR UPDATE ON frontend_ask.branches
  FOR EACH ROW EXECUTE FUNCTION frontend_ask.t3_guard_project_knowledge_write();
CREATE TRIGGER frontend_ask_turns_t3_write_fence
  BEFORE INSERT OR UPDATE ON frontend_ask.turns
  FOR EACH ROW EXECUTE FUNCTION frontend_ask.t3_guard_project_knowledge_write();
CREATE TRIGGER frontend_ask_statements_t3_write_fence
  BEFORE INSERT OR UPDATE ON frontend_ask.statements
  FOR EACH ROW EXECUTE FUNCTION frontend_ask.t3_guard_project_knowledge_write();
CREATE TRIGGER frontend_ask_citations_t3_write_fence
  BEFORE INSERT OR UPDATE ON frontend_ask.citations
  FOR EACH ROW EXECUTE FUNCTION frontend_ask.t3_guard_project_knowledge_write();
CREATE TRIGGER frontend_ask_source_selection_evidence_t3_write_fence
  BEFORE INSERT OR UPDATE ON frontend_ask.source_selection_evidence
  FOR EACH ROW EXECUTE FUNCTION frontend_ask.t3_guard_project_knowledge_write();
CREATE TRIGGER frontend_ask_answer_attempt_evidence_t3_write_fence
  BEFORE INSERT OR UPDATE ON frontend_ask.answer_attempt_evidence
  FOR EACH ROW EXECUTE FUNCTION frontend_ask.t3_guard_project_knowledge_write();

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
      ),
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
GRANT USAGE ON SCHEMA frontend_ask TO shotgun_erasure_executor;
GRANT SELECT ON asset.sources, asset.source_versions TO shotgun_schema_owner;
GRANT SELECT, DELETE ON frontend_ask.conversations, frontend_ask.branches,
  frontend_ask.turns, frontend_ask.answer_runs, frontend_ask.source_selections,
  frontend_ask.source_selection_evidence, frontend_ask.statements,
  frontend_ask.citations, frontend_ask.answer_run_attempts,
  frontend_ask.answer_attempt_evidence, frontend_ask.answer_run_events,
  frontend_ask.answer_exports, frontend_ask.answer_feedback,
  frontend_ask.transition_seeds TO shotgun_schema_owner;
GRANT UPDATE (parent_branch_id, origin_turn_id) ON frontend_ask.branches
  TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION frontend_ask.t3_project_ask_status(text, uuid),
  frontend_ask.t3_erase_project_ask(text, uuid) TO shotgun_erasure_executor;
