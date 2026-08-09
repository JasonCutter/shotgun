---
id: FRONTEND-PHASE-5-SECTION-2-WP3-EVIDENCE-260809001
classification: CANONICAL
status: wp3_implemented_pending_review
work_item: FE-P5-S2
created_at: 2026-08-09
subject_base: 701e0bfac5af60daa48d9155185956b91650ecbd
wp2_accepted_head: fa231a758dcb016f96341961717e8879e5601ed2
wp2_accepted_ci_number: 685
wp3_implementation_head: b2dc8d4e3e4c6d5c395173745f0eb6a2c6f66b5e
wp3_implementation_ci_number: 688
wp3_implementation_ci_run_id: 31291149589
wp3_implementation_ci_conclusion: SUCCESS
tracking_issue: https://github.com/JasonCutter/shotgun/issues/71
contract_pr: https://github.com/JasonCutter/shotgun/pull/70
product_pr: https://github.com/JasonCutter/shotgun/pull/80
governing_adr: ADR-131
contract_snapshot: docs/architecture/contracts/snapshots/frontend-phase-5-section-2/frontend-phase-5-section-2-contract-snapshot-260808001.md
implementation_request: docs/implementation/frontend-phase-5-section-2-implementation-request-260808001.md
---

# FE-P5-S2 — WP3 Reversal DraftChangeSet Evidence

## 1. Scope

WP3 — Reversal DraftChangeSet (Implementation Request r1 §5 WP3) implemented on
`feat/fe-p5-s2-wp1-contracts-persistence` (PR #80, Draft) after WP2 was ACCEPTED (head
`fa231a758`, CI #685 SUCCESS).

Flow implemented (ADR-131 §4 / IR r1 §5 WP3):

```text
Historical Revision → eligibility check → Reversal DraftChangeSet
  → current Snapshot impact → current Review → current Approval → Canonical Commit
```

Reversal is owned by `change-set-review` as an AUGMENT (no new Domain). Historical approval
is evidence/reference only; historical approval authority reuse is FORBIDDEN.

## 2. Implemented files

| File                                                         | Content                                                                                                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `modules/change-set-review/src/reversal.ts`                  | `ReversalEligibilityPort`, `ReversalEligibilityV1` gate, `createReversalEligibilityPort`, `computeReversalSnapshotImpact`, typed failure codes |
| `modules/change-set-review/src/index.ts`                     | module exports                                                                                                                                 |
| `modules/canonical-knowledge/src/index.ts`                   | `CanonicalKnowledgeRepositoryPort.findRevision` added                                                                                          |
| `adapters/stage6-in-memory/src/index.ts`                     | `InMemoryCanonicalKnowledgeRepository.findRevision`                                                                                            |
| `adapters/postgres-stage6/src/index.ts`                      | `PostgresCanonicalKnowledgeRepository.findRevision` (`canonical.revisions`)                                                                    |
| `packages/contracts/src/errors.ts`                           | FE-P5-S2 Reversal typed ErrorCodes                                                                                                             |
| `packages/contracts/src/failure-contract.ts`                 | Reversal failure descriptors + detail keys                                                                                                     |
| `tests/unit/change-set-review-reversal.test.ts`              | 12 tests                                                                                                                                       |
| `tests/database/change-set-review-reversal-postgres.test.ts` | 3 tests                                                                                                                                        |

## 3. Eligibility gate (server-derived, fail-closed)

`assessReversalEligibilityFromHistory` is pure and deterministic over the authoritative
canonical source revision + history. A source revision is eligible ONLY when ALL hold:

- source revision exists (`REVERSAL_SOURCE_NOT_FOUND` otherwise)
- current server-derived capability includes `project:action:rollback`
  (`REVERSAL_MISSING_CURRENT_CAPABILITY` otherwise)
- no historical approval is being reused as authority (`historicalApprovalResolver` supplies
  the reference; `REVERSAL_HISTORICAL_APPROVAL_REUSE` otherwise)
- no later `CANONICAL_CLAIM_ADDED` exists (→ `REVERSAL_SUPERSEDED_TARGET` +
  `REVERSAL_DEPENDENT_REVISION_CONFLICT`)
- if only later `CHANGESET_NO_OP` events exist → `REVERSAL_STALE_TARGET`
- if the source revision is the current tip → eligible

`createReversalEligibilityPort` loads the authoritative source through the injected canonical
reader and produces a `ReversalDraftChangeSetV1` (status `CANDIDATE`) when eligible; otherwise
it throws the typed `ReversalFailureCode`.

## 4. Current Snapshot impact

`computeReversalSnapshotImpact` projects the current canonical snapshot after the Reversal:
every claim added by a later `CANONICAL_CLAIM_ADDED` event is removed, yielding
`impactedVersion`, `removedClaimIds`, `retainedClaimIds`, and the impacted snapshot digest
(identity preserved on the source side — no authoritative row is deleted).

## 5. Required negative cases (IR r1 §5 WP3)

| Case                        | Result                                              |
| --------------------------- | --------------------------------------------------- |
| historical approval reuse   | typed reject `REVERSAL_HISTORICAL_APPROVAL_REUSE`   |
| stale target                | typed reject `REVERSAL_STALE_TARGET`                |
| superseded target           | typed reject `REVERSAL_SUPERSEDED_TARGET`           |
| dependent revision conflict | typed reject `REVERSAL_DEPENDENT_REVISION_CONFLICT` |
| missing current capability  | typed reject `REVERSAL_MISSING_CURRENT_CAPABILITY`  |

## 6. Verification

- WP3 focused suites: unit 12 + DB 3 = **15 tests PASS**.
- Full `npm run test:database`: **197 tests PASS** (37 files).
- `tsc --noEmit`, ESLint, Prettier clean.
- Automatic CI on push (PR #80, Draft).

## 7. Preserved boundaries

Not implemented in this Work Package (remain unauthorized):

- WP4 Federated History Projection + Product API.
- WP5 History Workspace UI.
- WP6 Integrated Verification + Security + Performance.
- Central authoritative History ledger: FORBIDDEN.
- Direct canonical restore: FORBIDDEN (Reversal always flows through current Review +
  current Approval + Canonical Commit).
- PR #80 Ready/Merge: user approval required, remains DRAFT.

## 8. Next action

Report WP3 implementation for the GPT Review. Do not begin WP4 until WP3 is reviewed and
accepted.
