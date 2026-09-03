-- WP-05 connector runtime durability.  This migration is additive: the
-- connector schema is the authority for semantic delivery/execution state;
-- canonical outbox tables remain owned by their existing modules.
CREATE SCHEMA IF NOT EXISTS connector;

CREATE TABLE IF NOT EXISTS connector.dedup_records (
  dedup_record_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  security_scope text NOT NULL,
  consumer_id text NOT NULL,
  message_kind text NOT NULL CHECK (message_kind IN ('command', 'event', 'query')),
  message_type text NOT NULL,
  semantic_key text NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL CHECK (state IN ('IN_PROGRESS', 'OUTCOME_UNKNOWN', 'COMPLETED', 'FAILED')),
  job_id uuid,
  fence_token bigint NOT NULL DEFAULT 1 CHECK (fence_token > 0),
  result jsonb,
  safe_error_code text,
  safe_error_message text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (project_id, security_scope, consumer_id, message_kind, message_type, semantic_key),
  CHECK (updated_at >= created_at),
  CHECK (state <> 'IN_PROGRESS' OR job_id IS NOT NULL),
  CHECK (state <> 'COMPLETED' OR result IS NOT NULL),
  CHECK (state NOT IN ('FAILED', 'OUTCOME_UNKNOWN') OR safe_error_message IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS connector_dedup_recovery_idx
  ON connector.dedup_records (state, updated_at);

CREATE TABLE IF NOT EXISTS connector.jobs (
  job_id uuid PRIMARY KEY,
  dedup_record_id uuid NOT NULL REFERENCES connector.dedup_records(dedup_record_id) ON DELETE RESTRICT,
  correlation_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'outcome-unknown', 'dead-letter', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  lease_owner text,
  lease_expires_at timestamptz,
  fencing_token bigint NOT NULL DEFAULT 1 CHECK (fencing_token > 0),
  next_attempt_at timestamptz,
  result jsonb,
  safe_error_code text,
  safe_error_message text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS connector_jobs_claim_idx
  ON connector.jobs (status, next_attempt_at, lease_expires_at, updated_at);

CREATE TABLE IF NOT EXISTS connector.job_attempts (
  attempt_id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES connector.jobs(job_id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  error_code text,
  scheduled_delay_ms integer NOT NULL DEFAULT 0 CHECK (scheduled_delay_ms >= 0),
  UNIQUE (job_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS connector.dead_letters (
  dead_letter_id uuid PRIMARY KEY,
  dedup_record_id uuid NOT NULL REFERENCES connector.dedup_records(dedup_record_id) ON DELETE RESTRICT,
  project_id text NOT NULL,
  consumer_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('command', 'event')),
  semantic_key text NOT NULL,
  fingerprint text NOT NULL,
  envelope jsonb NOT NULL,
  safe_error jsonb NOT NULL,
  job jsonb,
  status text NOT NULL CHECK (status IN ('open', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS connector.replays (
  replay_id uuid PRIMARY KEY,
  dead_letter_id uuid NOT NULL REFERENCES connector.dead_letters(dead_letter_id) ON DELETE CASCADE,
  attempted_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  reason text NOT NULL
);

CREATE TABLE IF NOT EXISTS connector.ordering_checkpoints (
  consumer_id text NOT NULL,
  ordering_key text NOT NULL,
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  fencing_token bigint NOT NULL DEFAULT 1 CHECK (fencing_token > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (consumer_id, ordering_key)
);
