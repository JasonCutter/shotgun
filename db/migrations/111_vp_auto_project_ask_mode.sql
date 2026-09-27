-- VP-1 adds the automatic project knowledge question mode without changing
-- the meaning of historical Ask runs.
ALTER TABLE frontend_ask.turns
  DROP CONSTRAINT turns_ask_mode_check;
ALTER TABLE frontend_ask.turns
  ADD CONSTRAINT frontend_ask_turns_ask_mode_check
  CHECK (ask_mode IN (
    'AUTO_PROJECT_KNOWLEDGE', 'CANONICAL_ONLY', 'SOURCE_EXPLORATION', 'HYBRID'
  ));

ALTER TABLE frontend_ask.answer_runs
  DROP CONSTRAINT answer_runs_mode_check;
ALTER TABLE frontend_ask.answer_runs
  ADD CONSTRAINT frontend_ask_answer_runs_mode_check
  CHECK (mode IN (
    'AUTO_PROJECT_KNOWLEDGE', 'CANONICAL_ONLY', 'SOURCE_EXPLORATION', 'HYBRID'
  ));
