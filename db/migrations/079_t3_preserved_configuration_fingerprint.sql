DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '078_t3_project_source_knowledge_reset.sql'
  ) THEN
    RAISE EXCEPTION
      'Migration 079 preflight failed: migration 078 is not registered';
  END IF;
END
$$;

-- The maintenance process must be able to verify preserved identity and
-- configuration after a restart. Store only the opaque digest, never the
-- underlying settings snapshot.
ALTER TABLE project_admin.project_knowledge_reset_requests
  ADD COLUMN preserved_configuration_digest text;

ALTER TABLE project_admin.project_knowledge_reset_requests
  ADD CONSTRAINT project_knowledge_reset_preserved_digest_format
  CHECK (
    preserved_configuration_digest IS NULL OR
    preserved_configuration_digest ~ '^sha256:[a-f0-9]{64}$'
  );

ALTER TABLE project_admin.project_knowledge_reset_requests
  ADD COLUMN owner_manifest_digest text;

ALTER TABLE project_admin.project_knowledge_reset_requests
  ADD CONSTRAINT project_knowledge_reset_owner_manifest_digest_format
  CHECK (
    owner_manifest_digest IS NULL OR
    owner_manifest_digest ~ '^sha256:[a-f0-9]{64}$'
  );
