-- Additive FE-P5-S1 Activity read-model persistence (WP2).
-- Bounded additive migration ONLY (Implementation Request r1 §5 / ADR-130 §5):
-- creates the `frontend_activity` schema with the two frozen Activity read-model
-- tables (`activity_index`, `projection_watermarks`) plus supporting indexes and
-- constraints. No existing Domain execution table is modified and no duplicate
-- full Domain execution history is stored. Activity is never the FE-P5-S2
-- History ledger.

DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '028_frontend_external_action_product.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 029 preflight failed: 028 is missing';
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS frontend_activity;

-- Project-scoped searchable current projection summary with concrete Domain
-- identity. `activity_id` is projection identity only and never replaces the
-- concrete Domain Resource identity (`domain_resource_id`). `snapshot` is the
-- bounded current projection summary (jsonb round-trip); scalar columns mirror
-- key fields for project-scoped lookups, stable ordering and revision guards.
CREATE TABLE frontend_activity.activity_index (
  resource_project_id text NOT NULL,
  activity_id text NOT NULL,
  domain_kind text NOT NULL
    CHECK (domain_kind IN ('SOURCES', 'ASK', 'EXTERNAL_ACTION', 'CONNECTOR_DIAGNOSTICS')),
  root_kind text NOT NULL CHECK (root_kind IN ('JOB', 'RUN')),
  domain_resource_kind text NOT NULL,
  domain_resource_id text NOT NULL,
  domain_resource_revision text,
  resource_href text NOT NULL,
  job_id text,
  run_id text NOT NULL,
  summary text NOT NULL,
  state text NOT NULL
    CHECK (state IN (
      'QUEUED', 'RUNNING', 'WAITING_FOR_USER', 'PARTIAL', 'SUCCEEDED',
      'FAILED', 'CANCEL_REQUESTED', 'CANCELLED', 'OUTCOME_UNKNOWN'
    )),
  attention text NOT NULL CHECK (attention IN ('NEEDS_ATTENTION', 'RESOLVED', 'NONE')),
  retryability text NOT NULL
    CHECK (retryability IN ('RETRYABLE', 'NOT_RETRYABLE', 'UNKNOWN')),
  freshness text NOT NULL CHECK (freshness IN ('CURRENT', 'LAGGING', 'STALE', 'UNKNOWN')),
  adapter_status text NOT NULL
    CHECK (adapter_status IN ('AVAILABLE', 'DEGRADED', 'UNAVAILABLE')),
  snapshot_revision bigint NOT NULL CHECK (snapshot_revision > 0),
  snapshot jsonb NOT NULL,
  projected_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (resource_project_id, domain_kind, activity_id),
  -- ADR-130 §2 / Contract Snapshot §6: Ask has no durable Job and uses a RUN
  -- root; Sources, External Action and Connector Runtime use a JOB root.
  CHECK (
    (domain_kind = 'ASK' AND root_kind = 'RUN')
    OR (domain_kind IN ('SOURCES', 'EXTERNAL_ACTION', 'CONNECTOR_DIAGNOSTICS') AND root_kind = 'JOB')
  ),
  -- A RUN root never carries a Job identity; a JOB root always does.
  CHECK (
    (root_kind = 'RUN' AND job_id IS NULL)
    OR (root_kind = 'JOB' AND job_id IS NOT NULL)
  )
);

-- Project-scoped stable total ordering for the queue: updated_at DESC, then
-- domain_kind, then activity_id (no ties, deterministic pagination).
CREATE INDEX frontend_activity_index_project_updated_idx
  ON frontend_activity.activity_index
  (resource_project_id, updated_at DESC, domain_kind, activity_id);

-- Deterministic rebuild / adapter re-observation lookup by concrete Domain
-- resource identity within a project.
CREATE INDEX frontend_activity_index_project_domain_resource_idx
  ON frontend_activity.activity_index
  (resource_project_id, domain_kind, domain_resource_id);

-- Project- and adapter-scoped projection watermarks: source observation,
-- projection time, lag, adapter status, snapshot revision and cursor.
CREATE TABLE frontend_activity.projection_watermarks (
  resource_project_id text NOT NULL,
  adapter_id text NOT NULL,
  domain_kind text NOT NULL
    CHECK (domain_kind IN ('SOURCES', 'ASK', 'EXTERNAL_ACTION', 'CONNECTOR_DIAGNOSTICS')),
  source_updated_at timestamptz,
  projected_at timestamptz NOT NULL,
  lag_milliseconds bigint CHECK (lag_milliseconds IS NULL OR lag_milliseconds >= 0),
  adapter_status text NOT NULL
    CHECK (adapter_status IN ('AVAILABLE', 'DEGRADED', 'UNAVAILABLE')),
  snapshot_revision bigint NOT NULL CHECK (snapshot_revision > 0),
  cursor text,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (resource_project_id, adapter_id)
);

CREATE INDEX frontend_activity_watermarks_project_idx
  ON frontend_activity.projection_watermarks (resource_project_id, domain_kind);
