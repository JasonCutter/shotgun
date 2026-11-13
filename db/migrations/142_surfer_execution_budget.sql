-- Additive Surfer execution owner; no Source, VP or global authority mutations.
CREATE SCHEMA IF NOT EXISTS surfer_execution;
CREATE TABLE IF NOT EXISTS surfer_execution.budget_state (
  budget_id text PRIMARY KEY CHECK (length(budget_id) BETWEEN 1 AND 256),
  revision bigint NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  digest text NOT NULL CHECK (digest ~ '^sha256:[a-f0-9]{64}$'),
  CHECK (payload->>'schemaVersion' = '1.0.0'),
  CHECK (payload->>'budgetId' = budget_id),
  CHECK ((payload->>'sequence')::bigint = revision)
);
