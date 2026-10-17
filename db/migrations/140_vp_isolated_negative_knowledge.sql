-- Isolated Fake product knowledge. Historical isolated execution-only calls and
-- legacy NULL-bound projects remain unchanged. No existing receipt is backfilled.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM runtime.schema_migrations
    WHERE name = '139_isolated_image_live_transport_identity.sql') THEN
    RAISE EXCEPTION 'Migration 140 requires registered migration 139';
  END IF;
END $$;

ALTER TABLE vp.project_epochs
  ADD COLUMN relation_policy_revision text,
  ADD CONSTRAINT vp_relation_policy_revision_shape CHECK (
    relation_policy_revision IS NULL OR relation_policy_revision ~
      '^vp-relation-v6-explicit-negative-product-fake-v1:r[1-9][0-9]{0,8}$');

ALTER TABLE vp.relation_provider_calls
  ADD CONSTRAINT vp_relation_provider_calls_project_call_unique UNIQUE (project_id, call_id);

ALTER TABLE vp.decision_receipts
  ADD COLUMN provider_call_id uuid,
  ADD CONSTRAINT vp_decision_provider_call_project_fk
    FOREIGN KEY (project_id, provider_call_id)
    REFERENCES vp.relation_provider_calls(project_id, call_id) ON DELETE RESTRICT,
  ADD CONSTRAINT vp_decision_provider_call_unique UNIQUE (provider_call_id),
  DROP CONSTRAINT decision_receipts_outcome_check,
  ADD CONSTRAINT decision_receipts_outcome_check CHECK (outcome IN
    ('EQUIVALENT','SUPPORTS','QUALIFIES','CONTRADICTS','RELATED','UNRESOLVED','NO_RELATION')),
  ADD CONSTRAINT vp_no_relation_receipt_shape CHECK (
    outcome <> 'NO_RELATION' OR (
      task_kind = 'SEMANTIC_RELATION' AND method = 'GENERAL_AI'
      AND provider_call_id IS NOT NULL
      AND policy_revision ~ '^vp-relation-v6-explicit-negative-product-fake-v1:r[1-9][0-9]{0,8}$'));

ALTER TABLE vp.history_events
  ADD COLUMN decision_id uuid,
  ADD COLUMN policy_revision text,
  ADD CONSTRAINT vp_history_decision_project_fk
    FOREIGN KEY (project_id, decision_id)
    REFERENCES vp.decision_receipts(project_id, decision_id) ON DELETE RESTRICT,
  DROP CONSTRAINT history_events_event_kind_check,
  ADD CONSTRAINT history_events_event_kind_check CHECK (event_kind IN (
    'DIRECT_ASSERTION_RECORDED','SEMANTIC_RELATION_RECORDED',
    'SOURCE_BATCH_ACTIVATED','SEMANTIC_NO_RELATION_RECORDED','RELATION_POLICY_BOUND')),
  DROP CONSTRAINT history_events_source_batch_shape_check,
  ADD CONSTRAINT history_events_source_batch_shape_check CHECK (
    (event_kind = 'SOURCE_BATCH_ACTIVATED' AND assertion_id IS NULL
      AND cardinality(relation_ids) = 0 AND source_version_id IS NOT NULL
      AND batch_id IS NOT NULL AND decision_id IS NULL AND policy_revision IS NULL)
    OR (event_kind IN ('DIRECT_ASSERTION_RECORDED','SEMANTIC_RELATION_RECORDED')
      AND assertion_id IS NOT NULL AND source_version_id IS NULL AND batch_id IS NULL
      AND policy_revision IS NULL)
    OR (event_kind = 'SEMANTIC_NO_RELATION_RECORDED'
      AND assertion_id IS NOT NULL AND cardinality(relation_ids) = 0
      AND source_version_id IS NULL AND batch_id IS NULL
      AND decision_id IS NOT NULL AND policy_revision IS NULL)
    OR (event_kind = 'RELATION_POLICY_BOUND'
      AND assertion_id IS NULL AND cardinality(relation_ids) = 0
      AND source_version_id IS NULL AND batch_id IS NULL AND decision_id IS NULL
      AND policy_revision IS NOT NULL
      AND policy_revision ~ '^vp-relation-v6-explicit-negative-product-fake-v1:r[1-9][0-9]{0,8}$'));

CREATE UNIQUE INDEX vp_history_decision_unique
  ON vp.history_events(project_id, decision_id) WHERE decision_id IS NOT NULL;
