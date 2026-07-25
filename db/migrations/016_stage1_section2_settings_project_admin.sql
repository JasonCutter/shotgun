-- 016_stage1_section2_settings_project_admin.sql
-- Database Migration for Frontend Phase 1 Section 2: Project Administration and Settings Policy Control Plane

CREATE SCHEMA IF NOT EXISTS project_admin;
CREATE SCHEMA IF NOT EXISTS settings;

-- 1. Projects Identity & Metadata
CREATE TABLE IF NOT EXISTS project_admin.projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'ACTIVE',
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1
);

-- 2. Project Revisions
CREATE TABLE IF NOT EXISTS project_admin.project_revisions (
  project_id text NOT NULL REFERENCES project_admin.projects(id),
  revision integer NOT NULL,
  changed_by text NOT NULL,
  change_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, revision)
);

-- 3. Principal Preferences
CREATE TABLE IF NOT EXISTS settings.principal_preferences (
  principal_id text PRIMARY KEY,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Project Settings
CREATE TABLE IF NOT EXISTS settings.project_settings (
  project_id text NOT NULL REFERENCES project_admin.projects(id),
  key text NOT NULL,
  scope text NOT NULL DEFAULT 'PROJECT',
  value jsonb NOT NULL,
  category text NOT NULL DEFAULT 'general',
  application_mode text NOT NULL DEFAULT 'IMMEDIATE',
  risk_level text NOT NULL DEFAULT 'LOW',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, key)
);

-- 5. System Settings
CREATE TABLE IF NOT EXISTS settings.system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  application_mode text NOT NULL DEFAULT 'IMMEDIATE',
  risk_level text NOT NULL DEFAULT 'LOW',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 6. Resource Settings
CREATE TABLE IF NOT EXISTS settings.resource_settings (
  resource_id text NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (resource_id, key)
);

-- 7. Settings Revisions
CREATE TABLE IF NOT EXISTS settings.settings_revisions (
  project_id text NOT NULL,
  revision integer NOT NULL,
  settings_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, revision)
);

-- 8. Policy Context Revisions
CREATE TABLE IF NOT EXISTS settings.policy_context_revisions (
  project_id text NOT NULL,
  revision integer NOT NULL,
  policy_binding jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, revision)
);

-- 9. Settings Commands
CREATE TABLE IF NOT EXISTS settings.settings_commands (
  command_id text PRIMARY KEY,
  client_request_id text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  project_id text NOT NULL,
  expected_revision integer NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  command_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 10. Settings Command Results
CREATE TABLE IF NOT EXISTS settings.settings_command_results (
  command_id text PRIMARY KEY REFERENCES settings.settings_commands(command_id),
  client_request_id text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL,
  applied_revision integer,
  review_proposal_id text,
  error_message text,
  completed_at timestamptz NOT NULL DEFAULT now()
);

-- 11. Settings Review Proposals
CREATE TABLE IF NOT EXISTS settings.settings_review_proposals (
  proposal_id text PRIMARY KEY,
  project_id text NOT NULL,
  resource_id text,
  directive_type text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'PROPOSED',
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 12. Settings Audit Events (Append-only)
CREATE TABLE IF NOT EXISTS settings.settings_audit_events (
  event_id text PRIMARY KEY,
  project_id text NOT NULL,
  actor_id text NOT NULL,
  action_name text NOT NULL,
  risk_level text NOT NULL,
  details jsonb NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now()
);
