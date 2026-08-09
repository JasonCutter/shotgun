---
id: FRONTEND-CROSS-PHASE-PRODUCT-GAP-REPAIR-AMENDMENT-260809001
classification: CANDIDATE
status: proposed_pending_user_approval
verification_gate: FRONTEND-CROSS-PHASE-PRODUCT-VERIFICATION
created_at: 2026-08-09
subject_base: 07990d6e68878d630a6fc0e472c660e5cab69f91
governing_ir: docs/implementation/frontend-cross-phase-product-verification-implementation-request-260809001.md
governing_contract: docs/architecture/frontend/cross-phase-contract-and-completion-audit.md
governing_adr: ADR-128
---

# Cross-Phase Blocking Product Correction — Bounded Gap Repair Amendment

## 1. Verdict context

GPT adjudication (2026-08-09): **Cross-Phase Blocking Discovery #2 Verdict: PRODUCT_GAP_CONFIRMED**
- CP-AC-08 (Canonical Commit): **BLOCKED**.
- Journey scope reduction: **REJECTED** — CP-AC-08 is a required end-to-end flow of the
  Canonical plan; ADR-128 already specifies a later consumer that revalidates
  purpose/target/policy/expiry/digest.
- Required direction: **BOUNDED PRODUCT CORRECTION** (no new Phase, no new Section, no
  journey reduction, no legacy-manifest silent coercion, no duplicate CI).

This amendment records two Blocking Product Corrections found by WP-XP1 and the minimal
Product contract to repair them. It does NOT authorize anything beyond the bounded repair.

## 2. Blocking Product Correction A — Draft → Review PostgreSQL production wiring

- **Status: IMPLEMENTED (head afaa67f0) / PENDING GOVERNANCE RATIFICATION.**
- Finding: `server.ts` used `createEmptyReviewDraftSourceReader()` for the non-in-memory
  Knowledge Draft repository path, so in the production composition (Postgres draft repo)
  SUBMITTED Knowledge Drafts and Reversal carriers never reached the Review queue.
- Repair (already implemented, minimal): added `frontendReviewDraftSourceReader?` to
  `ApplicationOptions`; `main.ts` now passes `createPostgresReviewDraftSourceReader(pool)`.
  The in-memory path (existing per-Section fixture) is unchanged (fallback preserved).
- Governance: this was a wiring repair that technically exceeded the IR r1
  "No production code change" wording; it is ratified by this amendment (no revert
  needed; approval history recorded here).

## 3. Blocking Product Correction B — Approval → Canonical Commit consumer

- **Status: CONFIRMED GAP / PENDING CONTRACT + USER APPROVAL.**
- Finding: the Frontend Review product API issues a `KNOWLEDGE_CANONICAL_CHANGE` Approval
  (FE-P4-S1/FE-P3-S2 flow) but **no product code consumes that approval to commit to
  Canonical**. The only `CanonicalKnowledgeRepositoryPort.commit()` production call site is
  the legacy Stage-5 `ChangeSetApproved` handler (`modules/canonical-knowledge/src/index.ts:427`),
  driven by the legacy whole-ChangeSet `ApprovedChangeSetManifest` — completely separate from
  the Frontend Review flow. There is no product-API canonical commit/apply endpoint.
- This is exactly the ADR-128 "later consumer" that was specified but never implemented.

### 3.1 Targeted gap audit summary (2026-08-09)

1. **Approved item set → Canonical mutation**: only `CLAIM_ADD` (→ `ADD_CLAIM`) and `NO_OP`
   have a Canonical mutation today; `CLAIM_UPDATE`/`CLAIM_REMOVE` and all other 24 operation
   kinds have NO Canonical model. The commit consumer must map `CLAIM_ADD`/`NO_OP` and
   **fail-closed (reject)** approved drafts containing any unmappable operation.
2. **Atomic multi-operation commit**: Canonical `commit()` is single-claim
   (`operation: 'ADD_CLAIM' | 'NO_OP'`), with per-commit replay idempotency (same
   commitId + manifestDigest → replay; different content → CONFLICT) and a version guard
   (`expectedCanonicalVersion`/`snapshotDigest` mismatch → `STALE_APPROVAL`). Multi-claim
   approved drafts commit as one command with one commit per claim.
