# FE-P5-S2 WP5 — Reversal Durable Ownership Architecture Amendment (ADR-131 §4/§7a)

- Status: **APPROVED (user Product Implementation delegation)**
- Proposed at: 2026-08-09
- Work item: `FE-P5-S2`
- Governing ADR: `ADR-131` (ACCEPTED)
- Implementation Request: `docs/implementation/frontend-phase-5-section-2-implementation-request-260808001.md`
- Trigger: GPT WP5 Round 4 Review — `REVERSAL_AUTHORITATIVE_OWNERSHIP_CONFLICT`

## Context

ADR-131 §4 fixes the Reversal owner as `change-set-review` AUGMENT:

```text
Historical Revision → Reversal DraftChangeSet → current Snapshot impact
→ current Review → current Approval → Canonical Commit
```

WP5 Round 3 (GPT Blocker 1) reverted the additive `review.reversals` migration
(033) because the Frozen IR migration sequence was fixed at 030/031/032. To keep
the Reversal durable without a migration change, Round 3 materialized the
Reversal as a SUBMITTED `FrontendKnowledgeDraftChangeSet` in the approved
frontend-knowledge-draft store (migration 025).

GPT Round 4 found that this moved the **durable authoritative owner** of the
Reversal from `change-set-review` to `frontend-knowledge-draft`, and that the
materialization drops Reversal contract fields (`sourceCommitId`,
`historicalApprovalRef`, Reversal `status`, `evidenceLineage`) — incompatible
with the Frozen ADR-131 ownership boundary.

## Decision

### 1. Reversal durable authority stays with `change-set-review` (Frozen owner)

The authoritative durable record of a Reversal is a `ReversalDraftChangeSetV1`
persisted by the `change-set-review` owning store. This is a direct
implementation of ADR-131 §4: `change-set-review` owns the Reversal
`DraftChangeSet` authority.

### 2. Additive persistence scopes extension (ADR-131 §7a)

The IR r1 migration sequence is amended from `030/031/032` to
`030/031/032/033` with one **bounded additive** record set:

- `db/migrations/033_frontend_review_reversal_persistence.sql` → `review.reversals`
  (reversal_id PK, project_id, reversal_json, created_at).

Rationale (direct-implementation record): the frozen `review.change_sets`
`DraftChangeSet` shape requires mandatory `candidate_id` / `comparison_id`
(Postgres FK rows that a Reversal does not have) and `revision_number = 1`,
`operation` enum; a Reversal cannot be represented there. The additive
`review.reversals` record set stores the full V1 contract JSON (same pattern as
`change_sets.change_set_json`), keeping the strict decoder as the single source
of truth. No existing table is modified; no event/history rewrite.

### 3. `frontend-knowledge-draft` is a DERIVED carrier for the current Review flow

For the existing `KNOWLEDGE_DRAFT_CHANGE_SET` Review queue/Context (frozen
browser contract — no new `ReviewTargetKind`), the reversal route ALSO
materializes a SUBMITTED `FrontendKnowledgeDraftChangeSet` as a **derived
carrier** — it is NOT the Reversal authority. The carrier preserves the
Reversal identity and evidence:

- `draftId = reversal.reversalId` (identity linkage),
- `base.canonicalResourceId/canonicalRevisionId = sourceRevisionId`,
- `evidenceLineage`/`evidenceReferences` carry the Reversal `sourceCommitId` and
  `historicalApprovalRef` (evidence/reference only — never authority),
- the carrier's own digest/artifact digests are bound to the authoritative
  Reversal fields.

The durable authority remains in `review.reversals`; the carrier is rebuilt by
the route whenever a Reversal is created and is disposable without loss of
authority.

## Impact

- `ChangeSetReviewRepositoryPort` gains additive `saveReversal` /
  `findReversalById` / `listReversals` (InMemory + Postgres `review.reversals`,
  migration 033).
- `createReversalEligibilityPort.createReversalDraftChangeSet` persists the
  candidate to the owning store before returning.
- The reversal-draft route persists the authoritative Reversal AND the derived
  Knowledge Draft carrier (migration 025) for the current Review flow.
- No frozen browser contract change; no new `ReviewTargetKind`.
