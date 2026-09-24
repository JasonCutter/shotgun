DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '082_t3_intake_erasure_routines.sql'
  ) THEN
    RAISE EXCEPTION
      'Migration 083 preflight failed: migration 082 is not registered';
  END IF;
END
$$;

GRANT SELECT, UPDATE ON project_admin.project_knowledge_epoch,
  project_admin.project_knowledge_reset_requests TO shotgun_schema_owner;
GRANT USAGE ON SCHEMA project_admin TO shotgun_runtime, shotgun_erasure_executor;

CREATE OR REPLACE FUNCTION project_admin.t3_read_reset_execution_snapshot(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
DECLARE
  snapshot jsonb;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;

  SELECT jsonb_build_object(
    'request', jsonb_build_object(
      'request_id', request.request_id,
      'preview_id', request.preview_id,
      'project_id', request.project_id,
      'project_revision', request.project_revision,
      'expected_knowledge_epoch', request.expected_knowledge_epoch,
      'resulting_knowledge_epoch', request.resulting_knowledge_epoch,
      'manifest_digest', request.manifest_digest,
      'owner_manifest_digest', request.owner_manifest_digest,
      'preserved_configuration_digest', request.preserved_configuration_digest,
      'state', request.state,
      'blocker_codes', request.blocker_codes,
      'impact_counts', request.impact_counts,
      'step_checkpoints', request.step_checkpoints,
      'created_at', request.created_at,
      'updated_at', request.updated_at,
      'completed_at', request.completed_at
    ),
    'completed_steps', COALESCE(request.step_checkpoints, '{}'::jsonb)
  )
  INTO snapshot
  FROM project_admin.project_knowledge_reset_requests AS request
  WHERE request.project_id = target_project_id
    AND request.request_id = reset_request_id;

  RETURN snapshot;
END
$$;

-- Runtime needs only the approved actor identity to rebuild Activity under
-- the same server-derived membership scope. Keep the reset request table
-- private and expose this one-field, Project/request-bound lookup instead.
CREATE OR REPLACE FUNCTION project_admin.t3_read_reset_actor(
  target_project_id text,
  reset_request_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
  SELECT request.actor_principal_id::text
  FROM project_admin.project_knowledge_reset_requests AS request
  WHERE request.project_id = target_project_id
    AND request.request_id = reset_request_id
$$;

ALTER FUNCTION project_admin.t3_read_reset_execution_snapshot(text, uuid)
  OWNER TO shotgun_schema_owner;
ALTER FUNCTION project_admin.t3_read_reset_actor(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION project_admin.t3_read_reset_execution_snapshot(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION project_admin.t3_read_reset_actor(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION project_admin.t3_set_reset_execution_state(
  target_project_id text,
  reset_request_id uuid,
  next_state text,
  next_blocker_codes text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
DECLARE
  current_state text;
  resulting_epoch bigint;
  project_state text;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  IF next_state NOT IN (
    'FENCING', 'PURGING', 'REBUILDING', 'VERIFYING', 'BLOCKED',
    'OUTCOME_UNKNOWN', 'ERASURE_UNVERIFIED'
  ) THEN
    RAISE EXCEPTION 'Invalid reset execution state'
      USING ERRCODE = '22023', CONSTRAINT = 't3_reset_execution_state_invalid';
  END IF;

  SELECT state, resulting_knowledge_epoch
    INTO current_state, resulting_epoch
  FROM project_admin.project_knowledge_reset_requests
  WHERE project_id = target_project_id AND request_id = reset_request_id
  FOR UPDATE;
  IF current_state IS NULL OR current_state = 'COMPLETE' THEN
    RAISE EXCEPTION 'Reset request is not executable'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_found';
  END IF;

  project_state := CASE
    WHEN next_state = 'BLOCKED' THEN 'RESET_FAILED'
    WHEN next_state IN ('OUTCOME_UNKNOWN', 'ERASURE_UNVERIFIED') THEN 'RESET_UNVERIFIED'
    ELSE 'RESET_PENDING'
  END;
  UPDATE project_admin.project_knowledge_reset_requests
  SET state = next_state,
      blocker_codes = COALESCE(next_blocker_codes, '{}'::text[]),
      updated_at = now()
  WHERE project_id = target_project_id AND request_id = reset_request_id;
  UPDATE project_admin.project_knowledge_epoch
  SET state = project_state, updated_at = now()
  WHERE project_id = target_project_id AND epoch = resulting_epoch;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project knowledge epoch changed'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_epoch_mismatch';
  END IF;
END
$$;

ALTER FUNCTION project_admin.t3_set_reset_execution_state(text, uuid, text, text[])
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION project_admin.t3_set_reset_execution_state(text, uuid, text, text[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION project_admin.t3_checkpoint_reset_execution_step(
  target_project_id text,
  reset_request_id uuid,
  checkpoint_name text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
DECLARE
  checkpoint_phase text;
  checkpoint_owner text;
  owner_ids text[] := ARRAY[
    'external-action', 'action', 'ask', 'review', 'knowledge-draft',
    'comparison', 'validation', 'candidate', 'ai-output', 'projection',
    'knowledge-graph', 'activity', 'history', 'canonical', 'discovery', 'knowledge',
    'source-product', 'intake', 'evidence', 'transformation', 'asset',
    'connector', 'frontend-command', 'project-audit', 'settings'
  ];
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;

  checkpoint_phase := split_part(checkpoint_name, ':', 1);
  checkpoint_owner := split_part(checkpoint_name, ':', 2);
  IF checkpoint_name <> 'manifest:approved-impact' AND NOT (
    checkpoint_phase = ANY(ARRAY['fence', 'purge', 'rebuild', 'verify'])
    AND checkpoint_owner = ANY(owner_ids)
    AND checkpoint_name = checkpoint_phase || ':' || checkpoint_owner
  ) THEN
    RAISE EXCEPTION 'Invalid reset execution checkpoint'
      USING ERRCODE = '22023', CONSTRAINT = 't3_reset_checkpoint_invalid';
  END IF;

  UPDATE project_admin.project_knowledge_reset_requests
  SET step_checkpoints = jsonb_set(
        step_checkpoints, ARRAY[checkpoint_name], 'true'::jsonb, true
      ),
      updated_at = now()
  WHERE project_id = target_project_id
    AND request_id = reset_request_id
    AND state <> 'COMPLETE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reset checkpoint target was not found'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_found';
  END IF;
END
$$;

ALTER FUNCTION project_admin.t3_checkpoint_reset_execution_step(text, uuid, text)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION project_admin.t3_checkpoint_reset_execution_step(text, uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION project_admin.t3_complete_reset_execution(
  target_project_id text,
  reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
DECLARE
  request project_admin.project_knowledge_reset_requests%ROWTYPE;
  owner_ids text[] := ARRAY[
    'external-action', 'action', 'ask', 'review', 'knowledge-draft',
    'comparison', 'validation', 'candidate', 'ai-output', 'projection',
    'knowledge-graph', 'activity', 'history', 'canonical', 'discovery', 'knowledge',
    'source-product', 'intake', 'evidence', 'transformation', 'asset',
    'connector', 'frontend-command', 'project-audit', 'settings'
  ];
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;

  SELECT * INTO request
  FROM project_admin.project_knowledge_reset_requests
  WHERE project_id = target_project_id AND request_id = reset_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reset request was not found'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_found';
  END IF;
  IF request.state = 'COMPLETE' THEN
    RETURN jsonb_build_object(
      'request_id', request.request_id,
      'project_id', request.project_id,
      'project_revision', request.project_revision,
      'expected_knowledge_epoch', request.expected_knowledge_epoch,
      'resulting_knowledge_epoch', request.resulting_knowledge_epoch,
      'manifest_digest', request.manifest_digest,
      'owner_manifest_digest', request.owner_manifest_digest,
      'preserved_configuration_digest', request.preserved_configuration_digest,
      'state', request.state,
      'blocker_codes', request.blocker_codes,
      'impact_counts', request.impact_counts,
      'step_checkpoints', request.step_checkpoints,
      'created_at', request.created_at,
      'updated_at', request.updated_at,
      'completed_at', request.completed_at
    );
  END IF;
  IF request.state <> 'VERIFYING' OR request.owner_manifest_digest IS NULL THEN
    RAISE EXCEPTION 'Reset request has not completed verification'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_verification_incomplete';
  END IF;
  IF request.step_checkpoints ->> 'manifest:approved-impact' IS DISTINCT FROM 'true'
     OR EXISTS (
       SELECT 1
       FROM unnest(owner_ids) AS owner(owner_id)
       CROSS JOIN unnest(ARRAY['fence', 'purge', 'rebuild', 'verify']) AS phases(phase)
       WHERE request.step_checkpoints ->> (phase || ':' || owner_id) IS DISTINCT FROM 'true'
     ) THEN
    RAISE EXCEPTION 'Reset owner checkpoint set is incomplete'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_checkpoints_incomplete';
  END IF;

  UPDATE project_admin.project_knowledge_reset_requests
  SET state = 'COMPLETE', blocker_codes = '{}', owner_manifest_digest = NULL,
      completed_at = now(), updated_at = now()
  WHERE project_id = target_project_id AND request_id = reset_request_id;
  UPDATE project_admin.project_knowledge_epoch
  SET state = 'READY', updated_at = now()
  WHERE project_id = target_project_id
    AND epoch = request.resulting_knowledge_epoch
    AND state IN ('RESET_PENDING', 'RESET_UNVERIFIED');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project reset epoch could not be released'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_epoch_mismatch';
  END IF;

  RETURN jsonb_build_object(
    'request_id', request.request_id,
    'project_id', request.project_id,
    'project_revision', request.project_revision,
    'expected_knowledge_epoch', request.expected_knowledge_epoch,
    'resulting_knowledge_epoch', request.resulting_knowledge_epoch,
    'manifest_digest', request.manifest_digest,
    'owner_manifest_digest', NULL,
    'preserved_configuration_digest', request.preserved_configuration_digest,
    'state', 'COMPLETE',
    'blocker_codes', ARRAY[]::text[],
    'impact_counts', request.impact_counts,
    'step_checkpoints', request.step_checkpoints,
    'created_at', request.created_at,
    'updated_at', now(),
    'completed_at', now()
  );
END
$$;

ALTER FUNCTION project_admin.t3_complete_reset_execution(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION project_admin.t3_complete_reset_execution(text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION project_admin.t3_read_reset_execution_snapshot(text, uuid),
  project_admin.t3_set_reset_execution_state(text, uuid, text, text[]),
  project_admin.t3_checkpoint_reset_execution_step(text, uuid, text),
  project_admin.t3_complete_reset_execution(text, uuid)
  TO shotgun_erasure_executor;
GRANT EXECUTE ON FUNCTION project_admin.t3_read_reset_actor(text, uuid)
  TO shotgun_runtime;
