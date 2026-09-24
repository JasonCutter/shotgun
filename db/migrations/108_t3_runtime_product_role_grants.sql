DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '107_t3_canonical_reset_history_publication.sql'
  ) THEN
    RAISE EXCEPTION
      'Migration 108 preflight failed: migration 107 is not registered';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shotgun_runtime') OR
     NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shotgun_erasure_executor') OR
     NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shotgun_schema_owner') THEN
    RAISE EXCEPTION
      'Migration 108 preflight failed: T3 database roles are missing';
  END IF;
END
$$;

-- Give the non-superuser runtime the DML needed by Shotgun's PostgreSQL
-- adapters. T3 snapshots, reset control state, and Canonical reset events stay
-- behind their reviewed owner routines and are explicitly excluded below.
DO $$
DECLARE
  application_schema text;
  rel record;
BEGIN
  FOREACH application_schema IN ARRAY ARRAY[
    'action', 'ai', 'asset', 'auth', 'candidate', 'canonical', 'comparison',
    'connector', 'discovery', 'evidence', 'frontend_activity', 'frontend_ask',
    'frontend_command', 'frontend_external_action', 'frontend_history',
    'frontend_knowledge_draft', 'frontend_knowledge_graph', 'frontend_review',
    'intake', 'knowledge', 'project_admin', 'project_audit', 'projection',
    'review', 'settings', 'source_product', 'transformation', 'validation'
  ] LOOP
    IF to_regnamespace(application_schema) IS NULL THEN
      RAISE EXCEPTION 'Migration 108 preflight failed: schema % is missing',
        application_schema;
    END IF;
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO shotgun_runtime', application_schema);

    FOR rel IN
      SELECT relation.relname, relation.relkind
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = application_schema
        AND relation.relkind IN ('r', 'p', 'v', 'm')
      ORDER BY relation.relname
    LOOP
      IF left(rel.relname, 3) = 't3_' OR
         (application_schema = 'project_admin' AND rel.relname IN (
           'project_knowledge_epoch', 'project_knowledge_reset_requests'
         )) OR
         (application_schema = 'canonical' AND rel.relname = 'knowledge_reset_events') THEN
        CONTINUE;
      END IF;
      IF rel.relkind IN ('r', 'p') THEN
        EXECUTE format(
          'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO shotgun_runtime',
          application_schema,
          rel.relname
        );
      ELSE
        EXECUTE format(
          'GRANT SELECT ON TABLE %I.%I TO shotgun_runtime',
          application_schema,
          rel.relname
        );
      END IF;
    END LOOP;

    EXECUTE format(
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO shotgun_runtime',
      application_schema
    );
  END LOOP;
END
$$;

-- The storage inventory verifier counts the migration ledger as a managed
-- table. Runtime can read its migration names but cannot modify the ledger.
GRANT USAGE ON SCHEMA runtime TO shotgun_runtime;
GRANT SELECT ON runtime.schema_migrations TO shotgun_runtime;

-- Runtime may submit and read Owner-approved requests, but it cannot advance
-- execution state, delete requests, access the opaque actor field, or read the
-- executor's retained Canonical recovery snapshots.
GRANT SELECT, INSERT, UPDATE ON project_admin.project_knowledge_epoch TO shotgun_runtime;
GRANT INSERT ON project_admin.project_knowledge_reset_requests TO shotgun_runtime;
GRANT SELECT (
  request_id, preview_id, project_id, project_revision, expected_knowledge_epoch,
  resulting_knowledge_epoch, manifest_digest, owner_manifest_digest,
  preserved_configuration_digest, idempotency_key, state, blocker_codes,
  impact_counts, step_checkpoints, created_at, updated_at, completed_at
) ON project_admin.project_knowledge_reset_requests TO shotgun_runtime;
GRANT EXECUTE ON FUNCTION project_admin.t3_read_reset_actor(text, uuid) TO shotgun_runtime;
GRANT EXECUTE ON FUNCTION canonical.t3_list_project_knowledge_reset_events(text)
  TO shotgun_runtime;

DO $$
DECLARE
  impact_function regprocedure;
BEGIN
  FOR impact_function IN
    SELECT procedure.oid::regprocedure
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname IN (
      'action', 'ai', 'asset', 'candidate', 'canonical', 'comparison', 'connector',
      'discovery', 'evidence', 'frontend_activity', 'frontend_ask', 'frontend_command',
      'frontend_external_action', 'frontend_history', 'frontend_knowledge_draft',
      'frontend_knowledge_graph', 'frontend_review', 'intake', 'knowledge',
      'project_audit', 'projection', 'review', 'settings', 'source_product',
      'transformation', 'validation'
    )
      AND procedure.pronargs = 1
      AND procedure.proargtypes[0] = 'text'::regtype
      AND left(procedure.proname, length('t3_project_')) = 't3_project_'
      AND right(procedure.proname, length('_impact')) = '_impact'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO shotgun_runtime', impact_function);
  END LOOP;
END
$$;

-- Sensitive objects created by the migration owner keep their explicit
-- executor-only grants even when they share a Product schema.
REVOKE ALL ON canonical.t3_reset_owner_snapshots,
  canonical.t3_reset_owner_snapshot_rows FROM shotgun_runtime;
REVOKE ALL ON canonical.knowledge_reset_events FROM shotgun_runtime;
REVOKE UPDATE, DELETE ON project_admin.project_knowledge_reset_requests FROM shotgun_runtime;
