-- Additive FE-P4-S1 Review Center persistence (ADR-128, accepted 2026-08-04;
-- Contract Snapshot revision 1). Existing Stage 5 change-set-review, Command
-- Ledger and Frontend Draft tables are NOT modified. No second command ledger
-- is created.
-- Context revisions, Items and dependency edges are immutable. Decisions and
-- comments are append-only. Approval status changes preserve history.
-- This migration only creates the frontend_review schema.

DO $$
BEGIN
  IF to_regclass('runtime.schema_migrations') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM runtime.schema_migrations
    WHERE name = '026_frontend_knowledge_graph_projection.sql'
  ) THEN
    RAISE EXCEPTION 'Migration 027 preflight failed: 026 is missing';
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS frontend_review;

-- Immutable Review Context revisions. One row per (review_context_id,
-- context_revision); revalidation inserts a new revision.
CREATE TABLE frontend_review.context_revision (
  review_context_id text NOT NULL,
  context_revision integer NOT NULL CHECK (context_revision > 0),
  review_resource_id text NOT NULL,
  target_kind text NOT NULL
    CHECK (target_kind IN ('KNOWLEDGE_DRAFT_CHANGE_SET', 'DISCOVERY_CANDIDATE', 'USER_DIRECTIVE_PROPOSAL')),
  target_id text NOT NULL,
  target_revision text NOT NULL,
  target_digest text NOT NULL,
  resource_project_id text NOT NULL,
  effective_project_id text NOT NULL,
  access_revision text NOT NULL,
  policy_context_revision text NOT NULL,
  canonical_base jsonb,
  artifact_refs jsonb NOT NULL,
  aggregate_state text NOT NULL
    CHECK (aggregate_state IN (
      'PENDING', 'PARTIALLY_DECIDED', 'ON_HOLD', 'REVISION_REQUESTED', 'REJECTED',
      'APPROVED_READY', 'ACCEPTED_FOR_AUTHORING', 'STALE', 'ACCESS_RESTRICTED',
      'UNAVAILABLE')),
  capabilities jsonb NOT NULL,
  generated_at timestamptz NOT NULL,
  stale_reason text,
  -- source identity used to derive staleness without mutating the revision
  source_revision text NOT NULL,
  source_digest text NOT NULL,
  source_updated_at timestamptz NOT NULL,
  materialized_at timestamptz NOT NULL,
  PRIMARY KEY (review_context_id, context_revision)
);

CREATE INDEX frontend_review_context_revision_project_idx
  ON frontend_review.context_revision (resource_project_id, materialized_at);
CREATE INDEX frontend_review_context_revision_resource_idx
  ON frontend_review.context_revision (review_resource_id, context_revision DESC);

CREATE OR REPLACE FUNCTION frontend_review.block_context_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'frontend_review.context_revision is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER frontend_review_context_revision_immutable
  BEFORE UPDATE OR DELETE ON frontend_review.context_revision
  FOR EACH ROW EXECUTE FUNCTION frontend_review.block_context_mutation();

-- Immutable Review Items per context revision.
CREATE TABLE frontend_review.item (
  review_context_id text NOT NULL,
  context_revision integer NOT NULL CHECK (context_revision > 0),
  review_item_id text NOT NULL,
  source_item_kind text NOT NULL
    CHECK (source_item_kind IN ('KNOWLEDGE_OPERATION', 'DISCOVERY_CANDIDATE', 'USER_DIRECTIVE_CLAUSE')),
  source_item_id text NOT NULL,
  source_item_revision text NOT NULL,
  source_item_digest text NOT NULL,
  target_ref jsonb NOT NULL,
  label text NOT NULL,
  before_representation jsonb,
  after_representation jsonb,
  rationale text NOT NULL,
  expected_impact text,
  artifact_refs jsonb NOT NULL,
  allowed_decisions jsonb NOT NULL,
  decision_state text NOT NULL
    CHECK (decision_state IN ('PENDING', 'APPROVED', 'REJECTED', 'REVISION_REQUESTED', 'ON_HOLD')),
  sensitivity text NOT NULL CHECK (sensitivity IN ('NORMAL', 'SENSITIVE', 'RESTRICTED')),
  masked_fields jsonb NOT NULL,
  access_masking text NOT NULL CHECK (access_masking IN ('VISIBLE', 'MASKED', 'HIDDEN')),
  PRIMARY KEY (review_context_id, context_revision, review_item_id),
  CONSTRAINT frontend_review_item_context_fk
    FOREIGN KEY (review_context_id, context_revision)
    REFERENCES frontend_review.context_revision (review_context_id, context_revision)
);

CREATE OR REPLACE FUNCTION frontend_review.block_item_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'frontend_review.item is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER frontend_review_item_immutable
  BEFORE UPDATE OR DELETE ON frontend_review.item
  FOR EACH ROW EXECUTE FUNCTION frontend_review.block_item_mutation();

