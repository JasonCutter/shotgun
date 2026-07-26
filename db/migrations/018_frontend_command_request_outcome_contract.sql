BEGIN;

CREATE SCHEMA IF NOT EXISTS frontend_command;

CREATE TABLE IF NOT EXISTS frontend_command.command_ledger (
  command_id text PRIMARY KEY,
  command_revision bigint NOT NULL,
  client_request_id text NOT NULL,
  idempotency_key text NOT NULL,
  principal_id text NOT NULL,
  target_project_id text NOT NULL,
  resource_project_id text,
  command_type text NOT NULL,
  command_schema_version text NOT NULL,
  command_semantic_digest text NOT NULL,
  policy_binding jsonb NOT NULL,
  accepted_principal_context jsonb NOT NULL,
  accepted_project_context jsonb NOT NULL,
  accepted_policy_context jsonb NOT NULL,
  preconditions jsonb NOT NULL,
  command_payload jsonb NOT NULL,
  outcome_state text NOT NULL,
  completion_disposition text,
  produced_resources jsonb NOT NULL DEFAULT '[]'::jsonb,
  rejection jsonb,
  correlation_id text NOT NULL,
  trace_id text NOT NULL,
  received_at timestamptz NOT NULL,
  accepted_at timestamptz,
  completed_at timestamptz,
  last_updated_at timestamptz NOT NULL,
  CONSTRAINT frontend_command_outcome_state_check CHECK (
    outcome_state IN ('ACCEPTED', 'COMPLETED', 'REJECTED', 'OUTCOME_UNKNOWN')
  ),
  CONSTRAINT frontend_command_completion_disposition_check CHECK (
    completion_disposition IS NULL OR
    completion_disposition IN ('SUCCEEDED', 'FAILED', 'PARTIAL', 'NO_OP')
  ),
  UNIQUE (principal_id, client_request_id),
  UNIQUE (
    principal_id,
    target_project_id,
    command_type,
    command_schema_version,
    idempotency_key
  )
);

CREATE INDEX IF NOT EXISTS frontend_command_ledger_outcome_lookup_idx
ON frontend_command.command_ledger (
  principal_id,
  client_request_id,
  command_semantic_digest
);

COMMIT;
