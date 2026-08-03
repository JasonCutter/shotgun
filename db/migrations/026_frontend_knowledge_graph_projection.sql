-- Additive FE-P3-S3 Semantic Graph projection persistence (ADR-127, accepted
-- 2026-08-04; Contract Snapshot revision 5).
-- Existing Stage 9 knowledge model, Canonical and Draft tables are NOT
-- modified. Overlay items are never persisted as Canonical edges.
-- This migration only creates the frontend_knowledge_graph schema.

DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '025_frontend_knowledge_draft_persistence.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 026 preflight failed: 025 is missing';
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS frontend_knowledge_graph;

-- Immutable Snapshot Context descriptor. Stores NO graph node/edge payloads.
-- normalized_filters carries the actual normalized GraphFilterSetV1 JSON;
-- filters_digest is kept for integrity validation.
CREATE TABLE frontend_knowledge_graph.snapshot_context (
  snapshot_id text PRIMARY KEY,
  project_id text NOT NULL,
  view_kind text NOT NULL
    CHECK (view_kind IN ('KNOWLEDGE_SEMANTIC', 'GOVERNANCE_IMPACT', 'OPERATIONAL_DEPENDENCY')),
  overlay_kinds jsonb NOT NULL,
  root_refs jsonb NOT NULL,
  normalized_filters jsonb NOT NULL,
  filters_digest text NOT NULL,
  limits jsonb NOT NULL,
  access_revision text NOT NULL,
  policy_context_revision text NOT NULL,
  projection_revision text NOT NULL,
  generated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX frontend_knowledge_graph_snapshot_context_project_idx
  ON frontend_knowledge_graph.snapshot_context (project_id, generated_at);

CREATE OR REPLACE FUNCTION frontend_knowledge_graph.block_snapshot_context_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'frontend_knowledge_graph.snapshot_context is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER frontend_knowledge_graph_snapshot_context_immutable
  BEFORE UPDATE OR DELETE ON frontend_knowledge_graph.snapshot_context
  FOR EACH ROW EXECUTE FUNCTION frontend_knowledge_graph.block_snapshot_context_mutation();

-- Materialized projection-health registry, one row per (project, view kind).
CREATE TABLE frontend_knowledge_graph.projection_health (
  project_id text NOT NULL,
  view_kind text NOT NULL
    CHECK (view_kind IN ('KNOWLEDGE_SEMANTIC', 'GOVERNANCE_IMPACT', 'OPERATIONAL_DEPENDENCY')),
  projection_revision text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('COMPLETE', 'PARTIAL', 'TRUNCATED', 'STALE', 'REBUILDING', 'FAILED', 'UNAVAILABLE', 'ACCESS_RESTRICTED')),
  generated_at timestamptz NOT NULL,
  lag integer NOT NULL DEFAULT 0 CHECK (lag >= 0),
  rebuild_state text NOT NULL DEFAULT 'IDLE'
    CHECK (rebuild_state IN ('IDLE', 'REBUILDING', 'FAILED')),
  access_revision text NOT NULL,
  policy_context_revision text NOT NULL,
  PRIMARY KEY (project_id, view_kind)
);

-- Overlay health/identity, one row per (project, base snapshot, overlay kind).
CREATE TABLE frontend_knowledge_graph.overlay_health (
  project_id text NOT NULL,
  base_snapshot_id text NOT NULL,
  overlay_kind text NOT NULL
    CHECK (overlay_kind IN ('CONFLICT', 'KNOWLEDGE_GAP', 'RECURSIVE_IMPACT')),
  overlay_snapshot_id text NOT NULL,
  overlay_revision text NOT NULL,
  analyzer_revision text NOT NULL,
  policy_context_revision text NOT NULL,
  generated_at timestamptz NOT NULL,
  completeness text NOT NULL
    CHECK (completeness IN ('COMPLETE', 'PARTIAL', 'TRUNCATED')),
  truncation jsonb,
  unavailable_reason text,
  PRIMARY KEY (project_id, base_snapshot_id, overlay_kind)
);

-- Opaque server-issued continuation tokens with a server-side binding and TTL.
CREATE TABLE frontend_knowledge_graph.continuation (
  token text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  principal_id text NOT NULL,
  session_id text NOT NULL,
  project_id text NOT NULL,
  access_revision text NOT NULL,
  policy_context_revision text NOT NULL,
  snapshot_id text NOT NULL,
  root_ref jsonb,
  filters_digest text NOT NULL,
  view_kind text NOT NULL
    CHECK (view_kind IN ('KNOWLEDGE_SEMANTIC', 'GOVERNANCE_IMPACT', 'OPERATIONAL_DEPENDENCY')),
  overlay_kinds jsonb NOT NULL,
  limits jsonb NOT NULL
);

CREATE INDEX frontend_knowledge_graph_continuation_expiry_idx
  ON frontend_knowledge_graph.continuation (expires_at);
CREATE INDEX frontend_knowledge_graph_continuation_project_idx
  ON frontend_knowledge_graph.continuation (project_id, session_id);

-- Bounded retention cleanup helper (called by the adapter; never automatic in
-- this migration).
CREATE OR REPLACE FUNCTION frontend_knowledge_graph.prune_expired(now_utc timestamptz)
RETURNS void AS $$
BEGIN
  DELETE FROM frontend_knowledge_graph.continuation WHERE expires_at <= now_utc;
  DELETE FROM frontend_knowledge_graph.snapshot_context WHERE expires_at <= now_utc;
END;
$$ LANGUAGE plpgsql;
