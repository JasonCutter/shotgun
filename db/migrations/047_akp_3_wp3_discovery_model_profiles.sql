-- AKP-3 WP3: Discovery-specific, revisioned AI model profile authority.
-- The profile binds an exact Project AI configuration revision, but never
-- stores credential material or credential ciphertext.

CREATE TABLE IF NOT EXISTS discovery.model_profiles (
  schema_version text NOT NULL CHECK (schema_version = '1.0.0'),
  project_id text NOT NULL,
  profile_id text NOT NULL,
  profile_revision integer NOT NULL CHECK (profile_revision >= 1),
  ai_configuration_revision integer NOT NULL CHECK (ai_configuration_revision >= 1),
  provider_id text NOT NULL,
  model_id text NOT NULL,
  provider_registry_revision text NOT NULL,
  model_capability_revision text NOT NULL,
  prompt_version text NOT NULL,
  output_schema_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('PREPARED', 'ACTIVE', 'RETIRED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  activated_at timestamptz,
  retired_at timestamptz,
  PRIMARY KEY (project_id, profile_revision),
  CONSTRAINT discovery_model_profiles_id_uq UNIQUE (project_id, profile_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS discovery_model_profiles_one_active_uq
  ON discovery.model_profiles (project_id)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS discovery_model_profiles_project_status_idx
  ON discovery.model_profiles (project_id, status, profile_revision DESC);
