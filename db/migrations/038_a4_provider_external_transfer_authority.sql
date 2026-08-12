-- A4 additive provider-specific privacy and deployment authority.
-- Existing Settings history and audit rows are intentionally preserved. The
-- existing review proposal table is reused for the high-risk proposal step;
-- effective approvals have their own immutable provider/project history.
CREATE SCHEMA IF NOT EXISTS settings;

CREATE TABLE settings.provider_external_transfer_approval_revisions (
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT
    CHECK (length(project_id) BETWEEN 1 AND 256),
  provider_id text NOT NULL CHECK (provider_id IN ('deepseek', 'openai', 'google-gemini')),
  approved boolean NOT NULL,
  approval_revision integer NOT NULL CHECK (approval_revision > 0),
  reviewed_by text NOT NULL CHECK (length(reviewed_by) BETWEEN 1 AND 256),
  reviewed_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, provider_id, approval_revision)
);

CREATE INDEX settings_provider_external_transfer_approval_revisions_lookup_idx
  ON settings.provider_external_transfer_approval_revisions
    (project_id, provider_id, approval_revision DESC);

CREATE OR REPLACE FUNCTION settings.block_provider_external_transfer_approval_revision_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'provider external transfer approval revisions are append-only and immutable';
END;
$$;

CREATE TRIGGER settings_provider_external_transfer_approval_revisions_immutable
  BEFORE UPDATE OR DELETE ON settings.provider_external_transfer_approval_revisions
  FOR EACH ROW EXECUTE FUNCTION settings.block_provider_external_transfer_approval_revision_mutation();

CREATE TABLE settings.provider_external_transfer_approvals (
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT
    CHECK (length(project_id) BETWEEN 1 AND 256),
  provider_id text NOT NULL CHECK (provider_id IN ('deepseek', 'openai', 'google-gemini')),
  approved boolean NOT NULL,
  approval_revision integer NOT NULL CHECK (approval_revision > 0),
  reviewed_by text NOT NULL CHECK (length(reviewed_by) BETWEEN 1 AND 256),
  reviewed_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, provider_id),
  CONSTRAINT provider_external_transfer_approval_current_revision_fk
    FOREIGN KEY (project_id, provider_id, approval_revision)
    REFERENCES settings.provider_external_transfer_approval_revisions
      (project_id, provider_id, approval_revision)
);

CREATE OR REPLACE FUNCTION settings.enforce_provider_external_transfer_approval_current_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.project_id <> NEW.project_id
     OR OLD.provider_id <> NEW.provider_id
     OR NEW.approval_revision <> OLD.approval_revision + 1
     OR NEW.reviewed_at < OLD.reviewed_at THEN
    RAISE EXCEPTION 'provider external transfer approval identity or revision is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER settings_provider_external_transfer_approval_current_monotonic_update
  BEFORE UPDATE ON settings.provider_external_transfer_approvals
  FOR EACH ROW EXECUTE FUNCTION settings.enforce_provider_external_transfer_approval_current_update();

CREATE OR REPLACE FUNCTION settings.block_provider_external_transfer_approval_current_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'provider external transfer approval current pointer cannot be deleted';
END;
$$;

CREATE TRIGGER settings_provider_external_transfer_approval_current_no_delete
  BEFORE DELETE ON settings.provider_external_transfer_approvals
  FOR EACH ROW EXECUTE FUNCTION settings.block_provider_external_transfer_approval_current_delete();

CREATE INDEX settings_provider_external_transfer_approvals_provider_idx
  ON settings.provider_external_transfer_approvals (provider_id, approved);