CREATE UNIQUE INDEX vp_history_relation_policy_binding_unique
  ON vp.history_events(project_id, policy_revision) WHERE event_kind = 'RELATION_POLICY_BOUND';
CREATE INDEX vp_history_semantic_decision_order_idx
  ON vp.history_events(project_id, event_kind, decision_id, epoch)
  WHERE decision_id IS NOT NULL;
CREATE INDEX vp_negative_receipts_pair_idx
  ON vp.decision_receipts(project_id, left_assertion_id, right_assertion_id)
  WHERE outcome = 'NO_RELATION';

-- The epoch row is the commit fence. SHARE conflicts with a concurrent binding
-- UPDATE, so a late worker cannot publish a receipt under an obsolete revision.
CREATE FUNCTION vp.require_relation_policy_binding(p_project_id text, p_revision text)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, vp AS $$
DECLARE active_revision text;
BEGIN
  SELECT relation_policy_revision INTO active_revision FROM vp.project_epochs
    WHERE project_id = p_project_id FOR SHARE;
  IF active_revision IS DISTINCT FROM NULL AND active_revision IS DISTINCT FROM p_revision THEN
    RAISE EXCEPTION 'Semantic relation policy binding mismatch'
      USING ERRCODE = '23514', CONSTRAINT = 'vp_relation_policy_binding_mismatch';
  END IF;
  IF p_revision ~ '^vp-relation-v6-explicit-negative-product-fake-v1:r[1-9][0-9]{0,8}$'
     AND (active_revision IS DISTINCT FROM p_revision
       OR current_database() !~ '^shotgun_test_[a-z0-9_]+$') THEN
    RAISE EXCEPTION 'Isolated product policy is unavailable in this project/database'
      USING ERRCODE = '23514', CONSTRAINT = 'vp_product_policy_not_isolated';
  END IF;
END $$;

CREATE FUNCTION vp.guard_relation_receipt_product()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, vp AS $$
DECLARE
  provider_call vp.relation_provider_calls%ROWTYPE;
  provider_job vp.relation_jobs%ROWTYPE;
  payload jsonb;
  product boolean;
