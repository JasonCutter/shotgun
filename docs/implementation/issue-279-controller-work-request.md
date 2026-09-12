# Issue #279 — Controller Work Request

Status: ACTIVE

Canonical base: `7fde6a095a140a037a5ccb03864d6f3916e1bb60`

Branch: `codex/issue-279-stage5-terminalization-version-semantics`

## Frozen objective

Eliminate the observed Source 2 Stage5 V2 silent omission completely before unrelated cleanup.

### Required corrections

1. Separate Stage7 lexical per-row commit/version metadata from Canonical Claim resource revision and current Snapshot version. Historical Canonical Claims projected at v1/v2 must remain valid members of a current v3 READY projection when the project watermark matches the current Canonical snapshot.
2. Hybrid fusion must not compare lexical per-row commit version with semantic generation base version as if they were the same semantic field, and must not map lexical Canonical version into Claim `resourceRevision`/`authorityRevision`.
3. `CandidateValidated` under `V2_ACTIVE` must not ACK success unless the execution has a durable `ComparisonResultV2` and Review Draft. BLOCKED/incomplete/Review-blocked execution must fail the required ACK rather than silently return.
4. Preserve `V1_ONLY`, `V2_SHADOW`, explicit `RecompareClaimCandidate`, Review authority, Canonical safety, and Issue #277 behavior.
5. Add production-history-shaped tests: create Canonical/project/search state incrementally (v1 -> v2 -> v3), prove stable exact duplicate and backup update candidates are not rejected as `SNAPSHOT_INTEGRITY`, and prove the real `CandidateValidated`/Connector boundary does not persist `SUCCEEDED + null` for a non-terminal V2 execution.

## Safety

Do not mutate owner/live DB or owner worktree. Do not reopen or rerun Issue #277. Source 2 Review remains unapproved until the correction is merged and revalidated.
