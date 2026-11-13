-- Fixed review preparations are not grants, knowledge adoption, or automatic model authority.
ALTER TABLE frontend_ask.surfer_meaning_proposals ADD CONSTRAINT surfer_meaning_queue_parent_identity UNIQUE(project_id,attempt_id,digest);
CREATE SCHEMA surfer_meaning;
CREATE TABLE surfer_meaning.job (
 job_id text PRIMARY KEY CHECK(job_id ~ '^meaning:[a-f0-9]{64}$'),
 request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[a-f0-9]{64}$'),
 project_id text NOT NULL, principal_id text NOT NULL CHECK(length(principal_id) BETWEEN 1 AND 256),
 run_id text NOT NULL CHECK(run_id ~ '^[A-Za-z0-9-]{1,40}$'),
 profile_digest text NOT NULL CHECK(profile_digest ~ '^sha256:[a-f0-9]{64}$'),
 proposal_attempt_id text NOT NULL, proposal_digest text NOT NULL, candidate_index integer NOT NULL CHECK(candidate_index BETWEEN 0 AND 7),
 work jsonb NOT NULL CHECK(jsonb_typeof(work)='object' AND length(work::text)<=48000),
 work_digest text NOT NULL CHECK(work_digest ~ '^sha256:[a-f0-9]{64}$'),
 revision bigint NOT NULL CHECK(revision>0),state text NOT NULL CHECK(state IN ('READY','RUNNING','COMPLETED','BLOCKED')),
 lease_token uuid,lease_until timestamptz,result jsonb,result_digest text,code text CHECK(code IN ('WORK_UNAVAILABLE','OUTCOME_UNKNOWN','INCOMPLETE')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(project_id,proposal_attempt_id,proposal_digest) REFERENCES frontend_ask.surfer_meaning_proposals(project_id,attempt_id,digest) ON DELETE CASCADE,
 CHECK(job_id='meaning:'||substring(request_digest from 8)),
 CHECK((state='RUNNING')=(lease_token IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK(state='RUNNING' OR (lease_token IS NULL AND lease_until IS NULL)),
 CHECK((state='COMPLETED')=(result IS NOT NULL AND result_digest IS NOT NULL)),
 CHECK(state='COMPLETED' OR (result IS NULL AND result_digest IS NULL)),
 CHECK(result_digest IS NULL OR result_digest ~ '^sha256:[a-f0-9]{64}$'),
 CHECK(result IS NULL OR (jsonb_typeof(result)='object' AND length(result::text)<=64000)),
 CHECK((state='BLOCKED')=(code IS NOT NULL))
);
CREATE INDEX surfer_meaning_due ON surfer_meaning.job(project_id,principal_id,run_id,profile_digest,state,created_at,job_id);
-- History carries no work, Source text, provider output, lease token or credential.
CREATE TABLE surfer_meaning.transition(job_id text NOT NULL,revision bigint NOT NULL,payload jsonb NOT NULL,PRIMARY KEY(job_id,revision));
CREATE FUNCTION surfer_meaning.guard_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Meaning work may only be erased through its parent'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 OR NEW.state<>'READY' OR NEW.lease_token IS NOT NULL OR NEW.result IS NOT NULL THEN RAISE EXCEPTION 'Invalid initial meaning queue state'; END IF;
  IF NOT EXISTS(SELECT 1 FROM frontend_ask.surfer_meaning_proposals p JOIN frontend_ask.surfer_memory_context c ON c.attempt_id=p.attempt_id JOIN frontend_ask.answer_runs r ON r.answer_run_id=p.answer_run_id JOIN frontend_command.command_ledger command ON command.command_id=r.create_command_id WHERE p.attempt_id=NEW.proposal_attempt_id AND p.project_id=NEW.project_id AND p.digest=NEW.proposal_digest AND r.state='SUCCEEDED' AND command.principal_id=NEW.principal_id AND command.command_type='SUBMIT_QUESTION' AND command.target_project_id=NEW.project_id AND command.outcome_state='COMPLETED' AND command.completion_disposition='SUCCEEDED' AND c.digest=p.context_digest AND p.receipt->'candidates'->NEW.candidate_index=NEW.work->'candidate' AND NEW.work->'proposal'->>'contextDigest'=c.digest) THEN RAISE EXCEPTION 'Unproven meaning candidate'; END IF;
 ELSE
  IF OLD.state IN ('COMPLETED','BLOCKED') OR NEW.revision<>OLD.revision+1 OR ROW(NEW.job_id,NEW.request_digest,NEW.project_id,NEW.principal_id,NEW.run_id,NEW.profile_digest,NEW.proposal_attempt_id,NEW.proposal_digest,NEW.candidate_index,NEW.work,NEW.work_digest,NEW.created_at) IS DISTINCT FROM ROW(OLD.job_id,OLD.request_digest,OLD.project_id,OLD.principal_id,OLD.run_id,OLD.profile_digest,OLD.proposal_attempt_id,OLD.proposal_digest,OLD.candidate_index,OLD.work,OLD.work_digest,OLD.created_at) THEN RAISE EXCEPTION 'Meaning identity/preparation/history is immutable'; END IF;
  IF OLD.state='READY' AND NEW.state<>'RUNNING' THEN RAISE EXCEPTION 'Meaning work must be claimed'; END IF;
  IF OLD.state='RUNNING' AND NEW.state='READY' THEN RAISE EXCEPTION 'Meaning work cannot be reset'; END IF;
  IF OLD.state='RUNNING' AND NEW.state='RUNNING' AND (OLD.lease_until>clock_timestamp() OR NEW.lease_token=OLD.lease_token) THEN RAISE EXCEPTION 'Meaning lease is not reclaimable'; END IF;
  IF OLD.state='RUNNING' AND NEW.state<>'RUNNING' AND OLD.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'Expired meaning claim'; END IF;
 END IF;
 IF ROW(NEW.work->>'revision',NEW.work->>'digest',NEW.work->>'profileDigest',NEW.work->'basis'->'authority'->>'projectId',NEW.work->'basis'->'authority'->>'principalId',NEW.work->'proposal'->>'attemptId',NEW.work->'proposal'->>'receiptDigest',(NEW.work->'proposal'->>'candidateIndex')::integer) IS DISTINCT FROM ROW('surfer.meaning-verification-work.v1'::text,NEW.work_digest,NEW.profile_digest,NEW.project_id,NEW.principal_id,NEW.proposal_attempt_id,NEW.proposal_digest,NEW.candidate_index) THEN RAISE EXCEPTION 'Meaning work pin differs'; END IF;
 IF NEW.state='RUNNING' AND (NEW.lease_until<=clock_timestamp() OR NEW.lease_until>clock_timestamp()+interval '2 days') THEN RAISE EXCEPTION 'Invalid bounded meaning lease'; END IF;
 IF NEW.state='COMPLETED' AND ROW(NEW.result->>'revision',NEW.result->>'workDigest',NEW.result->>'digest',NEW.result->>'semanticAssessment',NEW.result->>'effect') IS DISTINCT FROM ROW('surfer.meaning-cross-review.v1'::text,NEW.work_digest,NEW.result_digest,'MODEL_REVIEW_NOT_TRUTH_VALIDATED'::text,'NO_RULE_OR_KNOWLEDGE_CHANGE'::text) THEN RAISE EXCEPTION 'Meaning completion cannot adopt knowledge'; END IF;
 NEW.updated_at=clock_timestamp();RETURN NEW;
END $$;
CREATE FUNCTION surfer_meaning.record_transition() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO surfer_meaning.transition(job_id,revision,payload) VALUES(NEW.job_id,NEW.revision,jsonb_build_object('state',NEW.state,'code',NEW.code,'workDigest',NEW.work_digest,'resultDigest',NEW.result_digest,'at',NEW.updated_at));RETURN NEW;
END $$;
CREATE TRIGGER surfer_meaning_guard BEFORE INSERT OR UPDATE OR DELETE ON surfer_meaning.job FOR EACH ROW EXECUTE FUNCTION surfer_meaning.guard_job();
CREATE TRIGGER surfer_meaning_history AFTER INSERT OR UPDATE ON surfer_meaning.job FOR EACH ROW EXECUTE FUNCTION surfer_meaning.record_transition();
CREATE TRIGGER surfer_meaning_history_immutable BEFORE UPDATE OR DELETE ON surfer_meaning.transition FOR EACH ROW EXECUTE FUNCTION surfer_history.immutable_record();
REVOKE ALL ON SCHEMA surfer_meaning FROM PUBLIC;
REVOKE ALL ON surfer_meaning.job,surfer_meaning.transition FROM PUBLIC,shotgun_runtime;
GRANT USAGE ON SCHEMA surfer_meaning TO shotgun_runtime;
GRANT SELECT,INSERT,UPDATE ON surfer_meaning.job TO shotgun_runtime;
GRANT SELECT ON surfer_meaning.transition TO shotgun_runtime;
