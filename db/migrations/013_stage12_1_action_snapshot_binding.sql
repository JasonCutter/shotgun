CREATE TABLE action.candidates (
  project_id text NOT NULL,
  candidate_id text NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  candidate_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, candidate_id)
);

CREATE TABLE action.preview_snapshots (
  snapshot_id uuid PRIMARY KEY,
  action_id uuid NOT NULL UNIQUE REFERENCES action.executions(action_id),
  project_id text NOT NULL,
  snapshot_digest text NOT NULL UNIQUE CHECK (snapshot_digest ~ '^sha256:[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  snapshot_json jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE action.approval_records (
  approval_id uuid PRIMARY KEY,
  action_id uuid NOT NULL UNIQUE REFERENCES action.executions(action_id),
  snapshot_id uuid NOT NULL UNIQUE REFERENCES action.preview_snapshots(snapshot_id),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[a-f0-9]{64}$'),
  approved_by text NOT NULL,
  expires_at timestamptz NOT NULL,
  approval_json jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TRIGGER action_preview_snapshots_append_only
  BEFORE UPDATE OR DELETE ON action.preview_snapshots
  FOR EACH ROW EXECUTE FUNCTION action.reject_append_only_change();

CREATE TRIGGER action_approval_records_append_only
  BEFORE UPDATE OR DELETE ON action.approval_records
  FOR EACH ROW EXECUTE FUNCTION action.reject_append_only_change();
