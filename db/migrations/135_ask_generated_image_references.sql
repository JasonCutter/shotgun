-- Ask owns pinned references/context snapshots, not a second observation authority.
-- Existing text citations and historical statements retain their data and meaning.
ALTER TABLE frontend_ask.statements
  ADD COLUMN generated_observation_references jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(generated_observation_references) = 'array'
         AND jsonb_array_length(generated_observation_references) <= 12);
ALTER TABLE frontend_ask.answer_run_attempts
  ADD COLUMN generated_image_context jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(generated_image_context) = 'array'
         AND jsonb_array_length(generated_image_context) <= 12),
  ADD COLUMN answer_supported boolean;
