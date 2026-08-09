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
wp3_round1_fix_head: f58b3024c59d5f924e5ebc2a65743064f64ca74a
wp3_round1_fix_ci_number: PENDING
wp3_round1_fix_ci_conclusion: PENDING
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

Round 1 GPT review returned CHANGES_REQUIRED with five fix items (A-E); all five are
implemented in this document's Round 1 fixes.

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
| `modules/change-set-review/src/index.ts`                     | module exports (incl. `sortHistoryEvents`, `laterHistoryEvents`, `CurrentCapabilitiesResolver`)                                                |
| `modules/canonical-knowledge/src/index.ts`                   | `CanonicalKnowledgeRepositoryPort.findRevision` added                                                                                          |
| `adapters/stage6-in-memory/src/index.ts`                     | `InMemoryCanonicalKnowledgeRepository.findRevision`                                                                                            |
| `adapters/postgres-stage6/src/index.ts`                      | `PostgresCanonicalKnowledgeRepository.findRevision` (`canonical.revisions`)                                                                    |
| `packages/contracts/src/errors.ts`                           | FE-P5-S2 Reversal typed ErrorCodes                                                                                                             |
| `packages/contracts/src/failure-contract.ts`                 | Reversal failure descriptors + detail keys                                                                                                     |
| `tests/unit/change-set-review-reversal.test.ts`              | 19 tests (incl. server-derived capability, evidence-only approval, same-timestamp tie-break, tip non-zero impact)                              |
| `tests/database/change-set-review-reversal-postgres.test.ts` | 5 tests on real PostgreSQL (`PostgresCanonicalKnowledgeRepository`)                                                                            |

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

**Round 1 fix A — server-derived capability (no browser trust):** the browser request
(`CreateReversalDraftChangeSetInput`) carries ONLY `resourceProjectId`, `sourceRevisionId`,
`reason`, `createdBy`, `createdAt`. The current capability set is derived SERVER-SIDE via the
injected `currentCapabilitiesResolver` and passed into `assessReversalEligibility`. If no
resolver is configured, create fails closed with `REVERSAL_MISSING_CURRENT_CAPABILITY`.
Negative test: resolver returns `['project:read']` (no rollback) → create rejected.

**Round 1 fix B — historical approval is evidence/reference only:** a successful Reversal
preserves the historical approval as `historicalApprovalRef` on the Reversal DraftChangeSet
(evidence). Only an actual authority-reuse attempt rejects with
`REVERSAL_HISTORICAL_APPROVAL_REUSE`. Tests: evidence-only preservation (eligible, ref kept);
reuse attempt → typed reject.

**Round 1 fix D — authoritative history position (not createdAt-only):**
`laterHistoryEvents(sourceRevision, history)` locates the source revision's own history event
by `commitId` inside the stable ordered history (`ORDER BY created_at, history_event_id`) and
returns the rows strictly after it. Same-timestamp later events are therefore still detected
via the `historyEventId` tie-break. Negative test: source e-1 and later e-2 share `createdAt`
(e-1 < e-2 by tie-break) → source reversal → `REVERSAL_SUPERSEDED_TARGET`.

`createReversalEligibilityPort` loads the authoritative source through the injected canonical
reader and produces a `ReversalDraftChangeSetV1` (status `CANDIDATE`) when eligible; otherwise
it throws the typed `ReversalFailureCode`.

## 4. Current Snapshot impact

`computeReversalSnapshotImpact` projects the current canonical snapshot after the Reversal.

**Round 1 fix C — the source revision's OWN ADD_CLAIM effect is reversed:** for an
`ADD_CLAIM` source, `removedClaimIds` includes `sourceRevision.claimId` (its own effect) plus
every claim added by a later `CANONICAL_CLAIM_ADDED` event; `impactedVersion` is the source
revision's `beforeVersion`. A current-tip Reversal is therefore NON-ZERO: `revision:2`
(current tip, `ADD_CLAIM claim-b`, `beforeVersion=1`) → `removedClaimIds=['claim-b']`,
`impactedVersion=1`, `claim-a` retained.

Identity is preserved on the source side — no authoritative row is deleted.

## 5. Required negative cases (IR r1 §5 WP3)

| Case                        | Result                                              |
| --------------------------- | --------------------------------------------------- |
| historical approval reuse   | typed reject `REVERSAL_HISTORICAL_APPROVAL_REUSE`   |
| stale target                | typed reject `REVERSAL_STALE_TARGET`                |
| superseded target           | typed reject `REVERSAL_SUPERSEDED_TARGET`           |
| dependent revision conflict | typed reject `REVERSAL_DEPENDENT_REVISION_CONFLICT` |
| missing current capability  | typed reject `REVERSAL_MISSING_CURRENT_CAPABILITY`  |

## 6. Verification

**Round 1 fix E — verification on real PostgreSQL:** `tests/database/change-set-review-reversal-postgres.test.ts`
now uses `PostgresCanonicalKnowledgeRepository` + `createPostgresPool` (real `canonical.*`
tables), not a Map-based fake. Cases covered on the real DB:

- existing project + revision found; wrong project + same revisionId → not found
- canonical-backed reversal eligibility: current tip → CANDIDATE created
- superseded target → typed `REVERSAL_SUPERSEDED_TARGET`
- snapshot impact: current-tip reversal removes its own claim (real digest round-trip)
- same-timestamp tie-break: later event detected by `created_at, history_event_id` order

- WP3 focused suites: unit 19 + DB 5 = **24 tests PASS**.
- Full `npm run test:database`: **199 tests PASS** (37 files).
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

Report WP3 Round 2 (fixes A-E applied) for the GPT Review. Do not begin WP4 until WP3 is
reviewed and accepted.