3. **Approval lifecycle**: `ReviewApprovalStorePort` exposes only
   `findById/insert/listByProject` — no status transition. Postgres schema supports
   append-only `approval_status_revision` (migration 027 block-mutation trigger), but no
   code writes `CONSUMED`. The External Action model revalidates ACTIVE + expiry at consume
   time with idempotency owned by the command ledger. The minimal contract follows this
   model and additionally adds a bounded `CONSUMED` transition on successful commit.
4. **STALE fail-closed**: revalidate the current Canonical `getSnapshot` version/digest
   against the draft `base` and the approval binding; revalidate approval
   purpose/ACTIVE/expiry/project/accessRevision/policyContextRevision; recompute
   `reviewApprovalManifestDigest` and the draft `contentDigest`.
5. **Idempotent command/outcome**: a new governed command (below) follows
   `accept → lockAcceptedForExecution → completeInTransaction` on the shared Frontend
   Command Ledger; replay resolves by `clientRequestId`+`idempotencyKey`+`semanticDigest`
   with no duplicate commit.

### 3.2 Minimal Product contract (proposal)

**Command**: `knowledge.draft.commit.v1` (Frontend governed command, ledger-recorded).

1. **Request** (server-derived authority, browser never declares capability/project):
   `{ schemaVersion, clientRequestId, idempotencyKey, draftId, approvalId, expectedApprovalRevision }`.
2. **Revalidation chain** (all fail-closed, non-disclosing):
   - load draft (`drafts.findById`) → must exist, `resourceProjectId === scope.activeProjectId`,
     `status === 'SUBMITTED'`; recompute draft `contentDigest`.
   - load approval (`approvals.findById`) → `purpose === 'KNOWLEDGE_CANONICAL_CHANGE'`,
     `status === 'ACTIVE'`, `expiresAt > now`, `projectId`/`accessRevision`/`policyContextRevision`
     match scope; `targetId === draft.draftId`; recompute `reviewApprovalManifestDigest`
     (approvedItemIds/contextRevision/targetRevision/targetDigest/purpose) and cross-check
     `targetDigest` against draft `contentDigest`.
   - load Canonical (`canonical.getSnapshot`) → version/digest must equal draft `base`
     (`canonicalVersion`/`canonicalSnapshotDigest`) else `STALE` fail-closed.
   - map draft operations → only `CLAIM_ADD` and `NO_OP`; any other kind → typed reject
     (no Canonical representation), approval left ACTIVE.
3. **Execution**: for each mapped `CLAIM_ADD`/`NO_OP`, `canonical.commit({ commitId,
   revisionId, historyEventId, outboxId, claimId?, manifest, actor, committedAt })`
   (manifest carries the approved binding; commitId is the replay key). Then
   `dispatchCanonicalOutbox` and, on success, transition the approval
   **ACTIVE → CONSUMED** (new bounded store operation + Postgres append-only
   `approval_status_revision = 2`).
4. **Outcome**: `completeInTransaction` with produced resource
   `'stage6.canonical.commit'`; failures → `reject` / `markOutcomeUnknown`; replay resolves
   by original identity (never a second commit).
5. **Route**: `POST /product-api/frontend/knowledge/drafts/commit` (guarded; CSRF; body-only).

**Store delta**: add `consumeApproval(approvalId, consumedAt, consumedBy, revision)` to
`ReviewApprovalStorePort` + in-memory + Postgres (append-only status revision; keep
block-mutation trigger; `findById`/`listByProject` read latest status revision).

## 4. Scope guardrails (bounded repair only)

- No new Phase, no new Section, no new Work Item.
- No journey scope reduction; CP-AC-08 stays mandatory.
- No silent coercion of Frontend approvals into the legacy Stage-5 manifest.
- No auto-commit on Approve (FE-P4-S1 contract preserved: Approval issuance has no Commit
  side effect).
- Canonical commit remains single-claim `ADD_CLAIM`/`NO_OP`; unmappable draft operations
  fail-closed.
- No new runtime dependency; no migration beyond the bounded approval status revision
  extension (027/033 already provide the append-only structure; the Postgres approval table
  already has `approval_status_revision`).

## 5. Authority gate

```text
Amendment: PROPOSED / PENDING USER APPROVAL  ← CURRENT GATE
→ USER explicit approval
→ Amendment APPROVED / RATIFIED (Correction A ratified, Correction B contract frozen)
→ Correction B implementation (bounded, one at a time)
→ focused verification + exact-head automatic CI
→ GPT review ACCEPTED
→ WP-XP2 resumes (journey + XP-I01~07)
```
