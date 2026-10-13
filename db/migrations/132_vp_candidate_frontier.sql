-- Rebuildable discovery journal, not a new knowledge or budget authority.
CREATE TABLE vp.candidate_frontiers (
  frontier_id uuid PRIMARY KEY,
  project_id text NOT NULL REFERENCES project_admin.projects(id),
  policy_revision text NOT NULL,
  snapshot_digest text NOT NULL,
  generator_revision text NOT NULL,
  config_digest text NOT NULL,
  membership_digest text NOT NULL,
  assertion_count integer NOT NULL CHECK (assertion_count >= 0),
  candidate_count integer NOT NULL CHECK (candidate_count >= 0),
  is_current boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (project_id,policy_revision,snapshot_digest,generator_revision,config_digest),
  UNIQUE (project_id,frontier_id)
);
CREATE UNIQUE INDEX candidate_frontiers_current ON vp.candidate_frontiers(project_id,policy_revision) WHERE is_current;
CREATE TABLE vp.candidate_frontier_members (
  project_id text NOT NULL,
  frontier_id uuid NOT NULL,
  job_id uuid NOT NULL,
  rank integer NOT NULL CHECK (rank > 0),
  PRIMARY KEY (frontier_id,job_id),
  UNIQUE (frontier_id,rank),
  FOREIGN KEY (project_id,frontier_id) REFERENCES vp.candidate_frontiers(project_id,frontier_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id,job_id) REFERENCES vp.relation_jobs(project_id,job_id) ON DELETE CASCADE
);
GRANT SELECT,INSERT,UPDATE ON vp.candidate_frontiers TO shotgun_runtime;
GRANT SELECT,INSERT ON vp.candidate_frontier_members TO shotgun_runtime;
GRANT SELECT,DELETE ON vp.candidate_frontiers,vp.candidate_frontier_members TO shotgun_schema_owner;
CREATE TRIGGER candidate_frontiers_write_fence BEFORE INSERT OR UPDATE OR DELETE ON vp.candidate_frontiers
  FOR EACH ROW EXECUTE FUNCTION project_admin.t3_guard_project_knowledge_write();
CREATE TRIGGER candidate_frontier_members_write_fence BEFORE INSERT OR UPDATE OR DELETE ON vp.candidate_frontier_members
  FOR EACH ROW EXECUTE FUNCTION project_admin.t3_guard_project_knowledge_write();

CREATE OR REPLACE FUNCTION vp.t3_project_status(target_project_id text, reset_request_id uuid)
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
    'frontiers', (SELECT count(*) FROM vp.candidate_frontiers WHERE project_id = target_project_id),
    'frontier_members', (SELECT count(*) FROM vp.candidate_frontier_members WHERE project_id = target_project_id),
    'jobs', (SELECT count(*) FROM vp.relation_jobs WHERE project_id = target_project_id),
    'provider_calls', (SELECT count(*) FROM vp.relation_provider_calls WHERE project_id = target_project_id),
    'assertions', (SELECT count(*) FROM vp.assertions WHERE project_id = target_project_id),
    'relations', (SELECT count(*) FROM vp.relations WHERE project_id = target_project_id),
    'decisions', (SELECT count(*) FROM vp.decision_receipts WHERE project_id = target_project_id),
    'events', (SELECT count(*) FROM vp.history_events WHERE project_id = target_project_id),
    'epochs', (SELECT count(*) FROM vp.project_epochs WHERE project_id = target_project_id)
  );
END
$$;

ALTER FUNCTION vp.t3_project_status(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION vp.t3_project_status(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vp.t3_project_status(text, uuid) TO shotgun_erasure_executor;

CREATE OR REPLACE FUNCTION vp.t3_erase_project(target_project_id text, reset_request_id uuid)
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
  DELETE FROM vp.candidate_frontiers WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('frontiers', affected);
  DELETE FROM vp.relation_jobs WHERE project_id = target_project_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  deleted := deleted || jsonb_build_object('jobs', affected);
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


ALTER FUNCTION vp.t3_erase_project(text,uuid) OWNER TO shotgun_schema_owner;
