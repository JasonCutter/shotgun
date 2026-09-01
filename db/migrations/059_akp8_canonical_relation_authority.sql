-- AKP-8 WP2A / ADR-152: durable Canonical Relation authority.
-- Relations are bounded ADD_RELATION writes only. Entity authority remains in
-- the approved Knowledge Model; this table stores the Canonical edge and its
-- Review Approval provenance.

DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '058_akp8_typed_proposition_conflict_authority.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 059 preflight failed: canonical base migration 058 is missing';
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS canonical;

CREATE TABLE IF NOT EXISTS canonical.relations (
  relation_id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  revision_number integer NOT NULL CHECK (revision_number = 1),
  logical_identity_key text NOT NULL,
  relation_type text NOT NULL CHECK (length(trim(relation_type)) > 0),
  direction text NOT NULL CHECK (direction IN ('DIRECTED', 'UNDIRECTED')),
  from_endpoint jsonb NOT NULL CHECK (jsonb_typeof(from_endpoint) = 'object'),
  to_endpoint jsonb NOT NULL CHECK (jsonb_typeof(to_endpoint) = 'object'),
  valid_from timestamptz,
  valid_to timestamptz,
  evidence_ids text[] NOT NULL,
  access_scope text[] NOT NULL CHECK (cardinality(access_scope) > 0),
  sensitivity text NOT NULL CHECK (sensitivity IN ('public', 'internal', 'private', 'restricted')),
  authority_json jsonb NOT NULL CHECK (jsonb_typeof(authority_json) = 'object'),
  discovery_provenance_ref text,
  relation_json jsonb NOT NULL CHECK (jsonb_typeof(relation_json) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, logical_identity_key),
  UNIQUE (project_id, relation_id),
  CHECK (from_endpoint->>'authority' = 'APPROVED_KNOWLEDGE'),
  CHECK (to_endpoint->>'authority' = 'APPROVED_KNOWLEDGE'),
  CHECK (from_endpoint->>'resourceType' = 'ENTITY'),
  CHECK (to_endpoint->>'resourceType' = 'ENTITY'),
  CHECK (from_endpoint->>'projectId' = project_id),
  CHECK (to_endpoint->>'projectId' = project_id),
  CHECK ((from_endpoint->>'resourceRevision') ~ '^[1-9][0-9]*$'),
  CHECK ((to_endpoint->>'resourceRevision') ~ '^[1-9][0-9]*$'),
  CHECK (authority_json->>'kind' = 'FRONTEND_REVIEW_APPROVAL'),
  CHECK (relation_json->>'relationId' = relation_id),
  CHECK (relation_json->>'logicalIdentityKey' = logical_identity_key),
  CHECK (relation_json->>'projectId' = project_id),
  CHECK (relation_json->>'revisionNumber' = revision_number::text)
);

CREATE INDEX IF NOT EXISTS canonical_relations_project_idx
  ON canonical.relations (project_id, relation_id);

CREATE OR REPLACE FUNCTION canonical.relations_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'canonical.relations is append-only';
END;
$$;

DROP TRIGGER IF EXISTS canonical_relations_append_only ON canonical.relations;
CREATE TRIGGER canonical_relations_append_only
  BEFORE UPDATE OR DELETE ON canonical.relations
  FOR EACH ROW EXECUTE FUNCTION canonical.relations_append_only();

-- The accepted Discovery authoring precursor remains immutable and non-
-- Canonical. This server-owned append-only table links that exact Review
-- Resource revision to the Canonical Relation created in the same commit
-- transaction. It is deliberately separate from the immutable source row.
CREATE TABLE IF NOT EXISTS canonical.relation_precursors (
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  review_resource_id text NOT NULL,
  review_resource_revision integer NOT NULL CHECK (review_resource_revision >= 1),
  relation_id text NOT NULL,
  relation_revision integer NOT NULL CHECK (relation_revision = 1),
  linked_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, review_resource_id, review_resource_revision),
  UNIQUE (project_id, relation_id, relation_revision),
  CONSTRAINT canonical_relation_precursor_resource_fk
    FOREIGN KEY (project_id, review_resource_id, review_resource_revision)
    REFERENCES discovery.reentry_review_resources (
      project_id, review_resource_id, resource_revision
    )
    ON DELETE RESTRICT,
  CONSTRAINT canonical_relation_precursor_relation_fk
    FOREIGN KEY (project_id, relation_id)
    REFERENCES canonical.relations (project_id, relation_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS canonical_relation_precursors_relation_idx
  ON canonical.relation_precursors (project_id, relation_id, relation_revision);

CREATE OR REPLACE FUNCTION canonical.relation_precursors_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'canonical.relation_precursors is append-only';
END;
$$;

DROP TRIGGER IF EXISTS canonical_relation_precursors_append_only ON canonical.relation_precursors;
CREATE TRIGGER canonical_relation_precursors_append_only
  BEFORE UPDATE OR DELETE ON canonical.relation_precursors
  FOR EACH ROW EXECUTE FUNCTION canonical.relation_precursors_append_only();
