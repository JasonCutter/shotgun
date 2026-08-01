ALTER TABLE frontend_ask.answer_run_attempts
  ADD COLUMN IF NOT EXISTS resolved_sensitivity text NOT NULL DEFAULT 'public';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'frontend_ask_answer_run_attempts_sensitivity_check'
      AND conrelid = 'frontend_ask.answer_run_attempts'::regclass
  ) THEN
    ALTER TABLE frontend_ask.answer_run_attempts
      ADD CONSTRAINT frontend_ask_answer_run_attempts_sensitivity_check
      CHECK (resolved_sensitivity IN ('public', 'internal', 'private', 'restricted'));
  END IF;
END
$$;
