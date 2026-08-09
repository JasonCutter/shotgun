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
  resource_project_id text NOT NULL,
  source_event_kind text NOT NULL,
  source_event_id text NOT NULL,
  payload_availability text NOT NULL
    CHECK (payload_availability IN ('AVAILABLE', 'REDACTED', 'PURGED_BY_POLICY', 'UNAVAILABLE')),
  tombstone_metadata jsonb,
  changed_at timestamptz NOT NULL,
  reason text NOT NULL,
  policy_revision text,
  PRIMARY KEY (resource_project_id, source_event_kind, source_event_id)
);

CREATE TABLE IF NOT EXISTS frontend_review.history_payload_state (
  resource_project_id text NOT NULL,
  source_event_kind text NOT NULL,
  source_event_id text NOT NULL,
  payload_availability text NOT NULL
    CHECK (payload_availability IN ('AVAILABLE', 'REDACTED', 'PURGED_BY_POLICY', 'UNAVAILABLE')),
  tombstone_metadata jsonb,
  changed_at timestamptz NOT NULL,
  reason text NOT NULL,
  policy_revision text,
  PRIMARY KEY (resource_project_id, source_event_kind, source_event_id)
);

CREATE TABLE IF NOT EXISTS frontend_external_action.history_payload_state (
  resource_project_id text NOT NULL,
  source_event_kind text NOT NULL,
  source_event_id text NOT NULL,
  payload_availability text NOT NULL
    CHECK (payload_availability IN ('AVAILABLE', 'REDACTED', 'PURGED_BY_POLICY', 'UNAVAILABLE')),
  tombstone_metadata jsonb,
  changed_at timestamptz NOT NULL,
  reason text NOT NULL,
  policy_revision text,
  PRIMARY KEY (resource_project_id, source_event_kind, source_event_id)
);

CREATE TABLE IF NOT EXISTS settings.history_payload_state (
  resource_project_id text NOT NULL,
  source_event_kind text NOT NULL,
  source_event_id text NOT NULL,
  payload_availability text NOT NULL
    CHECK (payload_availability IN ('AVAILABLE', 'REDACTED', 'PURGED_BY_POLICY', 'UNAVAILABLE')),
  tombstone_metadata jsonb,
  changed_at timestamptz NOT NULL,
  reason text NOT NULL,
  policy_revision text,
  PRIMARY KEY (resource_project_id, source_event_kind, source_event_id)
);

-- Owner-local purge AuditEvent streams (WP1 Foundation Correction
-- discovered during WP2-B preparation). Canonical and Review have no generic
-- audit stream (canonical.history_events requires a commit_id FK; Review
-- decision/comment/approval are domain-specific append-only resources), so a
-- dedicated owner-local purge audit table is added per ADR-131 §3/§7a Scope C.
-- External Action REUSES frontend_external_action.audit_events and Settings
-- REUSES settings.settings_audit_events (generic append-only audit streams).
-- These tables are append-only: INSERT ALLOWED, UPDATE/DELETE/TRUNCATE
-- FORBIDDEN. Purged payload itself is NEVER copied here — only non-sensitive
-- metadata (source identity, policy revision, reason, tombstone/digest).

