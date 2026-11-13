-- Count-free preflight for stores whose project erasure owner has not been implemented.
-- This returns only whether matching content may remain. It grants no table access.
CREATE FUNCTION frontend_ask.t3_has_surfer_reset_content(target_project_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT
    EXISTS (SELECT 1 FROM surfer_knowledge.space_state WHERE space_id = target_project_id)
    OR EXISTS (SELECT 1 FROM surfer_knowledge.source_binding_v2 WHERE space_id = target_project_id)
    OR EXISTS (SELECT 1 FROM surfer_history.generation WHERE space_id = target_project_id)
    OR EXISTS (SELECT 1 FROM surfer_rows.space WHERE space_id = target_project_id)
    OR EXISTS (SELECT 1 FROM surfer_rows.migration WHERE space_id = target_project_id)
    OR EXISTS (SELECT 1 FROM surfer_intake.job WHERE project_id = target_project_id)
    OR EXISTS (SELECT 1 FROM surfer_meaning.job WHERE project_id = target_project_id)
    OR EXISTS (SELECT 1 FROM surfer_meaning.intent WHERE project_id = target_project_id)
    OR EXISTS (SELECT 1 FROM frontend_ask.surfer_meaning_proposals WHERE project_id = target_project_id)
    OR EXISTS (
      SELECT 1 FROM frontend_ask.surfer_memory_context
      WHERE project_id = target_project_id
        AND (context->'packet') IS DISTINCT FROM 'null'::jsonb
    )
    OR EXISTS (
      SELECT 1 FROM surfer_execution.budget_state AS budget
      CROSS JOIN LATERAL jsonb_array_elements(budget.payload->'records') AS reservation(record)
      WHERE reservation.record#>>'{request,spaceId}' = target_project_id
    )
    -- The legacy semantic run format has no Project key. Fail closed if any are present.
    OR EXISTS (SELECT 1 FROM surfer_execution.semantic_runs);
$$;
REVOKE ALL ON FUNCTION frontend_ask.t3_has_surfer_reset_content(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION frontend_ask.t3_has_surfer_reset_content(text) TO shotgun_runtime;

-- These writers have a canonical project_id. Reuse the installed Project fence.
CREATE TRIGGER surfer_memory_context_t3_write_fence
BEFORE INSERT ON frontend_ask.surfer_memory_context
FOR EACH ROW EXECUTE FUNCTION project_admin.t3_guard_project_knowledge_write();

CREATE TRIGGER surfer_meaning_proposal_t3_write_fence
BEFORE INSERT ON frontend_ask.surfer_meaning_proposals
FOR EACH ROW EXECUTE FUNCTION project_admin.t3_guard_project_knowledge_write();

CREATE TRIGGER surfer_meaning_job_t3_write_fence
BEFORE INSERT OR UPDATE ON surfer_meaning.job
FOR EACH ROW EXECUTE FUNCTION project_admin.t3_guard_project_knowledge_write();

CREATE TRIGGER surfer_meaning_intent_t3_write_fence
BEFORE INSERT ON surfer_meaning.intent
FOR EACH ROW EXECUTE FUNCTION project_admin.t3_guard_project_knowledge_write();

CREATE TRIGGER surfer_intake_job_t3_write_fence
BEFORE INSERT OR UPDATE ON surfer_intake.job
FOR EACH ROW EXECUTE FUNCTION project_admin.t3_guard_project_knowledge_write();
