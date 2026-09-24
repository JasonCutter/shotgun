DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '077_ts5_asset_cas_lifecycle.sql'
  ) THEN
    RAISE EXCEPTION
      'Migration 078 preflight failed: migration 077 is not registered';
  END IF;
END
$$;

-- Additive control-plane state only. This migration does not inspect or mutate
-- existing Source, Canonical, Account, Project, or AI configuration rows.
CREATE TABLE project_admin.project_knowledge_epoch (
  project_id text PRIMARY KEY REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  epoch bigint NOT NULL DEFAULT 0 CHECK (epoch >= 0),
  state text NOT NULL DEFAULT 'READY'
    CHECK (state IN ('READY', 'RESET_PENDING', 'RESET_FAILED', 'RESET_UNVERIFIED')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_admin.project_knowledge_reset_requests (
  request_id uuid PRIMARY KEY,
  preview_id uuid NOT NULL,
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  actor_principal_id text NOT NULL,
  project_revision integer NOT NULL CHECK (project_revision > 0),
  expected_knowledge_epoch bigint NOT NULL CHECK (expected_knowledge_epoch >= 0),
  resulting_knowledge_epoch bigint CHECK (
    resulting_knowledge_epoch IS NULL OR resulting_knowledge_epoch > expected_knowledge_epoch
  ),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  state text NOT NULL CHECK (state IN (
    'APPROVED', 'FENCING', 'PURGING', 'REBUILDING', 'VERIFYING',
    'COMPLETE', 'BLOCKED', 'OUTCOME_UNKNOWN', 'ERASURE_UNVERIFIED'
  )),
  blocker_codes text[] NOT NULL DEFAULT '{}',
  impact_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  step_checkpoints jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (project_id, idempotency_key),
  UNIQUE (project_id, request_id),
  CHECK (jsonb_typeof(impact_counts) = 'object'),
  CHECK (jsonb_typeof(step_checkpoints) = 'object')
);

CREATE INDEX project_knowledge_reset_requests_project_created_idx
  ON project_admin.project_knowledge_reset_requests (project_id, created_at DESC);

CREATE UNIQUE INDEX project_knowledge_reset_requests_one_active_idx
  ON project_admin.project_knowledge_reset_requests (project_id)
  WHERE state IN (
    'APPROVED', 'FENCING', 'PURGING', 'REBUILDING', 'VERIFYING',
    'OUTCOME_UNKNOWN', 'ERASURE_UNVERIFIED'
  );

CREATE TABLE canonical.knowledge_reset_events (
  event_id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  resulting_knowledge_epoch bigint NOT NULL CHECK (resulting_knowledge_epoch > 0),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  empty_knowledge_digest text NOT NULL CHECK (empty_knowledge_digest ~ '^sha256:[a-f0-9]{64}$'),
  state_version bigint NOT NULL CHECK (state_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  FOREIGN KEY (project_id, request_id)
    REFERENCES project_admin.project_knowledge_reset_requests(project_id, request_id)
    ON DELETE RESTRICT,
  UNIQUE (project_id, resulting_knowledge_epoch),
  UNIQUE (project_id, state_version)
);

CREATE INDEX knowledge_reset_events_project_created_idx
  ON canonical.knowledge_reset_events (project_id, created_at DESC);
