DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '100_t3_projection_erasure.sql'
  ) THEN
    RAISE EXCEPTION
      'Migration 101 preflight failed: migration 100 is not registered';
  END IF;
END
$$;

-- The canonical owner captures only opaque row identities before Review is
-- purged. These request-scoped rows let canonical purge source-linked NO_OP
-- commits after their Review authority has been removed. They are deleted in
-- the same transaction as Canonical purge, or when execution blocks before
-- the first content mutation.
CREATE TABLE canonical.t3_reset_owner_snapshots (
  project_id text NOT NULL,
  request_id uuid NOT NULL,
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  owner_manifest_digest text NOT NULL CHECK (owner_manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  canonical_version integer NOT NULL CHECK (canonical_version >= 0),
  canonical_snapshot_digest text NOT NULL CHECK (canonical_snapshot_digest ~ '^sha256:[a-f0-9]{64}$'),
  canonical_impact_fingerprint text NOT NULL CHECK (canonical_impact_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, request_id),
  FOREIGN KEY (project_id, request_id)
    REFERENCES project_admin.project_knowledge_reset_requests(project_id, request_id)
    ON DELETE CASCADE
);

CREATE TABLE canonical.t3_reset_owner_snapshot_rows (
  project_id text NOT NULL,
  request_id uuid NOT NULL,
  row_kind text NOT NULL CHECK (row_kind IN (
    'claim', 'relation', 'commit', 'revision', 'history', 'outbox',
    'relation_precursor', 'history_payload_state', 'history_payload_audit'
  )),
  row_id text NOT NULL,
  PRIMARY KEY (project_id, request_id, row_kind, row_id),
  FOREIGN KEY (project_id, request_id)
    REFERENCES canonical.t3_reset_owner_snapshots(project_id, request_id)
    ON DELETE CASCADE
);

ALTER TABLE canonical.t3_reset_owner_snapshots OWNER TO shotgun_schema_owner;
ALTER TABLE canonical.t3_reset_owner_snapshot_rows OWNER TO shotgun_schema_owner;
REVOKE ALL ON canonical.t3_reset_owner_snapshots,
  canonical.t3_reset_owner_snapshot_rows FROM PUBLIC, shotgun_runtime,
  shotgun_erasure_executor;

GRANT USAGE ON SCHEMA canonical TO shotgun_schema_owner, shotgun_runtime,
  shotgun_erasure_executor;
GRANT SELECT, INSERT, DELETE, UPDATE ON canonical.claims, canonical.commits,
  canonical.revisions, canonical.history_events, canonical.outbox,
  canonical.relations, canonical.relation_precursors,
  canonical.history_payload_state, canonical.history_payload_audit_events,
  canonical.project_state, canonical.knowledge_reset_events
  TO shotgun_schema_owner;
GRANT SELECT ON asset.sources, asset.source_versions, evidence.spans
  TO shotgun_schema_owner;
GRANT EXECUTE ON FUNCTION project_admin.t3_reset_write_authorized(text)
  TO shotgun_schema_owner;

-- Preserve the existing append-only contract for ordinary writers. Only the
-- dedicated executor, during an approved reset state, may erase a selected
-- Project's Canonical payload.
CREATE OR REPLACE FUNCTION canonical.reject_append_only_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_project_id text;
BEGIN
  target_project_id := COALESCE(to_jsonb(OLD)->>'project_id', to_jsonb(NEW)->>'project_id');
  IF target_project_id IS NOT NULL
     AND project_admin.t3_reset_write_authorized(target_project_id) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END
$$;
ALTER FUNCTION canonical.reject_append_only_change() OWNER TO shotgun_schema_owner;

CREATE OR REPLACE FUNCTION canonical.relations_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF project_admin.t3_reset_write_authorized(OLD.project_id) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'canonical.relations is append-only'
    USING ERRCODE = '55000';
END
$$;
ALTER FUNCTION canonical.relations_append_only() OWNER TO shotgun_schema_owner;

CREATE OR REPLACE FUNCTION canonical.relation_precursors_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF project_admin.t3_reset_write_authorized(OLD.project_id) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'canonical.relation_precursors is append-only'
    USING ERRCODE = '55000';
END
$$;
ALTER FUNCTION canonical.relation_precursors_append_only() OWNER TO shotgun_schema_owner;

CREATE OR REPLACE FUNCTION canonical.reject_payload_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF project_admin.t3_reset_write_authorized(OLD.resource_project_id) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION
    'canonical.history_payload_audit_events is append-only: % mutation is forbidden',
    TG_TABLE_NAME USING ERRCODE = '55000';
END
$$;
ALTER FUNCTION canonical.reject_payload_audit_mutation() OWNER TO shotgun_schema_owner;

CREATE OR REPLACE FUNCTION canonical.reject_t3_content_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'T3-managed Canonical content cannot be truncated: %', TG_TABLE_NAME
    USING ERRCODE = '55000';
END
$$;
ALTER FUNCTION canonical.reject_t3_content_truncate() OWNER TO shotgun_schema_owner;

DO $$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'canonical.claims', 'canonical.commits', 'canonical.revisions',
    'canonical.history_events', 'canonical.outbox', 'canonical.relations',
    'canonical.relation_precursors', 'canonical.history_payload_audit_events'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS t3_no_truncate ON %s', relation_name);
    EXECUTE format(
      'CREATE TRIGGER t3_no_truncate BEFORE TRUNCATE ON %s '
      'FOR EACH STATEMENT EXECUTE FUNCTION canonical.reject_t3_content_truncate()',
      relation_name
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION canonical.t3_classify_project_content(
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
SET search_path = pg_catalog, canonical, asset, evidence,
  frontend_review, review, project_admin
AS $$
  WITH claim_rows AS MATERIALIZED (
    SELECT claim.claim_id,
      CASE
        WHEN source.project_id = p_target_project_id
         AND claim.claim_json->>'claimId' = claim.claim_id
         AND claim.claim_json->>'projectId' = claim.project_id
         AND claim.claim_json->>'sourceVersionId' = claim.source_version_id
         AND jsonb_typeof(claim.claim_json->'claimText') = 'string'
         AND jsonb_typeof(claim.claim_json->'evidenceIds') = 'array'
         AND jsonb_array_length(claim.claim_json->'evidenceIds') > 0
         AND NOT EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(claim.claim_json->'evidenceIds') AS evidence_id(value)
           LEFT JOIN evidence.spans AS span
             ON span.evidence_id::text = evidence_id.value
            AND span.project_id = p_target_project_id
            AND span.source_version_id::text = claim.source_version_id
           WHERE span.evidence_id IS NULL
         )
          THEN 'SOURCE_DERIVED'
        ELSE 'UNKNOWN'
      END AS disposition,
      claim.claim_json
    FROM canonical.claims AS claim
    LEFT JOIN asset.source_versions AS version
      ON version.source_version_id::text = claim.source_version_id
    LEFT JOIN asset.sources AS source
      ON source.source_id = version.source_id
    WHERE claim.project_id = p_target_project_id
  ), relation_rows AS MATERIALIZED (
    SELECT relation.relation_id,
      CASE
        WHEN relation.relation_json->>'relationId' = relation.relation_id
         AND relation.relation_json->>'projectId' = relation.project_id
         AND relation.relation_json->>'logicalIdentityKey' = relation.logical_identity_key
         AND relation.relation_json->>'relationType' = relation.relation_type
         AND relation.relation_json->>'direction' = relation.direction
         AND relation.relation_json->'evidenceIds' = to_jsonb(relation.evidence_ids)
         AND cardinality(relation.evidence_ids) > 0
         AND NOT EXISTS (
           SELECT 1
           FROM unnest(relation.evidence_ids) AS evidence_id(value)
           LEFT JOIN evidence.spans AS span
             ON span.evidence_id::text = evidence_id.value
            AND span.project_id = p_target_project_id
           WHERE span.evidence_id IS NULL
         )
          THEN 'SOURCE_DERIVED'
        ELSE 'UNKNOWN'
      END AS disposition,
      relation.relation_json
    FROM canonical.relations AS relation
    WHERE relation.project_id = p_target_project_id
  ), review_authorities AS MATERIALIZED (
    SELECT approval.approval_id AS authority_id,
           CASE
             WHEN bool_or(classified.disposition = 'UNKNOWN') THEN 'UNKNOWN'
             WHEN bool_or(classified.disposition = 'SOURCE_DERIVED') THEN 'SOURCE_DERIVED'
             ELSE 'PRESERVE'
           END AS disposition
    FROM frontend_review.approval AS approval
    JOIN review.t3_classify_project_review(p_target_project_id) AS classified
      ON classified.relation_name = 'frontend_review.approval'
     AND classified.row_id = approval.approval_id || ':' || approval.approval_status_revision::text
    WHERE approval.project_id = p_target_project_id
    GROUP BY approval.approval_id
  ), v2_authorities AS MATERIALIZED (
    SELECT manifest.manifest_id AS authority_id,
           CASE
             WHEN bool_or(classified.disposition = 'UNKNOWN') THEN 'UNKNOWN'
             WHEN bool_or(classified.disposition = 'SOURCE_DERIVED') THEN 'SOURCE_DERIVED'
             ELSE 'PRESERVE'
           END AS disposition
    FROM review.approved_manifests_v2 AS manifest
    JOIN review.t3_classify_project_review(p_target_project_id) AS classified
      ON classified.relation_name = 'review.approved_manifests_v2'
     AND classified.row_id = manifest.manifest_id
    WHERE manifest.project_id = p_target_project_id
    GROUP BY manifest.manifest_id
  ), commit_rows AS MATERIALIZED (
    SELECT commit.commit_id, commit.result_json,
      CASE
        WHEN commit.result_json->>'erasurePolicy' = 'T3_PROJECT_SOURCE_KNOWLEDGE_RESET'
          THEN 'REDACTED'
        WHEN EXISTS (
          SELECT 1 FROM claim_rows AS claim
          WHERE claim.disposition = 'UNKNOWN'
            AND (
              claim.claim_id = commit.result_json->>'claimId'
              OR (commit.manifest_id IS NOT NULL
                  AND EXISTS (
                    SELECT 1 FROM canonical.claims AS raw_claim
                    WHERE raw_claim.claim_id = claim.claim_id
                      AND raw_claim.manifest_id = commit.manifest_id
                  ))
              OR (commit.authority_id IS NOT NULL
                  AND EXISTS (
                    SELECT 1 FROM canonical.claims AS raw_claim
                    WHERE raw_claim.claim_id = claim.claim_id
                      AND raw_claim.authority_id = commit.authority_id
                  ))
            )
        ) OR EXISTS (
          SELECT 1 FROM relation_rows AS relation
          WHERE relation.disposition = 'UNKNOWN'
            AND (
              relation.relation_id = commit.result_json->>'relationId'
              OR relation.relation_json #>> '{authority,approvalId}' = commit.authority_id
            )
        ) THEN 'UNKNOWN'
        WHEN EXISTS (
          SELECT 1 FROM claim_rows AS claim
          JOIN canonical.claims AS raw_claim USING (claim_id)
          WHERE claim.disposition = 'SOURCE_DERIVED'
            AND (raw_claim.manifest_id = commit.manifest_id
              OR raw_claim.authority_id = commit.authority_id
              OR claim.claim_id = commit.result_json->>'claimId')
        ) OR EXISTS (
          SELECT 1 FROM relation_rows AS relation
          WHERE relation.disposition = 'SOURCE_DERIVED'
            AND (relation.relation_id = commit.result_json->>'relationId'
              OR relation.relation_json #>> '{authority,approvalId}' = commit.authority_id)
        ) THEN 'SOURCE_DERIVED'
        WHEN commit.authority_kind = 'LEGACY_STAGE5_MANIFEST'
         AND commit.manifest_id IS NOT NULL THEN 'SOURCE_DERIVED'
        WHEN commit.authority_kind = 'FRONTEND_REVIEW_APPROVAL'
          THEN COALESCE(review_authority.disposition, 'UNKNOWN')
        WHEN commit.authority_kind = 'V2_COMPARISON_REVIEW'
          THEN COALESCE(v2_authority.disposition, 'UNKNOWN')
        ELSE 'UNKNOWN'
      END AS disposition
    FROM canonical.commits AS commit
    LEFT JOIN review_authorities AS review_authority
      ON review_authority.authority_id = commit.authority_id
    LEFT JOIN v2_authorities AS v2_authority
      ON v2_authority.authority_id = commit.authority_id
    WHERE commit.project_id = p_target_project_id
  ), rows AS (
    SELECT 'canonical.claims'::text AS relation_name, claim.claim_id AS row_id,
           claim.disposition, to_jsonb(raw_claim) AS row_data
    FROM claim_rows AS claim
    JOIN canonical.claims AS raw_claim USING (claim_id)
    UNION ALL
    SELECT 'canonical.relations', relation.relation_id,
           relation.disposition, to_jsonb(raw_relation)
    FROM relation_rows AS relation
    JOIN canonical.relations AS raw_relation USING (relation_id)
    UNION ALL
    SELECT 'canonical.commits', commit.commit_id::text,
           commit.disposition, to_jsonb(raw_commit)
    FROM commit_rows AS commit
    JOIN canonical.commits AS raw_commit USING (commit_id)
    UNION ALL
    SELECT 'canonical.revisions', revision.revision_id,
           commit.disposition, to_jsonb(revision)
    FROM canonical.revisions AS revision
    JOIN commit_rows AS commit USING (commit_id)
    WHERE revision.project_id = p_target_project_id
    UNION ALL
    SELECT 'canonical.history_events', event.history_event_id,
           commit.disposition, to_jsonb(event)
    FROM canonical.history_events AS event
    JOIN commit_rows AS commit USING (commit_id)
    WHERE event.project_id = p_target_project_id
    UNION ALL
    SELECT 'canonical.outbox', outbox.outbox_id,
           commit.disposition, to_jsonb(outbox)
    FROM canonical.outbox AS outbox
    JOIN commit_rows AS commit ON commit.commit_id = outbox.aggregate_id
    WHERE outbox.project_id = p_target_project_id
    UNION ALL
    SELECT 'canonical.relation_precursors',
           precursor.review_resource_id || ':' || precursor.review_resource_revision::text,
           relation.disposition, to_jsonb(precursor)
    FROM canonical.relation_precursors AS precursor
    JOIN relation_rows AS relation ON relation.relation_id = precursor.relation_id
    WHERE precursor.project_id = p_target_project_id
    UNION ALL
    SELECT 'canonical.history_payload_state', state.source_event_kind || ':' || state.source_event_id,
           commit.disposition, to_jsonb(state)
    FROM canonical.history_payload_state AS state
    JOIN canonical.history_events AS event
      ON event.project_id = state.resource_project_id
     AND event.history_event_id = state.source_event_id
     AND event.event_json->>'eventType' = state.source_event_kind
    JOIN commit_rows AS commit USING (commit_id)
    WHERE state.resource_project_id = p_target_project_id
    UNION ALL
    SELECT 'canonical.history_payload_audit_events', audit.audit_event_id,
           commit.disposition, to_jsonb(audit)
    FROM canonical.history_payload_audit_events AS audit
    JOIN canonical.history_events AS event
      ON event.project_id = audit.resource_project_id
     AND event.history_event_id = audit.source_event_id
     AND event.event_json->>'eventType' = audit.source_event_kind
    JOIN commit_rows AS commit USING (commit_id)
    WHERE audit.resource_project_id = p_target_project_id
    UNION ALL
    SELECT 'canonical.history_payload_state', state.source_event_kind || ':' || state.source_event_id,
           'UNKNOWN', to_jsonb(state)
    FROM canonical.history_payload_state AS state
    WHERE state.resource_project_id = p_target_project_id
      AND NOT EXISTS (
        SELECT 1 FROM canonical.history_events AS event
        WHERE event.project_id = state.resource_project_id
          AND event.history_event_id = state.source_event_id
          AND event.event_json->>'eventType' = state.source_event_kind
      )
    UNION ALL
    SELECT 'canonical.history_payload_audit_events', audit.audit_event_id,
           'UNKNOWN', to_jsonb(audit)
    FROM canonical.history_payload_audit_events AS audit
    WHERE audit.resource_project_id = p_target_project_id
      AND NOT EXISTS (
        SELECT 1 FROM canonical.history_events AS event
        WHERE event.project_id = audit.resource_project_id
          AND event.history_event_id = audit.source_event_id
          AND event.event_json->>'eventType' = audit.source_event_kind
      )
    UNION ALL
    SELECT 'canonical.project_state', state.project_id,
           CASE
             WHEN state.version >= 0 THEN 'PRESERVE'
             ELSE 'UNKNOWN'
           END,
           to_jsonb(state)
    FROM canonical.project_state AS state
    WHERE state.project_id = p_target_project_id
    UNION ALL
    SELECT 'canonical.knowledge_reset_events', event.event_id::text,
           'PRESERVE', to_jsonb(event)
    FROM canonical.knowledge_reset_events AS event
    WHERE event.project_id = p_target_project_id
  )
  SELECT row.relation_name, row.row_id, row.disposition,
         encode(pg_catalog.sha256(convert_to(row.row_data::text, 'UTF8')), 'hex')
  FROM rows AS row
  UNION ALL
  SELECT 'canonical.project_state', p_target_project_id, 'UNKNOWN',
         encode(pg_catalog.sha256(convert_to('missing-project-state', 'UTF8')), 'hex')
  WHERE NOT EXISTS (
    SELECT 1 FROM canonical.project_state AS state
    WHERE state.project_id = p_target_project_id
  ) AND EXISTS (
    SELECT 1 FROM canonical.claims AS claim WHERE claim.project_id = p_target_project_id
    UNION ALL
    SELECT 1 FROM canonical.relations AS relation WHERE relation.project_id = p_target_project_id
    UNION ALL
    SELECT 1 FROM canonical.commits AS commit WHERE commit.project_id = p_target_project_id
  )
$$;

ALTER FUNCTION canonical.t3_classify_project_content(text) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION canonical.t3_classify_project_content(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION canonical.t3_project_canonical_impact(
  p_target_project_id text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, canonical
AS $$
  WITH classified AS MATERIALIZED (
    SELECT * FROM canonical.t3_classify_project_content(p_target_project_id)
  ), aggregate AS (
    SELECT count(*) FILTER (WHERE disposition = 'SOURCE_DERIVED')::integer AS derived_count,
           count(*) FILTER (WHERE disposition = 'UNKNOWN')::integer AS unknown_count,
           count(*) FILTER (WHERE disposition = 'REDACTED')::integer AS redacted_count,
           encode(pg_catalog.sha256(convert_to(
             COALESCE(string_agg(
               relation_name || E'\t' || row_id || E'\t' || disposition || E'\t' || row_fingerprint,
               E'\n' ORDER BY relation_name, row_id, disposition
             ), ''), 'UTF8')), 'hex') AS fingerprint
    FROM classified
  )
  SELECT jsonb_build_object(
    'sourceDerivedRecordCount', aggregate.derived_count,
    'unclassifiedRecordCount', aggregate.unknown_count,
    'redactedIdentityCount', aggregate.redacted_count,
    'activeOutboxCount', (
      SELECT count(*)::integer FROM canonical.outbox AS outbox
      WHERE outbox.project_id = p_target_project_id
        AND outbox.status IN ('pending', 'processing')
    ),
    'canonicalVersion', COALESCE((
      SELECT state.version FROM canonical.project_state AS state
      WHERE state.project_id = p_target_project_id
    ), 0),
    'canonicalSnapshotDigest', (
      SELECT state.snapshot_digest FROM canonical.project_state AS state
      WHERE state.project_id = p_target_project_id
    ),
    'fingerprint', aggregate.fingerprint
  )
  FROM aggregate
$$;
ALTER FUNCTION canonical.t3_project_canonical_impact(text) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION canonical.t3_project_canonical_impact(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION canonical.t3_project_canonical_impact(text) TO shotgun_runtime;

CREATE OR REPLACE FUNCTION canonical.t3_project_canonical_status(
  p_target_project_id text,
  p_reset_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, canonical, project_admin
AS $$
DECLARE
  status jsonb;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM project_admin.project_knowledge_reset_requests AS request
    WHERE request.project_id = p_target_project_id
      AND request.request_id = p_reset_request_id
  ) THEN
    RAISE EXCEPTION 'Canonical reset request is missing'
      USING ERRCODE = '55000', CONSTRAINT = 't3_canonical_snapshot_missing';
  END IF;
  status := canonical.t3_project_canonical_impact(p_target_project_id);
  RETURN status || jsonb_build_object(
    'resetEventCount', (
      SELECT count(*)::integer FROM canonical.knowledge_reset_events AS event
      WHERE event.project_id = p_target_project_id
        AND event.request_id = p_reset_request_id
    ),
    'resetEventStateVersion', (
      SELECT event.state_version FROM canonical.knowledge_reset_events AS event
      WHERE event.project_id = p_target_project_id
        AND event.request_id = p_reset_request_id
    ),
    'resetEventEmptyDigest', (
      SELECT event.empty_knowledge_digest FROM canonical.knowledge_reset_events AS event
      WHERE event.project_id = p_target_project_id
        AND event.request_id = p_reset_request_id
    ),
    'resetEventManifestDigest', (
      SELECT event.manifest_digest FROM canonical.knowledge_reset_events AS event
      WHERE event.project_id = p_target_project_id
        AND event.request_id = p_reset_request_id
    )
  );
END
$$;
ALTER FUNCTION canonical.t3_project_canonical_status(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION canonical.t3_project_canonical_status(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION canonical.t3_snapshot_project_canonical(
  p_target_project_id text,
  p_reset_request_id uuid,
  p_manifest_digest text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, canonical, project_admin
AS $$
DECLARE
  request_row project_admin.project_knowledge_reset_requests%ROWTYPE;
  impact jsonb;
  current_version integer;
  current_digest text;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;

  SELECT * INTO request_row
  FROM project_admin.project_knowledge_reset_requests AS request
  WHERE request.project_id = p_target_project_id
    AND request.request_id = p_reset_request_id
  FOR UPDATE;
  IF NOT FOUND OR request_row.state NOT IN (
    'FENCING', 'PURGING', 'REBUILDING', 'VERIFYING',
    'OUTCOME_UNKNOWN', 'ERASURE_UNVERIFIED'
  ) OR request_row.manifest_digest <> p_manifest_digest
     OR request_row.owner_manifest_digest IS NULL
     OR request_row.resulting_knowledge_epoch IS NULL THEN
    RAISE EXCEPTION 'Canonical reset approval is missing or stale'
      USING ERRCODE = '55000', CONSTRAINT = 't3_canonical_snapshot_missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM canonical.knowledge_reset_events AS event
    WHERE event.project_id = p_target_project_id
      AND event.request_id = p_reset_request_id
      AND event.manifest_digest <> p_manifest_digest
  ) THEN
    RAISE EXCEPTION 'Canonical reset event belongs to a different approved manifest'
      USING ERRCODE = '55000', CONSTRAINT = 't3_canonical_reset_event_manifest_stale';
  END IF;

  IF EXISTS (
    SELECT 1 FROM canonical.knowledge_reset_events AS event
    WHERE event.project_id = p_target_project_id
      AND event.request_id = p_reset_request_id
      AND event.manifest_digest = p_manifest_digest
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM canonical.t3_reset_owner_snapshots AS snapshot
    WHERE snapshot.project_id = p_target_project_id
      AND snapshot.request_id = p_reset_request_id
  ) THEN
    RETURN;
  END IF;

  impact := canonical.t3_project_canonical_impact(p_target_project_id);
  IF (impact->>'unclassifiedRecordCount')::integer > 0 THEN
    RAISE EXCEPTION 'Canonical source lineage is incomplete'
      USING ERRCODE = '55000', CONSTRAINT = 't3_canonical_unclassified';
  END IF;
  IF (impact->>'activeOutboxCount')::integer > 0 THEN
    RAISE EXCEPTION 'Canonical outbox delivery is still active'
      USING ERRCODE = '55000', CONSTRAINT = 'active_job_outcome_unknown';
  END IF;

  SELECT state.version, state.snapshot_digest
    INTO current_version, current_digest
  FROM canonical.project_state AS state
  WHERE state.project_id = p_target_project_id
  FOR SHARE;
  IF NOT FOUND THEN
    current_version := 0;
    current_digest := 'sha256:' || encode(pg_catalog.sha256(convert_to(
      '{"claims":[],"projectId":' || to_json(p_target_project_id)::text || ',"version":0}',
      'UTF8'
    )), 'hex');
  END IF;
  IF EXISTS (
    SELECT 1 FROM canonical.knowledge_reset_events AS event
    WHERE event.project_id = p_target_project_id
      AND event.state_version >= current_version + 1
  ) THEN
    RAISE EXCEPTION 'Canonical state version is behind its reset event history'
      USING ERRCODE = '55000', CONSTRAINT = 't3_canonical_state_version_stale';
  END IF;

  INSERT INTO canonical.t3_reset_owner_snapshots (
    project_id, request_id, manifest_digest, owner_manifest_digest,
    canonical_version, canonical_snapshot_digest, canonical_impact_fingerprint
  ) VALUES (
    p_target_project_id, p_reset_request_id, p_manifest_digest,
    request_row.owner_manifest_digest, current_version, current_digest,
    impact->>'fingerprint'
  );

  INSERT INTO canonical.t3_reset_owner_snapshot_rows (
    project_id, request_id, row_kind, row_id
  )
  SELECT p_target_project_id, p_reset_request_id,
         CASE classified.relation_name
           WHEN 'canonical.claims' THEN 'claim'
           WHEN 'canonical.relations' THEN 'relation'
           WHEN 'canonical.commits' THEN 'commit'
           WHEN 'canonical.revisions' THEN 'revision'
           WHEN 'canonical.history_events' THEN 'history'
           WHEN 'canonical.outbox' THEN 'outbox'
           WHEN 'canonical.relation_precursors' THEN 'relation_precursor'
           WHEN 'canonical.history_payload_state' THEN 'history_payload_state'
           WHEN 'canonical.history_payload_audit_events' THEN 'history_payload_audit'
         END,
         classified.row_id
  FROM canonical.t3_classify_project_content(p_target_project_id) AS classified
  WHERE classified.disposition = 'SOURCE_DERIVED'
    AND classified.relation_name <> 'canonical.project_state'
    AND classified.relation_name <> 'canonical.knowledge_reset_events';
END
$$;
ALTER FUNCTION canonical.t3_snapshot_project_canonical(text, uuid, text)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION canonical.t3_snapshot_project_canonical(text, uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION canonical.t3_erase_project_canonical(
  p_target_project_id text,
  p_reset_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, canonical, project_admin
AS $$
DECLARE
  snapshot_row canonical.t3_reset_owner_snapshots%ROWTYPE;
  request_row project_admin.project_knowledge_reset_requests%ROWTYPE;
  resulting_version integer;
  empty_digest text;
  marker jsonb := jsonb_build_object(
    'policy', 'T3_PROJECT_SOURCE_KNOWLEDGE_RESET',
    'identityOnly', true
  );
  audit_reason text := 'Source knowledge reset';
  audit_actor text := 't3-source-reset';
  audit_policy text := 't3-project-source-knowledge-reset:v1';
BEGIN
  PERFORM set_config('shotgun.t3_reset_request_id', p_reset_request_id::text, true);
  IF session_user <> 'shotgun_erasure_executor'
     OR NOT project_admin.t3_reset_write_authorized(p_target_project_id) THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;

  SELECT * INTO request_row
  FROM project_admin.project_knowledge_reset_requests AS request
  WHERE request.project_id = p_target_project_id
    AND request.request_id = p_reset_request_id
  FOR UPDATE;
  IF NOT FOUND OR request_row.state NOT IN ('PURGING', 'REBUILDING', 'VERIFYING')
     OR request_row.owner_manifest_digest IS NULL
     OR request_row.resulting_knowledge_epoch IS NULL THEN
    RAISE EXCEPTION 'Canonical reset approval is missing'
      USING ERRCODE = '55000', CONSTRAINT = 't3_canonical_snapshot_missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM canonical.knowledge_reset_events AS event
    WHERE event.project_id = p_target_project_id
      AND event.request_id = p_reset_request_id
      AND event.manifest_digest = request_row.manifest_digest
  ) THEN
    RETURN;
  END IF;

  SELECT * INTO snapshot_row
  FROM canonical.t3_reset_owner_snapshots AS snapshot
  WHERE snapshot.project_id = p_target_project_id
    AND snapshot.request_id = p_reset_request_id
  FOR UPDATE;
  IF NOT FOUND OR snapshot_row.manifest_digest <> request_row.manifest_digest
     OR snapshot_row.owner_manifest_digest <> request_row.owner_manifest_digest THEN
    RAISE EXCEPTION 'Canonical reset snapshot is missing or stale'
      USING ERRCODE = '55000', CONSTRAINT = 't3_canonical_snapshot_missing';
  END IF;

  SELECT state.version, state.snapshot_digest
    INTO resulting_version, empty_digest
  FROM canonical.project_state AS state
  WHERE state.project_id = p_target_project_id
  FOR UPDATE;
  IF FOUND THEN
    IF resulting_version <> snapshot_row.canonical_version
       OR empty_digest <> snapshot_row.canonical_snapshot_digest THEN
      RAISE EXCEPTION 'Canonical state changed after approved reset snapshot'
        USING ERRCODE = '55000', CONSTRAINT = 't3_canonical_state_version_stale';
    END IF;
  ELSE
    IF snapshot_row.canonical_version <> 0 THEN
      RAISE EXCEPTION 'Canonical state disappeared after approved reset snapshot'
        USING ERRCODE = '55000', CONSTRAINT = 't3_canonical_state_version_stale';
    END IF;
    resulting_version := 0;
  END IF;
  IF resulting_version = 2147483647 THEN
    RAISE EXCEPTION 'Canonical version is exhausted'
      USING ERRCODE = '22003', CONSTRAINT = 't3_canonical_state_version_exhausted';
  END IF;
  resulting_version := resulting_version + 1;
  IF EXISTS (
    SELECT 1 FROM canonical.knowledge_reset_events AS event
    WHERE event.project_id = p_target_project_id
      AND event.state_version >= resulting_version
  ) THEN
    RAISE EXCEPTION 'Canonical reset version is not monotonic'
      USING ERRCODE = '55000', CONSTRAINT = 't3_canonical_state_version_stale';
  END IF;
  empty_digest := 'sha256:' || encode(pg_catalog.sha256(convert_to(
    '{"claims":[],"projectId":' || to_json(p_target_project_id)::text ||
    ',"version":' || resulting_version::text || '}',
    'UTF8'
  )), 'hex');

  DELETE FROM canonical.relation_precursors AS precursor
  WHERE precursor.project_id = p_target_project_id
    AND EXISTS (
      SELECT 1 FROM canonical.t3_reset_owner_snapshot_rows AS row
      WHERE row.project_id = p_target_project_id
        AND row.request_id = p_reset_request_id
        AND row.row_kind = 'relation'
        AND row.row_id = precursor.relation_id
    );

  DELETE FROM canonical.claims AS claim
  WHERE claim.project_id = p_target_project_id
    AND EXISTS (
      SELECT 1 FROM canonical.t3_reset_owner_snapshot_rows AS row
      WHERE row.project_id = p_target_project_id
        AND row.request_id = p_reset_request_id
        AND row.row_kind = 'claim'
        AND row.row_id = claim.claim_id
    );

  DELETE FROM canonical.relations AS relation
  WHERE relation.project_id = p_target_project_id
    AND EXISTS (
      SELECT 1 FROM canonical.t3_reset_owner_snapshot_rows AS row
      WHERE row.project_id = p_target_project_id
        AND row.request_id = p_reset_request_id
        AND row.row_kind = 'relation'
        AND row.row_id = relation.relation_id
    );

  UPDATE canonical.commits AS commit
  SET manifest_id = NULL,
      manifest_digest = NULL,
      change_set_id = NULL,
      authority_id = NULL,
      authority_digest = NULL,
      result_json = jsonb_strip_nulls(jsonb_build_object(
        'commitId', commit.commit_id,
        'projectId', commit.project_id,
        'operation', commit.result_json->>'operation',
        'status', commit.result_json->>'status',
        'beforeVersion', commit.result_json->'beforeVersion',
        'afterVersion', commit.result_json->'afterVersion',
        'revisionId', commit.result_json->'revisionId',
        'historyEventId', commit.result_json->'historyEventId',
        'outboxId', commit.result_json->'outboxId',
        'committedAt', commit.committed_at,
        'erasurePolicy', 'T3_PROJECT_SOURCE_KNOWLEDGE_RESET',
        'resetEventId', p_reset_request_id
      ))
  WHERE commit.project_id = p_target_project_id
    AND EXISTS (
      SELECT 1 FROM canonical.t3_reset_owner_snapshot_rows AS row
      WHERE row.project_id = p_target_project_id
        AND row.request_id = p_reset_request_id
        AND row.row_kind = 'commit'
        AND row.row_id = commit.commit_id::text
    );

  UPDATE canonical.revisions AS revision
  SET revision_json = jsonb_build_object(
        'revisionId', revision.revision_id,
        'projectId', revision.project_id,
        'commitId', revision.commit_id,
        'operation', revision.revision_json->>'operation',
        'beforeVersion', revision.revision_json->'beforeVersion',
        'afterVersion', revision.revision_json->'afterVersion',
        'reason', audit_reason,
        'actor', jsonb_build_object('type', 'system', 'id', audit_actor),
        'createdAt', revision.created_at,
        'erasurePolicy', 'T3_PROJECT_SOURCE_KNOWLEDGE_RESET',
        'resetEventId', p_reset_request_id
      )
  WHERE revision.project_id = p_target_project_id
    AND EXISTS (
      SELECT 1 FROM canonical.t3_reset_owner_snapshot_rows AS row
      WHERE row.project_id = p_target_project_id
        AND row.request_id = p_reset_request_id
        AND row.row_kind = 'revision'
        AND row.row_id = revision.revision_id
    );

  UPDATE canonical.history_events AS event
  SET event_json = jsonb_build_object(
        'historyEventId', event.history_event_id,
        'projectId', event.project_id,
        'commitId', event.commit_id,
        'manifestId', NULL::text,
        'changeSetId', NULL::text,
        'eventType', event.event_json->>'eventType',
        'beforeVersion', event.event_json->'beforeVersion',
        'afterVersion', event.event_json->'afterVersion',
        'reason', audit_reason,
        'actor', jsonb_build_object('type', 'system', 'id', audit_actor),
        'createdAt', event.created_at
      )
  WHERE event.project_id = p_target_project_id
    AND EXISTS (
      SELECT 1 FROM canonical.t3_reset_owner_snapshot_rows AS row
      WHERE row.project_id = p_target_project_id
        AND row.request_id = p_reset_request_id
        AND row.row_kind = 'history'
        AND row.row_id = event.history_event_id
    );

  UPDATE canonical.outbox AS outbox
  SET payload_json = jsonb_build_object(
        'commitId', outbox.aggregate_id,
        'operation', 'NO_OP',
        'status', 'NO_OP',
        'canonicalVersion', resulting_version,
        'actorId', audit_actor,
        'accessScope', '[]'::jsonb,
        'sensitivity', 'private',
        'erasurePolicy', 'T3_PROJECT_SOURCE_KNOWLEDGE_RESET',
        'resetEventId', p_reset_request_id
      ),
      last_error = NULL,
      claimed_at = NULL
  WHERE outbox.project_id = p_target_project_id
    AND EXISTS (
      SELECT 1 FROM canonical.t3_reset_owner_snapshot_rows AS row
      WHERE row.project_id = p_target_project_id
        AND row.request_id = p_reset_request_id
        AND row.row_kind = 'outbox'
        AND row.row_id = outbox.outbox_id
    );

  UPDATE canonical.history_payload_audit_events AS audit
  SET tombstone_metadata = marker,
      policy_revision = audit_policy,
      reason = audit_reason,
      actor_id = audit_actor
  WHERE audit.resource_project_id = p_target_project_id
    AND EXISTS (
      SELECT 1 FROM canonical.t3_reset_owner_snapshot_rows AS row
      WHERE row.project_id = p_target_project_id
        AND row.request_id = p_reset_request_id
        AND row.row_kind = 'history_payload_audit'
        AND row.row_id = audit.audit_event_id
    );

  INSERT INTO canonical.history_payload_audit_events (
    audit_event_id, resource_project_id, source_event_kind, source_event_id,
    previous_availability, new_availability, tombstone_metadata, policy_revision,
    reason, actor_id, occurred_at
  )
  SELECT 't3-source-reset:' || p_reset_request_id::text || ':' || event.history_event_id,
         event.project_id,
         event.event_json->>'eventType',
         event.history_event_id,
         COALESCE(state.payload_availability, 'AVAILABLE'),
         'PURGED_BY_POLICY', marker, audit_policy, audit_reason, audit_actor, now()
  FROM canonical.history_events AS event
  LEFT JOIN canonical.history_payload_state AS state
    ON state.resource_project_id = event.project_id
   AND state.source_event_kind = event.event_json->>'eventType'
   AND state.source_event_id = event.history_event_id
  WHERE event.project_id = p_target_project_id
    AND EXISTS (
      SELECT 1 FROM canonical.t3_reset_owner_snapshot_rows AS row
      WHERE row.project_id = p_target_project_id
        AND row.request_id = p_reset_request_id
        AND row.row_kind = 'history'
        AND row.row_id = event.history_event_id
    )
    AND COALESCE(state.payload_availability, 'AVAILABLE') <> 'PURGED_BY_POLICY'
  ON CONFLICT (audit_event_id) DO NOTHING;

  INSERT INTO canonical.history_payload_state (
    resource_project_id, source_event_kind, source_event_id,
    payload_availability, tombstone_metadata, changed_at, reason, policy_revision
  )
  SELECT event.project_id, event.event_json->>'eventType', event.history_event_id,
         'PURGED_BY_POLICY', marker, now(), audit_reason, audit_policy
  FROM canonical.history_events AS event
  WHERE event.project_id = p_target_project_id
    AND EXISTS (
      SELECT 1 FROM canonical.t3_reset_owner_snapshot_rows AS row
      WHERE row.project_id = p_target_project_id
        AND row.request_id = p_reset_request_id
        AND row.row_kind = 'history'
        AND row.row_id = event.history_event_id
    )
  ON CONFLICT (resource_project_id, source_event_kind, source_event_id)
  DO UPDATE SET payload_availability = 'PURGED_BY_POLICY',
                tombstone_metadata = EXCLUDED.tombstone_metadata,
                changed_at = EXCLUDED.changed_at,
                reason = EXCLUDED.reason,
                policy_revision = EXCLUDED.policy_revision;

  IF EXISTS (
    SELECT 1 FROM canonical.project_state AS state
    WHERE state.project_id = p_target_project_id
  ) THEN
    UPDATE canonical.project_state
    SET version = resulting_version,
        snapshot_digest = empty_digest,
        updated_at = now()
    WHERE project_id = p_target_project_id;
  ELSE
    INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
    VALUES (p_target_project_id, resulting_version, empty_digest, now());
  END IF;

  INSERT INTO canonical.knowledge_reset_events (
    event_id, request_id, project_id, resulting_knowledge_epoch,
    manifest_digest, empty_knowledge_digest, state_version, created_at, published_at
  ) VALUES (
    p_reset_request_id, p_reset_request_id, p_target_project_id,
    request_row.resulting_knowledge_epoch, request_row.manifest_digest,
    empty_digest, resulting_version, now(), NULL
  );

  DELETE FROM canonical.t3_reset_owner_snapshots AS snapshot
  WHERE snapshot.project_id = p_target_project_id
    AND snapshot.request_id = p_reset_request_id;
END
$$;
ALTER FUNCTION canonical.t3_erase_project_canonical(text, uuid) OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION canonical.t3_erase_project_canonical(text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION canonical.t3_project_canonical_status(text, uuid),
  canonical.t3_snapshot_project_canonical(text, uuid, text),
  canonical.t3_erase_project_canonical(text, uuid)
  TO shotgun_erasure_executor;

-- A fence failure occurs before any content mutation. Discard the opaque
-- Canonical owner snapshot so it cannot become a durable source identifier
-- inventory on a blocked request.
CREATE OR REPLACE FUNCTION canonical.t3_discard_pre_purge_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, canonical
AS $$
BEGIN
  IF NEW.state = 'BLOCKED'
     AND COALESCE(NEW.step_checkpoints->>'purge:canonical', 'false') <> 'true' THEN
    DELETE FROM canonical.t3_reset_owner_snapshots AS snapshot
    WHERE snapshot.project_id = NEW.project_id
      AND snapshot.request_id = NEW.request_id;
  END IF;
  RETURN NEW;
END
$$;
ALTER FUNCTION canonical.t3_discard_pre_purge_snapshot() OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION canonical.t3_discard_pre_purge_snapshot() FROM PUBLIC;
DROP TRIGGER IF EXISTS t3_canonical_discard_pre_purge_snapshot
  ON project_admin.project_knowledge_reset_requests;
CREATE TRIGGER t3_canonical_discard_pre_purge_snapshot
  AFTER UPDATE OF state ON project_admin.project_knowledge_reset_requests
  FOR EACH ROW EXECUTE FUNCTION canonical.t3_discard_pre_purge_snapshot();

GRANT EXECUTE ON FUNCTION canonical.t3_discard_pre_purge_snapshot()
  TO shotgun_schema_owner;
