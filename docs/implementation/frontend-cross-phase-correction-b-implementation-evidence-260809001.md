---
id: FRONTEND-CROSS-PHASE-CORRECTION-B-IMPLEMENTATION-EVIDENCE-260809001
classification: EVIDENCE
verification_gate: FRONTEND-CROSS-PHASE-PRODUCT-VERIFICATION
governing_amendment: docs/implementation/frontend-cross-phase-product-gap-repair-amendment-260809001.md
governing_ir: docs/implementation/frontend-cross-phase-product-verification-implementation-request-260809001.md
branch: feat/fe-p5-xp-cross-phase-verification
implementation_head: 2cc5e35f8
subject_base: 2aa3e0c27
created_at: 2026-08-09
---

# Correction B Implementation — GPT Review Evidence

User-approved Contract Delta (2026-08-09, "승인") implemented at head `2cc5e35f8`.
This document is the GPT review evidence. Review the delta against Amendment §3.2
(frozen contract) and the scope guardrails in §4.

## 1. Implementation scope

**Approval→Canonical Commit consumer** (`knowledge.draft.commit.v1`), bounded to:

1. Migration `034_frontend_canonical_authority_provenance.sql` (additive, idempotent).
2. Contract delta: `FrontendCanonicalAuthorityV1` / `FrontendCanonicalCommitWrite`
   (ADD_CLAIM | NO_OP), `CommitKnowledgeDraftRequestV1`
   (`{ schemaVersion, clientRequestId, idempotencyKey, draftId, approvalId,
   expectedApprovalRevision }`), nullable legacy manifest identity +
   `authorityId`/`authorityDigest` on `CanonicalClaim`/`CanonicalCommitResult`/
   `CanonicalRevision`/`CanonicalHistoryEvent`/`CanonicalCommittedPayload`.
3. `CanonicalKnowledgeRepositoryPort.commitFrontendDraft(write)` in
   `postgres-stage6` (reuses the transaction core: project_state FOR UPDATE →
   replay check → STALE check → claim/commit/revision/history/outbox) and
   `stage6-in-memory`; DB-level `UNIQUE(authority_kind='FRONTEND_REVIEW_APPROVAL',
   authority_id)` → one Approval → at most one commit.
4. Coordinator `FrontendKnowledgeDraftProductCoordinator.commitFrontendDraft`:
   ledger-recorded governed command with the §3.2 revalidation chain, a
   **deterministic commit id** (derived from approvalId+draftId so replay and
   crash-recovery rebuild the identical write), CLAIM_ADD/NO_OP-only mapping
   (any other operation kind → `UNSUPPORTED_OPERATION`, approval left ACTIVE),
   and ordering: durable Canonical commit → `consumeApproval` → ledger COMPLETED.
5. Route `POST /product-api/frontend/knowledge/drafts/commit` + `server.ts`
   wiring (approvals read/consumed through the review store transaction
   boundary; canonical repo).
6. `onReplayRecovery`: a retry of an ACCEPTED/OUTCOME_UNKNOWN commit command
   re-issues the same write idempotently (existing commit returned, approval
   corrected to CONSUMED) and completes the ORIGINAL ledger command.

**Explicitly NOT changed**: legacy Stage-5 `ChangeSetApproved`→`commit()` path
(only additive `authorityId:null` fields on legacy claim/result JSON); no
legacy `ApprovedChangeSetManifest` fabrication; no auto-commit on Approve
(FE-P4-S1 preserved); no new runtime dependency.

## 2. Bounded schema delta (migration 034)

- `canonical.commits`: `manifest_id`/`change_set_id`/`manifest_digest` now
  NULLable; `authority_kind TEXT NOT NULL DEFAULT 'LEGACY_STAGE5_MANIFEST'`
  CHECK in the two values; `authority_id`/`authority_digest TEXT`;
  `CREATE UNIQUE INDEX ... ON canonical.commits(authority_kind, authority_id)
  WHERE authority_kind='FRONTEND_REVIEW_APPROVAL' AND authority_id IS NOT NULL`.
- `canonical.claims`: `manifest_id` NULLable; `authority_id`/`authority_digest`
  TEXT; `source_version_id uuid → text` (frontend source versions are free-form
  text; legacy uuid values coerce implicitly — lossless widening).
- Existing Stage-5 rows untouched (`authority_kind = LEGACY_STAGE5_MANIFEST`,
  manifest/changeSet preserved). Statements are idempotent
  (`ADD COLUMN IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`).

## 3. Contract JSON schema updates (required for output validation)

