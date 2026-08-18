CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS projection.semantic_generations (
  project_id text NOT NULL,
  generation_id text NOT NULL,
  source_projection_digest text NOT NULL CHECK (source_projection_digest ~ '^sha256:[a-f0-9]{64}$'),
  canonical_base_version integer NOT NULL CHECK (canonical_base_version >= 1),
  credential_id text NOT NULL,
  credential_revision integer NOT NULL CHECK (credential_revision >= 1),
  provider_policy_fingerprint text NOT NULL CHECK (provider_policy_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  provider_id text NOT NULL,
  embedding_model_id text NOT NULL,
  embedding_profile_id text NOT NULL,
  embedding_profile_revision integer NOT NULL CHECK (embedding_profile_revision >= 1),
  provider_registry_revision text NOT NULL,
  capability_catalog_revision text NOT NULL,
  representation_version text NOT NULL,
  dimension integer NOT NULL CHECK (dimension >= 1),
  distance_metric text NOT NULL CHECK (distance_metric IN ('cosine', 'dot_product', 'euclidean')),
  normalization_policy text NOT NULL CHECK (normalization_policy IN ('unit_length', 'none')),
  build_status text NOT NULL DEFAULT 'BUILDING' CHECK (build_status IN ('BUILDING', 'READY', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, generation_id),
  CONSTRAINT unq_semantic_generation_bound_identity UNIQUE (
    project_id,
    generation_id,
    dimension,
    embedding_profile_id,
    embedding_profile_revision,
    representation_version
  )
);

CREATE TABLE IF NOT EXISTS projection.semantic_items (
  project_id text NOT NULL,
  generation_id text NOT NULL,
  semantic_item_id text NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('CLAIM', 'FACT', 'ENTITY', 'RELATION', 'EVENT', 'DECISION')),
  resource_id text NOT NULL,
  source_projection_digest text NOT NULL CHECK (source_projection_digest ~ '^sha256:[a-f0-9]{64}$'),
  canonical_version integer NOT NULL CHECK (canonical_version >= 1),
  semantic_text_digest text NOT NULL CHECK (semantic_text_digest ~ '^sha256:[a-f0-9]{64}$'),
  embedding_profile_id text NOT NULL,
  embedding_profile_revision integer NOT NULL CHECK (embedding_profile_revision >= 1),
  representation_version text NOT NULL,
  vector vector NOT NULL,
  dimension integer NOT NULL CHECK (dimension >= 1),
  evidence_ids text[] NOT NULL DEFAULT '{}',
  access_scope text[] NOT NULL DEFAULT '{}',
  sensitivity text NOT NULL CHECK (sensitivity IN ('public', 'internal', 'private', 'restricted')),
  indexed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, generation_id, resource_type, resource_id),
  CONSTRAINT unq_semantic_item_id UNIQUE (project_id, generation_id, semantic_item_id),
  CONSTRAINT chk_semantic_item_vector_dims CHECK (vector_dims(vector) = dimension),
  CONSTRAINT fk_semantic_items_generation_bound_identity FOREIGN KEY (
    project_id,
    generation_id,
    dimension,
    embedding_profile_id,
    embedding_profile_revision,
    representation_version
  ) REFERENCES projection.semantic_generations (
    project_id,
    generation_id,
    dimension,
    embedding_profile_id,
    embedding_profile_revision,
    representation_version
  ) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_semantic_items_security
  ON projection.semantic_items (project_id, generation_id, sensitivity);
