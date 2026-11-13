-- Operator-only lifecycle receipts. Does not create/enable roots or grant runtime DML.
CREATE TABLE provider_account.registration_commands (
 command_id uuid PRIMARY KEY,
 root_id uuid NOT NULL REFERENCES provider_account.roots(root_id),
 project_id text NOT NULL CHECK(length(project_id) BETWEEN 1 AND 256),
 request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[a-f0-9]{64}$'),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON provider_account.registration_commands FROM PUBLIC,shotgun_runtime;
CREATE FUNCTION provider_account.immutable_registration_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Account registration commands are append-only'; END $$;
CREATE TRIGGER immutable_registration_command BEFORE UPDATE OR DELETE ON provider_account.registration_commands
FOR EACH ROW EXECUTE FUNCTION provider_account.immutable_registration_command();