The Canonical knowledge module validates message outputs against JSON schemas
(`additionalProperties:false`). Without updates, any commit whose
`result_json`/`claim_json` carried the new fields (or a NULL manifest) was
rejected by the connector, breaking Search/Compiled Truth projection rebuilds.
Updated:
`canonical-commit-result.v1.schema.json`, `canonical-claim.v1.schema.json`,
`canonical-history-event.v1.schema.json`, `canonical-committed.v1.schema.json`
(nullable manifest/changeSet + `authorityId`/`authorityDigest`; `accessScope`
`minItems` dropped to allow NO_OP payloads with empty scope).

## 4. Revalidation chain (fail-closed, §3.2 item 2)

Draft: exists → `resourceProjectId === activeProjectId` → `status === SUBMITTED`
→ recomputed `frontendKnowledgeDraftRevisionDigest` matches submission
`contentDigest`. Approval: `purpose === KNOWLEDGE_CANONICAL_CHANGE` →
`status === ACTIVE` → not expired → project/accessRevision/policyContextRevision
match scope → `targetId === draftId` → `targetRevision === draft.revision` →
`targetDigest === submission.contentDigest` → recomputed
`reviewApprovalManifestDigest` equals `approvedManifestDigest`. Canonical:
`getSnapshot.version/digest` equals draft `base` (else `STALE_APPROVAL`).
Mapping: approved `item-N` → `operations[N-1]`; exactly zero CLAIM_ADD → one
NO_OP commit; exactly one CLAIM_ADD → one ADD_CLAIM commit; any other kind or
2+ CLAIM_ADD → `UNSUPPORTED_OPERATION` (approval left ACTIVE).

## 5. Ordering and recovery

Order: durable Canonical commit → `consumeApproval(approvalId, commitId,
consumedAt, consumedBy)` (idempotent for the same commitId) → ledger
`completeInTransaction`. Outbox publication remains a separate retry step.
Replay (ledger COMPLETED) resolves the same commit identity via RESOLVE mode
(tolerates the already-CONSUMED approval). Crash between commit and consume:
retry hits `onReplayRecovery`, re-issues the deterministic write (existing
commit returned, no new commit), corrects the approval to CONSUMED, completes
the original command.

## 6. Verification

- `tsc --noEmit`: clean.
- New `tests/database/frontend-canonical-commit-frontend-draft.test.ts` (6):
  ADD_CLAIM provenance (no manifest), replay idempotency, one-approval-one-commit
  CONFLICT, STALE fail-closed, NO_OP, legacy row preservation. **6/6 pass.**
- New `tests/integration/frontend-knowledge-draft-commit.test.ts` (8): commit +
  consume, replay identity, NO_OP, non-ACTIVE reject, unmappable (FACT_ADD)
  reject with approval left ACTIVE, multi-CLAIM_ADD reject, STALE, forged
  binding digest reject. **8/8 pass.**
- Regression (sequential DB run, repo `test:database` flags): recovery/parity/
  history DB suites **16/16 pass** (incl. `stage12-1-outbox-projection-recovery`,
  `frontend-review-postgres-parity`, `frontend-history-persistence`).
- Unit/contract/integration sweep: 1238 pass; the only intermittent failures
  (compiled-truth temporal, cited-search-ui, knowledge-model networkx) are
  pre-existing parallel-execution flakes — each passes standalone and
  `--fileParallelism=false`.
- Migration applied to the dev DB (034) and re-appliable idempotently.

## 7. Open items / decisions for GPT

1. **Multi-claim drafts fail-closed**: the frozen contract is single-claim per
   approval (write union ADD_CLAIM/NO_OP) + `UNIQUE(authority_kind, authority_id)`.
   An approved set with 2+ CLAIM_ADD operations is rejected as
   `UNSUPPORTED_OPERATION` (approval left ACTIVE). Confirmed aligned with §3.2
   (which takes precedence over the §3.1 "one commit per claim" sentence).
2. **NO_OP CanonicalCommitted payload**: `accessScope: []` (no claim) — schema
   `minItems` relaxed to allow it. Alternative was embedding the actor scope in
   the NO_OP write (contract deviation); chose schema relaxation.
3. **Crash between consume and ledger-complete**: retry fails-closed
   (`REVIEW_APPROVAL_EXPIRED` since the approval is CONSUMED) → ledger
   `markOutcomeUnknown`; the common crash window (commit→consume) recovers.
4. **`source_version_id uuid → text`** is a bounded widening required by the
   frontend source-version identity format.

## 8. Next gate

GPT review → if ACCEPTED → WP-XP2 resumes (cross-phase journey E2E + XP-I01~07).
