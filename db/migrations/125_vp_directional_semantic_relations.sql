DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1 FROM runtime.schema_migrations
     WHERE name = '124_vp_empty_batch_epoch.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 125 preflight failed: migration 124 is not registered';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'vp.relations'::regclass
       AND conname = 'relations_relation_kind_check'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'vp.decision_receipts'::regclass
       AND conname = 'decision_receipts_outcome_check'
  ) THEN
    RAISE EXCEPTION 'Migration 125 preflight failed: expected VP relation constraints are missing';
  END IF;
END
$$;

-- Pair IDs remain sorted stable identities. Direction gives semantic edges an
-- explicit source-to-target orientation without changing their identity.
ALTER TABLE vp.relations
  ADD COLUMN relation_direction text NOT NULL DEFAULT 'UNDIRECTED'
    CHECK (relation_direction IN ('UNDIRECTED', 'LEFT_TO_RIGHT', 'RIGHT_TO_LEFT'));

ALTER TABLE vp.relations
  DROP CONSTRAINT relations_relation_kind_check,
  ADD CONSTRAINT relations_relation_kind_check
    CHECK (relation_kind IN ('EQUIVALENT', 'SUPPORTS', 'QUALIFIES', 'CONTRADICTS', 'RELATED')),
  ADD CONSTRAINT vp_relations_direction_matches_kind_check
    CHECK (
      (relation_kind IN ('SUPPORTS', 'QUALIFIES')
        AND relation_direction IN ('LEFT_TO_RIGHT', 'RIGHT_TO_LEFT'))
      OR
      (relation_kind IN ('EQUIVALENT', 'CONTRADICTS', 'RELATED')
        AND relation_direction = 'UNDIRECTED')
    );

ALTER TABLE vp.decision_receipts
  DROP CONSTRAINT decision_receipts_outcome_check,
  ADD CONSTRAINT decision_receipts_outcome_check
    CHECK (outcome IN ('EQUIVALENT', 'SUPPORTS', 'QUALIFIES', 'CONTRADICTS', 'RELATED', 'UNRESOLVED'));
