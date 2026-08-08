-- Additive FE-P5-S2 History projection read-model persistence (IR r1 §4 Scope A).
-- Bounded additive migration ONLY (Implementation Request r1 §4 / ADR-131 §1):
-- creates the `frontend_history` schema with the rebuildable History projection
-- tables (`history_projection_index`, `projection_watermarks`) plus indexes and
-- constraints. No existing Domain table is modified and no duplicate full
-- Domain history is stored. History is a NON-AUTHORITATIVE federated read
-- projection; existing Domain History (Canonical/Review/External/Policy)
-- remains authoritative.

DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '029_frontend_activity_read_model.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 030 preflight failed: 029 is missing';
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS frontend_history;

-- Project-scoped federated History projection row. `history_entry_id` is
-- projection identity only and never replaces the source Domain event identity
-- (`source_event_id`). Ordering/cursor uses the frozen tuple
-- (occurred_at, domain_kind, source_event_kind, source_event_id,
-- source_sequence) — the projection never becomes a global chronology
-- authority (ADR-131 §2).
CREATE TABLE frontend_history.history_projection_index (
  resource_project_id text NOT NULL,
  history_entry_id text NOT NULL,
  domain_kind text NOT NULL
    CHECK (domain_kind IN ('CANONICAL', 'REVIEW', 'EXTERNAL_ACTION', 'POLICY')),
  domain_resource_kind text NOT NULL,
  domain_resource_id text NOT NULL,
  source_event_kind text NOT NULL,
  source_event_id text NOT NULL,
  source_sequence bigint,
  occurred_at timestamptz NOT NULL,
  payload_availability text NOT NULL
    CHECK (payload_availability IN ('AVAILABLE', 'REDACTED', 'PURGED_BY_POLICY', 'UNAVAILABLE')),
  payload_snapshot jsonb,
  projected_at timestamptz NOT NULL,
  PRIMARY KEY (resource_project_id, history_entry_id),
  -- One projection row per authoritative source event identity.
  UNIQUE (resource_project_id, domain_kind, source_event_kind, source_event_id)
);

-- Stable ordering/cursor index over the frozen tuple.
CREATE INDEX frontend_history_projection_order_idx
  ON frontend_history.history_projection_index
  (resource_project_id, occurred_at, domain_kind, source_event_kind, source_event_id, source_sequence);

-- Deterministic rebuild / adapter re-observation lookup by source identity.
CREATE INDEX frontend_history_projection_source_idx
  ON frontend_history.history_projection_index
  (resource_project_id, domain_kind, source_event_kind, source_event_id);

-- Project- and adapter-scoped projection watermarks (atomic project-scoped
-- commit; rebuild never exposes partial projection, IR r1 §4).
CREATE TABLE frontend_history.projection_watermarks (
  resource_project_id text NOT NULL,
  adapter_id text NOT NULL,
  domain_kind text NOT NULL
    CHECK (domain_kind IN ('CANONICAL', 'REVIEW', 'EXTERNAL_ACTION', 'POLICY')),
  source_updated_at timestamptz,
  projected_at timestamptz NOT NULL,
  last_source_position text,
  adapter_status text NOT NULL
    CHECK (adapter_status IN ('AVAILABLE', 'DEGRADED', 'UNAVAILABLE')),
  snapshot_revision bigint NOT NULL CHECK (snapshot_revision > 0),
  PRIMARY KEY (resource_project_id, adapter_id)
);
