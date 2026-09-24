DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1 FROM runtime.schema_migrations
    WHERE name = '104_t3_knowledge_model_erasure.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 105 preflight failed: migration 104 is not registered';
  END IF;
END
$$;

-- Connector owns durable delivery identity, job payloads, leases and replay
-- state. A Source-linked event is removable only when its Source lineage is
-- explicit and every execution outcome is terminal.
CREATE OR REPLACE FUNCTION connector.t3_jsonb_mentions_source_token(
  payload jsonb,
  source_tokens text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  WITH RECURSIVE json_values(value) AS (
    SELECT payload
    UNION ALL
    SELECT child.value
    FROM json_values AS parent
    CROSS JOIN LATERAL (
      SELECT element.value
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(parent.value) = 'array' THEN parent.value ELSE '[]'::jsonb END
      ) AS element(value)
      UNION ALL
      SELECT object_entry.value
      FROM jsonb_each(
        CASE WHEN jsonb_typeof(parent.value) = 'object' THEN parent.value ELSE '{}'::jsonb END
      ) AS object_entry(key, value)
    ) AS child
  )
  SELECT EXISTS (
    SELECT 1 FROM json_values
    WHERE jsonb_typeof(value) = 'string'
      AND value #>> '{}' = ANY(COALESCE(source_tokens, ARRAY[]::text[]))
  )
