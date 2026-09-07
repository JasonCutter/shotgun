-- ADR-163: durable V2 Review operation resolution.
--
-- This migration is additive.  Existing V2 Draft rows are snapshotted as
-- immutable revision 1 (or their current revision) without inventing an
-- OperationResolution.  No Canonical, provider, or Stage 6 table is touched.

DO $$
BEGIN
  IF to_regclass('review.change_sets_v2') IS NULL THEN
    RAISE EXCEPTION 'Migration 070 preflight failed: review.change_sets_v2 is missing';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS review.change_set_revisions_v2 (
  project_id text NOT NULL CHECK (length(btrim(project_id)) BETWEEN 1 AND 200),
  change_set_id text NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  content_digest text NOT NULL CHECK (content_digest ~ '^sha256:[a-f0-9]{64}$'),
  change_set_json jsonb NOT NULL CHECK (jsonb_typeof(change_set_json) = 'object'),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, change_set_id, revision_number),
  CONSTRAINT change_set_revisions_v2_change_set_fk
    FOREIGN KEY (project_id, change_set_id)
    REFERENCES review.change_sets_v2 (project_id, change_set_id)
    ON DELETE CASCADE
);

INSERT INTO review.change_set_revisions_v2
  (project_id, change_set_id, revision_number, content_digest, change_set_json, created_at)
SELECT project_id, change_set_id, revision_number, content_digest, change_set_json, created_at
FROM review.change_sets_v2
ON CONFLICT (project_id, change_set_id, revision_number) DO NOTHING;

CREATE INDEX IF NOT EXISTS change_set_revisions_v2_lookup_idx
  ON review.change_set_revisions_v2 (project_id, change_set_id, revision_number DESC);

CREATE TABLE IF NOT EXISTS review.operation_resolutions_v2 (
  resolution_id text PRIMARY KEY CHECK (length(btrim(resolution_id)) > 0),
  contract_version text NOT NULL CHECK (length(btrim(contract_version)) > 0),
  project_id text NOT NULL CHECK (length(btrim(project_id)) BETWEEN 1 AND 200),
  change_set_id text NOT NULL,
  source_draft_revision integer NOT NULL CHECK (source_draft_revision > 0),
  source_draft_digest text NOT NULL CHECK (source_draft_digest ~ '^sha256:[a-f0-9]{64}$'),
  resolved_draft_revision integer NOT NULL CHECK (resolved_draft_revision = source_draft_revision + 1),
  resolved_draft_digest text NOT NULL CHECK (resolved_draft_digest ~ '^sha256:[a-f0-9]{64}$'),
  comparison_id text NOT NULL,
  comparison_digest text NOT NULL CHECK (comparison_digest ~ '^sha256:[a-f0-9]{64}$'),
  candidate_id text NOT NULL,
  candidate_revision integer NOT NULL CHECK (candidate_revision > 0),
  candidate_digest text NOT NULL CHECK (candidate_digest ~ '^sha256:[a-f0-9]{64}$'),
  candidate_source_version_id text NOT NULL,
  candidate_evidence_ids jsonb NOT NULL CHECK (jsonb_typeof(candidate_evidence_ids) = 'array'),
  canonical_snapshot_id text NOT NULL,
  canonical_version integer NOT NULL CHECK (canonical_version >= 0),
  canonical_digest text NOT NULL CHECK (canonical_digest ~ '^sha256:[a-f0-9]{64}$'),
  shortlist_digest text CHECK (shortlist_digest IS NULL OR shortlist_digest ~ '^sha256:[a-f0-9]{64}$'),
  analysis_revision_ids jsonb NOT NULL CHECK (jsonb_typeof(analysis_revision_ids) = 'array'),
  relationship_ids jsonb NOT NULL CHECK (jsonb_typeof(relationship_ids) = 'array'),
  chosen_operation text NOT NULL CHECK (chosen_operation IN ('ADD_CLAIM', 'NO_OP')),
  access_revision text NOT NULL,
  policy_context_revision text NOT NULL,
  resolver_actor_id text NOT NULL,
  client_request_id text NOT NULL,
  semantic_command_identity text NOT NULL,
  idempotency_key text NOT NULL,
  command_digest text NOT NULL CHECK (command_digest ~ '^sha256:[a-f0-9]{64}$'),
  resolution_digest text NOT NULL CHECK (resolution_digest ~ '^sha256:[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state = 'RESOLVED'),
  created_at timestamptz NOT NULL,
  resolution_json jsonb NOT NULL CHECK (jsonb_typeof(resolution_json) = 'object'),
  CONSTRAINT operation_resolutions_v2_change_set_fk
    FOREIGN KEY (project_id, change_set_id)
    REFERENCES review.change_sets_v2 (project_id, change_set_id)
    ON DELETE RESTRICT,
  CONSTRAINT operation_resolutions_v2_source_revision_fk
    FOREIGN KEY (project_id, change_set_id, source_draft_revision)
    REFERENCES review.change_set_revisions_v2 (project_id, change_set_id, revision_number)
    ON DELETE RESTRICT,
  CONSTRAINT operation_resolutions_v2_resolved_revision_fk
    FOREIGN KEY (project_id, change_set_id, resolved_draft_revision)
    REFERENCES review.change_set_revisions_v2 (project_id, change_set_id, revision_number)
    ON DELETE RESTRICT,
  UNIQUE (project_id, change_set_id, source_draft_revision),
  UNIQUE (project_id, client_request_id),
  UNIQUE (project_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS operation_resolutions_v2_change_set_idx
  ON review.operation_resolutions_v2 (project_id, change_set_id, created_at DESC);

CREATE INDEX IF NOT EXISTS operation_resolutions_v2_semantic_identity_idx
  ON review.operation_resolutions_v2 (project_id, semantic_command_identity);
