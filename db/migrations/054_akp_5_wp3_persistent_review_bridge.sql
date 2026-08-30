-- AKP-5 WP3: durable normalized derived Discovery resources exposed to the
-- existing ADR-128 Review authority. WP2 reentry_candidates remain
-- NOT_ELIGIBLE validation inputs and are not modified by this migration.

DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '053_akp_5_wp2_discovery_reentry.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 054 preflight failed: 053 is missing';
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS discovery;

-- A server-owned one-to-one identity authority prevents one immutable WP2
-- candidate revision from branching into multiple ADR-128 Review roots.
CREATE TABLE IF NOT EXISTS discovery.reentry_review_roots (
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  candidate_id text NOT NULL,
  candidate_revision integer NOT NULL CHECK (candidate_revision >= 1),
  review_resource_id text NOT NULL,
  identity_version text NOT NULL CHECK (
    identity_version = 'discovery-review-root-identity:v1'
  ),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, review_resource_id),
  UNIQUE (project_id, candidate_id, candidate_revision),
  UNIQUE (project_id, review_resource_id, candidate_id, candidate_revision),
  CONSTRAINT discovery_review_root_candidate_fk
    FOREIGN KEY (project_id, candidate_id, candidate_revision)
    REFERENCES discovery.reentry_candidates (project_id, candidate_id, candidate_revision)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS discovery_review_roots_candidate_idx
  ON discovery.reentry_review_roots (project_id, candidate_id, candidate_revision);

-- This is a normalized, immutable Review projection. It is intentionally not
-- a second queue or Review ledger: ADR-128 owns Contexts, Items and decisions.
-- A new resource_revision is an explicit immutable revision; an existing
-- identity must never be silently overwritten.
CREATE TABLE IF NOT EXISTS discovery.reentry_review_resources (
  review_resource_id text NOT NULL,
  resource_revision integer NOT NULL CHECK (resource_revision >= 1),
  project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  effective_project_id text NOT NULL REFERENCES project_admin.projects(id) ON DELETE RESTRICT,
  candidate_id text NOT NULL,
  candidate_revision integer NOT NULL CHECK (candidate_revision >= 1),
  finding_id text NOT NULL,
  finding_revision integer NOT NULL CHECK (finding_revision >= 1),
  finding_type text NOT NULL CHECK (
    finding_type IN (
      'KNOWLEDGE_GAP', 'EVIDENCE_GAP', 'RELATION_HYPOTHESIS',
      'PATTERN_HYPOTHESIS', 'CONFLICT_HYPOTHESIS',
      'CLARIFICATION_QUESTION', 'ACTION_SUGGESTION'
    )
  ),
  manifest_id text NOT NULL,
  origin text NOT NULL CHECK (origin = 'DERIVED_DISCOVERY'),
  governance_target text NOT NULL CHECK (
    governance_target IN (
      'RELATION_GOVERNANCE', 'DERIVED_CLAIM_OR_KNOWLEDGE_CANDIDATE_GOVERNANCE',
      'EXISTING_CONFLICT_COMPARISON_AND_REVIEW', 'VALIDATION_OR_KNOWLEDGE_GAP_GOVERNANCE',
      'INVESTIGATION_QUESTION_PATH', 'ACTION_CANDIDATE_GOVERNANCE'
    )
  ),
  source_projection_digest text NOT NULL,
  canonical_base_version integer NOT NULL CHECK (canonical_base_version >= 0),
  canonical_snapshot_digest text NOT NULL,
  discovery_projection_revision text NOT NULL,
  discovery_projection_digest text NOT NULL,
  related_resource_refs jsonb NOT NULL CHECK (jsonb_typeof(related_resource_refs) = 'array'),
  evidence_ids text[] NOT NULL,
  evidence_lineage jsonb NOT NULL CHECK (jsonb_typeof(evidence_lineage) = 'array'),
  derivation_provenance jsonb NOT NULL CHECK (jsonb_typeof(derivation_provenance) = 'object'),
  access_scope text[] NOT NULL CHECK (cardinality(access_scope) > 0),
  sensitivity text NOT NULL CHECK (sensitivity IN ('public', 'internal', 'private', 'restricted')),
  validation_profile jsonb NOT NULL CHECK (jsonb_typeof(validation_profile) = 'object'),
  validation_result jsonb NOT NULL CHECK (jsonb_typeof(validation_result) = 'object'),
  lifecycle_state text NOT NULL CHECK (
    lifecycle_state IN (
      'NEW', 'VALIDATING', 'REVIEW_READY', 'REENTERED',
      'DISMISSED', 'SUPPRESSED', 'RESOLVED', 'STALE', 'SUPERSEDED'
    )
  ),
  review_eligibility text NOT NULL CHECK (review_eligibility = 'ELIGIBLE_AFTER_VALIDATION'),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  content_digest text NOT NULL,
  resource jsonb NOT NULL CHECK (jsonb_typeof(resource) = 'object'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (resource->>'reviewResourceId' = review_resource_id),
  CHECK (resource->>'resourceRevision' = resource_revision::text),
  CHECK (resource->>'projectId' = project_id),
  CHECK (resource->>'candidateId' = candidate_id),
  CHECK (resource->>'contentDigest' = content_digest),
  CHECK (resource->>'lifecycleState' = lifecycle_state),
  CHECK (resource->>'reviewEligibility' = review_eligibility),
  PRIMARY KEY (project_id, review_resource_id, resource_revision),
  UNIQUE (project_id, candidate_id, candidate_revision, resource_revision),
  CONSTRAINT discovery_review_resource_manifest_fk
    FOREIGN KEY (project_id, manifest_id)
    REFERENCES discovery.reentry_manifests (project_id, manifest_id)
    ON DELETE RESTRICT,
  CONSTRAINT discovery_review_resource_candidate_fk
    FOREIGN KEY (project_id, candidate_id, candidate_revision)
    REFERENCES discovery.reentry_candidates (project_id, candidate_id, candidate_revision)
    ON DELETE RESTRICT,
  CONSTRAINT discovery_review_resource_root_fk
    FOREIGN KEY (project_id, review_resource_id, candidate_id, candidate_revision)
    REFERENCES discovery.reentry_review_roots (
      project_id, review_resource_id, candidate_id, candidate_revision
    )
    ON DELETE RESTRICT,
  CONSTRAINT discovery_review_resource_finding_fk
    FOREIGN KEY (project_id, finding_id, finding_revision)
    REFERENCES discovery.findings (project_id, finding_id, finding_revision)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS discovery_review_resources_queue_idx
  ON discovery.reentry_review_resources (project_id, review_resource_id, resource_revision DESC);

CREATE OR REPLACE FUNCTION discovery.block_reentry_review_resource_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'discovery.reentry_review_resources is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION discovery.block_reentry_review_root_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'discovery.reentry_review_roots is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER discovery_reentry_review_roots_immutable
  BEFORE UPDATE OR DELETE ON discovery.reentry_review_roots
  FOR EACH ROW EXECUTE FUNCTION discovery.block_reentry_review_root_mutation();

CREATE TRIGGER discovery_reentry_review_resources_immutable
  BEFORE UPDATE OR DELETE ON discovery.reentry_review_resources
  FOR EACH ROW EXECUTE FUNCTION discovery.block_reentry_review_resource_mutation();
