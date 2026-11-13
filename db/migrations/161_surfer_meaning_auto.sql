-- Completion metadata is not a provider grant. No historical backfill.
CREATE TABLE surfer_meaning.intent (
 attempt_id text PRIMARY KEY,project_id text NOT NULL,principal_id text NOT NULL,
 proposal_digest text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(project_id,attempt_id,proposal_digest) REFERENCES frontend_ask.surfer_meaning_proposals(project_id,attempt_id,digest) ON DELETE CASCADE
);
CREATE TABLE surfer_meaning.intent_delivery (
 attempt_id text NOT NULL REFERENCES surfer_meaning.intent(attempt_id) ON DELETE CASCADE,
 run_id text NOT NULL CHECK(run_id ~ '^[A-Za-z0-9-]{1,40}$'),
 profile_digest text NOT NULL CHECK(profile_digest ~ '^sha256:[a-f0-9]{64}$'),
 code text NOT NULL CHECK(code IN ('ENQUEUED','NO_SEPARATE_EVIDENCE','OUTSIDE_BOUNDS','SOURCE_UNAVAILABLE')),
 job_ids text[] NOT NULL CHECK(cardinality(job_ids)<=2),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(attempt_id,run_id,profile_digest),
 CHECK((code='ENQUEUED')=(cardinality(job_ids)>0))
);
CREATE FUNCTION surfer_meaning.capture_completion() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.state='SUCCEEDED' AND OLD.state IS DISTINCT FROM NEW.state THEN
  INSERT INTO surfer_meaning.intent(attempt_id,project_id,principal_id,proposal_digest)
  SELECT p.attempt_id,p.project_id,c.principal_id,p.digest
  FROM frontend_ask.surfer_meaning_proposals p
  JOIN frontend_ask.answer_run_attempts a ON a.attempt_id=p.attempt_id
  JOIN frontend_command.command_ledger c ON c.command_id=NEW.create_command_id
  WHERE p.answer_run_id=NEW.answer_run_id AND p.project_id=NEW.project_id AND a.state='SUCCEEDED'
   AND jsonb_array_length(p.receipt->'candidates')>0
   AND c.command_type='SUBMIT_QUESTION' AND c.target_project_id=p.project_id
   AND c.outcome_state='COMPLETED' AND c.completion_disposition='SUCCEEDED'
  ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER surfer_meaning_auto_completion AFTER UPDATE OF state ON frontend_ask.answer_runs FOR EACH ROW EXECUTE FUNCTION surfer_meaning.capture_completion();
CREATE FUNCTION surfer_meaning.guard_intent() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' AND pg_trigger_depth()>1 THEN RETURN OLD; END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Meaning completion metadata is immutable'; END IF;
 IF TG_TABLE_NAME='intent_delivery' AND EXISTS(
  SELECT 1 FROM unnest(NEW.job_ids) id WHERE NOT EXISTS(
   SELECT 1 FROM surfer_meaning.job j JOIN surfer_meaning.intent i ON i.attempt_id=NEW.attempt_id
   WHERE j.job_id=id AND j.proposal_attempt_id=i.attempt_id AND j.project_id=i.project_id AND j.principal_id=i.principal_id AND j.run_id=NEW.run_id AND j.profile_digest=NEW.profile_digest
  )
 ) THEN RAISE EXCEPTION 'Unproven meaning delivery'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER surfer_meaning_intent_immutable BEFORE UPDATE OR DELETE ON surfer_meaning.intent FOR EACH ROW EXECUTE FUNCTION surfer_meaning.guard_intent();
CREATE TRIGGER surfer_meaning_delivery_guard BEFORE INSERT OR UPDATE OR DELETE ON surfer_meaning.intent_delivery FOR EACH ROW EXECUTE FUNCTION surfer_meaning.guard_intent();
REVOKE ALL ON surfer_meaning.intent,surfer_meaning.intent_delivery FROM PUBLIC,shotgun_runtime;
GRANT SELECT ON surfer_meaning.intent TO shotgun_runtime;
GRANT SELECT,INSERT ON surfer_meaning.intent_delivery TO shotgun_runtime;
REVOKE ALL ON FUNCTION surfer_meaning.capture_completion(),surfer_meaning.guard_intent() FROM PUBLIC;
