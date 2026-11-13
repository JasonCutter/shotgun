-- Operator-only preparation/first activation receipts. No store/root or runtime grant is issued.
CREATE TABLE provider_account.bootstrap_commands (
 command_id uuid PRIMARY KEY,root_id uuid NOT NULL REFERENCES provider_account.roots(root_id),
 action text NOT NULL CHECK(action IN ('INITIALIZE','ACTIVATE')),
 request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[a-f0-9]{64}$'),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON provider_account.bootstrap_commands FROM PUBLIC,shotgun_runtime;
CREATE TRIGGER immutable_bootstrap_command BEFORE UPDATE OR DELETE ON provider_account.bootstrap_commands
FOR EACH ROW EXECUTE FUNCTION provider_account.immutable_registration_command();
