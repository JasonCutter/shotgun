ALTER TABLE ai.provider_calls
  ADD COLUMN IF NOT EXISTS source_version_id uuid,
  ADD COLUMN IF NOT EXISTS access_scope text[] NOT NULL DEFAULT ARRAY['owner']::text[],
  ADD COLUMN IF NOT EXISTS sensitivity text NOT NULL DEFAULT 'private' CHECK (sensitivity IN ('public', 'internal', 'private', 'restricted')),
  ADD COLUMN IF NOT EXISTS input_snapshot_digest text,
  ADD COLUMN IF NOT EXISTS request_digest text,
  ADD COLUMN IF NOT EXISTS durable_state text NOT NULL DEFAULT 'OUTCOME_UNKNOWN' CHECK (durable_state IN ('REQUESTED', 'PROVIDER_RUNNING', 'OUTPUT_MATERIALIZED', 'PROVIDER_FAILED', 'OUTCOME_UNKNOWN', 'MATERIALIZATION_FAILED', 'COMPLETED')),
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 2 CHECK (max_attempts BETWEEN 1 AND 2),
  ADD COLUMN IF NOT EXISTS accepted_output_id uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS provider_calls_request_digest_unique
  ON ai.provider_calls (project_id, request_digest) WHERE request_digest IS NOT NULL;

ALTER TABLE ai.provider_attempts DROP CONSTRAINT IF EXISTS provider_attempts_status_check;
ALTER TABLE ai.provider_attempts
  ADD CONSTRAINT provider_attempts_status_check CHECK (status IN ('running', 'succeeded', 'failed', 'outcome_unknown'));
ALTER TABLE ai.provider_attempts
  ADD COLUMN IF NOT EXISTS started_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE ai.provider_attempts
  ADD CONSTRAINT provider_attempts_number_budget CHECK (attempt_number BETWEEN 1 AND 2);

CREATE TABLE ai.provider_outputs (
  output_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  call_id uuid NOT NULL REFERENCES ai.provider_calls(call_id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL REFERENCES ai.provider_attempts(attempt_id) ON DELETE RESTRICT,
  envelope_version text NOT NULL CHECK (envelope_version = 'ai-provider-output-v1'),
  provider text NOT NULL,
  adapter_version text NOT NULL,
  model text NOT NULL,
  schema_name text NOT NULL,
  schema_version text NOT NULL,
  prompt_version text NOT NULL,
  policy_version text NOT NULL,
  data_policy_version text NOT NULL,
  output_text text NOT NULL,
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  input_snapshot_digest text NOT NULL CHECK (input_snapshot_digest ~ '^sha256:[a-f0-9]{64}$'),
  provider_response_id text,
  model_version text NOT NULL,
  finish_reason text,
  usage_json jsonb NOT NULL,
  cost_json jsonb NOT NULL,
  structured_output_valid boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL,
  UNIQUE (attempt_id)
);

ALTER TABLE ai.provider_calls
  ADD CONSTRAINT provider_calls_accepted_output_fk FOREIGN KEY (accepted_output_id)
  REFERENCES ai.provider_outputs(output_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX provider_outputs_one_accepted_per_call
  ON ai.provider_calls (call_id) WHERE accepted_output_id IS NOT NULL;

CREATE TABLE candidate.materializations (
  materialization_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  output_id uuid NOT NULL REFERENCES ai.provider_outputs(output_id) ON DELETE RESTRICT,
  output_digest text NOT NULL CHECK (output_digest ~ '^sha256:[a-f0-9]{64}$'),
  input_snapshot_digest text NOT NULL CHECK (input_snapshot_digest ~ '^sha256:[a-f0-9]{64}$'),
  materializer_version text NOT NULL CHECK (materializer_version = 'stage12-1-v1'),
  batch_id uuid REFERENCES candidate.batches(batch_id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('MATERIALIZATION_FAILED', 'COMPLETED')),
  failure_code text,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (project_id, output_id, materializer_version),
  UNIQUE (batch_id)
);

CREATE OR REPLACE FUNCTION ai.reject_provider_output_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ai.provider_outputs is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER provider_outputs_append_only
  BEFORE UPDATE OR DELETE ON ai.provider_outputs
  FOR EACH ROW EXECUTE FUNCTION ai.reject_provider_output_change();
