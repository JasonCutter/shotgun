ALTER TABLE ai.provider_calls
  ADD COLUMN IF NOT EXISTS execution_identity jsonb;
