-- Pre-A9 corrective repair: secret-safe credential write outcome recovery.
-- This dedicated metadata is intentionally separate from generic frontend command
-- persistence and contains neither plaintext secrets nor encrypted envelopes.
ALTER TABLE ai.provider_credentials
  ADD COLUMN client_request_id text NULL
  CHECK (client_request_id IS NULL OR length(client_request_id) BETWEEN 1 AND 256);

CREATE UNIQUE INDEX ai_provider_credentials_project_client_request_id_unique
  ON ai.provider_credentials (project_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

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
     OR OLD.client_request_id IS DISTINCT FROM NEW.client_request_id
     OR OLD.created_at <> NEW.created_at THEN
    RAISE EXCEPTION 'provider credential identity and envelope are immutable';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN ai.provider_credentials.client_request_id IS
  'Non-secret credential create/replace request identity used only to recover credential metadata after uncertain client outcomes.';
