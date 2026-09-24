DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1 FROM runtime.schema_migrations
    WHERE name = '096_t3_action_erasure.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 097 preflight failed: migration 096 is not registered';
  END IF;
END
$$;

-- Discovery findings and their run/re-entry records are projections over a
-- Project's Canonical and compiled-truth snapshot. Reset removes the complete
-- stale Project projection while retaining independently configured schedules
-- and model profiles. Ranking policies are global and have no Project key.
CREATE OR REPLACE FUNCTION discovery.t3_project_discovery_impact(p_target_project_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, discovery
AS $$
DECLARE
  relation_name text;
  relation_schema text;
  relation_table text;
  relation_count bigint;
  derived_record_count bigint := 0;
  fingerprint_material text := '';
  active_job_count bigint := 0;
  active_provider_reservation_count bigint := 0;
  pending_reentry_count bigint := 0;
  unclassified_record_count bigint := 0;
  relations text[] := ARRAY[
    'discovery.findings',
    'discovery.finding_lifecycle_current',
    'discovery.finding_lifecycle_history',
    'discovery.finding_ready',
    'discovery.jobs',
    'discovery.job_lifecycle_history',
    'discovery.runs',
    'discovery.run_lifecycle_history',
    'discovery.attempts',
    'discovery.attempt_lifecycle_history',
    'discovery.stages',
    'discovery.stage_history',
    'discovery.work_budget_checkpoints',
    'discovery.stage_outputs',
    'discovery.provider_budget_reservations',
    'discovery.reentry_manifests',
    'discovery.reentry_candidates',
    'discovery.reentry_consumption',
    'discovery.reentry_review_roots',
    'discovery.reentry_review_resources',
    'discovery.feedback_events',
    'discovery.suppression_directives',
    'discovery.suppression_semantic_family_projection',
    'discovery.epistemic_reentry_triggers',
    'discovery.semantic_essence_diagnostics'
  ];
BEGIN
  IF p_target_project_id IS NULL OR p_target_project_id = '' THEN
    RAISE EXCEPTION 'Discovery reset Project is required'
      USING ERRCODE = '22023', CONSTRAINT = 't3_discovery_project_required';
  END IF;

  FOREACH relation_name IN ARRAY relations LOOP
    relation_schema := split_part(relation_name, '.', 1);
    relation_table := split_part(relation_name, '.', 2);
    EXECUTE format('SELECT count(*)::bigint FROM %I.%I WHERE project_id = $1',
      relation_schema, relation_table
    ) INTO relation_count USING p_target_project_id;
    derived_record_count := derived_record_count + relation_count;
    fingerprint_material := fingerprint_material || relation_name || ':' || relation_count::text || E'\n';
  END LOOP;

  SELECT
    (SELECT count(*) FROM discovery.jobs AS job
      WHERE job.project_id = p_target_project_id
        AND job.lifecycle_state IN (
          'QUEUED', 'WAITING_FOR_PROJECTION', 'RUNNING', 'PARTIAL', 'FAILED_RETRYABLE'
        ))
    + (SELECT count(*) FROM discovery.runs AS run
      WHERE run.project_id = p_target_project_id
        AND run.lifecycle_state IN (
          'QUEUED', 'WAITING_FOR_PROJECTION', 'RUNNING', 'PARTIAL', 'FAILED_RETRYABLE'
        ))
    + (SELECT count(*) FROM discovery.attempts AS attempt
      WHERE attempt.project_id = p_target_project_id
        AND (attempt.lifecycle_state IN (
          'QUEUED', 'WAITING_FOR_PROJECTION', 'RUNNING', 'PARTIAL', 'FAILED_RETRYABLE'
        ) OR attempt.lease_owner IS NOT NULL))
  INTO active_job_count;

  SELECT count(*) INTO active_provider_reservation_count
  FROM discovery.provider_budget_reservations AS reservation
  WHERE reservation.project_id = p_target_project_id AND reservation.state = 'RESERVED';

  SELECT
    (SELECT count(*) FROM discovery.epistemic_reentry_triggers AS trigger
      WHERE trigger.project_id = p_target_project_id AND trigger.status IN ('PENDING', 'RETRYABLE'))
    + (SELECT count(*) FROM discovery.reentry_consumption AS consumption
      WHERE consumption.project_id = p_target_project_id AND consumption.disposition = 'RETRYABLE')
    + (SELECT count(*) FROM discovery.finding_lifecycle_current AS lifecycle
      WHERE lifecycle.project_id = p_target_project_id AND lifecycle.lifecycle_state = 'VALIDATING')
    + (SELECT count(*) FROM discovery.reentry_review_resources AS resource
      WHERE resource.project_id = p_target_project_id AND resource.lifecycle_state = 'VALIDATING')
  INTO pending_reentry_count;

  SELECT
    (SELECT count(*) FROM discovery.findings AS finding
      WHERE finding.project_id = p_target_project_id
        AND (
          NOT EXISTS (
            SELECT 1 FROM discovery.runs AS run
            WHERE run.project_id = finding.project_id
              AND run.run_id = finding.run_id
              AND run.canonical_base_version = finding.canonical_base_version
              AND run.canonical_snapshot_digest = finding.canonical_snapshot_digest
          )
          OR EXISTS (
            SELECT 1 FROM unnest(finding.evidence_ids) AS ref(evidence_id)
            WHERE NOT EXISTS (
              SELECT 1 FROM evidence.spans AS span
              WHERE span.project_id = finding.project_id AND span.evidence_id::text = ref.evidence_id
            )
          )
        ))
    + (SELECT count(*) FROM discovery.reentry_candidates AS candidate
      WHERE candidate.project_id = p_target_project_id
        AND EXISTS (
          SELECT 1 FROM unnest(candidate.evidence_ids) AS ref(evidence_id)
          WHERE NOT EXISTS (
            SELECT 1 FROM evidence.spans AS span
            WHERE span.project_id = candidate.project_id AND span.evidence_id::text = ref.evidence_id
          )
        ))
    + (SELECT count(*) FROM discovery.reentry_review_resources AS resource
      WHERE resource.project_id = p_target_project_id
        AND (
          EXISTS (
            SELECT 1 FROM unnest(resource.evidence_ids) AS ref(evidence_id)
            WHERE NOT EXISTS (
              SELECT 1 FROM evidence.spans AS span
              WHERE span.project_id = resource.project_id
                AND span.evidence_id::text = ref.evidence_id
            )
          )
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(resource.evidence_lineage) AS lineage(value)
            WHERE NOT EXISTS (
              SELECT 1 FROM evidence.spans AS span
              WHERE span.project_id = resource.project_id
                AND span.evidence_id::text = lineage.value->>'evidenceId'
                AND (lineage.value->>'sourceId' IS NULL
                  OR span.source_id::text = lineage.value->>'sourceId')
                AND (lineage.value->>'sourceVersionId' IS NULL
                  OR span.source_version_id::text = lineage.value->>'sourceVersionId')
                AND (lineage.value->>'evidenceSpanId' IS NULL
                  OR span.evidence_id::text = lineage.value->>'evidenceSpanId')
            )
          )
        ))
    + (SELECT count(*) FROM discovery.reentry_consumption AS consumption
      WHERE consumption.project_id = p_target_project_id
        AND NOT EXISTS (
          SELECT 1 FROM discovery.findings AS finding
          WHERE finding.project_id = consumption.project_id
            AND finding.finding_id = consumption.finding_id
            AND finding.finding_revision = consumption.finding_revision
        ))
    + (SELECT count(*) FROM discovery.semantic_essence_diagnostics AS diagnostic
      WHERE diagnostic.project_id = p_target_project_id
        AND NOT EXISTS (
          SELECT 1 FROM discovery.attempts AS attempt
          WHERE attempt.project_id = diagnostic.project_id
            AND attempt.attempt_id = diagnostic.attempt_id
            AND attempt.run_id = diagnostic.run_id
            AND attempt.job_id = diagnostic.job_id
        ))
  INTO unclassified_record_count;

  RETURN jsonb_build_object(
    'derivedRecordCount', derived_record_count,
    'activeJobCount', active_job_count,
    'activeProviderReservationCount', active_provider_reservation_count,
    'pendingReentryCount', pending_reentry_count,
    'unclassifiedRecordCount', unclassified_record_count,
    'fingerprint', encode(pg_catalog.sha256(convert_to(fingerprint_material, 'UTF8')), 'hex')
  );
