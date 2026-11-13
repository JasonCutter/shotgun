-- Metadata handoff only. No Source text, credential, execution allowance or model profile.
CREATE SCHEMA surfer_intake;
CREATE TABLE surfer_intake.job (
 job_id text PRIMARY KEY CHECK(job_id ~ '^intake:[a-f0-9]{64}$'), request_id text NOT NULL CHECK(request_id ~ '^[a-f0-9]{64}$'),
 project_id text NOT NULL, source_id uuid NOT NULL, source_version_id uuid NOT NULL,
 revision_id uuid NOT NULL, evidence_count integer NOT NULL CHECK(evidence_count>0),
 event_digest text NOT NULL CHECK(event_digest ~ '^sha256:[a-f0-9]{64}$'),
 revision bigint NOT NULL CHECK(revision>0),
 state text NOT NULL CHECK(state IN ('READY','RUNNING','COMPLETED','BLOCKED')),
 principal_id uuid, run_id text, profile_digest text,
 lease_token uuid, lease_until timestamptz,
 prepared jsonb, receipt jsonb, safe_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(project_id,source_version_id,revision_id),
 CHECK(job_id='intake:'||request_id AND event_digest='sha256:'||request_id),
 CHECK((profile_digest IS NULL AND run_id IS NULL AND principal_id IS NULL) OR (profile_digest IS NOT NULL AND run_id IS NOT NULL AND profile_digest ~ '^sha256:[a-f0-9]{64}$' AND length(run_id) BETWEEN 1 AND 40 AND principal_id IS NOT NULL)),
 CHECK((state='RUNNING' AND lease_token IS NOT NULL AND lease_until IS NOT NULL AND profile_digest IS NOT NULL) OR (state<>'RUNNING' AND lease_token IS NULL AND lease_until IS NULL)),
 CHECK(state<>'READY' OR (profile_digest IS NULL AND prepared IS NULL)),
 CHECK(state NOT IN ('COMPLETED','BLOCKED') OR profile_digest IS NOT NULL),
 CHECK(state<>'COMPLETED' OR prepared IS NOT NULL),
 CHECK((state='COMPLETED')=(receipt IS NOT NULL)),
 CHECK((state='BLOCKED')=(safe_code IS NOT NULL)),
 CHECK(safe_code IS NULL OR safe_code IN ('WORK_UNAVAILABLE','OUTCOME_UNKNOWN','INCOMPLETE')),
 CHECK(prepared IS NULL OR jsonb_typeof(prepared)='object'),
 CHECK(receipt IS NULL OR jsonb_typeof(receipt)='object')
);
CREATE INDEX surfer_intake_ready ON surfer_intake.job(project_id,state,created_at,lease_until);
CREATE TABLE surfer_intake.transition (
 job_id text NOT NULL, revision bigint NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(job_id,revision)
);
CREATE FUNCTION surfer_intake.guard_job() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 OR NEW.state<>'READY' OR NEW.profile_digest IS NOT NULL OR NEW.prepared IS NOT NULL THEN RAISE EXCEPTION 'Invalid initial intake state'; END IF;
  IF NOT EXISTS(SELECT 1 FROM evidence.stage4_continuations c
   JOIN source_product.source_stage3_progress p ON p.project_id=c.project_id AND p.source_version_id=c.source_version_id AND p.source_id=c.source_id AND p.indexing_result_id=c.indexing_result_id
   JOIN evidence.indexing_results i ON i.indexing_result_id=c.indexing_result_id
   WHERE c.project_id=NEW.project_id AND c.source_id=NEW.source_id AND c.source_version_id=NEW.source_version_id AND c.revision_id=NEW.revision_id
    AND c.evidence_count=NEW.evidence_count AND i.project_id=c.project_id AND i.source_id=c.source_id AND i.source_version_id=c.source_version_id AND i.revision_id=c.revision_id AND i.evidence_count=c.evidence_count AND i.status='INDEXED' AND p.state='STAGE3_COMPLETED') THEN RAISE EXCEPTION 'Unproven intake event'; END IF;
 ELSE
  IF NEW.revision<>OLD.revision+1 OR OLD.state IN ('COMPLETED','BLOCKED') OR
    ROW(NEW.job_id,NEW.request_id,NEW.project_id,NEW.source_id,NEW.source_version_id,NEW.revision_id,NEW.evidence_count,NEW.event_digest,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.job_id,OLD.request_id,OLD.project_id,OLD.source_id,OLD.source_version_id,OLD.revision_id,OLD.evidence_count,OLD.event_digest,OLD.created_at) OR
    (OLD.profile_digest IS NOT NULL AND ROW(NEW.principal_id,NEW.run_id,NEW.profile_digest) IS DISTINCT FROM ROW(OLD.principal_id,OLD.run_id,OLD.profile_digest)) OR
    (OLD.prepared IS NOT NULL AND NEW.prepared IS DISTINCT FROM OLD.prepared) THEN RAISE EXCEPTION 'Intake identity/history is immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION surfer_intake.record_transition() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO surfer_intake.transition(job_id,revision,payload) VALUES(NEW.job_id,NEW.revision,to_jsonb(NEW)-'lease_token');
 RETURN NEW;
END $$;
CREATE TRIGGER surfer_intake_guard BEFORE INSERT OR UPDATE ON surfer_intake.job FOR EACH ROW EXECUTE FUNCTION surfer_intake.guard_job();
CREATE TRIGGER surfer_intake_history AFTER INSERT OR UPDATE ON surfer_intake.job FOR EACH ROW EXECUTE FUNCTION surfer_intake.record_transition();
CREATE TRIGGER surfer_intake_transition_immutable BEFORE UPDATE OR DELETE ON surfer_intake.transition FOR EACH ROW EXECUTE FUNCTION surfer_history.immutable_record();
GRANT USAGE ON SCHEMA surfer_intake TO shotgun_runtime;
GRANT SELECT,INSERT,UPDATE ON surfer_intake.job TO shotgun_runtime;
GRANT SELECT ON surfer_intake.transition TO shotgun_runtime;
