-- Additive FE-P5-S2 Payload Availability / Retention + Policy History
-- persistence (IR r1 §4 Scope C + D).
-- Bounded additive migration ONLY.
--
-- Scope C: mutable PayloadAvailability NEVER alters authoritative Event rows
-- (Canonical/Review/External Action history is already append-only/immutable).
-- Owner-side sidecar tables hold availability/tombstone state; purge keeps the
-- source event identity and appends a purge AuditEvent (ADR-112 §9).
--
-- Scope D: Policy History reuses existing settings persistence
-- (settings.settings_revisions, settings.policy_context_revisions,
-- settings.settings_audit_events). No new authoritative Policy History table;
-- only an immutability guard index is added where missing.

DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '031_frontend_deleted_project_audit.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 032 preflight failed: 031 is missing';
  END IF;
END
$$;

-- ---- Scope C: owner-side PayloadAvailability / Retention sidecars --------

CREATE TABLE IF NOT EXISTS canonical.history_payload_state (
  source_event_id text PRIMARY KEY,
  resource_project_id text NOT NULL,
  payload_availability text NOT NULL
    CHECK (payload_availability IN ('AVAILABLE', 'REDACTED', 'PURGED_BY_POLICY', 'UNAVAILABLE')),
  tombstone_metadata jsonb,
  changed_at timestamptz NOT NULL,
  reason text NOT NULL,
  policy_revision text
);

CREATE TABLE IF NOT EXISTS frontend_review.history_payload_state (
  source_event_id text PRIMARY KEY,
  resource_project_id text NOT NULL,
  payload_availability text NOT NULL
    CHECK (payload_availability IN ('AVAILABLE', 'REDACTED', 'PURGED_BY_POLICY', 'UNAVAILABLE')),
  tombstone_metadata jsonb,
  changed_at timestamptz NOT NULL,
  reason text NOT NULL,
  policy_revision text
);

CREATE TABLE IF NOT EXISTS frontend_external_action.history_payload_state (
  source_event_id text PRIMARY KEY,
  resource_project_id text NOT NULL,
  payload_availability text NOT NULL
    CHECK (payload_availability IN ('AVAILABLE', 'REDACTED', 'PURGED_BY_POLICY', 'UNAVAILABLE')),
  tombstone_metadata jsonb,
  changed_at timestamptz NOT NULL,
  reason text NOT NULL,
  policy_revision text
);

CREATE TABLE IF NOT EXISTS settings.history_payload_state (
  source_event_id text PRIMARY KEY,
  resource_project_id text NOT NULL,
  payload_availability text NOT NULL
    CHECK (payload_availability IN ('AVAILABLE', 'REDACTED', 'PURGED_BY_POLICY', 'UNAVAILABLE')),
  tombstone_metadata jsonb,
  changed_at timestamptz NOT NULL,
  reason text NOT NULL,
  policy_revision text
);

-- ---- Scope D: Policy History reuse guard --------------------------------

-- Ensure settings audit events are queryable by project/actor for the History
-- adapter (append-only authoritative source).
CREATE INDEX IF NOT EXISTS settings_audit_events_project_idx
  ON settings.settings_audit_events (project_id, timestamp);
