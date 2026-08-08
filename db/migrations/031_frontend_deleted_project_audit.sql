-- Additive FE-P5-S2 Deleted Project audit persistence (IR r1 §4 Scope B).
-- Bounded additive migration ONLY: creates the `project_audit` schema with
-- `project_tombstones` and `deleted_project_audit_scopes`. General Workspace
-- access stops on tombstone; separately authorized audit scope may preserve
-- lineage. Past membership alone never grants deleted-project audit access and
-- current Capability revalidation is always required (ADR-112 §11/§12,
-- ADR-131 §6).

DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '030_frontend_history_projection.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 031 preflight failed: 030 is missing';
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS project_audit;

-- Deleted Project tombstone: identity preserved, audit lineage digest kept.
CREATE TABLE project_audit.project_tombstones (
  project_id text PRIMARY KEY,
  deleted_at timestamptz NOT NULL,
  deleted_by text NOT NULL,
  reason text NOT NULL,
  retention_class text NOT NULL,
  lineage_digest text NOT NULL
);

-- Separately authorized deleted-project audit scope. Scope binding alone is
-- never sufficient: read requires current Capability revalidation.
CREATE TABLE project_audit.deleted_project_audit_scopes (
  scope_id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES project_audit.project_tombstones(project_id),
  granted_principal_ids jsonb NOT NULL,
  granted_at timestamptz NOT NULL,
  granted_by text NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX deleted_project_audit_scopes_project_idx
  ON project_audit.deleted_project_audit_scopes (project_id);
