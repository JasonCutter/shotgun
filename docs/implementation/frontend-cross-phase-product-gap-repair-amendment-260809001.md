---
id: FRONTEND-CROSS-PHASE-PRODUCT-GAP-REPAIR-AMENDMENT-260809001
classification: CANONICAL
status: approved
approved_by: USER
approved_at: 2026-08-09
approval_authority: Explicit user amendment approval
approval_head: 337a07162
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
   > **SUPERSEDED (2026-08-10, GPT Review Round 1 #5):** the frozen §3.2 delta fixes a
   > single-claim `FrontendCanonicalCommitWrite` per Approval plus
   > `UNIQUE(authority_kind, authority_id)` (one Approval → at most one Canonical commit
   > at the DB level). An approved set with 2+ `CLAIM_ADD` operations is therefore
   > **fail-closed** (`UNSUPPORTED_OPERATION`), NOT "one commit per claim". This sentence
   > is retained only as the pre-delta audit record.
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

### 3.2 Minimal Product contract (proposal → GPT-confirmed delta, 2026-08-09)

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
3. **Execution (GPT-confirmed, CORRECTED from the r1 draft)**:
   - The r1 draft said `canonical.commit({ ..., manifest })` — this conflicts with the
     legacy-coercion prohibition. **Corrected:** the commit consumer builds a
     **Frontend Canonical Commit Write** (below) and calls **`canonical.commitFrontendDraft(write)`**.
     No Stage-5 `ApprovedChangeSetManifest` is ever fabricated.
   - Frozen write shape:
     ```ts
     type FrontendCanonicalAuthorityV1 = {
       kind: 'FRONTEND_REVIEW_APPROVAL';
       approvalId: string;
       approvalBindingDigest: string;
       reviewContextId: string;
       contextRevision: number;
       draftId: string;
       draftRevision: number;
       draftContentDigest: string;
       approvedItemIds: readonly string[];
     };
     type FrontendCanonicalCommitWrite =
       | { commitId: string; revisionId: string; historyEventId: string; outboxId: string;
           projectId: string; operation: 'ADD_CLAIM'; claimId: string; claimText: string;
           sourceVersionId: string; evidenceIds: readonly string[];
           accessScope: readonly string[]; sensitivity: string;
           expectedCanonicalVersion: number; snapshotDigest: string;
           authority: FrontendCanonicalAuthorityV1; reason: string; actor: Actor;
           committedAt: string; }
       | { commitId: string; revisionId: string; historyEventId: string; outboxId: string;
           projectId: string; operation: 'NO_OP';
           expectedCanonicalVersion: number; snapshotDigest: string;
           authority: FrontendCanonicalAuthorityV1; reason: string; actor: Actor;
           committedAt: string; };
     ```
   - The common Canonical persistence core (project_state FOR UPDATE → replay check →
     stale check → claim → commit → revision → history → outbox → project update) is reused;
     only the **commit provenance** differs.
4. **Schema delta (bounded migration; the r1 "no migration" clause is AMENDED)**:
   - `canonical.commits`: add `authority_kind` (`'LEGACY_STAGE5_MANIFEST'` default /
     `'FRONTEND_REVIEW_APPROVAL'`), `authority_id`, `authority_digest`; make
     `manifest_id`/`change_set_id` NULLable; add `UNIQUE(authority_kind, authority_id)`
     (one Approval → at most one Canonical commit at the DB level).
   - `canonical.claims`: same authority reference (frontend rows reference the approval;
     legacy rows keep their manifest provenance) — no fake manifest identity in Claim rows.
   - Existing Stage-5 rows: `authority_kind = LEGACY_STAGE5_MANIFEST`, manifest/change_set
     values preserved. **No data rewrite.**
5. **Order (corrected)**: `Canonical durable commit → Approval CONSUMED → command COMPLETED`;
   Outbox publication is a separate retry/recovery step (a durable commit never leaves the
   approval ACTIVE because outbox publication later fails).
6. **Approval consume semantics**: `consumeApproval(approvalId, canonicalCommitId, consumedAt,
   consumedBy)` → `ACTIVE → CONSUMED` recording the consuming commit id; idempotent success
   when the SAME commit already consumed it; reject when a different commit consumed it or
   the approval is `REVOKED/EXPIRED/INVALIDATED`.
7. **Outcome**: `completeInTransaction` with produced resource `'stage6.canonical.commit'`;
   failures → `reject` / `markOutcomeUnknown`; replay resolves by original identity and, on
   retry after a crash between the durable commit and the consume, looks up the existing
   commit by approvalId, verifies the authority digest, makes no new commit, corrects the
   approval to CONSUMED, and completes the original command.
8. **Route**: `POST /product-api/frontend/knowledge/drafts/commit` (guarded; CSRF; body-only).

**Store delta**: `ReviewApprovalStorePort.consumeApproval(approvalId, canonicalCommitId,
consumedAt, consumedBy)` + in-memory + Postgres (append-only status revision; the consuming
canonical commit id is preserved in the approval status history for audit/history lineage;
keep block-mutation trigger; `findById`/`listByProject` read latest status revision).

## 4. Scope guardrails (bounded repair only)

- No new Phase, no new Section, no new Work Item.
- No journey scope reduction; CP-AC-08 stays mandatory.
- No silent coercion of Frontend approvals into the legacy Stage-5 manifest;
  frontend commits use `commitFrontendDraft(FrontendCanonicalCommitWrite)` only.
- No auto-commit on Approve (FE-P4-S1 contract preserved: Approval issuance has no Commit
  side effect).
- Canonical commit remains single-claim `ADD_CLAIM`/`NO_OP`; unmappable draft operations
  fail-closed.
- No new runtime dependency. Bounded additive migration (034) only: canonical commit/claim
  authority provenance + nullable legacy manifest columns + `UNIQUE(authority_kind,
  authority_id)`; no existing-row rewrite. The r1 "no migration" clause is amended by the
  GPT-confirmed contract delta (2026-08-09).

### 4.1 Bounded migration delta (2026-08-10, GPT Review Round 1 #5)

- **`canonical.claims.source_version_id uuid → text`**: required because Frontend source
  versions are free-form text identities (the legacy uuid-typed column rejected them).
  Lossless widening; legacy uuid values coerce implicitly on insert. Not explicitly in the
  original migration 034 description → recorded here as a **bounded migration delta** and
  **RATIFIED BY USER (2026-08-10, "승인")** — explicit ratification recorded in §6.
  Code is NOT reverted.

## 5. Authority gate

```text
Amendment: PROPOSED / PENDING USER APPROVAL
→ USER explicit approval (2026-08-09, "승인")  ✅ (r1 contract)
→ GPT contract delta review (2026-08-09)  ✅ — Correction B contract direction ACCEPTED,
  commitFrontendDraft APPROVED, legacy coercion FORBIDDEN, canonical provenance schema
  evolution REQUIRED, "no migration" clause MUST_BE_AMENDED
→ ★ CONTRACT DELTA (migration 034 + FrontendCanonicalCommitWrite) — APPROVED BY USER
  (2026-08-09, "승인") ✅
→ Correction B implementation (bounded, one at a time) — IN PROGRESS
→ focused verification + exact-head automatic CI
→ GPT review ROUND 1 (2026-08-10): CHANGES_REQUIRED — crash recovery / expectedApprovalRevision /
  sourceVersionId fabrication / history provenance (fixed as delta-only, head ee4147374)
→ GPT review ROUND 2 (2026-08-10): 3 closed, 1 Recovery blocker — recovery must branch on
  existing commit first + authorityDigest replay guard (fixed as delta-only, Round 3)
→ GPT review ACCEPTED
→ WP-XP2 resumes (journey + XP-I01~07)
```

## 6. Approval record

- 2026-08-09 — USER explicit approval ("승인") of the r1 Amendment.
- **Correction A (Draft→Review production wiring): RATIFIED.**
- **Correction B (Approval→Canonical Commit consumer): r1 CONTRACT APPROVED; GPT contract
  delta review ACCEPTED (commitFrontendDraft + FrontendCanonicalCommitWrite + migration 034
  provenance).** Contract delta implementation WAITS for the user contract-delta approval
  (section 5). GPT review gate follows focused verification.
- 2026-08-09 — GPT `Correction B — Canonical Commit Contract Review`: Direction APPROVED;
  `commitFrontendDraft` APPROVED; legacy `ApprovedChangeSetManifest` coercion FORBIDDEN;
  exact write shape CHANGES_REQUIRED (small normalization → frozen
  `FrontendCanonicalAuthorityV1`/`FrontendCanonicalCommitWrite`); WP-XP2 PAUSED UNTIL
  CORRECTION B COMPLETE.
- 2026-08-09 — **USER explicit approval ("승인") of the GPT-confirmed CONTRACT DELTA**
  (migration 034 + `FrontendCanonicalCommitWrite` + `consumeApproval(canonicalCommitId)`
  semantics). Correction B implementation AUTHORIZED (section 5 ✅).
- 2026-08-10 — **GPT Review Round 1: CHANGES_REQUIRED** (evidence
  `frontend-cross-phase-correction-b-implementation-evidence-260809001.md`).
  Blocking: (1) crash recovery must recover both windows, (2) `expectedApprovalRevision`
  must be enforced, (3) no fabricated `sourceVersionId`, (4) History provenance/evidence
  description alignment. Open items: §3.1 "one commit per claim" superseded; NO_OP-only
  empty `accessScope`; `source_version_id uuid→text` bounded migration delta.
- 2026-08-10 — **GPT Review Round 2: CHANGES_REQUIRED** (evidence §9). Closed:
  `expectedApprovalRevision` enforcement, sourceVersion lineage, History
  provenance. Remaining Recovery blocker: `onReplayRecovery` did not first check
  whether the durable commit exists, so a stale Draft could be silently rebased
  onto the current Canonical snapshot; repository replay guard also missed
  `authorityDigest`. Fix per GPT algorithm: branch on `findCommit` first,
  existing-commit path verifies project/authorityId/authorityDigest (no stale
  revalidation), no-existing-commit path runs full REVALIDATE; replay guard adds
  `authorityDigest`.
- 2026-08-10 — **USER "진행해"** (cont.) authorizes the Round 3 delta-only
  correction (recovery existing-commit branch + authorityDigest replay guard).
- 2026-08-10 — **USER "진행해"** authorizes the Round 2 delta-only corrections AND the
  bounded migration delta (`source_version_id uuid → text`). Ratification of the
  migration delta: **PENDING** — recorded in §4.1; confirmed by USER approval of the
  Round 2 evidence (this record is updated when explicit).
- 2026-08-10 — **GPT Review Round 3: TECHNICALLY ACCEPTED** (evidence §11).
  All implementation blockers CLOSED (Round 1 + Round 2). No further code
  changes. Remaining Final-Authority gates: (1) user ratification of the
  `source_version_id uuid→text` bounded migration delta (still PENDING), (2)
  exact-head automatic CI — RUN + GREEN via normal Draft PR #83 at `6d00656b2`
  (Frontend/Quality/Required Gates pass). WP-XP2 remains PAUSED until
  Correction B Final Authority is granted.
- 2026-08-10 — **USER explicit ratification ("승인")** of the bounded migration
  delta `canonical.claims.source_version_id uuid → text` (§4.1). Both
  Final-Authority gates are now satisfied: migration delta RATIFIED + exact-head
  automatic CI GREEN (`6d00656b2`, Draft PR #83). Correction B Final Authority
  can be granted; WP-XP2 resumes on GPT confirmation.
- 2026-08-10 — **GPT Final Implementation Review: ACCEPTED / COMPLETE**.
  Final Authority: `GPT_IMPLEMENTATION_REVIEW_ACCEPTED`. Migration delta
  USER_RATIFIED; exact Product head CI PASS (CI #742, run 31338618249,
  `6d00656b2`: Frontend/Quality/Required Gates SUCCESS). Correction B:
  ACCEPTED/COMPLETE; CP-AC-08 blocker CLOSED; Approval→Canonical Commit
  CONNECTED; Draft→Review→Approval→Canonical PRODUCT PATH AVAILABLE. WP-XP2:
  RESUME/AUTHORIZED. PR #83 remains OPEN/DRAFT (no merge until Cross-Phase
  verification completes).
