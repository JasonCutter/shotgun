CREATE SCHEMA IF NOT EXISTS canonical;

CREATE TABLE canonical.project_state (
  project_id text PRIMARY KEY,
  version integer NOT NULL CHECK (version >= 0),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL
);

CREATE TABLE canonical.claims (
  claim_id text PRIMARY KEY,
  project_id text NOT NULL,
  source_version_id uuid NOT NULL,
  manifest_id uuid NOT NULL,
  claim_json jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX canonical_claims_project_idx
  ON canonical.claims (project_id, created_at, claim_id);

CREATE TABLE canonical.commits (
  commit_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  manifest_id uuid NOT NULL UNIQUE,
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  change_set_id uuid NOT NULL,
  result_json jsonb NOT NULL,
  committed_at timestamptz NOT NULL
);

CREATE INDEX canonical_commits_project_idx
  ON canonical.commits (project_id, committed_at, commit_id);

CREATE TABLE canonical.revisions (
  revision_id text PRIMARY KEY,
  project_id text NOT NULL,
  commit_id uuid NOT NULL REFERENCES canonical.commits(commit_id),
  revision_json jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX canonical_revisions_project_idx
  ON canonical.revisions (project_id, created_at, revision_id);

CREATE TABLE canonical.history_events (
  history_event_id text PRIMARY KEY,
  project_id text NOT NULL,
  commit_id uuid NOT NULL REFERENCES canonical.commits(commit_id),
  event_json jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX canonical_history_project_idx
  ON canonical.history_events (project_id, created_at, history_event_id);

CREATE TABLE canonical.outbox (
  outbox_id text PRIMARY KEY,
  project_id text NOT NULL,
  aggregate_id uuid NOT NULL REFERENCES canonical.commits(commit_id),
  event_type text NOT NULL CHECK (event_type = 'CanonicalCommitted'),
  payload_json jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'published')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL,
  claimed_at timestamptz,
  published_at timestamptz,
  last_error text
);

CREATE INDEX canonical_outbox_delivery_idx
  ON canonical.outbox (project_id, status, available_at, outbox_id);

CREATE OR REPLACE FUNCTION canonical.reject_append_only_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER canonical_claims_append_only
  BEFORE UPDATE OR DELETE ON canonical.claims
  FOR EACH ROW EXECUTE FUNCTION canonical.reject_append_only_change();

CREATE TRIGGER canonical_commits_append_only
  BEFORE UPDATE OR DELETE ON canonical.commits
  FOR EACH ROW EXECUTE FUNCTION canonical.reject_append_only_change();

CREATE TRIGGER canonical_revisions_append_only
  BEFORE UPDATE OR DELETE ON canonical.revisions
  FOR EACH ROW EXECUTE FUNCTION canonical.reject_append_only_change();

CREATE TRIGGER canonical_history_append_only
  BEFORE UPDATE OR DELETE ON canonical.history_events
  FOR EACH ROW EXECUTE FUNCTION canonical.reject_append_only_change();