-- Immutable Review dependency edges (server-owned).
CREATE TABLE frontend_review.dependency (
  review_context_id text NOT NULL,
  context_revision integer NOT NULL CHECK (context_revision > 0),
  dependency_id text NOT NULL,
  from_review_item_id text NOT NULL,
  to_review_item_id text NOT NULL,
  kind text NOT NULL
    CHECK (kind IN ('REQUIRES', 'ATOMIC_WITH', 'CONFLICTS_WITH')),
  reason_code text NOT NULL,
  description text NOT NULL,
  availability text NOT NULL CHECK (availability IN ('AVAILABLE', 'UNAVAILABLE')),
  PRIMARY KEY (review_context_id, context_revision, dependency_id),
  CONSTRAINT frontend_review_dependency_context_fk
    FOREIGN KEY (review_context_id, context_revision)
    REFERENCES frontend_review.context_revision (review_context_id, context_revision)
);

CREATE OR REPLACE FUNCTION frontend_review.block_dependency_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'frontend_review.dependency is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER frontend_review_dependency_immutable
  BEFORE UPDATE OR DELETE ON frontend_review.dependency
  FOR EACH ROW EXECUTE FUNCTION frontend_review.block_dependency_mutation();

-- Append-only Review decisions. HOLD is nonterminal; terminal decisions cannot
-- be replaced on the same context revision.
CREATE TABLE frontend_review.decision (
  decision_id text PRIMARY KEY,
  review_context_id text NOT NULL,
  context_revision integer NOT NULL CHECK (context_revision > 0),
  review_item_id text NOT NULL,
  intent text NOT NULL CHECK (intent IN ('APPROVE', 'REJECT', 'REQUEST_REVISION', 'HOLD')),
  reason text,
  decided_by jsonb NOT NULL,
  decided_at timestamptz NOT NULL,
  terminal boolean NOT NULL
);

CREATE INDEX frontend_review_decision_context_idx
  ON frontend_review.decision (review_context_id, context_revision);

CREATE OR REPLACE FUNCTION frontend_review.block_decision_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'frontend_review.decision is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER frontend_review_decision_append_only
  BEFORE UPDATE OR DELETE ON frontend_review.decision
  FOR EACH ROW EXECUTE FUNCTION frontend_review.block_decision_mutation();

-- Append-only Review comments.
CREATE TABLE frontend_review.comment (
  comment_id text PRIMARY KEY,
  review_context_id text NOT NULL,
  context_revision integer NOT NULL CHECK (context_revision > 0),
  review_item_id text,
  text text NOT NULL,
  authored_by jsonb NOT NULL,
  authored_at timestamptz NOT NULL
);

CREATE INDEX frontend_review_comment_context_idx
  ON frontend_review.comment (review_context_id, context_revision);

CREATE OR REPLACE FUNCTION frontend_review.block_comment_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'frontend_review.comment is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER frontend_review_comment_append_only
  BEFORE UPDATE OR DELETE ON frontend_review.comment
  FOR EACH ROW EXECUTE FUNCTION frontend_review.block_comment_mutation();

-- Approval Resources with lifecycle status. Status changes preserve history by
-- appending a new approval row revision (see approval_status_history).
CREATE TABLE frontend_review.approval (
  approval_id text NOT NULL,
  approval_status_revision integer NOT NULL CHECK (approval_status_revision > 0),
  purpose text NOT NULL
    CHECK (purpose IN ('KNOWLEDGE_CANONICAL_CHANGE', 'USER_DIRECTIVE_CHANGE')),
  review_context_id text NOT NULL,
  context_revision integer NOT NULL CHECK (context_revision > 0),
  target_kind text NOT NULL
    CHECK (target_kind IN ('KNOWLEDGE_DRAFT_CHANGE_SET', 'DISCOVERY_CANDIDATE', 'USER_DIRECTIVE_PROPOSAL')),
  target_id text NOT NULL,
  target_revision text NOT NULL,
  target_digest text NOT NULL,
  approved_item_ids jsonb NOT NULL,
  approved_manifest_digest text NOT NULL,
  actor jsonb NOT NULL,
  project_id text NOT NULL,
  access_revision text NOT NULL,
  policy_context_revision text NOT NULL,
  reason text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL
    CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED', 'CONSUMED', 'INVALIDATED')),
  invalidation_reason text,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (approval_id, approval_status_revision)
);

CREATE INDEX frontend_review_approval_project_status_idx
  ON frontend_review.approval (project_id, status);
CREATE INDEX frontend_review_approval_context_idx
  ON frontend_review.approval (review_context_id, context_revision);

-- Approval status changes are append-only so lifecycle history is preserved.
CREATE OR REPLACE FUNCTION frontend_review.block_approval_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'frontend_review.approval is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER frontend_review_approval_append_only
  BEFORE UPDATE OR DELETE ON frontend_review.approval
  FOR EACH ROW EXECUTE FUNCTION frontend_review.block_approval_mutation();
