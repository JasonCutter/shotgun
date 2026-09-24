DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1 FROM runtime.schema_migrations
    WHERE name = '098_t3_knowledge_draft_erasure.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 099 preflight failed: migration 098 is not registered';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION frontend_review.t3_review_delete_authorized(
  p_project_id text,
  p_review_context_id text,
  p_context_revision integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, frontend_review, project_admin
AS $$
DECLARE
  context_project_id text;
BEGIN
  IF session_user <> 'shotgun_erasure_executor'
     OR NULLIF(current_setting('shotgun.t3_reset_request_id', true), '') IS NULL THEN
    RETURN false;
  END IF;

  context_project_id := p_project_id;
  IF context_project_id IS NULL AND p_review_context_id IS NOT NULL THEN
    SELECT CASE
      WHEN context.resource_project_id = context.effective_project_id
        THEN context.resource_project_id
      ELSE NULL
    END
    INTO context_project_id
    FROM frontend_review.context_revision AS context
    WHERE context.review_context_id = p_review_context_id
      AND context.context_revision = p_context_revision;
  END IF;

  RETURN context_project_id IS NOT NULL
     AND project_admin.t3_reset_write_authorized(context_project_id);
END
$$;
ALTER FUNCTION frontend_review.t3_review_delete_authorized(text, text, integer)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_review.t3_review_delete_authorized(text, text, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION project_admin.t3_reset_write_authorized(text)
  TO shotgun_schema_owner;

CREATE OR REPLACE FUNCTION frontend_review.t3_guard_review_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, frontend_review, project_admin
AS $$
DECLARE
  target_project_id text;
  reset_state text;
BEGIN
  IF TG_TABLE_NAME = 'context_revision' THEN
    IF NEW.resource_project_id IS DISTINCT FROM NEW.effective_project_id THEN
      RAISE EXCEPTION 'Review context Project binding is inconsistent'
        USING ERRCODE = '55000', CONSTRAINT = 't3_review_unclassified';
    END IF;
    target_project_id := NEW.effective_project_id;
  ELSIF TG_TABLE_NAME = 'approval' THEN
    target_project_id := to_jsonb(NEW)->>'project_id';
  ELSE
    SELECT CASE
      WHEN context.resource_project_id = context.effective_project_id
        THEN context.effective_project_id
      ELSE NULL
    END
    INTO target_project_id
    FROM frontend_review.context_revision AS context
    WHERE context.review_context_id = NEW.review_context_id
      AND context.context_revision = NEW.context_revision;
  END IF;

  IF target_project_id IS NULL THEN
    RAISE EXCEPTION 'Review write has no verified Project binding'
      USING ERRCODE = '55000', CONSTRAINT = 't3_review_unclassified';
  END IF;

  SELECT epoch.state INTO reset_state
  FROM project_admin.project_knowledge_epoch AS epoch
  WHERE epoch.project_id = target_project_id;
  IF reset_state IS NULL OR reset_state = 'READY' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Project knowledge reset fences Review writes'
    USING ERRCODE = '55000', CONSTRAINT = 'project_knowledge_reset_write_fence';
END
$$;
ALTER FUNCTION frontend_review.t3_guard_review_write() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION frontend_review.t3_guard_review_write() FROM PUBLIC;
GRANT SELECT ON project_admin.project_knowledge_epoch TO shotgun_schema_owner;

CREATE TRIGGER t3_review_context_write_fence
  BEFORE INSERT ON frontend_review.context_revision
  FOR EACH ROW EXECUTE FUNCTION frontend_review.t3_guard_review_write();
CREATE TRIGGER t3_review_item_write_fence
  BEFORE INSERT ON frontend_review.item
  FOR EACH ROW EXECUTE FUNCTION frontend_review.t3_guard_review_write();
CREATE TRIGGER t3_review_dependency_write_fence
  BEFORE INSERT ON frontend_review.dependency
  FOR EACH ROW EXECUTE FUNCTION frontend_review.t3_guard_review_write();
CREATE TRIGGER t3_review_decision_write_fence
  BEFORE INSERT ON frontend_review.decision
  FOR EACH ROW EXECUTE FUNCTION frontend_review.t3_guard_review_write();
CREATE TRIGGER t3_review_comment_write_fence
  BEFORE INSERT ON frontend_review.comment
  FOR EACH ROW EXECUTE FUNCTION frontend_review.t3_guard_review_write();
CREATE TRIGGER t3_review_approval_write_fence
  BEFORE INSERT ON frontend_review.approval
  FOR EACH ROW EXECUTE FUNCTION frontend_review.t3_guard_review_write();

CREATE OR REPLACE FUNCTION frontend_review.block_context_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, frontend_review
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND frontend_review.t3_review_delete_authorized(
       NULL, OLD.review_context_id, OLD.context_revision
     ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'frontend_review.context_revision is immutable';
END
$$;

CREATE OR REPLACE FUNCTION frontend_review.block_item_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, frontend_review
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND frontend_review.t3_review_delete_authorized(
       NULL, OLD.review_context_id, OLD.context_revision
     ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'frontend_review.item is immutable';
END
$$;

CREATE OR REPLACE FUNCTION frontend_review.block_dependency_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, frontend_review
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND frontend_review.t3_review_delete_authorized(
       NULL, OLD.review_context_id, OLD.context_revision
     ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'frontend_review.dependency is immutable';
END
$$;

CREATE OR REPLACE FUNCTION frontend_review.block_decision_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, frontend_review
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND frontend_review.t3_review_delete_authorized(
       NULL, OLD.review_context_id, OLD.context_revision
     ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'frontend_review.decision is append-only';
END
$$;

CREATE OR REPLACE FUNCTION frontend_review.block_comment_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, frontend_review
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND frontend_review.t3_review_delete_authorized(
       NULL, OLD.review_context_id, OLD.context_revision
     ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'frontend_review.comment is append-only';
END
$$;

CREATE OR REPLACE FUNCTION frontend_review.block_approval_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, frontend_review
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND frontend_review.t3_review_delete_authorized(
       OLD.project_id, OLD.review_context_id, OLD.context_revision
     ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'frontend_review.approval is append-only';
END
$$;

CREATE OR REPLACE FUNCTION review.t3_classify_project_review(
  p_target_project_id text
)
RETURNS TABLE (
  relation_name text,
  row_id text,
  disposition text,
  row_fingerprint text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, asset, candidate, discovery, evidence,
  frontend_knowledge_draft, frontend_review, review
AS $$
  WITH source_tokens AS (
    SELECT COALESCE(array_agg(token), ARRAY[]::text[]) AS values
    FROM (
      SELECT source.source_id::text AS token
      FROM asset.sources AS source
      WHERE source.project_id = p_target_project_id
      UNION
      SELECT version.source_version_id::text
      FROM asset.source_versions AS version
      JOIN asset.sources AS source USING (source_id)
      WHERE source.project_id = p_target_project_id
      UNION
      SELECT span.evidence_id::text
      FROM evidence.spans AS span
      WHERE span.project_id = p_target_project_id
    ) AS tokens
  ),
  draft_classification AS MATERIALIZED (
    SELECT draft_id, disposition
    FROM frontend_knowledge_draft.t3_classify_project_drafts(p_target_project_id)
    GROUP BY draft_id, disposition
  ),
  valid_legacy_sets AS MATERIALIZED (
    SELECT change_set.change_set_id
    FROM review.change_sets AS change_set
    JOIN asset.source_versions AS version
      ON version.source_version_id = change_set.source_version_id
    JOIN asset.sources AS source
      ON source.source_id = version.source_id
     AND source.project_id = p_target_project_id
    WHERE change_set.project_id = p_target_project_id
  ),
  scoped_legacy_sets AS MATERIALIZED (
    SELECT change_set.*
    FROM review.change_sets AS change_set
    WHERE change_set.project_id = p_target_project_id
  ),
  valid_v2_sets AS MATERIALIZED (
    SELECT change_set.change_set_id
    FROM review.change_sets_v2 AS change_set
    JOIN candidate.claim_candidates AS candidate
      ON candidate.project_id = change_set.project_id
     AND candidate.candidate_id = change_set.candidate_id
    JOIN asset.source_versions AS version
      ON version.source_version_id = candidate.source_version_id
    JOIN asset.sources AS source
      ON source.source_id = version.source_id
     AND source.project_id = p_target_project_id
    WHERE change_set.project_id = p_target_project_id
  ),
  scoped_v2_sets AS MATERIALIZED (
    SELECT change_set.*
    FROM review.change_sets_v2 AS change_set
    WHERE change_set.project_id = p_target_project_id
  ),
  context_scopes AS MATERIALIZED (
    SELECT context.review_context_id, context.context_revision,
           context.resource_project_id, context.effective_project_id,
           context.target_kind, context.target_id
    FROM frontend_review.context_revision AS context
    WHERE context.resource_project_id = p_target_project_id
       OR context.effective_project_id = p_target_project_id
    UNION
    SELECT context.review_context_id, context.context_revision,
           context.resource_project_id, context.effective_project_id,
           context.target_kind, context.target_id
    FROM frontend_review.approval AS approval
    JOIN frontend_review.context_revision AS context
      ON context.review_context_id = approval.review_context_id
     AND context.context_revision = approval.context_revision
    WHERE approval.project_id = p_target_project_id
  ),
  front_rows AS (
    SELECT 'frontend_review.context_revision'::text AS relation_name,
           context.review_context_id || ':' || context.context_revision::text AS row_id,
           context.review_context_id, context.context_revision,
           context.resource_project_id = p_target_project_id
             AND context.effective_project_id = p_target_project_id AS binding_valid,
           to_jsonb(context) AS row_data
    FROM frontend_review.context_revision AS context
    JOIN context_scopes AS scope USING (review_context_id, context_revision)
    UNION ALL
    SELECT 'frontend_review.item',
           item.review_context_id || ':' || item.context_revision::text || ':' || item.review_item_id,
           item.review_context_id,
           item.context_revision,
           scope.resource_project_id = p_target_project_id
             AND scope.effective_project_id = p_target_project_id,
           to_jsonb(item)
    FROM frontend_review.item AS item
    JOIN context_scopes AS scope USING (review_context_id, context_revision)
    UNION ALL
    SELECT 'frontend_review.dependency',
           dependency.review_context_id || ':' || dependency.context_revision::text || ':' || dependency.dependency_id,
           dependency.review_context_id,
           dependency.context_revision,
           scope.resource_project_id = p_target_project_id
             AND scope.effective_project_id = p_target_project_id,
           to_jsonb(dependency)
    FROM frontend_review.dependency AS dependency
    JOIN context_scopes AS scope USING (review_context_id, context_revision)
    UNION ALL
    SELECT 'frontend_review.decision', decision.decision_id,
           decision.review_context_id, decision.context_revision,
           scope.resource_project_id = p_target_project_id
             AND scope.effective_project_id = p_target_project_id,
           to_jsonb(decision)
    FROM frontend_review.decision AS decision
    JOIN context_scopes AS scope USING (review_context_id, context_revision)
    UNION ALL
    SELECT 'frontend_review.comment', comment.comment_id,
           comment.review_context_id, comment.context_revision,
           scope.resource_project_id = p_target_project_id
             AND scope.effective_project_id = p_target_project_id,
           to_jsonb(comment)
    FROM frontend_review.comment AS comment
    JOIN context_scopes AS scope USING (review_context_id, context_revision)
    UNION ALL
    SELECT 'frontend_review.approval',
           approval.approval_id || ':' || approval.approval_status_revision::text,
           approval.review_context_id, approval.context_revision,
           approval.project_id = p_target_project_id
             AND scope.resource_project_id = p_target_project_id
             AND scope.effective_project_id = p_target_project_id,
           to_jsonb(approval)
    FROM frontend_review.approval AS approval
    JOIN context_scopes AS scope USING (review_context_id, context_revision)
  ),
  front_context_classification AS (
    SELECT scope.review_context_id, scope.context_revision,
      CASE
        WHEN scope.resource_project_id <> p_target_project_id
          OR scope.effective_project_id <> p_target_project_id
          OR bool_or(NOT row.binding_valid)
          OR bool_or(frontend_knowledge_draft.t3_jsonb_has_unknown_source_reference(
               row.row_data, p_target_project_id
             ))
          THEN 'UNKNOWN'
        WHEN bool_or(frontend_knowledge_draft.t3_jsonb_mentions_source_token(
               row.row_data, source_tokens.values
             ))
          THEN 'SOURCE_DERIVED'
        WHEN scope.target_kind = 'KNOWLEDGE_DRAFT_CHANGE_SET'
          AND draft.disposition = 'SOURCE_DERIVED'
          THEN 'SOURCE_DERIVED'
        WHEN scope.target_kind = 'KNOWLEDGE_DRAFT_CHANGE_SET'
          AND draft.disposition = 'PRESERVE'
          THEN 'PRESERVE'
        WHEN scope.target_kind = 'KNOWLEDGE_DRAFT_CHANGE_SET'
          THEN 'UNKNOWN'
        WHEN scope.target_kind = 'DISCOVERY_CANDIDATE'
          AND EXISTS (
            SELECT 1 FROM discovery.findings AS finding
            WHERE finding.project_id = p_target_project_id
              AND finding.finding_id = scope.target_id
          )
          THEN 'SOURCE_DERIVED'
        WHEN scope.target_kind = 'DISCOVERY_CANDIDATE'
          THEN 'UNKNOWN'
        WHEN scope.target_kind = 'USER_DIRECTIVE_PROPOSAL'
          THEN 'PRESERVE'
        ELSE 'UNKNOWN'
      END AS disposition
    FROM context_scopes AS scope
    JOIN source_tokens ON true
    LEFT JOIN draft_classification AS draft ON draft.draft_id = scope.target_id
    JOIN front_rows AS row
      ON row.review_context_id = scope.review_context_id
     AND row.context_revision = scope.context_revision
    GROUP BY scope.review_context_id, scope.context_revision,
             scope.resource_project_id, scope.effective_project_id,
             scope.target_kind, scope.target_id, draft.disposition,
             source_tokens.values
  ),
  raw_rows AS (
    SELECT 'review.change_sets'::text AS relation_name,
           change_set.change_set_id::text AS row_id,
           CASE
             WHEN version.source_version_id IS NULL THEN 'UNKNOWN'
             WHEN source.project_id = p_target_project_id THEN 'SOURCE_DERIVED'
             ELSE 'UNKNOWN'
           END AS disposition,
           to_jsonb(change_set) AS row_data
    FROM scoped_legacy_sets AS change_set
    LEFT JOIN asset.source_versions AS version
      ON version.source_version_id = change_set.source_version_id
    LEFT JOIN asset.sources AS source ON source.source_id = version.source_id
    UNION ALL
    SELECT 'review.decisions', decision.decision_id::text,
           CASE WHEN set.change_set_id IS NULL
                     OR set.project_id IS DISTINCT FROM p_target_project_id
                THEN 'UNKNOWN' ELSE 'SOURCE_DERIVED' END,
           to_jsonb(decision)
    FROM review.decisions AS decision
    LEFT JOIN review.change_sets AS set ON set.change_set_id = decision.change_set_id
    WHERE decision.project_id = p_target_project_id
    UNION ALL
    SELECT 'review.change_sets_v2', change_set.change_set_id,
           CASE WHEN candidate.candidate_id IS NULL
                     OR source.project_id IS DISTINCT FROM p_target_project_id
                THEN 'UNKNOWN' ELSE 'SOURCE_DERIVED' END,
           to_jsonb(change_set)
    FROM scoped_v2_sets AS change_set
    LEFT JOIN candidate.claim_candidates AS candidate
      ON candidate.project_id = change_set.project_id
     AND candidate.candidate_id = change_set.candidate_id
    LEFT JOIN asset.source_versions AS version
      ON version.source_version_id = candidate.source_version_id
    LEFT JOIN asset.sources AS source ON source.source_id = version.source_id
    UNION ALL
    SELECT 'review.decisions_v2', decision.decision_id,
           CASE WHEN set.change_set_id IS NULL THEN 'UNKNOWN' ELSE 'SOURCE_DERIVED' END,
           to_jsonb(decision)
    FROM review.decisions_v2 AS decision
    LEFT JOIN review.change_sets_v2 AS set
      ON set.project_id = decision.project_id AND set.change_set_id = decision.change_set_id
    WHERE decision.project_id = p_target_project_id
    UNION ALL
    SELECT 'review.approved_manifests_v2', manifest.manifest_id,
           CASE WHEN set.change_set_id IS NULL THEN 'UNKNOWN' ELSE 'SOURCE_DERIVED' END,
           to_jsonb(manifest)
    FROM review.approved_manifests_v2 AS manifest
    LEFT JOIN review.change_sets_v2 AS set
      ON set.project_id = manifest.project_id AND set.change_set_id = manifest.change_set_id
    WHERE manifest.project_id = p_target_project_id
    UNION ALL
    SELECT 'review.change_set_revisions_v2',
           revision.change_set_id || ':' || revision.revision_number::text,
           CASE WHEN set.change_set_id IS NULL THEN 'UNKNOWN' ELSE 'SOURCE_DERIVED' END,
           to_jsonb(revision)
    FROM review.change_set_revisions_v2 AS revision
    LEFT JOIN review.change_sets_v2 AS set
      ON set.project_id = revision.project_id AND set.change_set_id = revision.change_set_id
    WHERE revision.project_id = p_target_project_id
    UNION ALL
    SELECT 'review.operation_resolutions_v2', resolution.resolution_id,
           CASE
             WHEN set.change_set_id IS NULL
               OR source.project_id IS DISTINCT FROM p_target_project_id
               OR EXISTS (
                 SELECT 1
                 FROM jsonb_array_elements_text(resolution.candidate_evidence_ids) AS evidence_id(value)
                 WHERE NOT EXISTS (
                   SELECT 1 FROM evidence.spans AS span
                   WHERE span.project_id = p_target_project_id
                     AND span.evidence_id::text = evidence_id.value
                 )
               )
               THEN 'UNKNOWN'
             ELSE 'SOURCE_DERIVED'
           END,
           to_jsonb(resolution)
    FROM review.operation_resolutions_v2 AS resolution
    LEFT JOIN review.change_sets_v2 AS set
      ON set.project_id = resolution.project_id AND set.change_set_id = resolution.change_set_id
    LEFT JOIN candidate.claim_candidates AS candidate
      ON candidate.project_id = resolution.project_id
     AND candidate.candidate_id::text = resolution.candidate_id
    LEFT JOIN asset.source_versions AS version
      ON version.source_version_id::text = resolution.candidate_source_version_id
    LEFT JOIN asset.sources AS source ON source.source_id = version.source_id
    WHERE resolution.project_id = p_target_project_id
    UNION ALL
    SELECT 'review.reversals', reversal.reversal_id,
           CASE
             WHEN frontend_knowledge_draft.t3_jsonb_has_unknown_source_reference(
                    reversal.reversal_json, p_target_project_id
                  ) THEN 'UNKNOWN'
             WHEN frontend_knowledge_draft.t3_jsonb_mentions_source_token(
                    reversal.reversal_json, source_tokens.values
                  ) THEN 'SOURCE_DERIVED'
             ELSE 'UNKNOWN'
           END,
           to_jsonb(reversal)
    FROM review.reversals AS reversal
    CROSS JOIN source_tokens
    WHERE reversal.project_id = p_target_project_id
    UNION ALL
    SELECT row.relation_name, row.row_id,
           COALESCE(classification.disposition, 'UNKNOWN'),
           row.row_data
    FROM front_rows AS row
    LEFT JOIN front_context_classification AS classification
      ON classification.review_context_id = row.review_context_id
     AND classification.context_revision = row.context_revision
  )
  SELECT row.relation_name, row.row_id, row.disposition,
         encode(pg_catalog.sha256(convert_to(row.row_data::text, 'UTF8')), 'hex')
  FROM raw_rows AS row
$$;
ALTER FUNCTION review.t3_classify_project_review(text) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION review.t3_classify_project_review(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION review.t3_project_review_impact(
  p_target_project_id text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, review
AS $$
  WITH classified AS MATERIALIZED (
    SELECT * FROM review.t3_classify_project_review(p_target_project_id)
  )
  SELECT jsonb_build_object(
    'sourceDerivedRecordCount', count(*) FILTER (WHERE disposition = 'SOURCE_DERIVED'),
    'preservedRecordCount', count(*) FILTER (WHERE disposition = 'PRESERVE'),
    'redactedIdentityCount', count(*) FILTER (WHERE disposition = 'SOURCE_DERIVED'),
    'unclassifiedRecordCount', count(*) FILTER (WHERE disposition = 'UNKNOWN'),
    'fingerprint', encode(pg_catalog.sha256(convert_to(
      COALESCE(string_agg(
        relation_name || ':' || COALESCE(row_id, '') || ':' || disposition || ':' || row_fingerprint,
        '' ORDER BY relation_name, row_id
      ), ''), 'UTF8')), 'hex')
  )
  FROM (
    SELECT relation_name, row_id, disposition, row_fingerprint
    FROM classified
  ) AS rows
$$;
ALTER FUNCTION review.t3_project_review_impact(text) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION review.t3_project_review_impact(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION review.t3_project_review_status(
  p_target_project_id text,
  p_reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, review
AS $$
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM project_admin.project_knowledge_reset_requests AS request
    WHERE request.project_id = p_target_project_id
      AND request.request_id = p_reset_request_id
      AND request.owner_manifest_digest IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Review reset request is missing'
      USING ERRCODE = '55000', CONSTRAINT = 't3_review_snapshot_missing';
  END IF;
  RETURN review.t3_project_review_impact(p_target_project_id);
END
$$;
ALTER FUNCTION review.t3_project_review_status(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION review.t3_project_review_status(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION review.t3_erase_project_review(
  p_target_project_id text,
  p_reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin, review, frontend_review
AS $$
DECLARE
  impact jsonb;
  erased jsonb := '{}'::jsonb;
  affected bigint;
  source_review_contexts text[] := ARRAY[]::text[];
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Approved Review reset request required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  PERFORM set_config('shotgun.t3_reset_request_id', p_reset_request_id::text, true);
  IF NOT project_admin.t3_reset_write_authorized(p_target_project_id) THEN
    RAISE EXCEPTION 'Approved Review reset request required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;

  impact := review.t3_project_review_impact(p_target_project_id);
  IF (impact->>'unclassifiedRecordCount')::bigint > 0 THEN
    RAISE EXCEPTION 'Review lineage is incomplete or ambiguous'
      USING ERRCODE = '55000', CONSTRAINT = 't3_review_unclassified';
  END IF;

  SELECT COALESCE(array_agg(classified.row_id ORDER BY classified.row_id), ARRAY[]::text[])
    INTO source_review_contexts
  FROM review.t3_classify_project_review(p_target_project_id) AS classified
  WHERE classified.relation_name = 'frontend_review.context_revision'
    AND classified.disposition = 'SOURCE_DERIVED';

  INSERT INTO frontend_review.history_payload_audit_events (
    audit_event_id, resource_project_id, source_event_kind, source_event_id,
    previous_availability, new_availability, tombstone_metadata, policy_revision,
    reason, actor_id, occurred_at
  )
  SELECT
    't3-review:' || p_reset_request_id::text || ':' ||
      encode(pg_catalog.sha256(convert_to(classified.relation_name || ':' || classified.row_id, 'UTF8')), 'hex'),
    p_target_project_id, 'T3:' || classified.relation_name, classified.row_id,
    COALESCE(previous.payload_availability, 'AVAILABLE'),
    'PURGED_BY_POLICY',
    jsonb_build_object('schemaVersion', 't3-review-tombstone-v1'),
    'ADR-171', 'T3 project source knowledge reset', 'shotgun_erasure_executor', now()
  FROM review.t3_classify_project_review(p_target_project_id) AS classified
  LEFT JOIN frontend_review.history_payload_state AS previous
    ON previous.resource_project_id = p_target_project_id
   AND previous.source_event_kind = 'T3:' || classified.relation_name
   AND previous.source_event_id = classified.row_id
  WHERE classified.disposition = 'SOURCE_DERIVED'
    AND COALESCE(previous.payload_availability, 'AVAILABLE') <> 'PURGED_BY_POLICY'
  ON CONFLICT (audit_event_id) DO NOTHING;

  INSERT INTO frontend_review.history_payload_state (
    resource_project_id, source_event_kind, source_event_id,
    payload_availability, tombstone_metadata, changed_at, reason, policy_revision
  )
  SELECT p_target_project_id, 'T3:' || classified.relation_name, classified.row_id,
         'PURGED_BY_POLICY',
         jsonb_build_object('schemaVersion', 't3-review-tombstone-v1'),
         now(), 'T3 project source knowledge reset', 'ADR-171'
  FROM review.t3_classify_project_review(p_target_project_id) AS classified
  WHERE classified.disposition = 'SOURCE_DERIVED'
  ON CONFLICT (resource_project_id, source_event_kind, source_event_id)
  DO UPDATE SET payload_availability = 'PURGED_BY_POLICY',
                tombstone_metadata = EXCLUDED.tombstone_metadata,
                changed_at = EXCLUDED.changed_at,
                reason = EXCLUDED.reason,
                policy_revision = EXCLUDED.policy_revision;

  DELETE FROM frontend_review.approval AS approval
  WHERE approval.project_id = p_target_project_id
    AND approval.review_context_id || ':' || approval.context_revision::text
      = ANY(source_review_contexts);
  GET DIAGNOSTICS affected = ROW_COUNT;
  erased := erased || jsonb_build_object('frontendApprovals', affected);

  DELETE FROM frontend_review.comment AS comment
  WHERE comment.review_context_id || ':' || comment.context_revision::text
    = ANY(source_review_contexts);
  GET DIAGNOSTICS affected = ROW_COUNT;
  erased := erased || jsonb_build_object('frontendComments', affected);

  DELETE FROM frontend_review.decision AS decision
  WHERE decision.review_context_id || ':' || decision.context_revision::text
    = ANY(source_review_contexts);
  GET DIAGNOSTICS affected = ROW_COUNT;
  erased := erased || jsonb_build_object('frontendDecisions', affected);

  DELETE FROM frontend_review.dependency AS dependency
  WHERE dependency.review_context_id || ':' || dependency.context_revision::text
    = ANY(source_review_contexts);
  GET DIAGNOSTICS affected = ROW_COUNT;
  erased := erased || jsonb_build_object('frontendDependencies', affected);

  DELETE FROM frontend_review.item AS item
  WHERE item.review_context_id || ':' || item.context_revision::text
    = ANY(source_review_contexts);
  GET DIAGNOSTICS affected = ROW_COUNT;
  erased := erased || jsonb_build_object('frontendItems', affected);

  DELETE FROM frontend_review.context_revision AS context
  WHERE context.review_context_id || ':' || context.context_revision::text
    = ANY(source_review_contexts);
  GET DIAGNOSTICS affected = ROW_COUNT;
  erased := erased || jsonb_build_object('frontendContexts', affected);

  DELETE FROM review.operation_resolutions_v2 AS row
  WHERE row.project_id = p_target_project_id
    AND EXISTS (
      SELECT 1 FROM review.t3_classify_project_review(p_target_project_id) AS classified
      WHERE classified.relation_name = 'review.operation_resolutions_v2'
        AND classified.row_id = row.resolution_id
        AND classified.disposition = 'SOURCE_DERIVED'
    );
  DELETE FROM review.decisions_v2 AS row
  WHERE row.project_id = p_target_project_id
    AND EXISTS (
      SELECT 1 FROM review.t3_classify_project_review(p_target_project_id) AS classified
      WHERE classified.relation_name = 'review.decisions_v2'
        AND classified.row_id = row.decision_id
        AND classified.disposition = 'SOURCE_DERIVED'
    );
  DELETE FROM review.approved_manifests_v2 AS row
  WHERE row.project_id = p_target_project_id
    AND EXISTS (
      SELECT 1 FROM review.t3_classify_project_review(p_target_project_id) AS classified
      WHERE classified.relation_name = 'review.approved_manifests_v2'
        AND classified.row_id = row.manifest_id
        AND classified.disposition = 'SOURCE_DERIVED'
    );
  DELETE FROM review.change_set_revisions_v2 AS row
  WHERE row.project_id = p_target_project_id
    AND EXISTS (
      SELECT 1 FROM review.t3_classify_project_review(p_target_project_id) AS classified
      WHERE classified.relation_name = 'review.change_set_revisions_v2'
        AND classified.row_id = row.change_set_id || ':' || row.revision_number::text
        AND classified.disposition = 'SOURCE_DERIVED'
    );
  DELETE FROM review.change_sets_v2 AS row
  WHERE row.project_id = p_target_project_id
    AND EXISTS (
      SELECT 1 FROM review.t3_classify_project_review(p_target_project_id) AS classified
      WHERE classified.relation_name = 'review.change_sets_v2'
        AND classified.row_id = row.change_set_id
        AND classified.disposition = 'SOURCE_DERIVED'
    );
  DELETE FROM review.decisions AS row
  WHERE row.project_id = p_target_project_id
    AND EXISTS (
      SELECT 1 FROM review.t3_classify_project_review(p_target_project_id) AS classified
      WHERE classified.relation_name = 'review.decisions'
        AND classified.row_id = row.decision_id::text
        AND classified.disposition = 'SOURCE_DERIVED'
    );
  DELETE FROM review.change_sets AS row
  WHERE row.project_id = p_target_project_id
    AND EXISTS (
      SELECT 1 FROM review.t3_classify_project_review(p_target_project_id) AS classified
      WHERE classified.relation_name = 'review.change_sets'
        AND classified.row_id = row.change_set_id::text
        AND classified.disposition = 'SOURCE_DERIVED'
    );
  DELETE FROM review.reversals AS row
  WHERE row.project_id = p_target_project_id
    AND EXISTS (
      SELECT 1 FROM review.t3_classify_project_review(p_target_project_id) AS classified
      WHERE classified.relation_name = 'review.reversals'
        AND classified.row_id = row.reversal_id
        AND classified.disposition = 'SOURCE_DERIVED'
    );

  RETURN review.t3_project_review_impact(p_target_project_id);
END
$$;
ALTER FUNCTION review.t3_erase_project_review(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION review.t3_erase_project_review(text, uuid) FROM PUBLIC;

GRANT USAGE ON SCHEMA review, frontend_review TO shotgun_schema_owner, shotgun_erasure_executor;
GRANT SELECT, DELETE ON review.change_sets, review.decisions, review.change_sets_v2,
  review.decisions_v2, review.approved_manifests_v2, review.change_set_revisions_v2,
  review.operation_resolutions_v2, review.reversals TO shotgun_schema_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON frontend_review.history_payload_state,
  frontend_review.history_payload_audit_events TO shotgun_schema_owner;
GRANT SELECT, DELETE ON frontend_review.context_revision, frontend_review.item,
  frontend_review.dependency, frontend_review.decision, frontend_review.comment,
  frontend_review.approval TO shotgun_schema_owner;
GRANT SELECT ON asset.sources, asset.source_versions, candidate.claim_candidates,
  discovery.findings, evidence.spans TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION frontend_knowledge_draft.t3_classify_project_drafts(text),
  frontend_knowledge_draft.t3_jsonb_mentions_source_token(jsonb, text[]),
  frontend_knowledge_draft.t3_jsonb_has_unknown_source_reference(jsonb, text),
  project_admin.t3_reset_write_authorized(text) TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION review.t3_project_review_status(text, uuid),
  review.t3_erase_project_review(text, uuid) TO shotgun_erasure_executor;
