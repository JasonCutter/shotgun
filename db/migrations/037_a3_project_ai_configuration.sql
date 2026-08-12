-- A3 additive Project AI configuration authority persistence.
-- Provider Registry and Model Catalog remain server-owned immutable descriptors;
-- only project-scoped configuration state and its append-only history persist.
CREATE SCHEMA IF NOT EXISTS ai;

CREATE TABLE ai.project_ai_configuration_revisions (
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT
    CHECK (length(project_id) BETWEEN 1 AND 256),
  active_provider_id text NOT NULL CHECK (length(active_provider_id) BETWEEN 1 AND 128),
  active_model_id text NOT NULL CHECK (length(active_model_id) BETWEEN 1 AND 256),
  credential_id uuid NOT NULL,
  credential_revision integer NOT NULL CHECK (credential_revision > 0),
  ai_configuration_revision integer NOT NULL CHECK (ai_configuration_revision > 0),
  updated_by text NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 256),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, ai_configuration_revision)
);

CREATE INDEX ai_project_ai_configuration_revisions_project_idx
  ON ai.project_ai_configuration_revisions (project_id, ai_configuration_revision DESC);

CREATE OR REPLACE FUNCTION ai.block_project_ai_configuration_revision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'project AI configuration revisions are append-only and immutable';
END;
$$;

CREATE TRIGGER ai_project_ai_configuration_revisions_immutable
  BEFORE UPDATE OR DELETE ON ai.project_ai_configuration_revisions
  FOR EACH ROW EXECUTE FUNCTION ai.block_project_ai_configuration_revision_mutation();

CREATE TABLE ai.project_ai_configurations (
  project_id text PRIMARY KEY REFERENCES project_admin.projects(id) ON DELETE RESTRICT
    CHECK (length(project_id) BETWEEN 1 AND 256),
  active_provider_id text NOT NULL CHECK (length(active_provider_id) BETWEEN 1 AND 128),
  active_model_id text NOT NULL CHECK (length(active_model_id) BETWEEN 1 AND 256),
  credential_id uuid NOT NULL,
  credential_revision integer NOT NULL CHECK (credential_revision > 0),
  ai_configuration_revision integer NOT NULL CHECK (ai_configuration_revision > 0),
  updated_by text NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 256),
  updated_at timestamptz NOT NULL,
  CONSTRAINT project_ai_configuration_current_revision_fk
    FOREIGN KEY (project_id, ai_configuration_revision)
    REFERENCES ai.project_ai_configuration_revisions (project_id, ai_configuration_revision)
);

CREATE INDEX ai_project_ai_configurations_provider_model_idx
  ON ai.project_ai_configurations (active_provider_id, active_model_id);

CREATE OR REPLACE FUNCTION ai.enforce_project_ai_configuration_current_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.project_id <> NEW.project_id
     OR NEW.ai_configuration_revision <> OLD.ai_configuration_revision + 1
     OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'project AI configuration current identity or revision is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_project_ai_configurations_monotonic_update
  BEFORE UPDATE ON ai.project_ai_configurations
  FOR EACH ROW EXECUTE FUNCTION ai.enforce_project_ai_configuration_current_update();
