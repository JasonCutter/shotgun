---
id: FRONTEND-PHASE-5-SECTION-2-WP6-EVIDENCE-260809001
classification: CANONICAL
status: wp6_implemented_pending_review
work_item: FE-P5-S2
created_at: 2026-08-09
subject_base: 701e0bfac5af60daa48d9155185956b91650ecbd
wp5_accepted_head: 57420668b
wp5_accepted_ci_number: 725
wp5_accepted_ci_run_id: 31308301025
wp5_accepted_ci_conclusion: SUCCESS
tracking_issue: https://github.com/JasonCutter/shotgun/issues/71
contract_pr: https://github.com/JasonCutter/shotgun/pull/70
product_pr: https://github.com/JasonCutter/shotgun/pull/80
governing_adr: ADR-131
contract_snapshot: docs/architecture/contracts/snapshots/frontend-phase-5-section-2/frontend-phase-5-section-2-contract-snapshot-260808001.md
implementation_request: docs/implementation/frontend-phase-5-section-2-implementation-request-260808001.md
---

# FE-P5-S2 — WP6 Integrated Verification + Security + Performance Evidence

## 1. Scope

WP6 is the FE-P5-S2 Section-completion verification (IR r1 §5 WP6): AC-01~16
evidence closure, security negative cases, rebuild/recovery, E2E (AC-15),
accessibility, and performance (AC-16). It introduces no new feature; it closes
the browser-level and Section-level evidence that unit/integration tests cannot
provide, and records the final AC → Evidence → Verification mapping.

## 2. AC → Evidence closure (AC-01 ~ AC-16)

| AC    | Title (Contract Snapshot §9)                                                                                   | Evidence artifacts                                                                                                                                                                       | Status |
| ----- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| AC-01 | History Workspace reads existing Domain History federated (no central ledger)                                  | WP4 evidence (`wp4_accepted`); `tests/unit/frontend-history-projection.test.ts`; `tests/contract/frontend-history.contract.test.ts`; browser `frontend-history-workspace.spec.ts` (list) | CLOSED |
| AC-02 | HistoryEntry references source Domain identity (registry; aggregate vs concrete; domainResourceId preserved)   | `frontend-history.contract.test.ts`; WP4 identity tests; browser detail rendering                                                                                                        | CLOSED |
| AC-03 | Event identity never edited/deleted                                                                            | `tests/database/frontend-history-persistence.test.ts` (UPDATE/DELETE rejected, INSERT allowed; 032 append-only/purge-only invariants)                                                    | CLOSED |
| AC-04 | Payload Availability states exposed                                                                            | `frontend-history-payload-state.test.ts` (+ Postgres); browser `frontend-history-workspace.spec.ts` (AVAILABLE + PURGED_BY_POLICY badge)                                                 | CLOSED |
| AC-05 | PURGED_BY_POLICY = redaction/tombstone, not identity deletion                                                  | payload-state negative tests (re-purge/resurrection rejected); browser PURGED display without raw payload                                                                                | CLOSED |
| AC-06 | History retention separated from cache retention                                                               | `tests/unit/frontend-history-payload-state.test.ts`; WP2 evidence; projection cache sanitize (Round 4 F2-B)                                                                              | CLOSED |
| AC-07 | Canonical Rollback = Reversal DraftChangeSet (direct restore forbidden)                                        | `tests/unit/change-set-review-reversal.test.ts`; browser `frontend-history-workspace.spec.ts` (Reversal → Review)                                                                        | CLOSED |
| AC-08 | Reversal uses current Snapshot impact + current Review + current Approval; historical approval reuse forbidden | `change-set-review-reversal.test.ts` (reuse-attempt rejected); `frontend-reversal-review-queue.test.ts` (queue → Context → Record APPROVE → Approval ACTIVE)                             | CLOSED |
| AC-09 | External rollback reuses Compensating Action                                                                   | WP4/5 Compensation link (browser `frontend-history-workspace.spec.ts` lineage/compensation links)                                                                                        | CLOSED |
| AC-10 | Deleted Project audit access requires Tombstone + Scope + Capability revalidation                              | `frontend-history-deleted-project-audit.test.ts` (4) + browser deep-link test                                                                                                            | CLOSED |
| AC-11 | Past membership alone never grants deleted-project audit access                                                | `frontend-history-deleted-project-audit.test.ts` (deny without scope/capability); `project-tombstone.test.ts`                                                                            | CLOSED |
| AC-12 | Restoration creates explicit recovery lineage                                                                  | `project-tombstone.test.ts` golden tests                                                                                                                                                 | CLOSED |
| AC-13 | Read-time Capability revalidation (fail-closed)                                                                | NEW `tests/integration/frontend-history-security-negative.test.ts` (5 HTTP negatives: history:read, project:action:rollback, cross-project, CSRF) + unit coordinator negatives           | CLOSED |
| AC-14 | Ordering/cursor/pagination contract (stable tie-breaker)                                                       | `frontend-history-projection-postgres-parity.test.ts` (frozen-tuple + keyset cursor); browser pagination test                                                                            | CLOSED |
| AC-15 | FE-P5-S2 completion mapping (observe→trace→query→Reversal/Compensation)                                        | NEW `tests/browser/frontend-history-workspace.spec.ts` (6 E2E: list/filters/pagination, detail+payload, lineage/Compensation, Reversal→Review, deleted-audit deep link, axe+keyboard)    | CLOSED |
| AC-16 | Performance gate (baseline → budget → user approval → freeze)                                                  | NEW `tests/browser/frontend-history-performance.spec.ts` (median-of-3); threshold FROZEN by user approval (§3.4)                                                                         | CLOSED |

## 3. WP6 verification additions

