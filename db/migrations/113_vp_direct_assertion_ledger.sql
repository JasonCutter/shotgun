-- VP shadow ledger: validated direct claims remain tied to immutable Evidence.
-- Existing Canonical data is preserved and is never written by this ledger.
CREATE SCHEMA IF NOT EXISTS vp;

CREATE TABLE vp.project_epochs (
  project_id text PRIMARY KEY REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  current_epoch bigint NOT NULL DEFAULT 0 CHECK (current_epoch >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION vp.enforce_epoch_increment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_epoch <> OLD.current_epoch + 1 THEN
    RAISE EXCEPTION 'VP knowledge epoch must advance by one';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER vp_epoch_monotonic
  BEFORE UPDATE ON vp.project_epochs
  FOR EACH ROW EXECUTE FUNCTION vp.enforce_epoch_increment();

-- Compound references prevent an assertion from combining IDs from different
-- projects or SourceVersions even if a future writer bypasses the adapter.
ALTER TABLE evidence.spans
  ADD CONSTRAINT evidence_spans_vp_lineage_unique
  UNIQUE (project_id, source_id, source_version_id, evidence_id);
ALTER TABLE candidate.claim_candidates
  ADD CONSTRAINT candidate_claims_vp_lineage_unique
  UNIQUE (project_id, source_version_id, candidate_id);

CREATE TABLE vp.assertions (
  assertion_id uuid PRIMARY KEY,
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  candidate_id uuid NOT NULL UNIQUE,
  source_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  claim_text text NOT NULL CHECK (length(btrim(claim_text)) > 0),
  origin text NOT NULL CHECK (origin = 'DIRECT_SOURCE'),
  access_scope text[] NOT NULL CHECK (cardinality(access_scope) > 0),
  sensitivity text NOT NULL CHECK (sensitivity IN ('public', 'internal', 'private', 'restricted')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (project_id, assertion_id),
  FOREIGN KEY (project_id, source_id) REFERENCES asset.sources(project_id, source_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_id, source_version_id)
    REFERENCES asset.source_versions(source_id, source_version_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, source_version_id, candidate_id)
    REFERENCES candidate.claim_candidates(project_id, source_version_id, candidate_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (project_id, source_id, source_version_id, evidence_id)
    REFERENCES evidence.spans(project_id, source_id, source_version_id, evidence_id)
    ON DELETE RESTRICT
);

CREATE INDEX vp_assertions_project_text_idx
  ON vp.assertions (project_id, claim_text, assertion_id);
CREATE INDEX vp_assertions_source_version_idx
  ON vp.assertions (project_id, source_version_id, assertion_id);

CREATE TABLE vp.decision_receipts (
  decision_id uuid PRIMARY KEY,
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  method text NOT NULL CHECK (method = 'DETERMINISTIC'),
  task_kind text NOT NULL CHECK (task_kind = 'EXACT_TEXT_EQUIVALENCE'),
  policy_revision text NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^sha256:[a-f0-9]{64}$'),
  outcome text NOT NULL CHECK (outcome = 'EQUIVALENT'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (project_id, decision_id)
);

CREATE TABLE vp.relations (
  relation_id uuid PRIMARY KEY,
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  left_assertion_id uuid NOT NULL,
  right_assertion_id uuid NOT NULL,
  relation_kind text NOT NULL CHECK (relation_kind = 'EQUIVALENT'),
  decision_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (left_assertion_id < right_assertion_id),
  UNIQUE (project_id, left_assertion_id, right_assertion_id, relation_kind),
  FOREIGN KEY (project_id, left_assertion_id)
    REFERENCES vp.assertions(project_id, assertion_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, right_assertion_id)
    REFERENCES vp.assertions(project_id, assertion_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, decision_id)
    REFERENCES vp.decision_receipts(project_id, decision_id) ON DELETE RESTRICT
);

CREATE TABLE vp.history_events (
  event_id uuid PRIMARY KEY,
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  epoch bigint NOT NULL CHECK (epoch > 0),
  event_kind text NOT NULL CHECK (event_kind = 'DIRECT_ASSERTION_RECORDED'),
  assertion_id uuid NOT NULL,
  relation_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (project_id, epoch),
  FOREIGN KEY (project_id, assertion_id)
    REFERENCES vp.assertions(project_id, assertion_id) ON DELETE RESTRICT
);

CREATE OR REPLACE VIEW vp.current_assertions AS
SELECT assertion.assertion_id, assertion.project_id, assertion.candidate_id,
       assertion.source_id, assertion.source_version_id, assertion.evidence_id,
       assertion.claim_text, assertion.origin, assertion.access_scope,
       assertion.sensitivity, assertion.created_at
  FROM vp.assertions AS assertion
  JOIN asset.source_versions AS version
    ON version.source_id = assertion.source_id
   AND version.source_version_id = assertion.source_version_id
  JOIN source_product.source_stage3_progress AS progress
    ON progress.project_id = assertion.project_id
   AND progress.source_version_id = assertion.source_version_id
   AND progress.state = 'STAGE3_COMPLETED'
 WHERE version.version_number = (
   SELECT max(latest.version_number)
     FROM asset.source_versions AS latest
    WHERE latest.source_id = assertion.source_id
 );

CREATE OR REPLACE VIEW vp.current_relations AS
SELECT relation.*
  FROM vp.relations AS relation
  JOIN vp.current_assertions AS left_assertion
    ON left_assertion.project_id = relation.project_id
   AND left_assertion.assertion_id = relation.left_assertion_id
  JOIN vp.current_assertions AS right_assertion
    ON right_assertion.project_id = relation.project_id
   AND right_assertion.assertion_id = relation.right_assertion_id;

CREATE FUNCTION vp.reject_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND project_admin.t3_reset_write_authorized(OLD.project_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'VP ledger % is append-only', TG_TABLE_NAME;
END
$$;

CREATE TRIGGER vp_assertions_append_only
  BEFORE UPDATE OR DELETE ON vp.assertions
  FOR EACH ROW EXECUTE FUNCTION vp.reject_ledger_mutation();
CREATE TRIGGER vp_decisions_append_only
  BEFORE UPDATE OR DELETE ON vp.decision_receipts
  FOR EACH ROW EXECUTE FUNCTION vp.reject_ledger_mutation();
CREATE TRIGGER vp_relations_append_only
  BEFORE UPDATE OR DELETE ON vp.relations
  FOR EACH ROW EXECUTE FUNCTION vp.reject_ledger_mutation();
CREATE TRIGGER vp_history_append_only
  BEFORE UPDATE OR DELETE ON vp.history_events
  FOR EACH ROW EXECUTE FUNCTION vp.reject_ledger_mutation();

CREATE FUNCTION vp.reject_ledger_truncate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'VP ledger % cannot be truncated', TG_TABLE_NAME;
END
$$;

CREATE TRIGGER vp_assertions_no_truncate
  BEFORE TRUNCATE ON vp.assertions
  FOR EACH STATEMENT EXECUTE FUNCTION vp.reject_ledger_truncate();
CREATE TRIGGER vp_decisions_no_truncate
  BEFORE TRUNCATE ON vp.decision_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION vp.reject_ledger_truncate();
CREATE TRIGGER vp_relations_no_truncate
  BEFORE TRUNCATE ON vp.relations
  FOR EACH STATEMENT EXECUTE FUNCTION vp.reject_ledger_truncate();
CREATE TRIGGER vp_history_no_truncate
  BEFORE TRUNCATE ON vp.history_events
  FOR EACH STATEMENT EXECUTE FUNCTION vp.reject_ledger_truncate();

-- Runtime may append and read the ledger, but cannot rewrite history.
GRANT USAGE ON SCHEMA vp TO shotgun_runtime, shotgun_schema_owner, shotgun_erasure_executor;
GRANT SELECT, INSERT, UPDATE ON vp.project_epochs TO shotgun_runtime;
GRANT SELECT, INSERT ON vp.assertions, vp.decision_receipts,
  vp.relations, vp.history_events TO shotgun_runtime;
GRANT SELECT ON vp.current_assertions, vp.current_relations TO shotgun_runtime;
GRANT SELECT, DELETE ON vp.assertions, vp.decision_receipts,
  vp.relations, vp.history_events, vp.project_epochs TO shotgun_schema_owner;

CREATE TRIGGER vp_project_epochs_write_fence
  BEFORE INSERT OR UPDATE ON vp.project_epochs
  FOR EACH ROW EXECUTE FUNCTION project_admin.t3_guard_project_knowledge_write();
CREATE TRIGGER vp_assertions_write_fence
  BEFORE INSERT ON vp.assertions
  FOR EACH ROW EXECUTE FUNCTION project_admin.t3_guard_project_knowledge_write();
CREATE TRIGGER vp_decisions_write_fence
  BEFORE INSERT ON vp.decision_receipts
  FOR EACH ROW EXECUTE FUNCTION project_admin.t3_guard_project_knowledge_write();
CREATE TRIGGER vp_relations_write_fence
  BEFORE INSERT ON vp.relations
  FOR EACH ROW EXECUTE FUNCTION project_admin.t3_guard_project_knowledge_write();
CREATE TRIGGER vp_history_write_fence
  BEFORE INSERT ON vp.history_events
  FOR EACH ROW EXECUTE FUNCTION project_admin.t3_guard_project_knowledge_write();

CREATE FUNCTION vp.t3_project_status(target_project_id text, reset_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, project_admin, vp AS $$
DECLARE
  authorized boolean;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM project_admin.project_knowledge_reset_requests AS request
    JOIN project_admin.project_knowledge_epoch AS epoch
      ON epoch.project_id = request.project_id
     AND epoch.epoch = request.resulting_knowledge_epoch
    WHERE request.project_id = target_project_id
      AND request.request_id = reset_request_id
      AND request.owner_manifest_digest IS NOT NULL
      AND request.state IN ('FENCING', 'PURGING', 'REBUILDING', 'VERIFYING')
      AND epoch.state = 'RESET_PENDING'
  ) INTO authorized;
  IF NOT authorized THEN
    RAISE EXCEPTION 'VP ledger status is unavailable outside active maintenance'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;
  RETURN jsonb_build_object(
    'assertions', (SELECT count(*) FROM vp.assertions WHERE project_id = target_project_id),
    'relations', (SELECT count(*) FROM vp.relations WHERE project_id = target_project_id),
    'decisions', (SELECT count(*) FROM vp.decision_receipts WHERE project_id = target_project_id),
    'events', (SELECT count(*) FROM vp.history_events WHERE project_id = target_project_id),
    'epochs', (SELECT count(*) FROM vp.project_epochs WHERE project_id = target_project_id)
  );
END
$$;

CREATE FUNCTION vp.t3_erase_project(target_project_id text, reset_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, project_admin, vp AS $$
DECLARE
  affected bigint;
  deleted jsonb := '{}'::jsonb;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  PERFORM set_config('shotgun.t3_reset_request_id', reset_request_id::text, true);
  IF NOT project_admin.t3_reset_write_authorized(target_project_id) THEN
    RAISE EXCEPTION 'Approved Source knowledge reset request is not active'
      USING ERRCODE = '55000', CONSTRAINT = 't3_reset_request_not_authorized';
  END IF;
  DELETE FROM vp.history_events WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('events', affected);
  DELETE FROM vp.relations WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('relations', affected);
  DELETE FROM vp.decision_receipts WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('decisions', affected);
  DELETE FROM vp.assertions WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('assertions', affected);
  DELETE FROM vp.project_epochs WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('epochs', affected);
  RETURN deleted;
END
$$;

ALTER FUNCTION vp.t3_project_status(text, uuid) OWNER TO shotgun_schema_owner;
ALTER FUNCTION vp.t3_erase_project(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION vp.t3_project_status(text, uuid),
  vp.t3_erase_project(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vp.t3_project_status(text, uuid),
  vp.t3_erase_project(text, uuid) TO shotgun_erasure_executor;
