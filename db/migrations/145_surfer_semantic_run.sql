-- Workload-local coordinator only. Does not grant account allowance or model egress.
CREATE TABLE IF NOT EXISTS surfer_execution.semantic_runs (
  run_id text PRIMARY KEY CHECK(length(run_id) BETWEEN 1 AND 256),
  revision bigint NOT NULL CHECK(revision BETWEEN 0 AND 9007199254740991),
  approval_key text UNIQUE CHECK(approval_key IS NULL OR approval_key ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  digest text NOT NULL CHECK(digest ~ '^sha256:[a-f0-9]{64}$'),
  CHECK(payload->>'runId'=run_id AND payload->>'schemaVersion'='1.0.0' AND (payload->>'sequence')::bigint=revision)
);
