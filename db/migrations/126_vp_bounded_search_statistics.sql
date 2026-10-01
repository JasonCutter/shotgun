DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1 FROM runtime.schema_migrations
     WHERE name = '125_vp_directional_semantic_relations.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 126 preflight failed: migration 125 is not registered';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shotgun_runtime') OR
     NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shotgun_schema_owner') THEN
    RAISE EXCEPTION 'Migration 126 preflight failed: Shotgun database roles are missing';
  END IF;
END
$$;

-- PostgreSQL 16 only allows a table owner (or superuser) to run ANALYZE.
-- Keep the refreshed tables under the existing non-login schema-owner role;
-- runtime keeps its prior DML grants and receives no general maintenance power.
ALTER TABLE asset.source_versions OWNER TO shotgun_schema_owner;
ALTER TABLE candidate.batches OWNER TO shotgun_schema_owner;
ALTER TABLE candidate.claim_candidates OWNER TO shotgun_schema_owner;
ALTER TABLE validation.results OWNER TO shotgun_schema_owner;
ALTER TABLE source_product.source_stage3_progress OWNER TO shotgun_schema_owner;
ALTER TABLE evidence.indexing_results OWNER TO shotgun_schema_owner;
ALTER TABLE evidence.spans OWNER TO shotgun_schema_owner;
ALTER TABLE vp.assertions OWNER TO shotgun_schema_owner;
ALTER TABLE vp.relations OWNER TO shotgun_schema_owner;
ALTER TABLE vp.decision_receipts OWNER TO shotgun_schema_owner;
ALTER TABLE vp.relation_jobs OWNER TO shotgun_schema_owner;

CREATE FUNCTION vp.refresh_search_statistics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  ANALYZE asset.source_versions;
  ANALYZE candidate.batches;
  ANALYZE candidate.claim_candidates;
  ANALYZE validation.results;
  ANALYZE source_product.source_stage3_progress;
  ANALYZE evidence.indexing_results;
  ANALYZE evidence.spans;
  ANALYZE vp.assertions;
  ANALYZE vp.relations;
  ANALYZE vp.decision_receipts;
  ANALYZE vp.relation_jobs;
END
$$;

ALTER FUNCTION vp.refresh_search_statistics() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION vp.refresh_search_statistics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vp.refresh_search_statistics() TO shotgun_runtime;
