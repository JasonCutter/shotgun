CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS projection.semantic_generations (
  project_id text NOT NULL,
  generation_id text NOT NULL,
  embedding_profile_id text NOT NULL,
  embedding_profile_revision integer NOT NULL CHECK (embedding_profile_revision >= 1),
  provider_id text NOT NULL,
  embedding_model_id text NOT NULL,
  provider_registry_revision text NOT NULL,
  capability_catalog_revision text NOT NULL,
  representation_version text NOT NULL,
  dimension integer NOT NULL CHECK (dimension >= 1),
  distance_metric text NOT NULL CHECK (distance_metric IN ('cosine', 'dot_product', 'euclidean')),
  normalization_policy text NOT NULL CHECK (normalization_policy IN ('unit_length', 'none')),
  build_status text NOT NULL DEFAULT 'BUILDING' CHECK (build_status IN ('BUILDING', 'READY', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, generation_id)
);

CREATE TABLE IF NOT EXISTS projection.semantic_items (
  project_id text NOT NULL,
  generation_id text NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('CLAIM', 'FACT', 'ENTITY', 'RELATION', 'EVENT', 'DECISION')),
  resource_id text NOT NULL,
  representation_version text NOT NULL,
  semantic_text_digest text NOT NULL CHECK (semantic_text_digest ~ '^sha256:[a-f0-9]{64}$'),
  vector vector NOT NULL,
  dimension integer NOT NULL CHECK (dimension >= 1),
  access_scope text[] NOT NULL DEFAULT '{}',
  sensitivity text NOT NULL CHECK (sensitivity IN ('public', 'internal', 'private', 'restricted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, generation_id, resource_type, resource_id),
  CONSTRAINT fk_semantic_items_generation FOREIGN KEY (project_id, generation_id)
    REFERENCES projection.semantic_generations (project_id, generation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_semantic_items_security
  ON projection.semantic_items (project_id, generation_id, sensitivity);
