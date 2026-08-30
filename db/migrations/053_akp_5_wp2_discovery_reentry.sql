-- AKP-5 WP2: durable derived-provenance validation/re-entry intake.
-- FindingReady remains the notification ledger; these tables are the durable
-- non-Canonical re-entry result and its candidate, not a generic queue.

CREATE SCHEMA IF NOT EXISTS discovery;

CREATE TABLE IF NOT EXISTS discovery.reentry_manifests (
  logical_identity_version text NOT NULL CHECK (logical_identity_version = 'discovery-reentry-identity:v1'),
  logical_identity_key text NOT NULL,
  manifest_id text NOT NULL,
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  finding_id text NOT NULL,
  finding_revision integer NOT NULL CHECK (finding_revision >= 1),
  finding_type text NOT NULL CHECK (
    finding_type IN (
      'KNOWLEDGE_GAP', 'EVIDENCE_GAP', 'RELATION_HYPOTHESIS',
      'PATTERN_HYPOTHESIS', 'CONFLICT_HYPOTHESIS',
      'CLARIFICATION_QUESTION', 'ACTION_SUGGESTION'
    )
  ),
  source_projection_digest text NOT NULL,
  canonical_base_version integer NOT NULL CHECK (canonical_base_version >= 0),
  canonical_snapshot_digest text NOT NULL,
  requested_reentry_purpose text NOT NULL CHECK (requested_reentry_purpose = 'DERIVED_PROVENANCE_VALIDATION'),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, manifest_id),
  UNIQUE (logical_identity_key),
  UNIQUE (project_id, finding_id, finding_revision, requested_reentry_purpose),
  CONSTRAINT discovery_reentry_manifest_finding_fk
    FOREIGN KEY (project_id, finding_id, finding_revision)
    REFERENCES discovery.findings (project_id, finding_id, finding_revision)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS discovery_reentry_manifests_pending_idx
  ON discovery.reentry_manifests (project_id, finding_id, finding_revision, requested_reentry_purpose);

CREATE TABLE IF NOT EXISTS discovery.reentry_candidates (
  candidate_id text NOT NULL,
  candidate_revision integer NOT NULL CHECK (candidate_revision = 1),
  logical_identity_key text NOT NULL,
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  manifest_id text NOT NULL,
  finding_id text NOT NULL,
  finding_revision integer NOT NULL CHECK (finding_revision >= 1),
  finding_type text NOT NULL CHECK (
    finding_type IN (
      'KNOWLEDGE_GAP', 'EVIDENCE_GAP', 'RELATION_HYPOTHESIS',
      'PATTERN_HYPOTHESIS', 'CONFLICT_HYPOTHESIS',
      'CLARIFICATION_QUESTION', 'ACTION_SUGGESTION'
    )
  ),
  origin text NOT NULL CHECK (origin = 'DERIVED_DISCOVERY'),
  source_projection_digest text NOT NULL,
  canonical_base_version integer NOT NULL CHECK (canonical_base_version >= 0),
  canonical_snapshot_digest text NOT NULL,
  discovery_projection_revision text NOT NULL,
  discovery_projection_digest text NOT NULL,
  related_resource_refs jsonb NOT NULL CHECK (jsonb_typeof(related_resource_refs) = 'array'),
  evidence_ids text[] NOT NULL,
  derivation_provenance jsonb NOT NULL CHECK (jsonb_typeof(derivation_provenance) = 'object'),
  access_scope text[] NOT NULL CHECK (cardinality(access_scope) > 0),
  sensitivity text NOT NULL CHECK (sensitivity IN ('public', 'internal', 'private', 'restricted')),
  validation_profile jsonb NOT NULL CHECK (jsonb_typeof(validation_profile) = 'object'),
  reentry_eligibility text NOT NULL CHECK (reentry_eligibility = 'ELIGIBLE_FOR_VALIDATION'),
  review_eligibility text NOT NULL CHECK (review_eligibility = 'NOT_ELIGIBLE'),
  candidate jsonb NOT NULL CHECK (jsonb_typeof(candidate) = 'object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, candidate_id, candidate_revision),
  UNIQUE (logical_identity_key),
  UNIQUE (project_id, manifest_id),
  CONSTRAINT discovery_reentry_candidate_manifest_fk
    FOREIGN KEY (project_id, manifest_id)
    REFERENCES discovery.reentry_manifests (project_id, manifest_id)
    ON DELETE RESTRICT,
  CONSTRAINT discovery_reentry_candidate_finding_fk
    FOREIGN KEY (project_id, finding_id, finding_revision)
    REFERENCES discovery.findings (project_id, finding_id, finding_revision)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS discovery_reentry_candidates_finding_idx
  ON discovery.reentry_candidates (project_id, finding_id, finding_revision);

-- FindingReady is append-only notification evidence. This narrow ledger records
-- the durable outcome of consuming one Finding/re-entry identity so deterministic
-- failures and terminal lifecycle states are not selected on every poll.
CREATE TABLE IF NOT EXISTS discovery.reentry_consumption (
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  finding_id text NOT NULL,
  finding_revision integer NOT NULL CHECK (finding_revision >= 1),
  requested_reentry_purpose text NOT NULL CHECK (
    requested_reentry_purpose = 'DERIVED_PROVENANCE_VALIDATION'
  ),
  publication_id text NOT NULL,
  disposition text NOT NULL CHECK (
    disposition IN ('PROCESSED', 'INELIGIBLE', 'BLOCKED_NON_RETRYABLE', 'RETRYABLE')
  ),
  reason_code text NOT NULL CHECK (
    reason_code IN (
      'SUCCESS', 'LIFECYCLE_INELIGIBLE',
      'NO_APPROVED_REENTRY_AUTHORITY',
      'NO_APPROVED_REVISION_AT_FROZEN_BASE',
      'FINDING_NOT_FOUND', 'IDENTITY_MISMATCH',
      'UNSUPPORTED_RESOURCE_KIND', 'RETRYABLE_INFRASTRUCTURE_FAILURE'
    )
  ),
  reason_detail text NOT NULL,
  next_eligible_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, finding_id, finding_revision, requested_reentry_purpose),
  CHECK ((disposition = 'RETRYABLE') = (next_eligible_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS discovery_reentry_consumption_retryable_idx
  ON discovery.reentry_consumption (next_eligible_at, project_id, finding_id, finding_revision)
  WHERE disposition = 'RETRYABLE';
