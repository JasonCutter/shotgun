-- AKP-4 WP5: add Discovery to the existing FE-P5-S1 Activity projection.
-- This is a narrow additive compatibility migration. Discovery runtime
-- authority and its historical migrations (048-051) remain unchanged; no
-- Activity ledger, Finding payload or second Outbox is introduced.

DO $$
BEGIN
  IF to_regclass('frontend_activity.activity_index') IS NULL
     OR to_regclass('frontend_activity.projection_watermarks') IS NULL THEN
    RAISE EXCEPTION 'Migration 052 preflight failed: FE-P5-S1 Activity read model is missing';
  END IF;
END
$$;

-- PostgreSQL generated names for the historical inline checks are not a
-- public contract. Drop only checks whose definition contains the old domain
-- allow-list, then replace them with the same rule plus DISCOVERY.
DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT n.nspname AS schema_name, c.relname AS table_name, con.conname
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'frontend_activity'
      AND c.relname IN ('activity_index', 'projection_watermarks')
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%CONNECTOR_DIAGNOSTICS%'
      AND pg_get_constraintdef(con.oid) NOT LIKE '%DISCOVERY%'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT %I',
      constraint_row.schema_name,
      constraint_row.table_name,
      constraint_row.conname
    );
  END LOOP;
END
$$;

ALTER TABLE frontend_activity.activity_index
  ADD CONSTRAINT activity_index_domain_kind_wp5_ck
  CHECK (domain_kind IN ('SOURCES', 'ASK', 'EXTERNAL_ACTION', 'DISCOVERY', 'CONNECTOR_DIAGNOSTICS'));

ALTER TABLE frontend_activity.activity_index
  ADD CONSTRAINT activity_index_root_domain_wp5_ck
  CHECK (
    (domain_kind = 'ASK' AND root_kind = 'RUN')
    OR (domain_kind IN ('SOURCES', 'EXTERNAL_ACTION', 'DISCOVERY', 'CONNECTOR_DIAGNOSTICS')
        AND root_kind = 'JOB')
  );

ALTER TABLE frontend_activity.projection_watermarks
  ADD CONSTRAINT projection_watermarks_domain_kind_wp5_ck
  CHECK (domain_kind IN ('SOURCES', 'ASK', 'EXTERNAL_ACTION', 'DISCOVERY', 'CONNECTOR_DIAGNOSTICS'));
