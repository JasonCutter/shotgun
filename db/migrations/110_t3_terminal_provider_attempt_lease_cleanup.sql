DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1 FROM runtime.schema_migrations
    WHERE name = '109_t3_provider_output_validation_promotion.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 110 preflight failed: migration 109 is not registered';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'ai' AND table_name = 'provider_attempts'
      AND column_name = 'lease_expires_at'
  ) THEN
    RAISE EXCEPTION 'Migration 110 preflight failed: provider attempt lease column is missing';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM ai.provider_attempts AS attempt
    JOIN ai.provider_calls AS call USING (call_id)
    JOIN project_admin.project_knowledge_epoch AS epoch USING (project_id)
    WHERE attempt.status IN ('succeeded', 'failed')
      AND attempt.finished_at IS NOT NULL
      AND attempt.lease_expires_at IS NOT NULL
      AND epoch.state <> 'READY'
  ) THEN
    RAISE EXCEPTION
      'Migration 110 cannot normalize terminal Provider leases while a Project reset is fenced';
  END IF;
END
$$;

-- A finished Provider attempt is terminal even when an older adapter build left
-- its lease timestamp populated. Normalize that obsolete lease so impact and
-- executor checks observe the same terminal state as the Stage 4 repository.
UPDATE ai.provider_attempts AS attempt
SET lease_expires_at = NULL
FROM ai.provider_calls AS call
WHERE call.call_id = attempt.call_id
  AND attempt.status IN ('succeeded', 'failed')
  AND attempt.finished_at IS NOT NULL
  AND attempt.lease_expires_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM project_admin.project_knowledge_epoch AS epoch
    WHERE epoch.project_id = call.project_id AND epoch.state <> 'READY'
  );
