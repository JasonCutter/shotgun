-- Additive FE-P3-S2 Draft aggregate persistence.
-- Existing Stage 5 review.change_sets and other tables are NOT modified.
-- This migration only creates a new frontend_knowledge_draft schema.

DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '024_frontend_phase2_ask_execution_sensitivity.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 025 preflight failed: 024 is missing';
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS frontend_knowledge_draft;

-- Current Draft aggregate. `snapshot` is the authoritative full aggregate
-- round-trip; scalar columns mirror key fields for CAS, constraints and
-- project-scoped lookups only.
CREATE TABLE frontend_knowledge_draft.drafts (
  draft_id text PRIMARY KEY,
  resource_project_id text NOT NULL,
  draft_project_id text NOT NULL,
  effective_project_id text NOT NULL,
  active_project_id text NOT NULL,
  resource_id text NOT NULL,
  seed_id text,
  answer_run_id text,
  start_mode text NOT NULL CHECK (start_mode IN ('SEED_MATERIALIZATION', 'KNOWLEDGE_PAGE')),
  status text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  content_digest text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX frontend_knowledge_draft_drafts_effective_project_idx
  ON frontend_knowledge_draft.drafts (effective_project_id);
CREATE INDEX frontend_knowledge_draft_drafts_draft_project_idx
  ON frontend_knowledge_draft.drafts (draft_project_id);
CREATE INDEX frontend_knowledge_draft_drafts_resource_cas_idx
  ON frontend_knowledge_draft.drafts (resource_project_id, draft_id, revision);

-- Append-only immutable revision history.
CREATE TABLE frontend_knowledge_draft.revisions (
  draft_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL,
  resource_project_id text NOT NULL,
  draft_project_id text NOT NULL,
  effective_project_id text NOT NULL,
  base jsonb NOT NULL,
  operations jsonb NOT NULL,
  content_digest text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (draft_id, revision)
);

CREATE INDEX frontend_knowledge_draft_revisions_project_idx
  ON frontend_knowledge_draft.revisions (resource_project_id, draft_id, revision);

CREATE OR REPLACE FUNCTION frontend_knowledge_draft.block_revision_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'frontend_knowledge_draft.revisions is append-only and immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER frontend_knowledge_draft_revisions_immutable
  BEFORE UPDATE OR DELETE ON frontend_knowledge_draft.revisions
  FOR EACH ROW EXECUTE FUNCTION frontend_knowledge_draft.block_revision_mutation();

-- Append-only typed operations with unique (draft_id, revision, operation_id).
CREATE TABLE frontend_knowledge_draft.operations (
  draft_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  operation_id text NOT NULL,
  operation_ordinal integer NOT NULL CHECK (operation_ordinal > 0),
  resource_project_id text NOT NULL,
  operation jsonb NOT NULL,
  PRIMARY KEY (draft_id, revision, operation_id)
);

CREATE INDEX frontend_knowledge_draft_operations_project_idx
  ON frontend_knowledge_draft.operations (resource_project_id, draft_id, revision);

-- Materialization: one Seed-to-Draft boundary and one materialization per Draft.
CREATE TABLE frontend_knowledge_draft.materializations (
  materialization_id text PRIMARY KEY,
  draft_id text NOT NULL UNIQUE,
  seed_id text,
  target_kind text NOT NULL CHECK (target_kind IN ('SEED', 'RESOURCE', 'PAGE')),
  page_id text,
  resource_id text NOT NULL,
  resource_project_id text NOT NULL,
  draft_project_id text NOT NULL,
  effective_project_id text NOT NULL,
  base jsonb NOT NULL,
  command_identity jsonb NOT NULL,
  replay_principal_id text NOT NULL,
  replay_client_request_id text NOT NULL,
  replay_idempotency_key text NOT NULL,
  semantic_digest text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  -- unique non-null seed identity (Postgres allows multiple NULL rows)
  CONSTRAINT frontend_knowledge_draft_materializations_seed_unique UNIQUE (seed_id)
);

CREATE INDEX frontend_knowledge_draft_materializations_effective_project_idx
  ON frontend_knowledge_draft.materializations (effective_project_id);
CREATE INDEX frontend_knowledge_draft_materializations_draft_project_idx
  ON frontend_knowledge_draft.materializations (draft_project_id);
CREATE INDEX frontend_knowledge_draft_materializations_replay_idx
  ON frontend_knowledge_draft.materializations
    (replay_principal_id, replay_client_request_id, replay_idempotency_key);

-- Validation/Impact artifact references derived from the Draft aggregate.
CREATE TABLE frontend_knowledge_draft.artifact_refs (
  artifact_id text NOT NULL,
  artifact_kind text NOT NULL CHECK (artifact_kind IN ('VALIDATION', 'IMPACT')),
  draft_id text NOT NULL,
  draft_revision integer NOT NULL CHECK (draft_revision > 0),
  artifact_revision integer NOT NULL CHECK (artifact_revision > 0),
  digest text NOT NULL,
  status text NOT NULL,
  resource_project_id text NOT NULL,
  project_policy_context jsonb NOT NULL,
  PRIMARY KEY (artifact_id, artifact_kind)
);

CREATE INDEX frontend_knowledge_draft_artifact_refs_project_idx
  ON frontend_knowledge_draft.artifact_refs (resource_project_id, draft_id);
