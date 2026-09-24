DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '079_t3_preserved_configuration_fingerprint.sql'
  ) THEN
    RAISE EXCEPTION
      'Migration 080 preflight failed: migration 079 is not registered';
  END IF;
END
$$;

-- Roles are intentionally created without login credentials. Deployment must
-- provision distinct secrets and prove the runtime/executor connection split.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shotgun_schema_owner') THEN
    CREATE ROLE shotgun_schema_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOINHERIT NOBYPASSRLS NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shotgun_runtime') THEN
    CREATE ROLE shotgun_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOINHERIT NOBYPASSRLS NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shotgun_erasure_executor') THEN
    CREATE ROLE shotgun_erasure_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOINHERIT NOBYPASSRLS NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shotgun_migrator') THEN
    CREATE ROLE shotgun_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOINHERIT NOBYPASSRLS NOREPLICATION;
  END IF;
END
$$;

DO $$
DECLARE
  role_state record;
BEGIN
  FOR role_state IN
    SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolinherit,
           rolbypassrls, rolreplication
    FROM pg_roles
    WHERE rolname IN (
      'shotgun_schema_owner', 'shotgun_runtime', 'shotgun_erasure_executor', 'shotgun_migrator'
    )
  LOOP
    IF role_state.rolsuper OR role_state.rolcreatedb OR role_state.rolcreaterole
       OR role_state.rolinherit OR role_state.rolbypassrls OR role_state.rolreplication THEN
      RAISE EXCEPTION 'Migration 080 preflight failed: privileged role attributes on %',
        role_state.rolname;
    END IF;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION project_admin.t3_reset_write_authorized(target_project_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
DECLARE
  request_setting text;
  request_uuid uuid;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RETURN false;
  END IF;

  request_setting := current_setting('shotgun.t3_reset_request_id', true);
  IF request_setting IS NULL OR request_setting = '' THEN
    RETURN false;
  END IF;

  BEGIN
    request_uuid := request_setting::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;

  RETURN EXISTS (
    SELECT 1
    FROM project_admin.project_knowledge_reset_requests AS request
    JOIN project_admin.project_knowledge_epoch AS epoch
      ON epoch.project_id = request.project_id
     AND epoch.epoch = request.resulting_knowledge_epoch
    WHERE request.project_id = target_project_id
      AND request.request_id = request_uuid
      AND request.state IN ('PURGING', 'REBUILDING', 'VERIFYING')
      AND request.owner_manifest_digest IS NOT NULL
      AND epoch.state = 'RESET_PENDING'
  );
END
$$;

ALTER FUNCTION project_admin.t3_reset_write_authorized(text) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION project_admin.t3_reset_write_authorized(text) FROM PUBLIC;
GRANT USAGE ON SCHEMA project_admin TO shotgun_schema_owner;
GRANT SELECT ON project_admin.project_knowledge_epoch,
  project_admin.project_knowledge_reset_requests TO shotgun_schema_owner;

CREATE OR REPLACE FUNCTION project_admin.t3_guard_project_knowledge_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
DECLARE
  target_project_id text;
  reset_state text;
BEGIN
  target_project_id := NEW.project_id;
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

  RAISE EXCEPTION 'Project knowledge reset fences writes for this Project'
    USING ERRCODE = '55000', CONSTRAINT = 'project_knowledge_reset_write_fence';
END
$$;

ALTER FUNCTION project_admin.t3_guard_project_knowledge_write() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION project_admin.t3_guard_project_knowledge_write() FROM PUBLIC;
GRANT SELECT ON project_admin.project_knowledge_epoch TO shotgun_schema_owner;

-- These owner schemas contain Source-derived, mixed-lineage, or rebuildable
-- records. Preserved identity/configuration tables are excluded explicitly.
DO $$
DECLARE
  relation record;
BEGIN
  FOR relation IN
    SELECT table_schema, table_name
    FROM information_schema.columns
    WHERE column_name = 'project_id'
      AND table_schema = ANY(ARRAY[
        'action', 'ai', 'asset', 'candidate', 'canonical', 'comparison', 'connector',
        'discovery', 'evidence', 'frontend_activity', 'frontend_ask', 'frontend_command',
        'frontend_external_action', 'frontend_history', 'frontend_knowledge_draft',
        'frontend_knowledge_graph', 'frontend_review', 'intake', 'knowledge',
        'project_admin', 'project_audit', 'projection', 'review', 'settings', 'source_product',
        'transformation', 'validation'
      ]::text[])
      AND NOT (table_schema = 'ai' AND table_name = ANY(ARRAY[
        'project_ai_configuration_revisions', 'project_ai_configurations',
        'project_standing_ai_processing_policies',
        'project_standing_ai_processing_policy_revisions', 'provider_credentials'
      ]::text[]))
      AND NOT (table_schema = 'discovery' AND table_name = ANY(ARRAY[
        'model_profiles', 'ranking_policy_revisions', 'schedules'
      ]::text[]))
      AND NOT (table_schema = 'frontend_external_action' AND table_name = ANY(ARRAY[
        'budgets', 'credentials'
      ]::text[]))
      AND NOT (table_schema = 'project_admin' AND table_name = ANY(ARRAY[
        'projects', 'project_revisions', 'project_knowledge_epoch',
        'project_knowledge_reset_requests'
      ]::text[]))
      AND NOT (table_schema = 'projection' AND table_name = 'semantic_embedding_profiles')
      AND NOT (table_schema = 'settings' AND table_name = ANY(ARRAY[
        'history_payload_state', 'policy_context_revisions', 'preference_command_results',
        'preference_commands', 'preference_revisions', 'principal_preferences',
        'project_settings', 'provider_external_transfer_approval_revisions',
        'provider_external_transfer_approvals', 'settings_audit_events',
        'settings_command_results', 'settings_commands', 'settings_revisions', 'system_settings'
      ]::text[]))
  LOOP
    EXECUTE format(
      'CREATE TRIGGER t3_project_knowledge_write_fence '
      'BEFORE INSERT OR UPDATE ON %I.%I '
      'FOR EACH ROW EXECUTE FUNCTION project_admin.t3_guard_project_knowledge_write()',
      relation.table_schema,
      relation.table_name
    );
  END LOOP;
END
$$;
