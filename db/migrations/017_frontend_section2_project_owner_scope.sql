BEGIN;

-- Drop the global single owner index
DROP INDEX IF EXISTS auth.auth_single_active_owner_idx;

-- Create a project-scoped unique owner index
CREATE UNIQUE INDEX auth_project_single_active_owner_idx
ON auth.project_memberships (project_id)
WHERE is_owner = true;

-- Add preference revisions and commands tables
CREATE TABLE IF NOT EXISTS settings.preference_revisions (
  principal_id TEXT NOT NULL,
  revision INT NOT NULL,
  preferences_snapshot JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_id, revision)
);

CREATE TABLE IF NOT EXISTS settings.preference_commands (
  command_id TEXT PRIMARY KEY,
  client_request_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  expected_revision INT NOT NULL,
  status TEXT NOT NULL,
  command_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX preference_commands_idem_idx ON settings.preference_commands (idempotency_key);

CREATE TABLE IF NOT EXISTS settings.preference_command_results (
  command_id TEXT PRIMARY KEY REFERENCES settings.preference_commands(command_id),
  client_request_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  applied_revision INT,
  error_message TEXT,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX preference_command_results_idem_idx ON settings.preference_command_results (idempotency_key);

-- Add project lifecycle commands tables
CREATE TABLE IF NOT EXISTS project_admin.project_commands (
  command_id TEXT PRIMARY KEY,
  client_request_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES project_admin.projects(id),
  actor_id TEXT NOT NULL,
  expected_revision INT NOT NULL,
  command_type TEXT NOT NULL,
  command_payload JSONB NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX project_commands_idem_idx ON project_admin.project_commands (idempotency_key);

CREATE TABLE IF NOT EXISTS project_admin.project_command_results (
  command_id TEXT PRIMARY KEY REFERENCES project_admin.project_commands(command_id),
  client_request_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  applied_revision INT,
  error_message TEXT,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX project_command_results_idem_idx ON project_admin.project_command_results (idempotency_key);

COMMIT;

