-- AKP-4 WP3: persistent weekly Discovery schedules and trigger identities.
-- This migration adds no worker leases, runs, attempts, stages, queue, or
-- execution state. Discovery jobs remain the WP1 durable Job authority.
-- Rollback: drop the two trigger indexes, then discovery.schedules after any
-- schedule rows have been migrated or intentionally removed by an operator.

DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '049_akp_4_wp2_canonical_trigger_uniqueness.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 050 preflight failed: 049 is missing';
  END IF;
END
$$;

CREATE TABLE discovery.schedules (
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  schedule_id text NOT NULL CHECK (length(schedule_id) BETWEEN 1 AND 512),
  schedule_revision integer NOT NULL CHECK (schedule_revision >= 1),
  status text NOT NULL CHECK (status IN ('ENABLED', 'DISABLED')),
  timezone text NOT NULL CHECK (length(timezone) BETWEEN 1 AND 128),
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  local_time text NOT NULL CHECK (local_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
  next_occurrence_at timestamptz NOT NULL,
  next_occurrence_key text NOT NULL CHECK (length(next_occurrence_key) BETWEEN 1 AND 512),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, schedule_id)
);

CREATE INDEX discovery_schedules_due_idx
  ON discovery.schedules (next_occurrence_at, project_id, schedule_id)
  WHERE status = 'ENABLED';

CREATE UNIQUE INDEX discovery_jobs_scheduled_trigger_identity_idx
  ON discovery.jobs (
    project_id,
    (trigger->'triggerIdentity'->>'scheduleId'),
    (trigger->'triggerIdentity'->>'scheduleRevision'),
    (trigger->'triggerIdentity'->>'occurrenceKey')
  )
  WHERE trigger_class = 'SCHEDULED_FULL_SCAN';

CREATE UNIQUE INDEX discovery_jobs_manual_trigger_identity_idx
  ON discovery.jobs (
    project_id,
    (trigger->'triggerIdentity'->>'commandId'),
    (trigger->'triggerIdentity'->>'requestId')
  )
  WHERE trigger_class = 'MANUAL';
