-- AKP-4 WP2: PostgreSQL authority for immutable Canonical trigger identity.
-- Rollback: DROP INDEX IF EXISTS discovery_jobs_canonical_trigger_identity_idx;
CREATE UNIQUE INDEX discovery_jobs_canonical_trigger_identity_idx
  ON discovery.jobs (
    project_id,
    (trigger->'triggerIdentity'->>'eventId'),
    (trigger->'triggerIdentity'->>'eventRevision')
  )
  WHERE trigger_class = 'CANONICAL_COMMITTED';
