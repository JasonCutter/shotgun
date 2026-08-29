CREATE SCHEMA IF NOT EXISTS discovery;

CREATE TABLE IF NOT EXISTS discovery.findings (
  schema_version text NOT NULL CHECK (schema_version = '1.0.0'),
  finding_id text NOT NULL,
  finding_revision integer NOT NULL CHECK (finding_revision >= 1),
  project_id text NOT NULL,
  finding_type text NOT NULL CHECK (
    finding_type IN (
      'KNOWLEDGE_GAP',
      'EVIDENCE_GAP',
      'RELATION_HYPOTHESIS',
      'PATTERN_HYPOTHESIS',
      'CONFLICT_HYPOTHESIS',
      'CLARIFICATION_QUESTION',
      'ACTION_SUGGESTION'
    )
  ),
  status text NOT NULL CHECK (status = 'DERIVED_INFERENCE'),
  generation_method text NOT NULL CHECK (
    generation_method IN ('DETERMINISTIC', 'AI_ASSISTED', 'HYBRID')
  ),
  lifecycle_state text NOT NULL CHECK (
    lifecycle_state IN (
      'NEW',
      'VALIDATING',
      'REVIEW_READY',
      'REENTERED',
      'DISMISSED',
      'SUPPRESSED',
      'RESOLVED',
      'STALE',
      'SUPERSEDED'
    )
  ),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  related_resource_refs jsonb NOT NULL CHECK (jsonb_typeof(related_resource_refs) = 'array'),
  evidence_ids text[] NOT NULL,
  source_projection_digest text NOT NULL,
  canonical_base_version integer NOT NULL CHECK (canonical_base_version >= 0),
  canonical_snapshot_digest text NOT NULL,
  discovery_projection_revision text NOT NULL,
  discovery_projection_digest text NOT NULL,
  run_id text NOT NULL,
  signal_summary jsonb NOT NULL CHECK (jsonb_typeof(signal_summary) = 'object'),
  rationale text NOT NULL,
  derivation_summary text NOT NULL,
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object'),
  access_scope text[] NOT NULL CHECK (cardinality(access_scope) > 0),
  sensitivity text NOT NULL CHECK (sensitivity IN ('public', 'internal', 'private', 'restricted')),
  fingerprint text NOT NULL,
  fingerprint_version text NOT NULL,
  retention_class text NOT NULL CHECK (retention_class = 'DURABLE_DERIVED_RECORD'),
  created_at timestamptz NOT NULL,
  supersedes_finding_id text,
  PRIMARY KEY (project_id, finding_id, finding_revision)
);
