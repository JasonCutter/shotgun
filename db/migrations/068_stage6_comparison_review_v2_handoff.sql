-- Additive Stage 6 authority for the versioned Comparison v2 Review handoff.
-- Legacy Stage 5 manifests and Frontend Review approvals remain unchanged.
ALTER TABLE canonical.commits
  DROP CONSTRAINT IF EXISTS canonical_commits_authority_kind_check;
ALTER TABLE canonical.commits
  DROP CONSTRAINT IF EXISTS commits_authority_kind_check;

ALTER TABLE canonical.commits
  ADD CONSTRAINT canonical_commits_authority_kind_check
  CHECK (authority_kind IN (
    'LEGACY_STAGE5_MANIFEST',
    'FRONTEND_REVIEW_APPROVAL',
    'V2_COMPARISON_REVIEW'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS canonical_commits_v2_authority_unique
  ON canonical.commits (project_id, authority_id)
  WHERE authority_kind = 'V2_COMPARISON_REVIEW' AND authority_id IS NOT NULL;
