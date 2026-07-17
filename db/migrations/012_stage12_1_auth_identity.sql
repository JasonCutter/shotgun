CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.principals (
  principal_id uuid PRIMARY KEY,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'service')),
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL,
  disabled_at timestamptz
);

CREATE TABLE auth.credentials (
  credential_id uuid PRIMARY KEY,
  principal_id uuid NOT NULL REFERENCES auth.principals(principal_id),
  credential_type text NOT NULL CHECK (credential_type = 'local_password'),
  account_id text NOT NULL UNIQUE,
  password_hash text NOT NULL CHECK (password_hash LIKE 'argon2id$v=1$%'),
  password_changed_at timestamptz NOT NULL,
  disabled_at timestamptz
);

CREATE TABLE auth.project_memberships (
  principal_id uuid NOT NULL REFERENCES auth.principals(principal_id),
  project_id text NOT NULL,
  scopes text[] NOT NULL CHECK (cardinality(scopes) > 0),
  sensitivity_clearance text NOT NULL CHECK (sensitivity_clearance IN ('public', 'internal', 'private', 'restricted')),
  is_owner boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  PRIMARY KEY (principal_id, project_id)
);

CREATE UNIQUE INDEX auth_single_active_owner_idx ON auth.project_memberships ((is_owner)) WHERE is_owner;

CREATE TABLE auth.sessions (
  session_id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^sha256:[a-f0-9]{64}$'),
  csrf_hash text NOT NULL CHECK (csrf_hash ~ '^sha256:[a-f0-9]{64}$'),
  principal_id uuid NOT NULL REFERENCES auth.principals(principal_id),
  active_project_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE auth.api_tokens (
  token_id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^sha256:[a-f0-9]{64}$'),
  principal_id uuid NOT NULL REFERENCES auth.principals(principal_id),
  scope_ceiling text[] NOT NULL CHECK (cardinality(scope_ceiling) > 0),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE auth.audit_events (
  audit_event_id uuid PRIMARY KEY,
  principal_id uuid,
  project_id text,
  event text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL
);

CREATE OR REPLACE FUNCTION auth.reject_append_only_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END;
$$;

CREATE TRIGGER auth_audit_events_append_only
  BEFORE UPDATE OR DELETE ON auth.audit_events
  FOR EACH ROW EXECUTE FUNCTION auth.reject_append_only_change();
