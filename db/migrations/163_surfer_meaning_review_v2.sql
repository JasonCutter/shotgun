-- Accept explicit v2 review receipts without rewriting v1 work,history or authority.
-- No data update,registration,credential,grant or permission changes.
CREATE OR REPLACE FUNCTION surfer_meaning.guard_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
 IF NEW.state='COMPLETED' THEN
  IF (NEW.result->>'revision' IS DISTINCT FROM 'surfer.meaning-cross-review.v1' AND NEW.result->>'revision' IS DISTINCT FROM 'surfer.meaning-cross-review.v2') OR ROW(NEW.result->>'workDigest',NEW.result->>'digest',NEW.result->>'semanticAssessment',NEW.result->>'effect') IS DISTINCT FROM ROW(NEW.work_digest,NEW.result_digest,'MODEL_REVIEW_NOT_TRUTH_VALIDATED'::text,'NO_RULE_OR_KNOWLEDGE_CHANGE'::text) THEN RAISE EXCEPTION 'Meaning completion cannot adopt knowledge'; END IF;
  IF NEW.result->>'revision'='surfer.meaning-cross-review.v2' AND (NEW.result->'producer'->>'promptRevision' IS DISTINCT FROM 'surfer-meaning-cross-review-v2' OR jsonb_typeof(NEW.result->'interpretationLimits') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.result->'findings'->'counterKinds') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.result->'findings'->'typeCitations') IS DISTINCT FROM 'array' OR jsonb_typeof(NEW.result->'findings'->'unitCitations') IS DISTINCT FROM 'array') THEN RAISE EXCEPTION 'Invalid versioned meaning review limits'; END IF;
 END IF;
 NEW.updated_at=clock_timestamp();RETURN NEW;
END $$;
