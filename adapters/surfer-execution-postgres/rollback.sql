-- Isolated rehearsal only. Quiesce all workers and preserve snapshots before rollback.
DROP TABLE IF EXISTS surfer_execution.budget_state;
DROP SCHEMA IF EXISTS surfer_execution;
