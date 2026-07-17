CREATE SCHEMA IF NOT EXISTS action;

CREATE TABLE action.executions (
  action_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  candidate_id text NOT NULL,
  candidate_revision integer NOT NULL CHECK (candidate_revision > 0),
  candidate_digest text NOT NULL CHECK (candidate_digest ~ '^sha256:[a-f0-9]{64}$'),
  target_digest text NOT NULL CHECK (target_digest ~ '^sha256:[a-f0-9]{64}$'),
  parameter_digest text NOT NULL CHECK (parameter_digest ~ '^sha256:[a-f0-9]{64}$'),
  preview_digest text NOT NULL CHECK (preview_digest ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN (
    'PREVIEW_READY', 'APPROVED', 'EXECUTING', 'PREFLIGHT_FAILED', 'EXECUTED',
    'OUTCOME_UNKNOWN', 'FAILED', 'VERIFIED', 'VERIFICATION_FAILED'
  )),
  record_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (project_id, candidate_id, candidate_revision)
);

CREATE INDEX action_execution_status_idx
  ON action.executions (project_id, status, updated_at, action_id);

CREATE TABLE action.approvals (
  token_id uuid PRIMARY KEY,
  action_id uuid NOT NULL UNIQUE REFERENCES action.executions(action_id),
  preview_digest text NOT NULL CHECK (preview_digest ~ '^sha256:[a-f0-9]{64}$'),
  target_digest text NOT NULL CHECK (target_digest ~ '^sha256:[a-f0-9]{64}$'),
  parameter_digest text NOT NULL CHECK (parameter_digest ~ '^sha256:[a-f0-9]{64}$'),
  candidate_revision integer NOT NULL CHECK (candidate_revision > 0),
  approved_by text NOT NULL,
  approval_json jsonb NOT NULL,
  approved_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > approved_at)
);

CREATE TABLE action.audit_events (
  audit_event_id uuid PRIMARY KEY,
  action_id uuid NOT NULL REFERENCES action.executions(action_id),
  project_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  category text NOT NULL,
  event_json jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (action_id, sequence)
);

CREATE INDEX action_audit_project_idx
  ON action.audit_events (project_id, action_id, sequence);

CREATE OR REPLACE FUNCTION action.reject_append_only_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER action_approvals_append_only
  BEFORE UPDATE OR DELETE ON action.approvals
  FOR EACH ROW EXECUTE FUNCTION action.reject_append_only_change();

CREATE TRIGGER action_audit_append_only
  BEFORE UPDATE OR DELETE ON action.audit_events
  FOR EACH ROW EXECUTE FUNCTION action.reject_append_only_change();
