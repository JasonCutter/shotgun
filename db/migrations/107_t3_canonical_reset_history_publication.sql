DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1 FROM runtime.schema_migrations
    WHERE name = '106_t3_settings_erasure.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 107 preflight failed: migration 106 is not registered';
  END IF;
END
$$;

-- Canonical reset identity stays authoritative in Canonical. Product History
-- receives a bounded read through this function; the event payload itself
-- contains only reset/audit metadata and no erased Source content.
CREATE OR REPLACE FUNCTION canonical.t3_list_project_knowledge_reset_events(
  target_project_id text
)
RETURNS TABLE (
  event_id uuid,
  request_id uuid,
  project_id text,
  actor_principal_id text,
  resulting_knowledge_epoch bigint,
  manifest_digest text,
  empty_knowledge_digest text,
  state_version bigint,
  created_at timestamptz,
  published_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, canonical, project_admin
AS $$
  SELECT event.event_id, event.request_id, event.project_id,
         request.actor_principal_id, event.resulting_knowledge_epoch,
         event.manifest_digest, event.empty_knowledge_digest,
         event.state_version, event.created_at, event.published_at
  FROM canonical.knowledge_reset_events AS event
  JOIN project_admin.project_knowledge_reset_requests AS request
    ON request.project_id = event.project_id AND request.request_id = event.request_id
  WHERE event.project_id = target_project_id
  ORDER BY event.created_at, event.event_id
$$;
ALTER FUNCTION canonical.t3_list_project_knowledge_reset_events(text)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION canonical.t3_list_project_knowledge_reset_events(text) FROM PUBLIC;

-- Publication is acknowledged only after the complete canonical History
-- adapter snapshot contains this source identity at its committed revision.
CREATE OR REPLACE FUNCTION canonical.t3_publish_project_knowledge_reset_event(
  target_project_id text,
  reset_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, canonical, frontend_history, project_admin
AS $$
DECLARE
  event_row canonical.knowledge_reset_events%ROWTYPE;
  committed_revision bigint;
BEGIN
  IF session_user <> 'shotgun_erasure_executor' THEN
    RAISE EXCEPTION 'Dedicated erasure executor required'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;

  SELECT * INTO event_row
  FROM canonical.knowledge_reset_events AS event
  WHERE event.project_id = target_project_id AND event.request_id = reset_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical reset event is missing'
      USING ERRCODE = '55000', CONSTRAINT = 't3_canonical_reset_event_missing';
  END IF;
  IF event_row.published_at IS NOT NULL THEN RETURN; END IF;

  PERFORM set_config('shotgun.t3_reset_request_id', reset_request_id::text, true);
  IF NOT project_admin.t3_reset_write_authorized(target_project_id)
     OR NOT EXISTS (
       SELECT 1
       FROM project_admin.project_knowledge_reset_requests AS request
       WHERE request.project_id = target_project_id
         AND request.request_id = reset_request_id
         AND request.state IN ('REBUILDING', 'VERIFYING')
     ) THEN
    RAISE EXCEPTION 'Canonical reset publication is not authorized for this Project'
      USING ERRCODE = '42501', CONSTRAINT = 't3_erasure_executor_required';
  END IF;

  SELECT max(watermark.snapshot_revision)
  INTO committed_revision
  FROM frontend_history.projection_watermarks AS watermark
  WHERE watermark.resource_project_id = target_project_id;

  IF committed_revision IS NULL OR 4 <> (
       SELECT count(DISTINCT watermark.domain_kind)::integer
       FROM frontend_history.projection_watermarks AS watermark
       WHERE watermark.resource_project_id = target_project_id
         AND watermark.snapshot_revision = committed_revision
         AND watermark.domain_kind IN ('CANONICAL', 'REVIEW', 'EXTERNAL_ACTION', 'POLICY')
     ) OR NOT EXISTS (
       SELECT 1
       FROM frontend_history.history_projection_index AS entry
       WHERE entry.resource_project_id = target_project_id
         AND entry.domain_kind = 'CANONICAL'
         AND entry.source_event_kind = 'CANONICAL_KNOWLEDGE_RESET'
         AND entry.source_event_id = event_row.event_id::text
     ) THEN
    RAISE EXCEPTION 'Canonical reset event is not present in committed History'
      USING ERRCODE = '55000', CONSTRAINT = 't3_canonical_reset_history_missing';
  END IF;

  UPDATE canonical.knowledge_reset_events
  SET published_at = now()
  WHERE event_id = event_row.event_id AND published_at IS NULL;
END
$$;
ALTER FUNCTION canonical.t3_publish_project_knowledge_reset_event(text, uuid)
  OWNER TO shotgun_schema_owner;
REVOKE ALL ON FUNCTION canonical.t3_publish_project_knowledge_reset_event(text, uuid)
  FROM PUBLIC;

GRANT USAGE ON SCHEMA canonical TO shotgun_runtime, shotgun_erasure_executor;
GRANT EXECUTE ON FUNCTION canonical.t3_list_project_knowledge_reset_events(text)
  TO shotgun_runtime, shotgun_erasure_executor;
GRANT EXECUTE ON FUNCTION canonical.t3_publish_project_knowledge_reset_event(text, uuid)
  TO shotgun_erasure_executor;
