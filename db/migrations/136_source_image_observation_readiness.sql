-- Image readiness points to the typed VP observation; it never manufactures
-- a source Evidence indexing result or a positive EvidenceIndexed event.
ALTER TABLE vp.image_observations ADD CONSTRAINT vp_image_observation_progress_lineage_unique
  UNIQUE(project_id,source_id,source_version_id,observation_id);
ALTER TABLE source_product.source_stage3_progress
  ADD COLUMN image_observation_id uuid,
  DROP CONSTRAINT source_stage3_progress_state_check,
  ADD CONSTRAINT source_stage3_progress_state_check CHECK(state IN (
    'MATERIALIZED','STAGE3_RUNNING','STAGE3_COMPLETED','NO_EVIDENCE',
    'STAGE3_RETRYABLE','RECONCILIATION_REQUIRED','IMAGE_OBSERVATION_COMPLETED')),
  ADD CONSTRAINT source_stage3_progress_image_observation_fk
    FOREIGN KEY(project_id,source_id,source_version_id,image_observation_id)
      REFERENCES vp.image_observations(project_id,source_id,source_version_id,observation_id) ON DELETE RESTRICT,
  ADD CONSTRAINT source_stage3_progress_image_observation_state CHECK (
    (state='IMAGE_OBSERVATION_COMPLETED' AND image_observation_id IS NOT NULL AND indexing_result_id IS NULL)
    OR (state<>'IMAGE_OBSERVATION_COMPLETED' AND image_observation_id IS NULL));

CREATE OR REPLACE FUNCTION source_product.enforce_stage3_progress_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed boolean := false;
BEGIN
  IF NEW.state = OLD.state THEN
    allowed := true;
  ELSE
    allowed := CASE OLD.state
      WHEN 'MATERIALIZED' THEN NEW.state IN ('STAGE3_RUNNING','RECONCILIATION_REQUIRED')
      WHEN 'STAGE3_RUNNING' THEN NEW.state IN (
        'STAGE3_COMPLETED','NO_EVIDENCE','STAGE3_RETRYABLE','RECONCILIATION_REQUIRED','IMAGE_OBSERVATION_COMPLETED')
      WHEN 'STAGE3_RETRYABLE' THEN NEW.state IN ('STAGE3_RUNNING','RECONCILIATION_REQUIRED')
      WHEN 'RECONCILIATION_REQUIRED' THEN NEW.state IN ('STAGE3_RUNNING','STAGE3_COMPLETED','NO_EVIDENCE','STAGE3_RETRYABLE')
      WHEN 'STAGE3_COMPLETED' THEN false
      WHEN 'NO_EVIDENCE' THEN false
      WHEN 'IMAGE_OBSERVATION_COMPLETED' THEN false
      ELSE false
    END;
  END IF;
  IF NOT allowed THEN
    RAISE EXCEPTION 'Invalid Source Stage3 transition: % -> %', OLD.state, NEW.state;
  END IF;
  IF OLD.state='IMAGE_OBSERVATION_COMPLETED' AND (
    NEW.image_observation_id IS DISTINCT FROM OLD.image_observation_id
    OR NEW.source_id IS DISTINCT FROM OLD.source_id
    OR NEW.source_version_id IS DISTINCT FROM OLD.source_version_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
  ) THEN
    RAISE EXCEPTION 'Completed image observation readiness binding is immutable';
  END IF;
  NEW.progress_revision := OLD.progress_revision + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$$;
