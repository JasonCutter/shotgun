CREATE SCHEMA IF NOT EXISTS ai;
CREATE SCHEMA IF NOT EXISTS candidate;
CREATE SCHEMA IF NOT EXISTS validation;

CREATE TABLE ai.provider_calls (
  call_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  request_id text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  policy_version text NOT NULL,
  schema_name text NOT NULL,
  data_classification text NOT NULL,
  input_evidence_ids uuid[] NOT NULL,
  status text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  call_json jsonb,
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, request_id)
);

CREATE TABLE ai.provider_attempts (
  attempt_id uuid PRIMARY KEY,
  call_id uuid NOT NULL REFERENCES ai.provider_calls(call_id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  status text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  error_code text,
  provider_response_id text,
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  UNIQUE (call_id, attempt_number)
);

CREATE TABLE candidate.batches (
  batch_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  source_version_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  provider_call jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, idempotency_key)
);

CREATE TABLE candidate.claim_candidates (
  candidate_id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES candidate.batches(batch_id) ON DELETE CASCADE,
  project_id text NOT NULL,
  source_version_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number = 1),
  claim_text text NOT NULL CHECK (length(claim_text) > 0),
  evidence_id uuid NOT NULL REFERENCES evidence.spans(evidence_id),
  evidence_mode text NOT NULL CHECK (evidence_mode = 'DIRECT_EVIDENCE'),
  extraction_profile text NOT NULL CHECK (extraction_profile = 'direct-only'),
  status text NOT NULL CHECK (status IN ('PENDING_VALIDATION', 'READY', 'REJECTED')),
  provider_call jsonb NOT NULL,
  access_scope text[] NOT NULL CHECK (cardinality(access_scope) > 0),
  sensitivity text NOT NULL CHECK (sensitivity IN ('public', 'internal', 'private', 'restricted')),
  created_at timestamptz NOT NULL,
  UNIQUE (batch_id, evidence_id, claim_text)
);

CREATE INDEX claim_candidates_source_idx
  ON candidate.claim_candidates (project_id, source_version_id, created_at);

CREATE TABLE validation.results (
  validation_id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidate.claim_candidates(candidate_id),
  revision_number integer NOT NULL CHECK (revision_number = 1),
  project_id text NOT NULL,
  source_version_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('READY', 'REJECTED')),
  dimensions jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, candidate_id, revision_number)
);
