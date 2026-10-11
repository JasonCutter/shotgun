-- This schema is authoritative only in the explicitly configured global budget DB.
-- Workload DB copies created by ordinary migrations are never used as authority.
CREATE SCHEMA IF NOT EXISTS vp_global_budget;

CREATE TABLE vp_global_budget.policies (
  authority_id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (provider ~ '^[a-z0-9_-]{1,40}$'),
  account_fingerprint text NOT NULL CHECK (account_fingerprint ~ '^[a-f0-9]{64}$'),
  workload_class text NOT NULL CHECK (workload_class = 'VP_RELATION'),
  budget_timezone text NOT NULL CHECK (budget_timezone = 'UTC'),
  daily_limit integer NOT NULL CHECK (daily_limit BETWEEN 1 AND 100),
  configured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (provider, account_fingerprint, workload_class)
);

CREATE TABLE vp_global_budget.daily_usage (
  authority_id uuid NOT NULL REFERENCES vp_global_budget.policies(authority_id),
  budget_day date NOT NULL,
  claimed_count integer NOT NULL CHECK (claimed_count >= 0),
  PRIMARY KEY (authority_id, budget_day)
);

CREATE TABLE vp_global_budget.claims (
  claim_id uuid PRIMARY KEY,
  authority_id uuid NOT NULL REFERENCES vp_global_budget.policies(authority_id),
  budget_day date NOT NULL,
  workload_identity text NOT NULL CHECK (length(workload_identity) BETWEEN 1 AND 256),
  project_id text,
  relation_request_id text,
  state text NOT NULL CHECK (state IN ('RESERVED', 'PROVIDER_SUCCEEDED', 'PROVIDER_FAILED', 'RELEASED')),
  provider_request_id text,
  model text,
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  failure_code text,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at timestamptz,
  FOREIGN KEY (authority_id, budget_day)
    REFERENCES vp_global_budget.daily_usage(authority_id, budget_day)
);

CREATE INDEX vp_global_budget_claims_reconciliation_idx
  ON vp_global_budget.claims (authority_id, budget_day, state);

GRANT USAGE ON SCHEMA vp_global_budget TO shotgun_runtime;
GRANT SELECT ON vp_global_budget.policies, vp_global_budget.daily_usage TO shotgun_runtime;
GRANT SELECT, INSERT, UPDATE ON vp_global_budget.daily_usage,
  vp_global_budget.claims TO shotgun_runtime;

-- Provision exactly one persistent store identity in the dedicated authority DB.
-- Runtime migrations intentionally do not generate it: a cloned or ephemeral
-- workload DB cannot silently become a live provider-budget authority.
CREATE TABLE vp_global_budget.authority_store (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  store_id uuid NOT NULL UNIQUE,
  provisioned_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

GRANT SELECT ON vp_global_budget.authority_store TO shotgun_runtime;

-- One authority-side UTC day source for claims and status. Isolated database
-- tests may replace this function to exercise midnight rollover without time travel.
CREATE FUNCTION vp_global_budget.current_budget_day() RETURNS date
LANGUAGE sql VOLATILE
AS $$ SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date $$;

GRANT EXECUTE ON FUNCTION vp_global_budget.current_budget_day() TO shotgun_runtime;

-- The authority keeps the durable relation attempt identity before provider egress.
ALTER TABLE vp_global_budget.claims
  ADD COLUMN relation_job_id uuid,
  ADD COLUMN semantic_attempt_id uuid,
  ADD COLUMN execution_key text,
  ADD COLUMN provider_identity text,
  ADD CONSTRAINT vp_global_claim_relation_binding_complete CHECK (
    (relation_job_id IS NULL AND semantic_attempt_id IS NULL
      AND execution_key IS NULL AND provider_identity IS NULL)
    OR
    (relation_job_id IS NOT NULL AND semantic_attempt_id IS NOT NULL
      AND execution_key IS NOT NULL AND execution_key ~ '^sha256:[a-f0-9]{64}$'
      AND provider_identity IS NOT NULL AND length(provider_identity) BETWEEN 1 AND 256
      AND project_id IS NOT NULL)
  );

CREATE UNIQUE INDEX vp_global_claim_semantic_attempt_unique
  ON vp_global_budget.claims (authority_id, relation_job_id, semantic_attempt_id)
  WHERE relation_job_id IS NOT NULL;

-- A one-use execution fence survives restores and competing workload ledgers.
-- This does not change the accepted global counter or provision any authority.
ALTER TABLE vp_global_budget.claims ADD COLUMN execution_authorized_at timestamptz;

CREATE INDEX vp_global_claim_relation_reconciliation_idx
  ON vp_global_budget.claims (authority_id, relation_job_id, execution_key)
  WHERE relation_job_id IS NOT NULL;
