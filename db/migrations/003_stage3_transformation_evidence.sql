CREATE SCHEMA IF NOT EXISTS transformation;
CREATE SCHEMA IF NOT EXISTS evidence;

CREATE TABLE transformation.revisions (
  revision_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  source_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  source_content_hash text NOT NULL CHECK (source_content_hash ~ '^sha256:[a-f0-9]{64}$'),
  transformer_id text NOT NULL,
  transformer_version text NOT NULL,
  document_ir jsonb NOT NULL,
  source_map jsonb NOT NULL,
  document_hash text NOT NULL CHECK (document_hash ~ '^sha256:[a-f0-9]{64}$'),
  source_map_hash text NOT NULL CHECK (source_map_hash ~ '^sha256:[a-f0-9]{64}$'),
  access_scope text[] NOT NULL CHECK (cardinality(access_scope) > 0),
  sensitivity text NOT NULL CHECK (sensitivity IN ('public', 'internal', 'private', 'restricted')),
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, source_version_id, transformer_id, transformer_version)
);

CREATE TABLE transformation.attempts (
  attempt_id uuid PRIMARY KEY,
  project_id text NOT NULL,
  source_version_id uuid NOT NULL,
  transformer_id text NOT NULL,
  transformer_version text NOT NULL,
  revision_id uuid NOT NULL REFERENCES transformation.revisions(revision_id),
  reused_revision boolean NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX transformation_attempts_source_idx
  ON transformation.attempts (project_id, source_version_id, created_at);

CREATE TABLE evidence.spans (
  evidence_id uuid PRIMARY KEY,
  revision_id uuid NOT NULL REFERENCES transformation.revisions(revision_id),
  project_id text NOT NULL,
  source_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  pointer text NOT NULL,
  node_kind text NOT NULL CHECK (node_kind IN ('document', 'paragraph', 'sentence')),
  origin text NOT NULL CHECK (origin = 'source'),
  position jsonb NOT NULL,
  quote jsonb NOT NULL,
  exact_hash text NOT NULL CHECK (exact_hash ~ '^sha256:[a-f0-9]{64}$'),
  access_scope text[] NOT NULL CHECK (cardinality(access_scope) > 0),
  sensitivity text NOT NULL CHECK (sensitivity IN ('public', 'internal', 'private', 'restricted')),
  created_at timestamptz NOT NULL,
  UNIQUE (project_id, revision_id, pointer)
);

CREATE INDEX evidence_spans_source_idx
  ON evidence.spans (project_id, source_version_id, ((position ->> 'start')::integer));
