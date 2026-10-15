-- Explicit isolated acceptance only. Do not relabel any historical Fake row.
-- Fail this migration if pre-existing JSON disagrees with its SQL identity.
ALTER TABLE ai.image_observation_executions
  DROP CONSTRAINT image_observation_executions_execution_mode_check;
ALTER TABLE ai.image_observation_executions
  ADD CONSTRAINT image_observation_executions_execution_mode_check
  CHECK (execution_mode IN ('ISOLATED_FAKE', 'ISOLATED_LIVE_ACCEPTANCE')),
  ADD CONSTRAINT image_observation_execution_transport_binding_check
  CHECK ((
    (execution_mode = 'ISOLATED_FAKE'
      AND COALESCE(record_json->>'transportKind', 'ISOLATED_FAKE') = 'ISOLATED_FAKE'
      AND NOT (record_json ? 'acceptanceId'))
    OR
    (execution_mode = 'ISOLATED_LIVE_ACCEPTANCE'
      AND record_json->>'transportKind' = 'ISOLATED_LIVE_ACCEPTANCE'
      AND jsonb_typeof(record_json->'acceptanceId') = 'string'
      AND length(record_json->>'acceptanceId') > 0)
  ) IS TRUE);
