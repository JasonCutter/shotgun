-- Project-level standing authority for automatic AI-assisted processing.
-- A standing policy is separate from provider credentials/configuration, the
-- deployment ceiling, and the historical A4 provider approval stream.
CREATE SCHEMA IF NOT EXISTS ai;

CREATE TABLE ai.project_standing_ai_processing_policy_revisions (
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT
    CHECK (length(project_id) BETWEEN 1 AND 256),
  enabled boolean NOT NULL,
  provider_id text NOT NULL CHECK (provider_id IN ('deepseek', 'openai', 'google-gemini')),
  policy_revision integer NOT NULL CHECK (policy_revision > 0),
  ai_configuration_revision integer NOT NULL CHECK (ai_configuration_revision >= 0),
  changed_by text NOT NULL CHECK (length(changed_by) BETWEEN 1 AND 256),
  changed_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, policy_revision)
);

CREATE INDEX ai_project_standing_ai_processing_policy_revisions_lookup_idx
  ON ai.project_standing_ai_processing_policy_revisions (project_id, policy_revision DESC);

CREATE OR REPLACE FUNCTION ai.block_project_standing_ai_processing_policy_revision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'standing AI processing policy revisions are append-only and immutable';
END;
$$;

CREATE TRIGGER ai_project_standing_ai_processing_policy_revisions_immutable
  BEFORE UPDATE OR DELETE ON ai.project_standing_ai_processing_policy_revisions
  FOR EACH ROW EXECUTE FUNCTION ai.block_project_standing_ai_processing_policy_revision_mutation();

CREATE TABLE ai.project_standing_ai_processing_policies (
  project_id text PRIMARY KEY REFERENCES project_admin.projects(id) ON DELETE RESTRICT
    CHECK (length(project_id) BETWEEN 1 AND 256),
  enabled boolean NOT NULL,
  provider_id text NOT NULL CHECK (provider_id IN ('deepseek', 'openai', 'google-gemini')),
  policy_revision integer NOT NULL CHECK (policy_revision > 0),
  ai_configuration_revision integer NOT NULL CHECK (ai_configuration_revision >= 0),
  changed_by text NOT NULL CHECK (length(changed_by) BETWEEN 1 AND 256),
  changed_at timestamptz NOT NULL,
  CONSTRAINT project_standing_ai_processing_policy_current_revision_fk
    FOREIGN KEY (project_id, policy_revision)
    REFERENCES ai.project_standing_ai_processing_policy_revisions (project_id, policy_revision)
);

CREATE INDEX ai_project_standing_ai_processing_policies_provider_idx
  ON ai.project_standing_ai_processing_policies (provider_id, enabled);

CREATE OR REPLACE FUNCTION ai.enforce_project_standing_ai_processing_policy_current_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.project_id <> NEW.project_id
     OR NEW.policy_revision <> OLD.policy_revision + 1
     OR NEW.changed_at < OLD.changed_at THEN
    RAISE EXCEPTION 'standing AI processing policy identity or revision is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_project_standing_ai_processing_policy_current_monotonic_update
  BEFORE UPDATE ON ai.project_standing_ai_processing_policies
  FOR EACH ROW EXECUTE FUNCTION ai.enforce_project_standing_ai_processing_policy_current_update();

CREATE OR REPLACE FUNCTION ai.block_project_standing_ai_processing_policy_current_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'standing AI processing policy current pointer cannot be deleted';
END;
$$;

CREATE TRIGGER ai_project_standing_ai_processing_policy_current_no_delete
  BEFORE DELETE ON ai.project_standing_ai_processing_policies
  FOR EACH ROW EXECUTE FUNCTION ai.block_project_standing_ai_processing_policy_current_delete();

-- Existing Projects start disabled. Their current configured provider is kept
-- as the binding so enabling the policy later is an explicit, provider-aware
-- decision. An explicit historical A4 rejection is never rewritten.
INSERT INTO ai.project_standing_ai_processing_policy_revisions (
  project_id, enabled, provider_id, policy_revision, ai_configuration_revision,
  changed_by, changed_at
)
SELECT
  projects.id,
  false,
  CASE
    WHEN configuration.active_provider_id IN ('deepseek', 'openai', 'google-gemini')
      THEN configuration.active_provider_id
    ELSE 'deepseek'
  END,
  1,
  COALESCE(configuration.ai_configuration_revision, 0),
  'migration:project-standing-ai-processing:v1',
  now()
FROM project_admin.projects AS projects
LEFT JOIN ai.project_ai_configurations AS configuration
  ON configuration.project_id = projects.id
ON CONFLICT (project_id, policy_revision) DO NOTHING;

INSERT INTO ai.project_standing_ai_processing_policies (
  project_id, enabled, provider_id, policy_revision, ai_configuration_revision,
  changed_by, changed_at
)
SELECT
  project_id, enabled, provider_id, policy_revision, ai_configuration_revision,
  changed_by, changed_at
FROM ai.project_standing_ai_processing_policy_revisions
WHERE policy_revision = 1
ON CONFLICT (project_id) DO NOTHING;
