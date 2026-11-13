-- Proposal receipts grant no Source, rule, account, evaluation, or Action authority.
ALTER TABLE frontend_ask.surfer_memory_context ADD CONSTRAINT surfer_memory_context_proposal_identity
UNIQUE(attempt_id,answer_run_id,project_id,digest);
CREATE TABLE frontend_ask.surfer_meaning_proposals (
  attempt_id text PRIMARY KEY,
  answer_run_id text NOT NULL,
  project_id text NOT NULL,
  context_digest text NOT NULL CHECK(context_digest ~ '^sha256:[a-f0-9]{64}$'),
  receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object' AND length(receipt::text)<=60000),
  digest text NOT NULL CHECK(digest ~ '^sha256:[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(attempt_id,answer_run_id,project_id,context_digest)
    REFERENCES frontend_ask.surfer_memory_context(attempt_id,answer_run_id,project_id,digest) ON DELETE CASCADE,
  FOREIGN KEY(project_id,answer_run_id) REFERENCES frontend_ask.answer_runs(project_id,answer_run_id) ON DELETE CASCADE
);
CREATE TRIGGER immutable_surfer_ask_meaning_proposal BEFORE UPDATE ON frontend_ask.surfer_meaning_proposals
FOR EACH ROW EXECUTE FUNCTION surfer_history.immutable_record();
REVOKE ALL ON frontend_ask.surfer_meaning_proposals FROM PUBLIC,shotgun_runtime;
GRANT SELECT,INSERT ON frontend_ask.surfer_meaning_proposals TO shotgun_runtime;
-- Parent Ask erasure remains authoritative; no independent receipt DELETE grant.
