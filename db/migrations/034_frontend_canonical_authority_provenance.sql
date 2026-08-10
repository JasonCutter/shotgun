-- FE-P5-XP Correction B: Canonical commit/claim authority provenance.
-- Frontend Review Approval commits use `authority_kind = FRONTEND_REVIEW_APPROVAL`
-- and never fabricate legacy Stage-5 manifest/changeSet identities. Existing
-- legacy rows are untouched (authority_kind = LEGACY_STAGE5_MANIFEST).
--
-- Additive only; no existing-row rewrite. Statements are idempotent so the
-- migration can be re-applied while iterating on the schema delta.

-- canonical.commits: authority provenance + nullable legacy manifest identity.
ALTER TABLE canonical.commits
  ALTER COLUMN manifest_id DROP NOT NULL,
  ALTER COLUMN change_set_id DROP NOT NULL,
  ALTER COLUMN manifest_digest DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS authority_kind TEXT NOT NULL DEFAULT 'LEGACY_STAGE5_MANIFEST'
    CHECK (authority_kind IN ('LEGACY_STAGE5_MANIFEST', 'FRONTEND_REVIEW_APPROVAL')),
  ADD COLUMN IF NOT EXISTS authority_id TEXT,
  ADD COLUMN IF NOT EXISTS authority_digest TEXT;

-- One Frontend Approval -> at most one Canonical commit (DB-level guarantee).
-- NULL authority_id rows (legacy) are not constrained by the UNIQUE predicate.
CREATE UNIQUE INDEX IF NOT EXISTS canonical_commits_frontend_authority_unique
  ON canonical.commits (authority_kind, authority_id)
  WHERE authority_kind = 'FRONTEND_REVIEW_APPROVAL' AND authority_id IS NOT NULL;

-- canonical.claims: same authority reference; legacy manifest_id becomes
-- nullable and is only populated on the legacy path.
ALTER TABLE canonical.claims
  ALTER COLUMN manifest_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS authority_id TEXT,
  ADD COLUMN IF NOT EXISTS authority_digest TEXT;

-- Frontend claim source versions are free-form text identities (the legacy
-- uuid-typed column would reject them). Widening uuid -> text is lossless and
-- additive; legacy uuid values coerce implicitly on insert.
ALTER TABLE canonical.claims
  ALTER COLUMN source_version_id TYPE text;