$$;
ALTER FUNCTION connector.t3_jsonb_mentions_source_token(jsonb, text[])
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION connector.t3_jsonb_mentions_source_token(jsonb, text[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION connector.t3_text_mentions_source_token(
  payload text,
  source_tokens text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM unnest(COALESCE(source_tokens, ARRAY[]::text[])) AS token(value)
    WHERE token.value <> '' AND position(token.value IN COALESCE(payload, '')) > 0
  )
$$;
ALTER FUNCTION connector.t3_text_mentions_source_token(text, text[])
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION connector.t3_text_mentions_source_token(text, text[]) FROM PUBLIC;

-- Include exact IDs and opaque digests owned by the Source-linked Product
-- aggregates. Connector may key an event by a downstream ID or retain that ID
-- only in a completed query result, so SourceVersion and Evidence IDs alone do
-- not close the durable delivery lineage.
CREATE OR REPLACE FUNCTION connector.t3_project_source_tokens(p_target_project_id text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, asset, transformation, evidence, ai, candidate,
  validation, comparison, review, canonical, projection, frontend_command,
  source_product, frontend_ask, knowledge
AS $$
BEGIN
  RETURN (
  WITH source_scope AS MATERIALIZED (
    SELECT source.source_id, version.source_version_id
    FROM asset.sources AS source
    JOIN asset.source_versions AS version USING (source_id)
    WHERE source.project_id = p_target_project_id
  ), affected_conversations AS MATERIALIZED (
    SELECT DISTINCT answer_run.conversation_id
    FROM frontend_ask.source_selections AS selection
    JOIN frontend_ask.answer_runs AS answer_run
      ON answer_run.answer_run_id = selection.answer_run_id
     AND answer_run.project_id = selection.project_id
    WHERE selection.project_id = p_target_project_id
      AND EXISTS (SELECT 1 FROM source_scope WHERE source_id = selection.source_id)
    UNION
    SELECT DISTINCT answer_run.conversation_id
    FROM frontend_ask.citations AS citation
    JOIN frontend_ask.statements AS statement USING (statement_id)
    JOIN frontend_ask.answer_runs AS answer_run USING (answer_run_id)
    WHERE answer_run.project_id = p_target_project_id
      AND EXISTS (SELECT 1 FROM source_scope WHERE source_version_id = citation.source_version_id)
    UNION
    SELECT DISTINCT answer_run.conversation_id
    FROM frontend_ask.answer_attempt_evidence AS attempt_evidence
    JOIN frontend_ask.answer_run_attempts AS attempt USING (attempt_id)
    JOIN frontend_ask.answer_runs AS answer_run
      ON answer_run.project_id = attempt.project_id
     AND answer_run.answer_run_id = attempt.answer_run_id
    WHERE answer_run.project_id = p_target_project_id
      AND EXISTS (
        SELECT 1 FROM source_scope
        WHERE source_id::text = attempt_evidence.source_id
          AND source_version_id::text = attempt_evidence.source_version_id
      )
  ), affected_candidates AS MATERIALIZED (
    SELECT candidate.candidate_id, candidate.batch_id, candidate.provider_call
    FROM candidate.claim_candidates AS candidate
    JOIN source_scope USING (source_version_id)
    WHERE candidate.project_id = p_target_project_id
  ), affected_changes AS MATERIALIZED (
    SELECT change_set.change_set_id, change_set.content_digest, change_set.snapshot_digest,
           change_set.candidate_id, change_set.comparison_id
    FROM review.change_sets AS change_set
    JOIN source_scope USING (source_version_id)
    WHERE change_set.project_id = p_target_project_id
  ), affected_commits AS MATERIALIZED (
    SELECT commit.commit_id, commit.manifest_id, commit.manifest_digest, commit.result_json
    FROM canonical.commits AS commit
    JOIN affected_changes AS change_set ON change_set.change_set_id = commit.change_set_id
    WHERE commit.project_id = p_target_project_id
  ), tokens(token) AS (
    SELECT source_id::text FROM source_scope
    UNION SELECT source_version_id::text FROM source_scope
    -- Stage 3 connectors use one correlation id for the whole SourceVersion
    -- pipeline. Query outcomes can be terminal failures with no source token in
    -- their result or dead-letter payload, so preserve this exact owner lineage.
    UNION SELECT 'sources-stage3:' || p_target_project_id || ':' || source_version_id::text
      FROM source_scope
    UNION SELECT revision.revision_id::text
      FROM transformation.revisions AS revision
      JOIN source_scope USING (source_version_id)
      WHERE revision.project_id = p_target_project_id
    UNION SELECT span.evidence_id::text
      FROM evidence.spans AS span
      JOIN source_scope USING (source_version_id)
      WHERE span.project_id = p_target_project_id
    UNION SELECT call.call_id::text
      FROM ai.provider_calls AS call
      JOIN source_scope USING (source_version_id)
      WHERE call.project_id = p_target_project_id
    UNION SELECT call.request_id
      FROM ai.provider_calls AS call
      JOIN source_scope USING (source_version_id)
      WHERE call.project_id = p_target_project_id
    UNION SELECT output.output_id::text
      FROM ai.provider_outputs AS output
      JOIN ai.provider_calls AS call USING (call_id)
      JOIN source_scope USING (source_version_id)
      WHERE output.project_id = p_target_project_id AND call.project_id = p_target_project_id
    UNION SELECT output.attempt_id::text
      FROM ai.provider_outputs AS output
      JOIN ai.provider_calls AS call USING (call_id)
      JOIN source_scope USING (source_version_id)
      WHERE output.project_id = p_target_project_id AND call.project_id = p_target_project_id
    UNION SELECT output.content_digest
      FROM ai.provider_outputs AS output
      JOIN ai.provider_calls AS call USING (call_id)
      JOIN source_scope USING (source_version_id)
      WHERE output.project_id = p_target_project_id AND call.project_id = p_target_project_id
    UNION SELECT batch.batch_id::text
      FROM candidate.batches AS batch
      JOIN source_scope USING (source_version_id)
      WHERE batch.project_id = p_target_project_id
    UNION SELECT candidate.candidate_id::text FROM affected_candidates AS candidate
    UNION SELECT candidate.batch_id::text FROM affected_candidates AS candidate
    UNION SELECT materialization.materialization_id::text
      FROM candidate.materializations AS materialization
      JOIN candidate.batches AS batch USING (batch_id)
      JOIN source_scope USING (source_version_id)
      WHERE materialization.project_id = p_target_project_id
    UNION SELECT validation.validation_id::text
      FROM validation.results AS validation
      JOIN source_scope USING (source_version_id)
      WHERE validation.project_id = p_target_project_id
    UNION SELECT comparison.comparison_id::text
      FROM comparison.results AS comparison
      JOIN source_scope USING (source_version_id)
      WHERE comparison.project_id = p_target_project_id
    UNION SELECT comparison.snapshot_digest
      FROM comparison.results AS comparison
      JOIN source_scope USING (source_version_id)
      WHERE comparison.project_id = p_target_project_id
    UNION SELECT comparison.candidate_digest
      FROM comparison.results AS comparison
      JOIN source_scope USING (source_version_id)
      WHERE comparison.project_id = p_target_project_id
    UNION SELECT comparison.diff_digest
      FROM comparison.results AS comparison
      JOIN source_scope USING (source_version_id)
      WHERE comparison.project_id = p_target_project_id
    UNION SELECT change_set.change_set_id::text FROM affected_changes AS change_set
    UNION SELECT change_set.content_digest FROM affected_changes AS change_set
    UNION SELECT change_set.snapshot_digest FROM affected_changes AS change_set
    UNION SELECT decision.decision_id::text
      FROM review.decisions AS decision
      JOIN affected_changes AS change_set USING (change_set_id)
      WHERE decision.project_id = p_target_project_id
    UNION SELECT decision.decision_id
      FROM review.decisions_v2 AS decision
      JOIN review.change_sets_v2 AS change_set USING (project_id, change_set_id)
      JOIN affected_candidates AS candidate USING (candidate_id)
      WHERE decision.project_id = p_target_project_id
    UNION SELECT change_set.change_set_id
      FROM review.change_sets_v2 AS change_set
      JOIN affected_candidates AS candidate USING (candidate_id)
      WHERE change_set.project_id = p_target_project_id
    UNION SELECT manifest.manifest_id
      FROM review.approved_manifests_v2 AS manifest
      JOIN review.change_sets_v2 AS change_set USING (project_id, change_set_id)
      JOIN affected_candidates AS candidate USING (candidate_id)
      WHERE manifest.project_id = p_target_project_id
    UNION SELECT claim.claim_id
      FROM canonical.claims AS claim
      JOIN source_scope
        ON claim.source_version_id = source_scope.source_version_id::text
      WHERE claim.project_id = p_target_project_id
    UNION SELECT commit.commit_id::text FROM affected_commits AS commit
    UNION SELECT commit.manifest_id::text FROM affected_commits AS commit
    UNION SELECT commit.manifest_digest FROM affected_commits AS commit
    UNION SELECT revision.revision_id
      FROM canonical.revisions AS revision
      JOIN affected_commits AS commit USING (commit_id)
      WHERE revision.project_id = p_target_project_id
    UNION SELECT event.history_event_id
      FROM canonical.history_events AS event
      JOIN affected_commits AS commit USING (commit_id)
      WHERE event.project_id = p_target_project_id
    UNION SELECT outbox.outbox_id
      FROM canonical.outbox AS outbox
      JOIN affected_commits AS commit ON commit.commit_id = outbox.aggregate_id
      WHERE outbox.project_id = p_target_project_id
    UNION SELECT document.claim_id
      FROM projection.search_documents AS document
      JOIN source_scope USING (source_version_id)
      WHERE document.project_id = p_target_project_id
    UNION SELECT document.commit_id::text
      FROM projection.search_documents AS document
      JOIN source_scope USING (source_version_id)
      WHERE document.project_id = p_target_project_id
    UNION SELECT document.revision_id
      FROM projection.search_documents AS document
      JOIN source_scope USING (source_version_id)
      WHERE document.project_id = p_target_project_id
    UNION SELECT unnest(document.evidence_ids)
      FROM projection.search_documents AS document
      JOIN source_scope USING (source_version_id)
      WHERE document.project_id = p_target_project_id
    UNION SELECT watermark.last_commit_id::text
      FROM projection.watermarks AS watermark
      WHERE watermark.project_id = p_target_project_id
        AND EXISTS (
          SELECT 1 FROM projection.search_documents AS document
          JOIN source_scope USING (source_version_id)
          WHERE document.project_id = p_target_project_id
        )
    UNION SELECT watermark.snapshot_digest
      FROM projection.watermarks AS watermark
      WHERE watermark.project_id = p_target_project_id
        AND EXISTS (
          SELECT 1 FROM projection.search_documents AS document
          JOIN source_scope USING (source_version_id)
          WHERE document.project_id = p_target_project_id
        )
    UNION SELECT compiled.source_snapshot_digest
      FROM projection.compiled_truth AS compiled
      WHERE compiled.project_id = p_target_project_id
        AND EXISTS (
          SELECT 1 FROM canonical.claims AS claim
          JOIN source_scope
            ON claim.source_version_id = source_scope.source_version_id::text
          WHERE claim.project_id = p_target_project_id
        )
    UNION SELECT compiled.logical_digest
      FROM projection.compiled_truth AS compiled
      WHERE compiled.project_id = p_target_project_id
        AND EXISTS (
          SELECT 1 FROM canonical.claims AS claim
          JOIN source_scope
            ON claim.source_version_id = source_scope.source_version_id::text
          WHERE claim.project_id = p_target_project_id
        )
    UNION SELECT submission.submission_id::text
      FROM source_product.intake_submissions AS submission
      WHERE submission.project_id = p_target_project_id
    UNION SELECT submission.create_command_id
      FROM source_product.intake_submissions AS submission
      WHERE submission.project_id = p_target_project_id
    UNION SELECT item.submission_item_id::text
      FROM source_product.intake_submission_items AS item
      WHERE item.project_id = p_target_project_id
        AND EXISTS (
          SELECT 1 FROM source_product.intake_submissions AS submission
          WHERE submission.project_id = p_target_project_id
            AND submission.submission_id = item.submission_id
        )
    UNION SELECT item.stage2_submission_id
      FROM source_product.intake_submission_items AS item
      WHERE item.project_id = p_target_project_id AND item.stage2_submission_id IS NOT NULL
    UNION SELECT command.command_id
      FROM frontend_command.command_ledger AS command
      WHERE command.target_project_id = p_target_project_id
        AND command.command_type = ANY(ARRAY[
          'sources.intake.submit.v1', 'sources.intake.cancel.v1',
          'sources.intake.retry.v1', 'sources.duplicate.resolve.v1',
          'sources.candidate.reextract.v1'
        ]::text[])
    UNION SELECT command.client_request_id
      FROM frontend_command.command_ledger AS command
      WHERE command.target_project_id = p_target_project_id
        AND command.command_type = ANY(ARRAY[
          'sources.intake.submit.v1', 'sources.intake.cancel.v1',
          'sources.intake.retry.v1', 'sources.duplicate.resolve.v1',
          'sources.candidate.reextract.v1'
        ]::text[])
    UNION SELECT command.idempotency_key
      FROM frontend_command.command_ledger AS command
      WHERE command.target_project_id = p_target_project_id
        AND command.command_type = ANY(ARRAY[
          'sources.intake.submit.v1', 'sources.intake.cancel.v1',
          'sources.intake.retry.v1', 'sources.duplicate.resolve.v1',
          'sources.candidate.reextract.v1'
        ]::text[])
    UNION SELECT conversation.conversation_id
      FROM frontend_ask.conversations AS conversation
      JOIN affected_conversations AS affected USING (conversation_id)
      WHERE conversation.project_id = p_target_project_id
    UNION SELECT branch.branch_id
      FROM frontend_ask.branches AS branch
      JOIN affected_conversations AS affected USING (conversation_id)
    UNION SELECT turn.turn_id
      FROM frontend_ask.turns AS turn
      JOIN affected_conversations AS affected USING (conversation_id)
    UNION SELECT run.answer_run_id
      FROM frontend_ask.answer_runs AS run
      JOIN affected_conversations AS affected USING (conversation_id)
      WHERE run.project_id = p_target_project_id
    UNION SELECT run.create_command_id
      FROM frontend_ask.answer_runs AS run
      JOIN affected_conversations AS affected USING (conversation_id)
      WHERE run.project_id = p_target_project_id
    UNION SELECT selection.selection_id
      FROM frontend_ask.source_selections AS selection
      JOIN frontend_ask.answer_runs AS run USING (answer_run_id)
      JOIN affected_conversations AS affected USING (conversation_id)
      WHERE selection.project_id = p_target_project_id
    UNION SELECT statement.statement_id
      FROM frontend_ask.statements AS statement
      JOIN frontend_ask.answer_runs AS run USING (answer_run_id)
      JOIN affected_conversations AS affected USING (conversation_id)
      WHERE run.project_id = p_target_project_id
    UNION SELECT citation.citation_id
      FROM frontend_ask.citations AS citation
      JOIN frontend_ask.statements AS statement USING (statement_id)
      JOIN frontend_ask.answer_runs AS run USING (answer_run_id)
      JOIN affected_conversations AS affected USING (conversation_id)
      WHERE run.project_id = p_target_project_id
    UNION SELECT group_row.group_id
      FROM knowledge.review_groups AS group_row
      JOIN source_scope USING (source_version_id)
      WHERE group_row.project_id = p_target_project_id
    UNION SELECT import.import_id::text
      FROM knowledge.entity_vault_imports AS import
      JOIN source_scope USING (source_version_id)
      WHERE import.project_id = p_target_project_id
  )
  SELECT COALESCE(array_agg(DISTINCT token) FILTER (WHERE token IS NOT NULL), ARRAY[]::text[])
  FROM tokens
  );
END
$$;
ALTER FUNCTION connector.t3_project_source_tokens(text) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION connector.t3_project_source_tokens(text) FROM PUBLIC;
GRANT USAGE ON SCHEMA ai, candidate, validation, comparison, review, canonical,
  projection, frontend_command, source_product, frontend_ask, knowledge
  TO shotgun_schema_owner;
GRANT SELECT ON ai.provider_calls, ai.provider_outputs, candidate.batches,
  candidate.materializations, candidate.claim_candidates,
  validation.results, comparison.results, review.change_sets, review.decisions,
  review.change_sets_v2, review.decisions_v2, review.approved_manifests_v2,
  canonical.claims, canonical.commits, canonical.revisions, canonical.history_events,
  canonical.outbox, projection.search_documents, projection.watermarks,
  projection.compiled_truth, frontend_command.command_ledger,
  source_product.intake_submissions, source_product.intake_submission_items,
  frontend_ask.conversations, frontend_ask.branches, frontend_ask.turns,
  frontend_ask.source_selections, frontend_ask.answer_runs,
  frontend_ask.answer_run_attempts, frontend_ask.answer_attempt_evidence,
  frontend_ask.statements, frontend_ask.citations,
  knowledge.review_groups, knowledge.entity_vault_imports
  TO shotgun_schema_owner;

CREATE OR REPLACE FUNCTION connector.t3_project_connector_impact(p_target_project_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, connector, asset, transformation, evidence
AS $$
DECLARE
  source_tokens text[];
  result jsonb;
BEGIN
  IF p_target_project_id IS NULL OR p_target_project_id = '' THEN
    RAISE EXCEPTION 'Connector reset Project is required'
      USING ERRCODE = '22023', CONSTRAINT = 't3_connector_project_required';
  END IF;

  source_tokens := connector.t3_project_source_tokens(p_target_project_id);

  WITH source_revisions AS (
    SELECT revision.revision_id::text AS revision_id
    FROM transformation.revisions AS revision
    JOIN asset.source_versions AS version
      ON version.source_version_id = revision.source_version_id
    JOIN asset.sources AS source
      ON source.source_id = version.source_id AND source.project_id = p_target_project_id
    WHERE revision.project_id = p_target_project_id
  ),
  linked_dedup AS MATERIALIZED (
    SELECT dedup.*
    FROM connector.dedup_records AS dedup
    WHERE dedup.project_id = p_target_project_id
      AND (
        (dedup.message_type = 'EvidenceIndexed' AND EXISTS (
          SELECT 1 FROM source_revisions AS revision
          WHERE dedup.semantic_key = 'evidence-indexed:' || p_target_project_id || ':' || revision.revision_id
        ))
        OR dedup.semantic_key = ANY(source_tokens)
        OR connector.t3_text_mentions_source_token(dedup.semantic_key, source_tokens)
        OR connector.t3_jsonb_mentions_source_token(dedup.result, source_tokens)
        OR EXISTS (
          SELECT 1 FROM connector.jobs AS job
          WHERE job.dedup_record_id = dedup.dedup_record_id
            AND (
              (job.correlation_id = ANY(source_tokens)
                AND (dedup.consumer_id LIKE 'stage3.%' OR dedup.consumer_id LIKE 'stage4.%'))
              OR connector.t3_jsonb_mentions_source_token(job.result, source_tokens)
            )
        )
        -- Search projection rows are intentionally rebuilt after backup
        -- restore, so they cannot remain the only lineage proof for this
        -- Project's prior rebuild job. Reset invalidates every old
        -- project-scoped Search rebuild regardless of Source row presence.
        OR dedup.message_type = 'RebuildSearchProjection'
        OR EXISTS (
          SELECT 1 FROM connector.dead_letters AS dead_letter
          WHERE dead_letter.dedup_record_id = dedup.dedup_record_id
            AND (connector.t3_jsonb_mentions_source_token(dead_letter.envelope, source_tokens)
              OR connector.t3_jsonb_mentions_source_token(dead_letter.job, source_tokens))
        )
      )
  ),
  linked_jobs AS MATERIALIZED (
    SELECT job.* FROM connector.jobs AS job
    JOIN linked_dedup AS dedup USING (dedup_record_id)
  ),
  linked_dead_letters AS MATERIALIZED (
    SELECT dead_letter.* FROM connector.dead_letters AS dead_letter
    JOIN linked_dedup AS dedup USING (dedup_record_id)
  ),
  linked_replays AS MATERIALIZED (
    SELECT replay.* FROM connector.replays AS replay
    JOIN linked_dead_letters AS dead_letter USING (dead_letter_id)
  ),
  linked_ordering AS MATERIALIZED (
    SELECT checkpoint.*
    FROM connector.ordering_checkpoints AS checkpoint
    WHERE checkpoint.project_id = p_target_project_id
      AND (
        checkpoint.claim_job_id IN (SELECT job_id FROM linked_jobs)
        OR checkpoint.ordering_key = ANY(source_tokens)
        OR EXISTS (
          SELECT 1 FROM linked_dedup AS dedup
          WHERE checkpoint.security_scope = dedup.security_scope
            AND checkpoint.consumer_id = dedup.consumer_id
            AND checkpoint.message_kind = dedup.message_kind
            AND checkpoint.message_type = dedup.message_type
            AND checkpoint.ordering_key = dedup.semantic_key
        )
      )
  ),
  project_dedup AS MATERIALIZED (
    SELECT * FROM connector.dedup_records WHERE project_id = p_target_project_id
  ),
  project_dead_letters AS MATERIALIZED (
    SELECT * FROM connector.dead_letters WHERE project_id = p_target_project_id
  ),
  project_ordering AS MATERIALIZED (
    SELECT * FROM connector.ordering_checkpoints WHERE project_id = p_target_project_id
  ),
  independent_dedup AS MATERIALIZED (
    SELECT dedup.*
    FROM project_dedup AS dedup
    JOIN connector.jobs AS job USING (dedup_record_id)
    WHERE NOT EXISTS (
        SELECT 1 FROM linked_dedup AS linked
        WHERE linked.dedup_record_id = dedup.dedup_record_id
      )
      AND dedup.state = 'COMPLETED'
      AND job.status = 'succeeded'
      AND (
        (dedup.message_kind = 'query' AND (
          (dedup.message_type = 'CheckComparisonFreshness'
            AND job.result ?& ARRAY['fresh', 'currentSnapshotDigest', 'currentSnapshotVersion']::text[]
            AND jsonb_typeof(job.result->'fresh') = 'boolean'
            AND jsonb_typeof(job.result->'currentSnapshotDigest') = 'string'
            AND jsonb_typeof(job.result->'currentSnapshotVersion') = 'number')
          OR (dedup.message_type = 'GetCompiledTruthStatus'
            AND job.result ?& ARRAY['status', 'canonicalVersion', 'projectorVersion',
              'projectedCanonicalVersion']::text[]
            AND jsonb_typeof(job.result->'status') = 'string'
            AND jsonb_typeof(job.result->'canonicalVersion') = 'number')
          OR (dedup.message_type = 'GetProjectionReadiness'
            AND job.result ?& ARRAY['status', 'canonicalVersion', 'projectedCanonicalVersion']::text[]
            AND jsonb_typeof(job.result->'status') = 'string'
            AND jsonb_typeof(job.result->'canonicalVersion') = 'number')
          OR (dedup.message_type = 'ListKnowledgeGroups'
            AND job.result = '{"items": []}'::jsonb)
        ))
        OR (dedup.message_kind = 'command'
          AND dedup.message_type = 'DispatchCanonicalOutbox'
          AND job.result = '{"published": 0}'::jsonb)
      )
  ),
  independent_ordering AS MATERIALIZED (
    SELECT checkpoint.*
    FROM project_ordering AS checkpoint
    WHERE checkpoint.claim_job_id IN (
      SELECT job.job_id
      FROM connector.jobs AS job
      JOIN independent_dedup AS dedup USING (dedup_record_id)
    )
      OR EXISTS (
        SELECT 1
        FROM independent_dedup AS dedup
        WHERE checkpoint.security_scope = dedup.security_scope
          AND checkpoint.consumer_id = dedup.consumer_id
          AND checkpoint.message_kind = dedup.message_kind
          AND checkpoint.message_type = dedup.message_type
          AND checkpoint.ordering_key = dedup.semantic_key
      )
  ),
  aggregate AS (
    SELECT
      (SELECT count(*) FROM linked_dedup)
      + (SELECT count(*) FROM linked_jobs)
      + (SELECT count(*) FROM connector.job_attempts AS attempt
         JOIN linked_jobs AS job USING (job_id))
      + (SELECT count(*) FROM linked_dead_letters)
      + (SELECT count(*) FROM linked_replays)
      + (SELECT count(*) FROM linked_ordering) AS source_derived_record_count,
      (SELECT count(*) FROM project_dedup) - (SELECT count(*) FROM linked_dedup)
      - (SELECT count(*) FROM independent_dedup)
      + (SELECT count(*) FROM project_dead_letters) - (SELECT count(*) FROM linked_dead_letters)
      + (SELECT count(*) FROM project_ordering) - (SELECT count(*) FROM linked_ordering)
      - (SELECT count(*) FROM independent_ordering)
        AS unclassified_record_count,
      (SELECT count(*) FROM linked_dedup
        WHERE state IN ('IN_PROGRESS', 'OUTCOME_UNKNOWN'))
      + (SELECT count(*) FROM linked_jobs
        WHERE status IN ('queued', 'running', 'retryable', 'outcome-unknown')
           OR lease_owner IS NOT NULL OR lease_expires_at > clock_timestamp())
      + (SELECT count(*) FROM connector.job_attempts AS attempt
         JOIN linked_jobs AS job USING (job_id) WHERE attempt.status = 'running')
      + (SELECT count(*) FROM linked_replays WHERE status = 'running') AS active_job_count,
      encode(pg_catalog.sha256(convert_to(
        COALESCE((SELECT string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY row_data::text)
          FROM project_dedup AS row_data), '') || E'\n' ||
        COALESCE((SELECT string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY row_data::text)
          FROM project_dead_letters AS row_data), '') || E'\n' ||
        COALESCE((SELECT string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY row_data::text)
          FROM project_ordering AS row_data), '') || E'\n' ||
        COALESCE((SELECT string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY row_data::text)
          FROM connector.jobs AS row_data JOIN project_dedup AS dedup USING (dedup_record_id)), '') || E'\n' ||
        COALESCE((SELECT string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY row_data::text)
          FROM connector.job_attempts AS row_data JOIN connector.jobs AS job USING (job_id)
          JOIN project_dedup AS dedup USING (dedup_record_id)), '') || E'\n' ||
        COALESCE((SELECT string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY row_data::text)
          FROM connector.replays AS row_data JOIN project_dead_letters AS dead_letter USING (dead_letter_id)), ''),
        'UTF8')), 'hex') AS fingerprint
  )
  SELECT jsonb_build_object(
    'sourceDerivedRecordCount', aggregate.source_derived_record_count,
    'unclassifiedRecordCount', aggregate.unclassified_record_count,
    'activeJobCount', aggregate.active_job_count,
    'fingerprint', aggregate.fingerprint
  ) INTO result FROM aggregate;
  RETURN result;
