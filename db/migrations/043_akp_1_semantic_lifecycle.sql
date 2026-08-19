CREATE TABLE IF NOT EXISTS projection.semantic_generation_pointers (
  project_id text NOT NULL,
  active_generation_id text NOT NULL,
  last_known_good_generation_id text,
  pointer_revision integer NOT NULL DEFAULT 1 CHECK (pointer_revision >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id),
  CONSTRAINT fk_semantic_pointer_active_gen FOREIGN KEY (project_id, active_generation_id)
    REFERENCES projection.semantic_generations (project_id, generation_id) ON DELETE RESTRICT,
  CONSTRAINT fk_semantic_pointer_rollback_gen FOREIGN KEY (project_id, last_known_good_generation_id)
    REFERENCES projection.semantic_generations (project_id, generation_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_semantic_generation_pointers_active
  ON projection.semantic_generation_pointers (project_id, active_generation_id);
