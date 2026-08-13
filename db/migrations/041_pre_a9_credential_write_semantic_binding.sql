-- Pre-A9 follow-up: bind credential recovery request identities to non-secret meaning.
-- Existing request-id rows without binding deliberately remain non-recoverable (fail closed).

ALTER TABLE ai.provider_credentials
  ADD COLUMN client_request_operation text,
  ADD COLUMN client_request_provider_id text,
  ADD COLUMN client_request_credential_id uuid,
  ADD COLUMN client_request_expected_revision integer;

ALTER TABLE ai.provider_credentials
  ADD CONSTRAINT ai_provider_credentials_client_request_binding_check
  CHECK (
    (client_request_id IS NULL
      AND client_request_operation IS NULL
      AND client_request_provider_id IS NULL
      AND client_request_credential_id IS NULL
      AND client_request_expected_revision IS NULL)
    OR
    (client_request_id IS NOT NULL
      AND client_request_operation IS NULL
      AND client_request_provider_id IS NULL
      AND client_request_credential_id IS NULL
      AND client_request_expected_revision IS NULL)
    OR
    (client_request_id IS NOT NULL
      AND client_request_operation = 'CREATE'
      AND client_request_provider_id IS NOT NULL
      AND client_request_credential_id IS NULL
      AND client_request_expected_revision IS NULL)
    OR
    (client_request_id IS NOT NULL
      AND client_request_operation = 'REPLACE'
      AND client_request_provider_id IS NOT NULL
      AND client_request_credential_id IS NOT NULL
      AND client_request_expected_revision IS NOT NULL
      AND client_request_expected_revision >= 1)
  );

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
     OR OLD.client_request_operation IS DISTINCT FROM NEW.client_request_operation
     OR OLD.client_request_provider_id IS DISTINCT FROM NEW.client_request_provider_id
     OR OLD.client_request_credential_id IS DISTINCT FROM NEW.client_request_credential_id
     OR OLD.client_request_expected_revision IS DISTINCT FROM NEW.client_request_expected_revision
     OR OLD.created_at <> NEW.created_at THEN
    RAISE EXCEPTION 'provider credential identity and envelope are immutable';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN ai.provider_credentials.client_request_operation IS
  'Non-secret semantic operation bound to credential write recovery: CREATE or REPLACE.';
COMMENT ON COLUMN ai.provider_credentials.client_request_provider_id IS
  'Non-secret provider identity bound to credential write recovery.';
COMMENT ON COLUMN ai.provider_credentials.client_request_credential_id IS
  'Non-secret replace target credential identity; null for CREATE.';
COMMENT ON COLUMN ai.provider_credentials.client_request_expected_revision IS
  'Non-secret replace target revision; null for CREATE.';