END
$$;
ALTER FUNCTION connector.t3_project_connector_impact(text) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION connector.t3_project_connector_impact(text) FROM PUBLIC;

-- The row-level guard used by generic Project tables reads NEW.project_id. Jobs
-- and attempts intentionally have no Project column, so resolve the owner here.
CREATE OR REPLACE FUNCTION connector.t3_guard_job_project_knowledge_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, connector, project_admin
AS $$
DECLARE
  target_project_id text;
  reset_state text;
BEGIN
  IF TG_TABLE_NAME = 'jobs' THEN
    SELECT dedup.project_id INTO target_project_id
    FROM connector.dedup_records AS dedup WHERE dedup.dedup_record_id = NEW.dedup_record_id;
  ELSE
    SELECT dedup.project_id INTO target_project_id
    FROM connector.job_attempts AS attempt
    JOIN connector.jobs AS job USING (job_id)
    JOIN connector.dedup_records AS dedup USING (dedup_record_id)
    WHERE attempt.attempt_id = NEW.attempt_id;
    IF target_project_id IS NULL THEN
      SELECT dedup.project_id INTO target_project_id
      FROM connector.jobs AS job
      JOIN connector.dedup_records AS dedup USING (dedup_record_id)
      WHERE job.job_id = NEW.job_id;
    END IF;
  END IF;
  IF target_project_id IS NULL THEN RETURN NEW; END IF;
  SELECT epoch.state INTO reset_state FROM project_admin.project_knowledge_epoch AS epoch
  WHERE epoch.project_id = target_project_id;
  IF reset_state IS NULL OR reset_state = 'READY'
     OR project_admin.t3_reset_write_authorized(target_project_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Project knowledge reset fences Connector writes'
    USING ERRCODE = '55000', CONSTRAINT = 'project_knowledge_reset_write_fence';
END
$$;
ALTER FUNCTION connector.t3_guard_job_project_knowledge_write() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION connector.t3_guard_job_project_knowledge_write() FROM PUBLIC;
GRANT USAGE ON SCHEMA connector TO shotgun_schema_owner, shotgun_runtime, shotgun_erasure_executor;
GRANT USAGE ON SCHEMA asset, transformation, evidence TO shotgun_schema_owner;
GRANT SELECT ON connector.dedup_records, connector.jobs, connector.job_attempts,
  connector.dead_letters, connector.replays, connector.ordering_checkpoints,
  asset.sources, asset.source_versions, transformation.revisions, evidence.spans
  TO shotgun_schema_owner;
GRANT DELETE ON connector.dedup_records, connector.jobs, connector.job_attempts,
  connector.dead_letters, connector.replays, connector.ordering_checkpoints
  TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION project_admin.t3_reset_write_authorized(text)
  TO shotgun_schema_owner;

DROP TRIGGER IF EXISTS t3_connector_job_write_fence ON connector.jobs;
CREATE TRIGGER t3_connector_job_write_fence BEFORE INSERT OR UPDATE ON connector.jobs
  FOR EACH ROW EXECUTE FUNCTION connector.t3_guard_job_project_knowledge_write();
DROP TRIGGER IF EXISTS t3_connector_attempt_write_fence ON connector.job_attempts;
CREATE TRIGGER t3_connector_attempt_write_fence BEFORE INSERT OR UPDATE ON connector.job_attempts
  FOR EACH ROW EXECUTE FUNCTION connector.t3_guard_job_project_knowledge_write();

CREATE OR REPLACE FUNCTION connector.t3_reset_request_authorized(
  p_target_project_id text,
  p_reset_request_id uuid,
  allowed_states text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
  SELECT session_user = 'shotgun_erasure_executor'
    AND EXISTS (
      SELECT 1 FROM project_admin.project_knowledge_reset_requests AS request
      JOIN project_admin.project_knowledge_epoch AS epoch
        ON epoch.project_id = request.project_id
       AND epoch.epoch = request.resulting_knowledge_epoch
      WHERE request.project_id = p_target_project_id
        AND request.request_id = p_reset_request_id
        AND request.state = ANY(allowed_states)
        AND request.owner_manifest_digest IS NOT NULL
        AND epoch.state = 'RESET_PENDING'
    )
$$;
ALTER FUNCTION connector.t3_reset_request_authorized(text, uuid, text[])
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION connector.t3_reset_request_authorized(text, uuid, text[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION connector.t3_snapshot_project_connector(
  p_target_project_id text,
  p_reset_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, connector, project_admin, asset, transformation, evidence
AS $$
DECLARE
  analysis jsonb;
  snapshot jsonb;
  source_token_values text[];
BEGIN
  IF NOT connector.t3_reset_request_authorized(
    p_target_project_id, p_reset_request_id, ARRAY['FENCING']::text[]
  ) THEN
    RAISE EXCEPTION 'Connector reset is not authorized'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  analysis := connector.t3_project_connector_impact(p_target_project_id);
  IF (analysis->>'unclassifiedRecordCount')::bigint > 0 THEN
    RAISE EXCEPTION 'Connector Source lineage is incomplete'
      USING ERRCODE = '55000', CONSTRAINT = 't3_connector_unclassified';
  END IF;
  IF (analysis->>'activeJobCount')::bigint > 0 THEN
    RAISE EXCEPTION 'Connector has an active or outcome-unknown Source job'
      USING ERRCODE = '55000', CONSTRAINT = 'active_job_outcome_unknown';
  END IF;
  PERFORM set_config('shotgun.t3_reset_request_id', p_reset_request_id::text, true);

  source_token_values := connector.t3_project_source_tokens(p_target_project_id);

  WITH source_revisions AS (
    SELECT revision.revision_id::text AS revision_id
    FROM transformation.revisions AS revision
    JOIN asset.source_versions AS version ON version.source_version_id = revision.source_version_id
    JOIN asset.sources AS source ON source.source_id = version.source_id AND source.project_id = p_target_project_id
    WHERE revision.project_id = p_target_project_id
  ), selected AS (
    SELECT dedup.dedup_record_id
    FROM connector.dedup_records AS dedup
    WHERE dedup.project_id = p_target_project_id AND (
      (dedup.message_type = 'EvidenceIndexed' AND EXISTS (
        SELECT 1 FROM source_revisions AS revision
        WHERE dedup.semantic_key = 'evidence-indexed:' || p_target_project_id || ':' || revision.revision_id
      )) OR dedup.semantic_key = ANY(source_token_values)
      OR connector.t3_text_mentions_source_token(dedup.semantic_key, source_token_values)
      OR connector.t3_jsonb_mentions_source_token(dedup.result, source_token_values)
      OR EXISTS (
        SELECT 1 FROM connector.jobs AS job
        WHERE job.dedup_record_id = dedup.dedup_record_id
          AND (
            (job.correlation_id = ANY(source_token_values)
              AND (dedup.consumer_id LIKE 'stage3.%' OR dedup.consumer_id LIKE 'stage4.%'))
            OR connector.t3_jsonb_mentions_source_token(job.result, source_token_values)
          )
      )
      -- See the impact query above: restore drops rebuildable Search rows,
      -- while this old Project-scoped job must still be purged with them.
      OR dedup.message_type = 'RebuildSearchProjection'
      OR EXISTS (
        SELECT 1 FROM connector.dead_letters AS dead_letter
        WHERE dead_letter.dedup_record_id = dedup.dedup_record_id
          AND (connector.t3_jsonb_mentions_source_token(dead_letter.envelope, source_token_values)
            OR connector.t3_jsonb_mentions_source_token(dead_letter.job, source_token_values))
      )
    )
  ), selected_jobs AS (
    SELECT job.job_id, dedup.dedup_record_id, dedup.project_id, dedup.security_scope,
           dedup.consumer_id, dedup.message_kind, dedup.message_type, dedup.semantic_key
    FROM connector.jobs AS job JOIN connector.dedup_records AS dedup USING (dedup_record_id)
    WHERE dedup.dedup_record_id IN (SELECT dedup_record_id FROM selected)
  ), selected_ordering AS (
    SELECT checkpoint.*
    FROM connector.ordering_checkpoints AS checkpoint
    WHERE checkpoint.project_id = p_target_project_id AND (
      checkpoint.claim_job_id IN (SELECT job_id FROM selected_jobs)
      OR checkpoint.ordering_key = ANY(source_token_values)
      OR EXISTS (
        SELECT 1 FROM selected_jobs AS job
        WHERE checkpoint.security_scope = job.security_scope
          AND checkpoint.consumer_id = job.consumer_id
          AND checkpoint.message_kind = job.message_kind
          AND checkpoint.message_type = job.message_type
          AND checkpoint.ordering_key = job.semantic_key
      )
    )
  )
  SELECT jsonb_build_object(
    'dedupRecordIds', COALESCE((SELECT jsonb_agg(dedup_record_id::text ORDER BY dedup_record_id)
      FROM selected), '[]'::jsonb),
    'orderingCheckpointKeys', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'security_scope', security_scope, 'consumer_id', consumer_id,
      'message_kind', message_kind, 'message_type', message_type, 'ordering_key', ordering_key
    ) ORDER BY security_scope, consumer_id, message_kind, message_type, ordering_key)
      FROM selected_ordering), '[]'::jsonb),
    'fingerprint', analysis->>'fingerprint',
    'recordCount', (analysis->>'sourceDerivedRecordCount')::bigint
  ) INTO snapshot;

  UPDATE project_admin.project_knowledge_reset_requests AS request
  SET step_checkpoints = jsonb_set(request.step_checkpoints,
        '{t3ConnectorFenceSnapshot}', snapshot, true), updated_at = now()
  WHERE request.project_id = p_target_project_id AND request.request_id = p_reset_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Connector reset request was not found'
      USING ERRCODE = '55000', CONSTRAINT = 't3_connector_snapshot_missing';
  END IF;
END
$$;
ALTER FUNCTION connector.t3_snapshot_project_connector(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION connector.t3_snapshot_project_connector(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION connector.t3_erase_project_connector(
  p_target_project_id text,
  p_reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, connector, project_admin
AS $$
DECLARE
  request_row project_admin.project_knowledge_reset_requests%ROWTYPE;
  snapshot jsonb;
  dedup_ids uuid[];
  deleted_count bigint;
  receipt jsonb;
BEGIN
  IF NOT connector.t3_reset_request_authorized(
    p_target_project_id, p_reset_request_id, ARRAY['PURGING']::text[]
  ) THEN
    RAISE EXCEPTION 'Connector reset is not authorized'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  PERFORM set_config('shotgun.t3_reset_request_id', p_reset_request_id::text, true);
  SELECT * INTO request_row FROM project_admin.project_knowledge_reset_requests AS request
  WHERE request.project_id = p_target_project_id AND request.request_id = p_reset_request_id FOR UPDATE;
  snapshot := request_row.step_checkpoints->'t3ConnectorFenceSnapshot';
  receipt := request_row.step_checkpoints->'t3ConnectorPurgeReceipt';
  IF snapshot IS NULL AND receipt IS NOT NULL THEN RETURN receipt; END IF;
  IF snapshot IS NULL OR snapshot->>'fingerprint' IS NULL THEN
    RAISE EXCEPTION 'Connector fence snapshot is missing'
      USING ERRCODE = '55000', CONSTRAINT = 't3_connector_snapshot_missing';
  END IF;
  SELECT COALESCE(array_agg(value::uuid), ARRAY[]::uuid[]) INTO dedup_ids
  FROM jsonb_array_elements_text(snapshot->'dedupRecordIds') AS item(value);

  IF EXISTS (
    SELECT 1 FROM connector.dedup_records AS dedup
    JOIN connector.jobs AS job USING (dedup_record_id)
    WHERE dedup.dedup_record_id = ANY(dedup_ids)
      AND (job.status IN ('queued', 'running', 'retryable', 'outcome-unknown')
        OR job.lease_owner IS NOT NULL OR job.lease_expires_at > clock_timestamp())
  ) OR EXISTS (
    SELECT 1 FROM connector.dedup_records AS dedup
    WHERE dedup.dedup_record_id = ANY(dedup_ids)
      AND dedup.state IN ('IN_PROGRESS', 'OUTCOME_UNKNOWN')
  ) OR EXISTS (
    SELECT 1 FROM connector.job_attempts AS attempt
    JOIN connector.jobs AS job USING (job_id)
    WHERE job.dedup_record_id = ANY(dedup_ids) AND attempt.status = 'running'
  ) OR EXISTS (
    SELECT 1 FROM connector.replays AS replay
    JOIN connector.dead_letters AS dead_letter USING (dead_letter_id)
    WHERE dead_letter.dedup_record_id = ANY(dedup_ids) AND replay.status = 'running'
  ) THEN
    RAISE EXCEPTION 'Connector Source job became active after its fence snapshot'
      USING ERRCODE = '55000', CONSTRAINT = 'active_job_outcome_unknown';
  END IF;

  -- Checkpoint equality is compared against the fence-time value before any
  -- child row is removed. A changed record requires a new Preview.
  IF (connector.t3_project_connector_impact(p_target_project_id)->>'fingerprint')
       IS DISTINCT FROM snapshot->>'fingerprint' THEN
    RAISE EXCEPTION 'Connector rows changed after reset approval'
      USING ERRCODE = '55000', CONSTRAINT = 't3_connector_snapshot_stale';
  END IF;

  DELETE FROM connector.ordering_checkpoints AS checkpoint
  USING jsonb_to_recordset(snapshot->'orderingCheckpointKeys') AS keyset(
    security_scope text, consumer_id text, message_kind text,
    message_type text, ordering_key text
  )
  WHERE checkpoint.project_id = p_target_project_id
    AND checkpoint.security_scope = keyset.security_scope
    AND checkpoint.consumer_id = keyset.consumer_id
    AND checkpoint.message_kind = keyset.message_kind
    AND checkpoint.message_type = keyset.message_type
    AND checkpoint.ordering_key = keyset.ordering_key;

  DELETE FROM connector.replays AS replay USING connector.dead_letters AS dead_letter
  WHERE replay.dead_letter_id = dead_letter.dead_letter_id
    AND dead_letter.dedup_record_id = ANY(dedup_ids);
  DELETE FROM connector.dead_letters AS dead_letter
  WHERE dead_letter.dedup_record_id = ANY(dedup_ids);
  DELETE FROM connector.job_attempts AS attempt USING connector.jobs AS job
  WHERE attempt.job_id = job.job_id AND job.dedup_record_id = ANY(dedup_ids);
  DELETE FROM connector.jobs AS job WHERE job.dedup_record_id = ANY(dedup_ids);
  DELETE FROM connector.dedup_records AS dedup
  WHERE dedup.dedup_record_id = ANY(dedup_ids);
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  receipt := jsonb_build_object(
    'purgeCompleted', true,
    'sourceDerivedRecordCount', (snapshot->>'recordCount')::bigint,
    'fingerprint', snapshot->>'fingerprint'
  );
  UPDATE project_admin.project_knowledge_reset_requests AS request
  SET step_checkpoints = jsonb_set(
        request.step_checkpoints - 't3ConnectorFenceSnapshot',
        '{t3ConnectorPurgeReceipt}', receipt, true
      ), updated_at = now()
  WHERE request.project_id = p_target_project_id AND request.request_id = p_reset_request_id;
  RETURN receipt || jsonb_build_object('deletedDedupRecords', deleted_count);
END
$$;
ALTER FUNCTION connector.t3_erase_project_connector(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION connector.t3_erase_project_connector(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION connector.t3_project_connector_status(
  p_target_project_id text,
  p_reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, connector, project_admin
AS $$
DECLARE
  request_row project_admin.project_knowledge_reset_requests%ROWTYPE;
  analysis jsonb;
  remaining_count bigint;
  receipt jsonb;
BEGIN
  IF NOT connector.t3_reset_request_authorized(
    p_target_project_id, p_reset_request_id, ARRAY['VERIFYING']::text[]
  ) THEN
    RAISE EXCEPTION 'Connector reset status is unavailable outside verification'
      USING ERRCODE = '55000', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  SELECT * INTO request_row FROM project_admin.project_knowledge_reset_requests AS request
  WHERE request.project_id = p_target_project_id AND request.request_id = p_reset_request_id;
  receipt := request_row.step_checkpoints->'t3ConnectorPurgeReceipt';
  analysis := connector.t3_project_connector_impact(p_target_project_id);
  remaining_count := (analysis->>'sourceDerivedRecordCount')::bigint
    + (analysis->>'unclassifiedRecordCount')::bigint;
  RETURN jsonb_build_object(
    'purgeCompleted', COALESCE((receipt->>'purgeCompleted')::boolean, false),
    'sourceDerivedRecordCount', COALESCE((receipt->>'sourceDerivedRecordCount')::bigint, 0),
    'remainingProjectRecordCount', remaining_count,
    'fingerprint', COALESCE(receipt->>'fingerprint', repeat('0', 64))
  );
END
$$;
ALTER FUNCTION connector.t3_project_connector_status(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION connector.t3_project_connector_status(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION connector.t3_discard_pre_purge_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, project_admin
AS $$
BEGIN
  IF NEW.state = 'BLOCKED' AND OLD.state IS DISTINCT FROM NEW.state THEN
    UPDATE project_admin.project_knowledge_reset_requests AS request
    SET step_checkpoints = request.step_checkpoints - 't3ConnectorFenceSnapshot'
    WHERE request.project_id = NEW.project_id AND request.request_id = NEW.request_id;
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION connector.t3_discard_pre_purge_snapshot() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION connector.t3_discard_pre_purge_snapshot() FROM PUBLIC;
DROP TRIGGER IF EXISTS t3_connector_discard_pre_purge_snapshot
  ON project_admin.project_knowledge_reset_requests;
CREATE TRIGGER t3_connector_discard_pre_purge_snapshot
  AFTER UPDATE OF state ON project_admin.project_knowledge_reset_requests
  FOR EACH ROW EXECUTE FUNCTION connector.t3_discard_pre_purge_snapshot();

GRANT EXECUTE ON FUNCTION connector.t3_project_connector_impact(text)
  TO shotgun_runtime, shotgun_erasure_executor;
GRANT EXECUTE ON FUNCTION connector.t3_snapshot_project_connector(text, uuid),
  connector.t3_erase_project_connector(text, uuid),
  connector.t3_project_connector_status(text, uuid),
  connector.t3_discard_pre_purge_snapshot()
  TO shotgun_erasure_executor, shotgun_schema_owner;