END
$$;

ALTER FUNCTION discovery.t3_project_discovery_impact(text) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION discovery.t3_project_discovery_impact(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION discovery.t3_project_discovery_status(
  p_target_project_id text,
  p_reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, discovery, project_admin
AS $$
DECLARE
  impact jsonb;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM project_admin.project_knowledge_reset_requests AS request
    WHERE request.project_id = p_target_project_id AND request.request_id = p_reset_request_id
  ) THEN
    RAISE EXCEPTION 'Discovery reset request is missing'
      USING ERRCODE = '55000', CONSTRAINT = 't3_discovery_snapshot_missing';
  END IF;

  impact := discovery.t3_project_discovery_impact(p_target_project_id);
  RETURN impact;
END
$$;

ALTER FUNCTION discovery.t3_project_discovery_status(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION discovery.t3_project_discovery_status(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION discovery.t3_erase_project_discovery(
  p_target_project_id text,
  p_reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, discovery, project_admin
AS $$
DECLARE
  impact jsonb;
  attempt_row record;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  PERFORM set_config('shotgun.t3_reset_request_id', p_reset_request_id::text, true);
  IF NULLIF(current_setting('shotgun.t3_reset_request_id', true), '') IS DISTINCT FROM p_reset_request_id::text
     OR NOT project_admin.t3_reset_write_authorized(p_target_project_id) THEN
    RAISE EXCEPTION 'Approved Discovery reset request required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;

  impact := discovery.t3_project_discovery_impact(p_target_project_id);
  IF (impact->>'activeJobCount')::bigint > 0
     OR (impact->>'activeProviderReservationCount')::bigint > 0
     OR (impact->>'pendingReentryCount')::bigint > 0 THEN
    RAISE EXCEPTION 'Discovery work must reach a known terminal state before reset'
      USING ERRCODE = '55000', CONSTRAINT = 'active_job_outcome_unknown';
  END IF;
  IF (impact->>'unclassifiedRecordCount')::bigint > 0 THEN
    RAISE EXCEPTION 'Discovery lineage or evidence references are incomplete'
      USING ERRCODE = '55000', CONSTRAINT = 't3_discovery_unclassified';
  END IF;

  DELETE FROM discovery.stage_outputs WHERE project_id = p_target_project_id;
  DELETE FROM discovery.stage_history WHERE project_id = p_target_project_id;
  DELETE FROM discovery.stages WHERE project_id = p_target_project_id;
  DELETE FROM discovery.work_budget_checkpoints WHERE project_id = p_target_project_id;
  DELETE FROM discovery.provider_budget_reservations WHERE project_id = p_target_project_id;
  DELETE FROM discovery.finding_ready WHERE project_id = p_target_project_id;
  DELETE FROM discovery.semantic_essence_diagnostics WHERE project_id = p_target_project_id;

  DELETE FROM discovery.attempt_lifecycle_history WHERE project_id = p_target_project_id;
  -- Retry attempts have a RESTRICT self-reference to their predecessor.
  -- Delete descendants before predecessors to preserve that invariant.
  FOR attempt_row IN
    SELECT attempt_id
    FROM discovery.attempts
    WHERE project_id = p_target_project_id
    ORDER BY attempt_number DESC, attempt_id DESC
  LOOP
    DELETE FROM discovery.attempts
    WHERE project_id = p_target_project_id AND attempt_id = attempt_row.attempt_id;
  END LOOP;

  DELETE FROM discovery.run_lifecycle_history WHERE project_id = p_target_project_id;
  DELETE FROM discovery.runs WHERE project_id = p_target_project_id;
  DELETE FROM discovery.job_lifecycle_history WHERE project_id = p_target_project_id;
  DELETE FROM discovery.jobs WHERE project_id = p_target_project_id;

  DELETE FROM discovery.suppression_semantic_family_projection
    WHERE project_id = p_target_project_id;
  DELETE FROM discovery.epistemic_reentry_triggers WHERE project_id = p_target_project_id;
  DELETE FROM discovery.reentry_review_resources WHERE project_id = p_target_project_id;
  DELETE FROM discovery.reentry_review_roots WHERE project_id = p_target_project_id;
  DELETE FROM discovery.reentry_candidates WHERE project_id = p_target_project_id;
  DELETE FROM discovery.reentry_consumption WHERE project_id = p_target_project_id;
  DELETE FROM discovery.reentry_manifests WHERE project_id = p_target_project_id;
  DELETE FROM discovery.feedback_events WHERE project_id = p_target_project_id;
  DELETE FROM discovery.suppression_directives WHERE project_id = p_target_project_id;
  DELETE FROM discovery.finding_lifecycle_history WHERE project_id = p_target_project_id;
  DELETE FROM discovery.finding_lifecycle_current WHERE project_id = p_target_project_id;
  DELETE FROM discovery.findings WHERE project_id = p_target_project_id;

  RETURN discovery.t3_project_discovery_impact(p_target_project_id);
END
$$;

ALTER FUNCTION discovery.t3_erase_project_discovery(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION discovery.t3_erase_project_discovery(text, uuid) FROM PUBLIC;

-- The existing append-only and immutable rules remain the default. Only a
-- DELETE inside an approved T3 executor request receives the narrow exception.
CREATE OR REPLACE FUNCTION discovery.block_feedback_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND project_admin.t3_reset_write_authorized(OLD.project_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'discovery.feedback_events is append-only'
    USING ERRCODE = '55000';
END
$$;

CREATE OR REPLACE FUNCTION discovery.block_finding_lifecycle_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND project_admin.t3_reset_write_authorized(OLD.project_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Discovery finding lifecycle history is append-only and immutable'
    USING ERRCODE = '55000';
END
$$;

CREATE OR REPLACE FUNCTION discovery.block_reentry_review_resource_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND project_admin.t3_reset_write_authorized(OLD.project_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'discovery.reentry_review_resources is immutable'
    USING ERRCODE = '55000';
END
$$;

CREATE OR REPLACE FUNCTION discovery.block_reentry_review_root_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND project_admin.t3_reset_write_authorized(OLD.project_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'discovery.reentry_review_roots is immutable'
    USING ERRCODE = '55000';
END
$$;

CREATE OR REPLACE FUNCTION discovery.block_suppression_directive_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND project_admin.t3_reset_write_authorized(OLD.project_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'discovery.suppression_directives is append-only'
    USING ERRCODE = '55000';
END
$$;

ALTER FUNCTION discovery.block_feedback_event_mutation() OWNER TO shotgun_schema_owner;
ALTER FUNCTION discovery.block_finding_lifecycle_history_mutation() OWNER TO shotgun_schema_owner;
ALTER FUNCTION discovery.block_reentry_review_resource_mutation() OWNER TO shotgun_schema_owner;
ALTER FUNCTION discovery.block_reentry_review_root_mutation() OWNER TO shotgun_schema_owner;
ALTER FUNCTION discovery.block_suppression_directive_mutation() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION discovery.block_feedback_event_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION discovery.block_finding_lifecycle_history_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION discovery.block_reentry_review_resource_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION discovery.block_reentry_review_root_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION discovery.block_suppression_directive_mutation() FROM PUBLIC;

GRANT USAGE ON SCHEMA discovery, asset, evidence, project_admin TO shotgun_schema_owner;
GRANT USAGE ON SCHEMA discovery TO shotgun_runtime, shotgun_erasure_executor;
GRANT USAGE ON SCHEMA project_admin TO shotgun_erasure_executor;
GRANT SELECT ON asset.sources, asset.source_versions, evidence.spans,
  project_admin.project_knowledge_epoch, project_admin.project_knowledge_reset_requests
  TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION project_admin.t3_reset_write_authorized(text)
  TO shotgun_schema_owner;
GRANT SELECT, DELETE ON discovery.findings, discovery.finding_lifecycle_current,
  discovery.finding_lifecycle_history, discovery.finding_ready, discovery.jobs,
  discovery.job_lifecycle_history, discovery.runs, discovery.run_lifecycle_history,
  discovery.attempts, discovery.attempt_lifecycle_history, discovery.stages,
  discovery.stage_history, discovery.work_budget_checkpoints, discovery.stage_outputs,
  discovery.provider_budget_reservations, discovery.reentry_manifests,
  discovery.reentry_candidates, discovery.reentry_consumption, discovery.reentry_review_roots,
  discovery.reentry_review_resources, discovery.feedback_events,
  discovery.suppression_directives, discovery.suppression_semantic_family_projection,
  discovery.epistemic_reentry_triggers, discovery.semantic_essence_diagnostics
  TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION discovery.t3_project_discovery_impact(text) TO shotgun_runtime;
GRANT EXECUTE ON FUNCTION discovery.t3_project_discovery_impact(text),
  discovery.t3_project_discovery_status(text, uuid),
  discovery.t3_erase_project_discovery(text, uuid)
  TO shotgun_erasure_executor;
GRANT EXECUTE ON FUNCTION discovery.t3_project_discovery_impact(text)
  TO shotgun_schema_owner;
