-- TS-1 / Phase B: pin Candidate generation to the exact Stage 3 revision.
-- Existing rows remain readable and updateable while new Candidate lineage is
-- fail-closed.  No historical row is guessed or silently backfilled here.

ALTER TABLE transformation.revisions
  ADD CONSTRAINT transformation_revisions_project_source_version_revision_key
  UNIQUE (project_id, source_version_id, revision_id);

ALTER TABLE ai.provider_calls
  ADD COLUMN IF NOT EXISTS revision_id uuid;

ALTER TABLE candidate.batches
  ADD COLUMN IF NOT EXISTS revision_id uuid;

ALTER TABLE ai.provider_calls
  ADD CONSTRAINT provider_calls_revision_fk
  FOREIGN KEY (project_id, source_version_id, revision_id)
  REFERENCES transformation.revisions (project_id, source_version_id, revision_id);

ALTER TABLE candidate.batches
  ADD CONSTRAINT candidate_batches_revision_fk
  FOREIGN KEY (project_id, source_version_id, revision_id)
  REFERENCES transformation.revisions (project_id, source_version_id, revision_id);

CREATE OR REPLACE FUNCTION ai.enforce_candidate_revision_pin() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.schema_name = 'ClaimCandidateBatch.v1'
     AND (NEW.source_version_id IS NULL OR NEW.revision_id IS NULL) THEN
    RAISE EXCEPTION 'candidate provider calls require pinned source_version_id and revision_id';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.revision_id IS NOT NULL
     AND NEW.revision_id IS DISTINCT FROM OLD.revision_id THEN
    RAISE EXCEPTION 'provider call revision_id is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.revision_id IS NULL
     AND NEW.revision_id IS NOT NULL
     AND current_setting('shotgun.allow_revision_backfill', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'legacy provider call revision backfill requires controlled mode';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION candidate.enforce_batch_revision_pin() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.revision_id IS NULL THEN
    RAISE EXCEPTION 'candidate batches require a pinned revision_id';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.revision_id IS NOT NULL
     AND NEW.revision_id IS DISTINCT FROM OLD.revision_id THEN
    RAISE EXCEPTION 'candidate batch revision_id is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.revision_id IS NULL
     AND NEW.revision_id IS NOT NULL
     AND current_setting('shotgun.allow_revision_backfill', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'legacy candidate batch revision backfill requires controlled mode';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS provider_calls_candidate_revision_pin ON ai.provider_calls;
CREATE TRIGGER provider_calls_candidate_revision_pin
  BEFORE INSERT OR UPDATE OF revision_id ON ai.provider_calls
  FOR EACH ROW EXECUTE FUNCTION ai.enforce_candidate_revision_pin();

DROP TRIGGER IF EXISTS candidate_batches_revision_pin ON candidate.batches;
CREATE TRIGGER candidate_batches_revision_pin
  BEFORE INSERT OR UPDATE OF revision_id ON candidate.batches
  FOR EACH ROW EXECUTE FUNCTION candidate.enforce_batch_revision_pin();

CREATE INDEX IF NOT EXISTS provider_calls_revision_idx
  ON ai.provider_calls (project_id, source_version_id, revision_id);

CREATE INDEX IF NOT EXISTS candidate_batches_revision_idx
  ON candidate.batches (project_id, source_version_id, revision_id);

-- Explicit legacy reconciliation helper. It is intentionally not invoked by
-- the migration: operators must review the returned counts and run it inside
-- a disposable/backup-verified transaction. A call is eligible only when all
-- input Evidence IDs resolve to one exact project/SourceVersion/revision and
-- that revision exists in transformation.revisions. No latest-version or
-- browser/current-source fallback is permitted.
CREATE OR REPLACE FUNCTION candidate.backfill_revision_pins()
RETURNS TABLE(provider_calls_backfilled bigint, batches_backfilled bigint)
LANGUAGE plpgsql
AS $$
DECLARE
  provider_count bigint;
  batch_count bigint;
BEGIN
  PERFORM set_config('shotgun.allow_revision_backfill', 'on', true);

  WITH evidence_inputs AS (
    SELECT
      call.call_id,
      call.project_id,
      call.input_evidence_ids,
      span.source_version_id,
      span.revision_id,
      span.evidence_id
    FROM ai.provider_calls AS call
    CROSS JOIN LATERAL unnest(call.input_evidence_ids) AS input(evidence_id)
    JOIN evidence.spans AS span
      ON span.project_id = call.project_id
     AND span.source_version_id = call.source_version_id
     AND span.evidence_id = input.evidence_id
    WHERE call.schema_name = 'ClaimCandidateBatch.v1'
      AND call.revision_id IS NULL
  ), eligible_candidates AS (
    SELECT
      call_id,
      project_id,
      (array_agg(source_version_id ORDER BY source_version_id))[1] AS source_version_id,
      (array_agg(revision_id ORDER BY revision_id))[1] AS revision_id
    FROM evidence_inputs
    GROUP BY call_id, project_id, input_evidence_ids
    HAVING COUNT(DISTINCT evidence_id) = cardinality(input_evidence_ids)
       AND COUNT(DISTINCT source_version_id) = 1
       AND COUNT(DISTINCT revision_id) = 1
  ), eligible AS (
    SELECT candidates.*
    FROM eligible_candidates AS candidates
    JOIN transformation.revisions AS revision
      ON revision.project_id = candidates.project_id
     AND revision.source_version_id = candidates.source_version_id
     AND revision.revision_id = candidates.revision_id
  )
  UPDATE ai.provider_calls AS call
  SET revision_id = eligible.revision_id,
      updated_at = now()
  FROM eligible
  WHERE call.call_id = eligible.call_id
    AND call.project_id = eligible.project_id
    AND call.revision_id IS NULL;
  GET DIAGNOSTICS provider_count = ROW_COUNT;

  UPDATE candidate.batches AS batch
  SET revision_id = call.revision_id
  FROM candidate.materializations AS materialization
  JOIN ai.provider_outputs AS output ON output.output_id = materialization.output_id
  JOIN ai.provider_calls AS call ON call.call_id = output.call_id
  WHERE materialization.batch_id = batch.batch_id
    AND batch.revision_id IS NULL
    AND call.revision_id IS NOT NULL
    AND batch.project_id = call.project_id
    AND batch.source_version_id = call.source_version_id;
  GET DIAGNOSTICS batch_count = ROW_COUNT;

  provider_calls_backfilled := provider_count;
  batches_backfilled := batch_count;
  RETURN NEXT;
END;
$$;