### 3.1 E2E + accessibility (AC-15) — `tests/browser/frontend-history-workspace.spec.ts`

6 browser tests PASS (individual run):

1. Federated History list with domain filters and frozen-tuple pagination.
2. Authoritative detail with payload availability display (AVAILABLE) and the
   bounded payload snapshot carrying the authoritative `revisionId`.
3. Audit lineage + Compensation links to the owning External Action workspace.
4. Reversal initiation → `POST /product-api/frontend/review/reversal-draft` with
   the authoritative `sourceRevisionId` → current Review Workspace navigation.
5. Deleted-project audit target (`resourceProjectId`) preserved in the History
   deep link on entry selection.
6. axe zero critical/serious + keyboard-only selection (Enter) on the
   workspace.

Accessibility fix included: `history-list-item` / `history-item-domain` and the
payload-availability badges now carry explicit WCAG-AA-contrast text colors
(`#166534` / `#92400e`) so the selected-row + PURGED badges pass
`color-contrast` (serious) at the Activity/Review accessibility bar.

### 3.2 Security negatives (AC-13 / AC-07 / AC-08) — `tests/integration/frontend-history-security-negative.test.ts`

5 HTTP-level tests PASS:

1. History workspace read denied without the current `history:read` (403
   `PROJECT_ACCESS_DENIED`, non-disclosing).
2. History workspace read allowed with `history:read`.
3. Reversal creation denied without `project:action:rollback`
   (`REVERSAL_MISSING_CURRENT_CAPABILITY`, non-disclosing).
4. Reversal creation denied for a resource outside the active project (403).
5. Reversal creation rejected without a CSRF token (403).

### 3.3 Rebuild / recovery

Already covered by WP4 + WP2 evidence (cited in the AC table): deterministic
atomic rebuild, ALL-adapter watermarks, ANY-adapter failure aborts the whole
rebuild (previous committed projection stays), Postgres CAS rejects lower
revision, and payload-state rollback on projection sanitize failure (Round 4
F2-B).

### 3.3b Reversal durable-authority → derived-carrier recovery (WP6 Round 1 Blocker B) — `tests/integration/frontend-reversal-carrier-recovery.test.ts`

The authoritative Reversal (`change-set-review` `review.reversals`) and the
derived SUBMITTED Knowledge Draft carrier (migration 025) are separate
persistence boundaries. A carrier write can fail after the authoritative save
succeeds; the recovery invariant is:

1. Create Reversal → authoritative save succeeds → derived carrier insert
   FORCED failure (first transaction throws) → request reports failure safely
   (500) and the authoritative Reversal still exists.
2. Queue read triggers `reconcileReversalCarriers` (server-side): the SAME
   `reversalId` carrier is deterministically regenerated from the authoritative
   record (never a new Reversal id) and inserted.
3. Review Queue then contains the same Reversal and its Context is readable.

1 focused regression PASS (real HTTP flow + forced failure + recovery).

### 3.4 Performance (AC-16) — `tests/browser/frontend-history-performance.spec.ts`

Deterministic three-sample median gates (1 warm-up + 3 measured samples,
in-page `performance.now()` to the committed state), local fake fixtures,
headless Chromium, single worker. Measured baseline (2026-08-09):

| Metric                      | Samples (ms)    | Median (ms) | Gate (ms) |
| --------------------------- | --------------- | ----------- | --------- |
| `history-list-display-ms`   | [890, 941, 853] | **890**     | 2000      |
| `history-list-to-detail-ms` | [84, 62, 66]    | **66**      | 2000      |

### AC-16 numeric threshold approval

Following the Frozen AC-16 procedure (baseline → proposed budget → explicit
user approval → threshold freeze), the proposed numeric budget is approved and
FROZEN:

```text
AC-16 numeric threshold (FROZEN 2026-08-09):
- history-list-display-ms    median <= 2000 ms
- history-list-to-detail-ms  median <= 2000 ms
Approved by: USER
Authority: explicit AC-16 numeric-threshold approval
```

Both medians were measured far below the frozen gate on the representative
state; the gate test (`GATE_MS = 2000`) is the FROZEN performance verification.

## 4. Verification totals (2026-08-09)

- Web app full suite: **126 tests PASS** (21 files).
- Unit + contract + integration: **1218 PASS** (12 failures are the known
  unrelated flaky set — `stage-8-format-expansion`, `compiled-truth`,
  `knowledge-model`, `health`, `canonical-projection-recovery`,
  `action-execution-api`, `cited-search-ui`, `compiled-truth-ui`,
  `knowledge-model-ui`, `review-ui`; pass standalone, unrelated to WP6).
- Browser E2E: **68 PASS** (5 failures are the known performance specs that
  exceed the gate only under full-suite load; each passes standalone — the
  History performance spec passes with the measured baselines above).
- New WP6 specs: History E2E 6/6, History performance 2/2 (standalone),
  History/Reversal HTTP security negatives 5/5, Reversal carrier recovery 1/1.
- `tsc --noEmit` (root + app), ESLint, Prettier clean.
- Governance cleanup: WP2 evidence frontmatter corrected to `wp2_accepted`;
  Architecture Amendment approval authority recorded as "Explicit Architecture
  Amendment approval" (Approved by USER, 2026-08-09).
- Automatic CI on push (PR #80, Draft) — latest head recorded in §5.

## 5. WP6 verification head

- **WP6 Evidence Head**: 8251de211
- **Automatic CI**: #730 / run 31311221451 / SUCCESS

## 6. Next action

Report WP6 for the GPT Section-completion review. On acceptance, FE-P5-S2
Section completion (Ready/Merge) remains user-approval-gated (PR #80 DRAFT).
