-- R3 durable semantic-generation lifecycle.
-- 042/043 remain immutable; this migration hardens and extends them.

ALTER TABLE projection.semantic_generations
  DROP CONSTRAINT IF EXISTS semantic_generations_canonical_base_version_check;

ALTER TABLE projection.semantic_generations
  ADD CONSTRAINT chk_semantic_generations_canonical_base_version_nonnegative
  CHECK (canonical_base_version >= 0);

ALTER TABLE projection.semantic_items
  DROP CONSTRAINT IF EXISTS semantic_items_canonical_version_check;

ALTER TABLE projection.semantic_items
  ADD CONSTRAINT chk_semantic_items_canonical_version_nonnegative
  CHECK (canonical_version >= 0);

ALTER TABLE projection.semantic_items
  ADD COLUMN IF NOT EXISTS provider_id text,
  ADD COLUMN IF NOT EXISTS embedding_model_id text,
  ADD COLUMN IF NOT EXISTS normalization_policy text,
  ADD COLUMN IF NOT EXISTS authority text,
  ADD COLUMN IF NOT EXISTS provenance jsonb;

UPDATE projection.semantic_items AS item
SET provider_id = generation.provider_id,
    embedding_model_id = generation.embedding_model_id,
    normalization_policy = generation.normalization_policy
FROM projection.semantic_generations AS generation
WHERE generation.project_id = item.project_id
  AND generation.generation_id = item.generation_id
  AND (item.provider_id IS NULL OR item.embedding_model_id IS NULL OR item.normalization_policy IS NULL);

ALTER TABLE projection.semantic_items
  ALTER COLUMN provider_id SET NOT NULL,
  ALTER COLUMN embedding_model_id SET NOT NULL,
  ALTER COLUMN normalization_policy SET NOT NULL;

ALTER TABLE projection.semantic_items
  ADD CONSTRAINT chk_semantic_items_normalization_policy
  CHECK (normalization_policy IN ('unit_length', 'none'));

ALTER TABLE projection.semantic_generations
  ADD CONSTRAINT unq_semantic_generation_r3_bound_identity UNIQUE (
    project_id,
    generation_id,
    source_projection_digest,
    provider_id,
    embedding_model_id,
    normalization_policy
  );

CREATE TABLE IF NOT EXISTS projection.semantic_generation_pointers (
  project_id text PRIMARY KEY,
  active_generation_id text NOT NULL,
  pointer_revision bigint NOT NULL CHECK (pointer_revision >= 1),
  source_projection_digest text NOT NULL CHECK (source_projection_digest ~ '^sha256:[a-f0-9]{64}$'),
  canonical_base_version integer NOT NULL CHECK (canonical_base_version >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_semantic_generation_pointer_target FOREIGN KEY (project_id, active_generation_id)
    REFERENCES projection.semantic_generations (project_id, generation_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_semantic_generation_pointers_target
  ON projection.semantic_generation_pointers (project_id, active_generation_id);

CREATE OR REPLACE FUNCTION projection.enforce_semantic_generation_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.build_status <> OLD.build_status
     AND (OLD.build_status <> 'BUILDING' OR NEW.build_status NOT IN ('READY', 'FAILED')) THEN
    RAISE EXCEPTION 'Invalid semantic generation status transition: % -> %',
      OLD.build_status, NEW.build_status
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_semantic_generation_status_transition
  ON projection.semantic_generations;

CREATE TRIGGER trg_semantic_generation_status_transition
BEFORE UPDATE OF build_status ON projection.semantic_generations
FOR EACH ROW
EXECUTE FUNCTION projection.enforce_semantic_generation_status_transition();
