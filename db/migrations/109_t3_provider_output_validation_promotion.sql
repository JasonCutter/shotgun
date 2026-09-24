DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '108_t3_runtime_product_role_grants.sql'
  ) THEN
    RAISE EXCEPTION
      'Migration 109 preflight failed: migration 108 is not registered';
  END IF;
END
$$;

-- T3 adds a narrowly authorized DELETE path for source erasure. Keep Stage 4's
-- existing one-field structured-output validation promotion available to the
-- normal Product runtime; all other ordinary mutations remain append-only.
CREATE OR REPLACE FUNCTION ai.reject_provider_output_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.structured_output_valid = TRUE
     AND OLD.structured_output_valid IN (TRUE, FALSE)
     AND (to_jsonb(NEW) - 'structured_output_valid') =
         (to_jsonb(OLD) - 'structured_output_valid') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' AND project_admin.t3_reset_write_authorized(OLD.project_id) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'ai.provider_outputs is append-only outside validation promotion or approved T3 erasure'
    USING ERRCODE = '55000', CONSTRAINT = 'ai_provider_output_immutable';
END
$$;
ALTER FUNCTION ai.reject_provider_output_change() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION ai.reject_provider_output_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION project_admin.t3_reset_write_authorized(text) TO shotgun_schema_owner;
