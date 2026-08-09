---
id: FRONTEND-CROSS-PHASE-CORRECTION-B-IMPLEMENTATION-EVIDENCE-260809001
classification: EVIDENCE
verification_gate: FRONTEND-CROSS-PHASE-PRODUCT-VERIFICATION
governing_amendment: docs/implementation/frontend-cross-phase-product-gap-repair-amendment-260809001.md
governing_ir: docs/implementation/frontend-cross-phase-product-verification-implementation-request-260809001.md
branch: feat/fe-p5-xp-cross-phase-verification
round1_head: 2cc5e35f8
round2_head: ee4147374
round3_head: 093ea985d
ci_head: 6d00656b2
subject_base: 2aa3e0c27
created_at: 2026-08-09
---

# Correction B Implementation — GPT Review Evidence

User-approved Contract Delta (2026-08-09, "승인") implemented. Round 1 head
`2cc5e35f8`; Round 2 (CHANGES_REQUIRED corrections, 2026-08-10) head
`ee4147374`; Round 3 (Recovery existing-commit branch, 2026-08-10) head
`093ea985d`. **GPT Review Round 3: TECHNICALLY ACCEPTED (2026-08-10).**
Exact-head automatic CI green at `6d00656b2` (Draft PR #83, normal workflow
entry; no empty commits, no manual CI). **`source_version_id uuid→text` bounded
migration delta RATIFIED BY USER (2026-08-10, "승인").** Both Final-Authority
gates satisfied; Correction B Final Authority pending GPT confirmation.
Review against Amendment §3.2 (frozen contract) and scope guardrails §4.

## 1. Implementation scope

**Approval→Canonical Commit consumer** (`knowledge.draft.commit.v1`), bounded to:

1. Migration `034_frontend_canonical_authority_provenance.sql` (additive, idempotent).
2. Contract delta: `FrontendCanonicalAuthorityV1` / `FrontendCanonicalCommitWrite`
   (ADD_CLAIM | NO_OP), `CommitKnowledgeDraftRequestV1`
   (`{ schemaVersion, clientRequestId, idempotencyKey, draftId, approvalId,
   expectedApprovalRevision }`), nullable legacy manifest identity +
   `authorityId`/`authorityDigest` on `CanonicalClaim` and `CanonicalCommitResult`
   (provenance is projected into History payloads through the commit result).
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
   > **SUPERSEDED BY ROUND 2 §9.1** — the consume→ledger-complete window now
   > recovers idempotently (already-CONSUMED by the same commit is accepted).
4. **`source_version_id uuid → text`** is a bounded widening required by the
   frontend source-version identity format.

## 8. Next gate

GPT review → if ACCEPTED → WP-XP2 resumes (cross-phase journey E2E + XP-I01~07).

## 9. Round 2 — CHANGES_REQUIRED corrections (2026-08-10)

GPT Review Round 1 verdict: **CHANGES_REQUIRED**. All four blocking items fixed
as delta-only corrections (the normal commit path, migration provenance
structure and legacy Stage-5 separation were NOT reworked).

### 9.1 Crash recovery now recovers both windows (GPT #1)

`onReplayRecovery` no longer runs the full `REVALIDATE` chain. It re-issues the
SAME deterministic write under **RESOLVE** identity checks (draft/approval
identity + binding digest), then `commitFrontendDraft` (replay-idempotent: same
commitId + authority → returns the existing commit BEFORE the STALE guard) and
`consumeApproval` (idempotent for the same canonicalCommitId).

- Window A (durable commit → crash before consume): retry returns the same
  commit, Approval ACTIVE → CONSUMED, original ledger COMPLETED.
