CREATE SCHEMA IF NOT EXISTS knowledge;

CREATE TABLE knowledge.review_groups (
  project_id text NOT NULL,
  group_id text NOT NULL,
  source_version_id uuid NOT NULL REFERENCES asset.source_versions(source_version_id),
  revision_number integer NOT NULL CHECK (revision_number >= 1),
  status text NOT NULL CHECK (
    status IN ('PENDING_REVIEW', 'ON_HOLD', 'APPROVED', 'REJECTED', 'EDIT_REENTRY')
  ),
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0),
  decisions jsonb NOT NULL CHECK (jsonb_typeof(decisions) = 'array'),
  access_scope text[] NOT NULL CHECK (cardinality(access_scope) > 0),
  sensitivity text NOT NULL CHECK (sensitivity IN ('public', 'internal', 'private', 'restricted')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, group_id)
);

CREATE INDEX knowledge_review_groups_status_idx
  ON knowledge.review_groups (project_id, status, updated_at);

CREATE TABLE knowledge.entity_vault_imports (
  project_id text NOT NULL,
  import_id text NOT NULL,
  source_version_id uuid NOT NULL REFERENCES asset.source_versions(source_version_id),
  status text NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'APPROVED_FOR_REVIEW', 'REJECTED')),
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  entity_count integer NOT NULL CHECK (entity_count > 0),
  entities jsonb NOT NULL CHECK (jsonb_typeof(entities) = 'array' AND jsonb_array_length(entities) > 0),
  canonical_write boolean NOT NULL CHECK (canonical_write = false),
  next_action text NOT NULL CHECK (next_action = 'REVIEW_AND_STAGE_KNOWLEDGE_GROUP'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  approved_by text,
  PRIMARY KEY (project_id, import_id)
);
