-- A completed empty/rejected Candidate batch changes the active knowledge
-- projection even when it creates no assertion rows. Record that transition.
ALTER TABLE candidate.batches
  ADD CONSTRAINT candidate_batches_project_batch_source_version_unique
    UNIQUE (project_id, batch_id, source_version_id);

ALTER TABLE vp.history_events
  ALTER COLUMN assertion_id DROP NOT NULL,
  ADD COLUMN source_version_id uuid,
  ADD COLUMN batch_id uuid,
  DROP CONSTRAINT history_events_event_kind_check,
  ADD CONSTRAINT history_events_event_kind_check
    CHECK (event_kind IN (
      'DIRECT_ASSERTION_RECORDED',
      'SEMANTIC_RELATION_RECORDED',
      'SOURCE_BATCH_ACTIVATED'
    )),
  ADD CONSTRAINT history_events_source_batch_shape_check
    CHECK (
      (event_kind = 'SOURCE_BATCH_ACTIVATED'
        AND assertion_id IS NULL
        AND cardinality(relation_ids) = 0
        AND source_version_id IS NOT NULL
        AND batch_id IS NOT NULL)
      OR
      (event_kind IN ('DIRECT_ASSERTION_RECORDED', 'SEMANTIC_RELATION_RECORDED')
        AND assertion_id IS NOT NULL
        AND source_version_id IS NULL
        AND batch_id IS NULL)
    ),
  ADD CONSTRAINT history_events_source_batch_fk
    FOREIGN KEY (project_id, batch_id, source_version_id)
    REFERENCES candidate.batches (project_id, batch_id, source_version_id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX vp_history_source_batch_activation_unique
  ON vp.history_events (project_id, batch_id)
  WHERE event_kind = 'SOURCE_BATCH_ACTIVATED';
