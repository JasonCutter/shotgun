# Issue 203 WP6 Operational Rollout and Replacement

## Implemented boundary

The existing `CandidateValidated` consumer now has an optional application
composition seam. The default composition is unchanged. When v2 persistence,
Review, semantic-generation, and governed provider ports are supplied, the seam
uses `comparison.stage5.rollout` to select the authority and invokes the
existing WP5 orchestrator. `V2_ACTIVE` re-reads authority before calling the
existing v2 Review Bridge; `V1_ONLY` and `V2_SHADOW` preserve v1 authority.

## Persistence and migration

Settings remain append-only in `settings.settings_revisions`; no migration was
added. PostgreSQL and in-memory Settings adapters expose the narrow structural
read `getProjectSettingValue`. Existing Postgres Comparison v2 and Review v2
repositories are reused.

## Verification

Focused tests cover R6-01 through R6-11 plus the actual CandidateValidated
composition seam. No live provider, Canonical write, frontend change, or ECAV
run was performed. The OSS decision is recorded in
`issue-203-wp6-oss-integration-decision.md`.
