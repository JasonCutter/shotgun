-- Additive FE-P5-S2 WP5 (Round 2 B): owning-Domain Reversal persistence.
-- Bounded additive migration ONLY.
--
-- A Reversal DraftChangeSet cannot be represented as the frozen
-- `review.change_sets` `DraftChangeSet` row (mandatory candidate_id /
-- comparison_id FK rows that a Reversal does not have, plus
-- revision_number = 1 CHECK and operation enum). The owning change-set-review
-- store therefore persists Reversal DraftChangeSets as a dedicated additive
-- record set. The full V1 contract object is stored as a JSONB snapshot
-- (same pattern as change_sets.change_set_json) so the strict decoder remains
-- the single source of truth for shape.

DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '032_frontend_payload_policy_history.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 033 preflight failed: 032 is missing';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS review.reversals (
  reversal_id text PRIMARY KEY,
  project_id text NOT NULL,
  reversal_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reversals_project_created_idx
  ON review.reversals (project_id, created_at, reversal_id);