CREATE TABLE IF NOT EXISTS canonical.history_payload_audit_events (
  audit_event_id text PRIMARY KEY,
  resource_project_id text NOT NULL,
  source_event_kind text NOT NULL,
  source_event_id text NOT NULL,
  previous_availability text NOT NULL
    CHECK (previous_availability IN ('AVAILABLE', 'REDACTED', 'PURGED_BY_POLICY', 'UNAVAILABLE')),
  -- Purge AuditEvent stream: this stream records retention-driven purges only.
  -- Non-purge availability transitions (REDACTED/AVAILABLE/UNAVAILABLE) are
  -- not part of this owner-local purge audit stream (ADR-131 §3).
  new_availability text NOT NULL
    CHECK (new_availability = 'PURGED_BY_POLICY'),
  tombstone_metadata jsonb,
  policy_revision text,
  reason text NOT NULL,
  actor_id text NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX canonical_history_payload_audit_project_idx
  ON canonical.history_payload_audit_events (resource_project_id, occurred_at, audit_event_id);

CREATE TABLE IF NOT EXISTS frontend_review.history_payload_audit_events (
  audit_event_id text PRIMARY KEY,
  resource_project_id text NOT NULL,
  source_event_kind text NOT NULL,
  source_event_id text NOT NULL,
  previous_availability text NOT NULL
    CHECK (previous_availability IN ('AVAILABLE', 'REDACTED', 'PURGED_BY_POLICY', 'UNAVAILABLE')),
  -- Purge AuditEvent stream: this stream records retention-driven purges only.
  -- Non-purge availability transitions (REDACTED/AVAILABLE/UNAVAILABLE) are
  -- not part of this owner-local purge audit stream (ADR-131 §3).
  new_availability text NOT NULL
    CHECK (new_availability = 'PURGED_BY_POLICY'),
  tombstone_metadata jsonb,
  policy_revision text,
  reason text NOT NULL,
  actor_id text NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE INDEX frontend_review_history_payload_audit_project_idx
  ON frontend_review.history_payload_audit_events (resource_project_id, occurred_at, audit_event_id);

-- ---- Scope D: Policy History reuse + immutability guard ------------------

-- Ensure settings audit events are queryable by project/actor for the History
-- adapter (append-only authoritative source).
CREATE INDEX IF NOT EXISTS settings_audit_events_project_idx
  ON settings.settings_audit_events (project_id, timestamp);

-- Policy History is an append-only authoritative capability owned by
-- settings-policy (ADR-131 §7). The reused settings historical sources must
-- be immutable at the DB level: UPDATE/DELETE is rejected, INSERT is allowed.

CREATE OR REPLACE FUNCTION settings.reject_history_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'settings history is append-only: % mutation is forbidden', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS settings_revisions_no_update_delete
  ON settings.settings_revisions;
CREATE TRIGGER settings_revisions_no_update_delete
  BEFORE UPDATE OR DELETE ON settings.settings_revisions
  FOR EACH ROW EXECUTE FUNCTION settings.reject_history_mutation();

DROP TRIGGER IF EXISTS policy_context_revisions_no_update_delete
  ON settings.policy_context_revisions;
CREATE TRIGGER policy_context_revisions_no_update_delete
  BEFORE UPDATE OR DELETE ON settings.policy_context_revisions
  FOR EACH ROW EXECUTE FUNCTION settings.reject_history_mutation();

DROP TRIGGER IF EXISTS settings_audit_events_no_update_delete
  ON settings.settings_audit_events;
CREATE TRIGGER settings_audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON settings.settings_audit_events
  FOR EACH ROW EXECUTE FUNCTION settings.reject_history_mutation();

-- TRUNCATE is a statement-level operation and is NOT caught by the row-level
-- BEFORE UPDATE OR DELETE trigger, so an explicit statement-level guard closes
-- the append-only hole (UPDATE/DELETE/TRUNCATE all forbidden; INSERT allowed).
CREATE OR REPLACE FUNCTION settings.reject_history_truncate()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'settings history is append-only: TRUNCATE on % is forbidden', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS settings_revisions_no_truncate
  ON settings.settings_revisions;
CREATE TRIGGER settings_revisions_no_truncate
  BEFORE TRUNCATE ON settings.settings_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION settings.reject_history_truncate();

DROP TRIGGER IF EXISTS policy_context_revisions_no_truncate
  ON settings.policy_context_revisions;
CREATE TRIGGER policy_context_revisions_no_truncate
  BEFORE TRUNCATE ON settings.policy_context_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION settings.reject_history_truncate();

DROP TRIGGER IF EXISTS settings_audit_events_no_truncate
  ON settings.settings_audit_events;
CREATE TRIGGER settings_audit_events_no_truncate
  BEFORE TRUNCATE ON settings.settings_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION settings.reject_history_truncate();

-- ---- Scope C append-only guards (owner-local purge audit streams) --------

-- Canonical owner-local purge audit stream is append-only:
-- UPDATE/DELETE/TRUNCATE forbidden, INSERT allowed.

CREATE OR REPLACE FUNCTION canonical.reject_payload_audit_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'canonical.history_payload_audit_events is append-only: % mutation is forbidden',
    TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION canonical.reject_payload_audit_truncate()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'canonical.history_payload_audit_events is append-only: TRUNCATE is forbidden'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS canonical_history_payload_audit_no_update_delete
  ON canonical.history_payload_audit_events;
CREATE TRIGGER canonical_history_payload_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON canonical.history_payload_audit_events
  FOR EACH ROW EXECUTE FUNCTION canonical.reject_payload_audit_mutation();

DROP TRIGGER IF EXISTS canonical_history_payload_audit_no_truncate
  ON canonical.history_payload_audit_events;
CREATE TRIGGER canonical_history_payload_audit_no_truncate
  BEFORE TRUNCATE ON canonical.history_payload_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION canonical.reject_payload_audit_truncate();

-- Review owner-local purge audit stream is append-only:
-- UPDATE/DELETE/TRUNCATE forbidden, INSERT allowed.

CREATE OR REPLACE FUNCTION frontend_review.reject_payload_audit_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'frontend_review.history_payload_audit_events is append-only: % mutation is forbidden',
    TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION frontend_review.reject_payload_audit_truncate()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'frontend_review.history_payload_audit_events is append-only: TRUNCATE is forbidden'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS frontend_review_history_payload_audit_no_update_delete
  ON frontend_review.history_payload_audit_events;
CREATE TRIGGER frontend_review_history_payload_audit_no_update_delete
  BEFORE UPDATE OR DELETE ON frontend_review.history_payload_audit_events
  FOR EACH ROW EXECUTE FUNCTION frontend_review.reject_payload_audit_mutation();

DROP TRIGGER IF EXISTS frontend_review_history_payload_audit_no_truncate
  ON frontend_review.history_payload_audit_events;
CREATE TRIGGER frontend_review_history_payload_audit_no_truncate
  BEFORE TRUNCATE ON frontend_review.history_payload_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION frontend_review.reject_payload_audit_truncate();
