-- A2 additive credential vault persistence. Existing AI calls and all product data remain unchanged.
CREATE SCHEMA IF NOT EXISTS ai;

CREATE TABLE ai.provider_credentials (
  credential_id uuid NOT NULL,
  project_id text NOT NULL CHECK (length(project_id) BETWEEN 1 AND 256),
  provider_id text NOT NULL CHECK (length(provider_id) BETWEEN 1 AND 128),
  encrypted_secret jsonb NOT NULL CHECK (
    jsonb_typeof(encrypted_secret) = 'object'
    AND encrypted_secret ? 'version'
    AND encrypted_secret ? 'algorithm'
    AND encrypted_secret ? 'nonce'
    AND encrypted_secret ? 'ciphertext'
    AND encrypted_secret ? 'authTag'
  ),
  encryption_version text NOT NULL CHECK (encryption_version = 'aes-256-gcm:v1'),
  key_version text NOT NULL CHECK (length(key_version) BETWEEN 1 AND 32),
  credential_revision integer NOT NULL CHECK (credential_revision > 0),
  lifecycle_state text NOT NULL CHECK (
    lifecycle_state IN ('active', 'superseded', 'revoked', 'removed')
  ),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= created_at),
  PRIMARY KEY (credential_id, credential_revision)
);

CREATE UNIQUE INDEX ai_provider_credentials_one_active_revision
  ON ai.provider_credentials (credential_id)
  WHERE lifecycle_state = 'active';

CREATE INDEX ai_provider_credentials_project_provider_idx
  ON ai.provider_credentials (project_id, provider_id, updated_at DESC);

CREATE OR REPLACE FUNCTION ai.reject_provider_credential_secret_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.credential_id <> NEW.credential_id
     OR OLD.project_id <> NEW.project_id
     OR OLD.provider_id <> NEW.provider_id
     OR OLD.credential_revision <> NEW.credential_revision
     OR OLD.encrypted_secret IS DISTINCT FROM NEW.encrypted_secret
     OR OLD.encryption_version <> NEW.encryption_version
     OR OLD.key_version <> NEW.key_version
     OR OLD.created_at <> NEW.created_at THEN
    RAISE EXCEPTION 'provider credential identity and envelope are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_provider_credentials_immutable_fields
  BEFORE UPDATE ON ai.provider_credentials
  FOR EACH ROW EXECUTE FUNCTION ai.reject_provider_credential_secret_mutation();

CREATE OR REPLACE FUNCTION ai.reject_provider_credential_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'provider credential revisions are append-only';
END;
$$;

CREATE TRIGGER ai_provider_credentials_append_only
  BEFORE DELETE ON ai.provider_credentials
  FOR EACH ROW EXECUTE FUNCTION ai.reject_provider_credential_delete();

