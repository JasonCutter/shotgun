-- Operator-only retention records. AUTHORIZED grants, reservation fences and counters stay intact.
CREATE TABLE provider_account.root_renewal_commands (
 command_id uuid PRIMARY KEY,root_id uuid NOT NULL REFERENCES provider_account.roots(root_id),
 request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[a-f0-9]{64}$'),
 after_policy_digest text NOT NULL CHECK(after_policy_digest ~ '^sha256:[a-f0-9]{64}$'),
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 receipt_digest text NOT NULL CHECK(receipt_digest ~ '^sha256:[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE provider_account.retained_unknown_grants (
 command_id uuid NOT NULL REFERENCES provider_account.root_renewal_commands(command_id),
 receipt_id uuid NOT NULL REFERENCES provider_account.grants(receipt_id),
 grant_snapshot jsonb NOT NULL CHECK(jsonb_typeof(grant_snapshot)='object' AND grant_snapshot->>'state'='AUTHORIZED'),
 PRIMARY KEY(command_id,receipt_id),CHECK(grant_snapshot->>'receipt_id'=receipt_id::text)
);
CREATE TRIGGER immutable_root_renewal BEFORE UPDATE OR DELETE ON provider_account.root_renewal_commands FOR EACH ROW EXECUTE FUNCTION provider_account.immutable_registration_command();
CREATE TRIGGER immutable_retained_unknown BEFORE UPDATE OR DELETE ON provider_account.retained_unknown_grants FOR EACH ROW EXECUTE FUNCTION provider_account.immutable_registration_command();
REVOKE ALL ON provider_account.root_renewal_commands,provider_account.retained_unknown_grants FROM PUBLIC,shotgun_runtime;
