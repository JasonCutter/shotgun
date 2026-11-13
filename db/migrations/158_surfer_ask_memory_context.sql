-- One immutable extension of the existing Ask attempt; no source, model or account authority.
CREATE TABLE frontend_ask.surfer_memory_context (
  attempt_id text PRIMARY KEY REFERENCES frontend_ask.answer_run_attempts(attempt_id) ON DELETE CASCADE,
  answer_run_id text NOT NULL,
  project_id text NOT NULL,
  attempt_number integer NOT NULL CHECK(attempt_number>0),
  base_context_digest text NOT NULL CHECK(length(base_context_digest) BETWEEN 1 AND 256),
  context jsonb NOT NULL CHECK(jsonb_typeof(context)='object' AND length(context::text)<=100000),
  digest text NOT NULL CHECK(digest ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(answer_run_id,attempt_number),
  FOREIGN KEY(project_id,answer_run_id) REFERENCES frontend_ask.answer_runs(project_id,answer_run_id) ON DELETE CASCADE
);
CREATE TRIGGER immutable_surfer_ask_memory_context BEFORE UPDATE ON frontend_ask.surfer_memory_context
FOR EACH ROW EXECUTE FUNCTION surfer_history.immutable_record();
REVOKE ALL ON frontend_ask.surfer_memory_context FROM PUBLIC,shotgun_runtime;
GRANT SELECT,INSERT ON frontend_ask.surfer_memory_context TO shotgun_runtime;
-- Parent Ask erasure authorization remains in force; cascade removes this Evidence-subset copy.