- Window B (commit + consume → crash before ledger COMPLETED): retry accepts
the already-CONSUMED (same commit) Approval, original ledger COMPLETED.
- Focused regression: `tests/integration/frontend-knowledge-draft-commit.test.ts`
  `recovers a commit→consume crash ...` (#1-A) and
  `recovers a consume→ledger-complete crash ...` (#1-B) — both pass.

### 9.2 expectedApprovalRevision enforced (GPT #2)

- `ReviewApprovalStorePort.findByIdWithRevision` added; in-memory tracks an
  append-only revision map, Postgres reads the latest `approval_status_revision`.
- Coordinator `revalidated` verifies
  `approvalStatusRevision === request.expectedApprovalRevision` (fail-closed
  `STALE`) on the normal path; skipped in RESOLVE (replay/recovery may observe
  a legitimately advanced revision).
- Postgres `consumeApproval` writes `currentRevision + 1` (no hardcoded `2`).
- Browser can read the revision: `GetReviewApprovalResultV1` now carries
  `approvalStatusRevision` (additive; decoder + product API + contract test
  updated).
- Parity test `tracks append-only approval status revisions ...` covers
  insert(1)→consume(2)→idempotent(2)→different-commit conflict in both stores.

### 9.3 No fabricated sourceVersionId (GPT #3)

`buildWrite` CLAIM_ADD path now requires `evidenceReferences.length >= 1`
(fail-closed `VALIDATION_FAILED`) and rejects multiple distinct source versions
(`UNSUPPORTED_OPERATION`); the `?? resourceId` fallback is removed.

### 9.4 History provenance + evidence description aligned (GPT #4)

- `CanonicalHistoryAdapter` now projects `authorityId`/`authorityDigest` from
  the authoritative `CanonicalCommitResult` into the History payload.
- Evidence description corrected: only `CanonicalClaim`/`CanonicalCommitResult`
  carry authority fields.

### 9.5 Open item resolutions (GPT #5)

- §3.1 "one commit per claim" marked **SUPERSEDED** by the §3.2 delta (one
  Approval → at most one commit; 2+ CLAIM_ADD fail-closed).
- `canonical-committed` schema: `accessScope` non-empty constraint restored for
  `ADD_CLAIM` via `if/then`; only `NO_OP` may carry an empty scope.
- `source_version_id uuid → text` recorded as a **bounded migration delta** in
  Amendment §4.1, pending user ratification record (§6).

## 10. Round 3 — Recovery existing-commit branch (2026-08-10)

GPT Review Round 2 verdict: **CHANGES_REQUIRED** — 3 items closed
(`expectedApprovalRevision`, sourceVersion lineage, History provenance), one
Recovery blocker remains: `onReplayRecovery` did NOT first check whether the
durable commit exists, so a recovery retry could silently rebase a stale Draft
onto the current Canonical snapshot and commit.

Fixed per the GPT algorithm:

1. **Branch on existing commit first**: `onReplayRecovery` computes the
   deterministic commit id and calls `canonical.findCommit(projectId, commitId)`.
   - Existing commit → verify `projectId` + `authorityId` + `authorityDigest`
     (`=== approval.approvedManifestDigest`), no Canonical stale revalidation,
     recover the Approval (ACTIVE → CONSUMED, or already CONSUMED by the same
     commit → idempotent), complete the ORIGINAL ledger command.
   - No existing commit → full `REVALIDATE` (Approval ACTIVE/expiry/revision,
     Draft base == current Canonical, binding digests) then normal
     `commitFrontendDraft` → consume → COMPLETE. A stale Draft is NEVER
     rebased.
2. **Repository replay guard now verifies `authorityDigest`** (in addition to
   `projectId`/`authorityId`) in `postgres-stage6` and `stage6-in-memory`.
3. **Focused regression** (new): recovery with NO existing commit while
   Canonical advanced → `STALE_APPROVAL`, no commit for the original Approval,
   Approval remains ACTIVE. Plus DB-level test: same commitId replay with a
   forged `approvalBindingDigest` → `CONFLICT`.

Existing crash A/B tests kept unchanged and still pass.

## 11. GPT Review Round 3 — TECHNICALLY ACCEPTED (2026-08-10)

GPT verdict: **ACCEPTED** (technical).

- Existing-commit-first recovery: **PASS** — `onReplayRecovery` now looks up the
  deterministic commit id first; existing commit → verify
  projectId/authorityId/authorityDigest, recover Approval, complete original
  command; no existing commit → full REVALIDATE (stale Draft is never silently
  rebased).
- `authorityDigest` replay guard: **PASS** (PostgreSQL + InMemory use the same
  rule).
- No-existing-commit stale recovery: **FAIL-CLOSED / PASS** — the focused
  regression (`STALE_APPROVAL`, no commit, Approval ACTIVE) passes.
- Forged `approvalBindingDigest` replay → `CONFLICT` DB-level regression: **PASS**.
- Round 1 blockers: CLOSED. Round 2 blocker: CLOSED.

GPT requires NO further code changes and NO test re-runs. The two
Final-Authority gates (non-code) are now SATISFIED:

1. **User ratification** of the `source_version_id uuid→text` bounded
   migration delta — **RATIFIED BY USER (2026-08-10, "승인")**; recorded in
   Amendment §4.1 / §6.
2. **Exact-head automatic CI** — RUN + GREEN via the normal Draft PR #83
   workflow at `6d00656b2` (Frontend / Quality / Required Gates all pass;
   Node.js 20 deprecation warning only).

Correction B Final Authority: both gates satisfied → pending GPT Final
Authority confirmation. WP-XP2: PAUSED until that confirmation.