BEGIN
  IF NEW.task_kind <> 'SEMANTIC_RELATION' THEN RETURN NEW; END IF;
  PERFORM vp.require_relation_policy_binding(NEW.project_id, NEW.policy_revision);
  product := NEW.policy_revision ~
    '^vp-relation-v6-explicit-negative-product-fake-v1:r[1-9][0-9]{0,8}$';
  IF NEW.outcome = 'NO_RELATION' AND NOT product THEN
    RAISE EXCEPTION 'NO_RELATION requires product Fake policy'
      USING ERRCODE = '23514', CONSTRAINT = 'vp_no_relation_product_only';
  END IF;
  IF NOT product THEN RETURN NEW; END IF;
  IF NEW.provider_call_id IS NULL OR NEW.method <> 'GENERAL_AI' THEN
    RAISE EXCEPTION 'Product semantic receipt requires a linked provider call'
      USING ERRCODE = '23514', CONSTRAINT = 'vp_product_provider_call_required';
  END IF;
  SELECT * INTO provider_call FROM vp.relation_provider_calls
    WHERE project_id = NEW.project_id AND call_id = NEW.provider_call_id;
  SELECT * INTO provider_job FROM vp.relation_jobs
    WHERE project_id = NEW.project_id AND job_id = provider_call.job_id;
  payload := provider_call.output_json;
  IF (provider_call.call_id IS NOT NULL AND provider_job.job_id IS NOT NULL
    AND provider_call.state = 'OUTPUT_STORED'
    AND provider_call.global_claim_id IS NOT NULL AND provider_call.semantic_attempt_id IS NOT NULL
    AND provider_job.status = 'RUNNING'
    -- Recovery may acquire a fresh completion lease for the same stored call.
    -- Its original immutable semantic_attempt_id must not be replaced by that lease.
    AND provider_job.lease_expires_at > clock_timestamp()
    AND provider_job.policy_revision = NEW.policy_revision
    AND provider_job.left_assertion_id = NEW.left_assertion_id
    AND provider_job.right_assertion_id = NEW.right_assertion_id
    AND payload->>'contract' = 'vp-explicit-negative-product-fake-v1'
    AND payload #>> '{input,projectId}' = NEW.project_id
    AND payload #>> '{input,policyRevision}' = NEW.policy_revision
    AND payload #>> '{input,left,assertionId}' = NEW.left_assertion_id::text
    AND payload #>> '{input,right,assertionId}' = NEW.right_assertion_id::text
    AND payload #>> '{record,policyRevision}' = NEW.policy_revision
    AND payload #>> '{record,transportKind}' = 'ISOLATED_FAKE'
    AND payload #>> '{record,providerIdentity,provider}' = 'isolated-fake'
    AND NEW.input_digest = provider_call.request_digest
    AND NEW.confidence = (payload #>> '{record,disposition,declaration,confidence}')::double precision
    AND NEW.input_tokens = (payload #>> '{record,providerObservation,inputTokens}')::integer
    AND NEW.output_tokens = (payload #>> '{record,providerObservation,outputTokens}')::integer
    AND provider_call.provider_identity = concat(payload #>> '{record,providerIdentity,provider}',
       '/', payload #>> '{record,providerIdentity,model}')
    AND NEW.provider_model = concat(payload #>> '{record,providerIdentity,provider}', '/',
      COALESCE(payload #>> '{record,providerObservation,modelVersion}',
               payload #>> '{record,providerIdentity,model}'))
    AND (NEW.outcome <> 'NO_RELATION' OR (
      payload #>> '{record,disposition,status}' = 'NO_RELATION'
      AND payload #>> '{record,disposition,declaration,choice}' = 'NO_RELATION'
      AND (payload #>> '{record,disposition,declaration,probabilities,NO_RELATION}')::numeric >= 0.9))
    AND (NEW.outcome = 'NO_RELATION' OR (
      payload #>> '{record,disposition,status}' = 'DECIDED'
      AND payload #>> '{record,disposition,declaration,choice}' = NEW.outcome))) IS NOT TRUE
  THEN
    RAISE EXCEPTION 'Product semantic receipt has no matching stored Fake execution'
      USING ERRCODE = '23514', CONSTRAINT = 'vp_product_provider_call_mismatch';
  END IF;
  -- Existing intake writers lock Source before adding a version. Serialize the
  -- current-pair check with that same authority rather than a second counter.
  PERFORM source.source_id FROM asset.sources AS source
    WHERE source.project_id=NEW.project_id AND source.source_id IN (
      SELECT source_id FROM vp.assertions WHERE project_id=NEW.project_id
        AND assertion_id IN (NEW.left_assertion_id,NEW.right_assertion_id))
    ORDER BY source.source_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM vp.current_assertions AS a
    WHERE a.project_id = NEW.project_id AND a.assertion_id = NEW.left_assertion_id)
    OR NOT EXISTS (SELECT 1 FROM vp.current_assertions AS a
    WHERE a.project_id = NEW.project_id AND a.assertion_id = NEW.right_assertion_id) THEN
    RAISE EXCEPTION 'Product semantic pair is no longer current'
      USING ERRCODE = '23514', CONSTRAINT = 'vp_product_pair_not_current';
  END IF;
  IF NEW.outcome = 'NO_RELATION' AND EXISTS (
    SELECT 1 FROM vp.relations AS r JOIN vp.decision_receipts AS d
      ON d.project_id = r.project_id AND d.decision_id = r.decision_id
    WHERE r.project_id = NEW.project_id
      AND r.left_assertion_id = NEW.left_assertion_id
      AND r.right_assertion_id = NEW.right_assertion_id
      AND r.relation_kind = 'EQUIVALENT' AND d.method = 'DETERMINISTIC'
      AND d.task_kind = 'EXACT_TEXT_EQUIVALENCE') THEN
    RAISE EXCEPTION 'Deterministic exact equivalence cannot be withdrawn by AI'
      USING ERRCODE = '23514', CONSTRAINT = 'vp_exact_equivalence_negative_forbidden';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vp_product_receipt_guard BEFORE INSERT ON vp.decision_receipts
  FOR EACH ROW EXECUTE FUNCTION vp.guard_relation_receipt_product();

CREATE FUNCTION vp.guard_relation_edge_policy()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, vp AS $$
DECLARE decision vp.decision_receipts%ROWTYPE; payload jsonb;
BEGIN
  SELECT * INTO decision FROM vp.decision_receipts
    WHERE project_id = NEW.project_id AND decision_id = NEW.decision_id;
  IF decision.decision_id IS NULL OR decision.outcome = 'NO_RELATION' THEN
    RAISE EXCEPTION 'Negative or missing receipt cannot create an edge'
      USING ERRCODE = '23514', CONSTRAINT = 'vp_negative_edge_forbidden';
  END IF;
  IF decision.method <> 'DETERMINISTIC' OR decision.task_kind <> 'EXACT_TEXT_EQUIVALENCE' THEN
    PERFORM vp.require_relation_policy_binding(NEW.project_id, decision.policy_revision);
  END IF;
  IF decision.policy_revision ~ '^vp-relation-v6-explicit-negative-product-fake-v1:r[1-9][0-9]{0,8}$' THEN
    SELECT output_json INTO payload FROM vp.relation_provider_calls
      WHERE project_id=NEW.project_id AND call_id=decision.provider_call_id;
    IF (NEW.relation_kind = decision.outcome
      AND NEW.left_assertion_id = decision.left_assertion_id
      AND NEW.right_assertion_id = decision.right_assertion_id
      AND NEW.relation_direction = CASE
        WHEN payload #>> '{record,disposition,declaration,direction}' = 'NONE' THEN 'UNDIRECTED'
        ELSE payload #>> '{record,disposition,declaration,direction}' END) IS NOT TRUE THEN
      RAISE EXCEPTION 'Product edge differs from stored execution declaration'
        USING ERRCODE = '23514', CONSTRAINT = 'vp_product_edge_output_mismatch';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vp_relation_edge_policy_guard BEFORE INSERT ON vp.relations
  FOR EACH ROW EXECUTE FUNCTION vp.guard_relation_edge_policy();

CREATE FUNCTION vp.guard_unresolved_relation_veto()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, vp AS $$
BEGIN
  IF NEW.status = 'COMPLETED' AND NEW.last_failure_code IN
      ('INSUFFICIENT_EVIDENCE','QUALIFIER_NOT_MODELED') THEN
    PERFORM vp.require_relation_policy_binding(NEW.project_id, NEW.policy_revision);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vp_unresolved_relation_policy_guard
  BEFORE INSERT OR UPDATE ON vp.relation_jobs
  FOR EACH ROW EXECUTE FUNCTION vp.guard_unresolved_relation_veto();

-- Both directions are checked at commit: a receipt cannot be orphaned from
-- history, and a binding cannot be changed as metadata alone.
CREATE FUNCTION vp.check_product_receipt_history()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, vp AS $$
BEGIN
  IF NEW.task_kind = 'SEMANTIC_RELATION' AND NEW.policy_revision ~
      '^vp-relation-v6-explicit-negative-product-fake-v1:r[1-9][0-9]{0,8}$'
    AND NOT EXISTS (SELECT 1 FROM vp.history_events AS h
      WHERE h.project_id = NEW.project_id AND h.decision_id = NEW.decision_id
        AND h.event_kind = CASE WHEN NEW.outcome = 'NO_RELATION'
          THEN 'SEMANTIC_NO_RELATION_RECORDED' ELSE 'SEMANTIC_RELATION_RECORDED' END)
  THEN
    RAISE EXCEPTION 'Product semantic receipt requires matching history'
      USING ERRCODE = '23514', CONSTRAINT = 'vp_product_receipt_history_required';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER vp_product_receipt_history_required
  AFTER INSERT ON vp.decision_receipts DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION vp.check_product_receipt_history();

CREATE FUNCTION vp.check_relation_policy_history()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, vp AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.relation_policy_revision IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.relation_policy_revision IS NOT DISTINCT FROM
      OLD.relation_policy_revision THEN RETURN NULL; END IF;
  IF NEW.relation_policy_revision IS NULL OR
    NOT EXISTS (SELECT 1 FROM vp.history_events AS h
      WHERE h.project_id = NEW.project_id AND h.epoch = NEW.current_epoch
        AND h.event_kind = 'RELATION_POLICY_BOUND'
        AND h.policy_revision = NEW.relation_policy_revision) THEN
    RAISE EXCEPTION 'Relation policy binding requires same-epoch history'
      USING ERRCODE = '23514', CONSTRAINT = 'vp_relation_policy_history_required';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER vp_relation_policy_history_required
  AFTER INSERT OR UPDATE ON vp.project_epochs DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION vp.check_relation_policy_history();

CREATE FUNCTION vp.guard_product_history()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, vp AS $$
DECLARE
  decision vp.decision_receipts%ROWTYPE;
  active_revision text;
BEGIN
  IF NEW.event_kind = 'RELATION_POLICY_BOUND' THEN
    IF current_database() !~ '^shotgun_test_[a-z0-9_]+$' OR NOT EXISTS (
      SELECT 1 FROM vp.project_epochs AS e WHERE e.project_id = NEW.project_id
        AND e.current_epoch = NEW.epoch AND e.relation_policy_revision = NEW.policy_revision) THEN
      RAISE EXCEPTION 'Binding event must match isolated project epoch'
        USING ERRCODE = '23514', CONSTRAINT = 'vp_relation_policy_event_mismatch';
    END IF;
  END IF;
  IF NEW.decision_id IS NOT NULL THEN
    SELECT * INTO decision FROM vp.decision_receipts
      WHERE project_id = NEW.project_id AND decision_id = NEW.decision_id;
    IF decision.decision_id IS NULL OR decision.task_kind <> 'SEMANTIC_RELATION'
      OR (NEW.event_kind = 'SEMANTIC_NO_RELATION_RECORDED') <> (decision.outcome = 'NO_RELATION')
      OR (decision.policy_revision ~
        '^vp-relation-v6-explicit-negative-product-fake-v1:r[1-9][0-9]{0,8}$'
        AND NEW.event_kind NOT IN ('SEMANTIC_NO_RELATION_RECORDED','SEMANTIC_RELATION_RECORDED'))
      OR (decision.policy_revision ~
        '^vp-relation-v6-explicit-negative-product-fake-v1:r[1-9][0-9]{0,8}$'
        AND decision.outcome <> 'NO_RELATION' AND NOT EXISTS (
          SELECT 1 FROM vp.relations AS r WHERE r.project_id = NEW.project_id
            AND r.decision_id = NEW.decision_id
            AND r.relation_id = ANY(NEW.relation_ids))) THEN
      RAISE EXCEPTION 'Semantic history does not match its receipt'
        USING ERRCODE = '23514', CONSTRAINT = 'vp_product_history_receipt_mismatch';
    END IF;
  END IF;
  IF NEW.event_kind = 'SEMANTIC_RELATION_RECORDED' THEN
    SELECT relation_policy_revision INTO active_revision FROM vp.project_epochs
      WHERE project_id = NEW.project_id FOR SHARE;
    IF active_revision IS NOT NULL AND (
      NEW.decision_id IS NULL OR decision.policy_revision IS DISTINCT FROM active_revision) THEN
      RAISE EXCEPTION 'Semantic history cannot publish under an obsolete policy'
        USING ERRCODE = '23514', CONSTRAINT = 'vp_semantic_history_policy_mismatch';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vp_product_history_guard BEFORE INSERT ON vp.history_events
  FOR EACH ROW EXECUTE FUNCTION vp.guard_product_history();

-- Retain migration 117 unresolved-job veto. Epoch history orders a new
-- negative against positives. A positive without recoverable epoch ordering
-- fails closed for the affected pair; deterministic exact edges are exempt.
CREATE OR REPLACE VIEW vp.current_relations AS
SELECT DISTINCT ON (relation.project_id, relation.left_assertion_id,
                    relation.right_assertion_id)
       relation.relation_id, relation.project_id, relation.left_assertion_id,
       relation.right_assertion_id, relation.relation_kind,
       relation.decision_id, relation.created_at
  FROM vp.relations AS relation
  JOIN vp.current_assertions AS left_assertion
    ON left_assertion.project_id = relation.project_id
   AND left_assertion.assertion_id = relation.left_assertion_id
  JOIN vp.current_assertions AS right_assertion
    ON right_assertion.project_id = relation.project_id
   AND right_assertion.assertion_id = relation.right_assertion_id
  JOIN vp.decision_receipts AS decision
    ON decision.project_id = relation.project_id
   AND decision.decision_id = relation.decision_id
  LEFT JOIN LATERAL (
    SELECT EXISTS (SELECT 1 FROM vp.history_events AS h
      JOIN vp.decision_receipts AS negative
        ON negative.project_id = h.project_id AND negative.decision_id = h.decision_id
      WHERE h.project_id = relation.project_id
        AND h.event_kind = 'SEMANTIC_NO_RELATION_RECORDED'
        AND negative.outcome = 'NO_RELATION'
        AND negative.left_assertion_id = relation.left_assertion_id
        AND negative.right_assertion_id = relation.right_assertion_id) AS has_negative
  ) AS negative_presence ON TRUE
  LEFT JOIN LATERAL (
    SELECT max(h.epoch) AS epoch FROM vp.history_events AS h
    -- Legacy pairs without a negative need no history-array lookup.
    WHERE negative_presence.has_negative AND h.project_id = relation.project_id
      AND h.event_kind = 'SEMANTIC_RELATION_RECORDED'
      AND (h.decision_id = decision.decision_id
        OR relation.relation_id = ANY(h.relation_ids))
  ) AS positive_history ON TRUE
 WHERE (decision.method = 'DETERMINISTIC' AND decision.task_kind = 'EXACT_TEXT_EQUIVALENCE'
        AND EXISTS (SELECT 1 FROM vp.project_epochs AS binding
          WHERE binding.project_id=relation.project_id AND binding.relation_policy_revision IS NOT NULL)
   OR NOT EXISTS (
   SELECT 1 FROM vp.relation_jobs AS unresolved
    WHERE unresolved.project_id = relation.project_id
      AND unresolved.left_assertion_id = relation.left_assertion_id
      AND unresolved.right_assertion_id = relation.right_assertion_id
      AND unresolved.status = 'COMPLETED'
      AND unresolved.last_failure_code IN
        ('INSUFFICIENT_EVIDENCE', 'QUALIFIER_NOT_MODELED')
      AND unresolved.updated_at >= decision.created_at))
   AND (decision.method = 'DETERMINISTIC' AND
        decision.task_kind = 'EXACT_TEXT_EQUIVALENCE' OR NOT EXISTS (
     SELECT 1 FROM vp.history_events AS negative_history
     JOIN vp.decision_receipts AS negative
       ON negative.project_id = negative_history.project_id
      AND negative.decision_id = negative_history.decision_id
     WHERE negative_history.project_id = relation.project_id
       AND negative_history.event_kind = 'SEMANTIC_NO_RELATION_RECORDED'
       AND negative.outcome = 'NO_RELATION'
       AND negative.left_assertion_id = relation.left_assertion_id
       AND negative.right_assertion_id = relation.right_assertion_id
       AND (positive_history.epoch IS NULL OR negative_history.epoch >= positive_history.epoch)
   ))
 ORDER BY relation.project_id, relation.left_assertion_id,
   relation.right_assertion_id,
   (CASE WHEN negative_presence.has_negative THEN
     decision.method = 'DETERMINISTIC' AND decision.task_kind = 'EXACT_TEXT_EQUIVALENCE'
     END) DESC NULLS LAST,
   (CASE WHEN negative_presence.has_negative THEN positive_history.epoch END) DESC NULLS LAST,
   decision.created_at DESC, relation.relation_id DESC;

-- The existing T3 owner deletes jobs before receipts. A provider-call FK
-- requires the linked immutable receipts/history/edges to be removed first.
ALTER FUNCTION vp.t3_erase_project(text,uuid) RENAME TO t3_erase_project_before_negative;
REVOKE ALL ON FUNCTION vp.t3_erase_project_before_negative(text,uuid)
  FROM PUBLIC, shotgun_erasure_executor;
CREATE FUNCTION vp.t3_erase_project(target_project_id text, reset_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, project_admin, vp AS $$
DECLARE deleted jsonb; events_count bigint; relations_count bigint; receipts_count bigint;
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
  -- The existing owner performs its additional image/job authorization too.
  PERFORM vp.t3_project_status(target_project_id, reset_request_id);
  DELETE FROM vp.history_events WHERE project_id = target_project_id;
  GET DIAGNOSTICS events_count = ROW_COUNT;
  DELETE FROM vp.relations WHERE project_id = target_project_id;
  GET DIAGNOSTICS relations_count = ROW_COUNT;
  DELETE FROM vp.decision_receipts WHERE project_id = target_project_id;
  GET DIAGNOSTICS receipts_count = ROW_COUNT;
  deleted := vp.t3_erase_project_before_negative(target_project_id, reset_request_id);
  RETURN deleted || jsonb_build_object('events',events_count,
    'relations',relations_count,'decisions',receipts_count);
END $$;
ALTER FUNCTION vp.t3_erase_project(text,uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION vp.t3_erase_project(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vp.t3_erase_project(text,uuid) TO shotgun_erasure_executor;
