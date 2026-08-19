CREATE TABLE IF NOT EXISTS projection.semantic_embedding_profiles (
  project_id text NOT NULL,
  profile_id text NOT NULL,
  profile_revision integer NOT NULL CHECK (profile_revision >= 1),
  provider_id text NOT NULL,
  embedding_model_id text NOT NULL,
  credential_id text NOT NULL,
  credential_revision integer NOT NULL CHECK (credential_revision >= 1),
  representation_version text NOT NULL,
  dimension integer NOT NULL CHECK (dimension >= 1),
  distance_metric text NOT NULL CHECK (distance_metric IN ('cosine', 'dot_product', 'euclidean')),
  normalization_policy text NOT NULL CHECK (normalization_policy IN ('unit_length', 'none')),
  status text NOT NULL CHECK (status IN ('PREPARED', 'BUILDING', 'ACTIVE', 'RETIRED', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  activated_at timestamptz,
  PRIMARY KEY (project_id, profile_revision),
  CONSTRAINT unq_semantic_embedding_profile_id UNIQUE (project_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_semantic_embedding_profiles_project_status
  ON projection.semantic_embedding_profiles (project_id, status);
