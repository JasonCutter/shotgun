-- AKP-7 WP3: derived, rebuildable lookup for the approved typed semantic
-- family matcher. This table is not Finding, feedback, or Canonical authority.

DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '055_akp_7_wp1_feedback_suppression_ranking_storage.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 056 preflight failed: 055 is missing';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS discovery.suppression_semantic_family_projection (
  project_id text NOT NULL,
  suppression_id text NOT NULL,
  source_finding_id text NOT NULL,
  source_finding_revision integer NOT NULL CHECK (source_finding_revision >= 1),
  semantic_family_key text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, suppression_id),
  CONSTRAINT discovery_suppression_semantic_family_projection_fk
    FOREIGN KEY (project_id, suppression_id)
    REFERENCES discovery.suppression_directives (project_id, suppression_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS discovery_suppression_semantic_family_projection_lookup_idx
  ON discovery.suppression_semantic_family_projection (
    project_id, semantic_family_key, created_at, suppression_id
  );

COMMENT ON TABLE discovery.suppression_semantic_family_projection IS
  'Derived/rebuildable semantic-family lookup for bounded Discovery presentation reads; not an authority table.';
