---
id: FRONTEND-PHASE-5-SECTION-2-WP2-EVIDENCE-260809001
classification: CANONICAL
status: wp2_accepted
work_item: FE-P5-S2
created_at: 2026-08-09
subject_base: 701e0bfac5af60daa48d9155185956b91650ecbd
wp1_accepted_head: 82fec2ca167d76fa92f5d45ddaf4ed2ed8371387
wp1_foundation_correction_head: e6e9d556a5002b5888019282f0c764ccf46bb866
wp1_foundation_correction_ci_number: 680
wp2_implementation_head: 647b580c16171af70a74f824ed5e72b7b91e50d0
wp2_implementation_ci_number: 681
wp2_implementation_ci_run_id: 31287525830
wp2_implementation_ci_conclusion: SUCCESS
tracking_issue: https://github.com/JasonCutter/shotgun/issues/71
contract_pr: https://github.com/JasonCutter/shotgun/pull/70
product_pr: https://github.com/JasonCutter/shotgun/pull/80
governing_adr: ADR-131
contract_snapshot: docs/architecture/contracts/snapshots/frontend-phase-5-section-2/frontend-phase-5-section-2-contract-snapshot-260808001.md
implementation_request: docs/implementation/frontend-phase-5-section-2-implementation-request-260808001.md
---

# FE-P5-S2 — WP2 Authoritative History Capabilities Evidence

## 1. Scope

WP2 — Authoritative History Capabilities (Implementation Request r1 §5 WP2, internal slices
WP2-A/B/C) implemented on `feat/fe-p5-s2-wp1-contracts-persistence` (PR #80, Draft) after WP1
was ACCEPTED (head `82fec2ca`, CI #674 SUCCESS) and the WP1 Foundation Correction was ACCEPTED
(head `e6e9d556a`, CI #680 SUCCESS).

WP2 COMPLETE IFF WP2-A PASS AND WP2-B PASS AND WP2-C PASS.

## 2. WP2-A — Policy History (owner: settings-policy)

Authoritative read capability over the append-only settings Policy Change History sources
(`settings.settings_audit_events`, reused per ADR-131 §7 / IR r1 §4 Scope D). No new
authoritative Policy History table.

| File                                                      | Content                                                                                                                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `modules/settings-policy/src/policy-history.ts`           | `PolicyHistoryEntry`, `PolicyHistoryCursor`, `ListPolicyHistoryInput/Result`, `PolicyHistoryReadPort`, stable ordering + true keyset pagination |
| `modules/settings-policy/src/index.ts`                    | module exports                                                                                                                                  |
| `adapters/settings-project-admin-in-memory/src/index.ts`  | `InMemoryPolicyHistoryReadAdapter` (append-only, read-only)                                                                                     |
| `adapters/postgres/src/index.ts`                          | `PostgresPolicyHistoryReadAdapter` (project-scoped keyset over `settings.settings_audit_events`)                                                |
| `tests/unit/settings-policy-history.test.ts`              | 5 tests (ordering, keyset, pagination, append-only, invalid input)                                                                              |
| `tests/database/settings-policy-history-postgres.test.ts` | 2 tests (project-scoped read, pagination, no mutation, invalid input)                                                                           |

## 3. WP2-B — Payload Availability / Retention / Tombstone (owner: each authoritative Domain)

Owner-side sidecar (`history_payload_state`, migration 032) read/write + atomic
`purgeByPolicy` that flips the sidecar to `PURGED_BY_POLICY` AND appends the owner Domain
purge AuditEvent in ONE transaction (ADR-131 §3, ADR-112 §9). Purged payload is never copied
into an AuditEvent — non-sensitive metadata only.

Purge AuditEvent targets (per GPT design decision 2026-08-09):

- CANONICAL / REVIEW: owner-local purge audit stream (`history_payload_audit_events`, 032)
- EXTERNAL_ACTION: reused `frontend_external_action.audit_events` (`HISTORY_PAYLOAD_PURGED`)
- SETTINGS: reused `settings.settings_audit_events` (`HISTORY_PAYLOAD_PURGED`)

| File                                                             | Content                                                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `modules/frontend-history/src/payload-state.ts`                  | `PayloadStateRecord`, `PayloadStateStorePort`, `PurgeByPolicyInput`, `SetPayloadStateInput`, `isPurgeTransitionValid` |
| `modules/frontend-history/src/index.ts`                          | module exports                                                                                                        |
| `adapters/frontend-history-in-memory/src/index.ts`               | `InMemoryPayloadStateStore` (purgeByPolicy is the only purge authority; direct set / resurrection rejected)           |
| `adapters/frontend-history-postgres/src/index.ts`                | `PostgresPayloadStateStore` (transactional purge: sidecar + owner audit append; EXTERNAL_ACTION action_id resolution) |
| `tests/unit/frontend-history-payload-state.test.ts`              | 6 tests (set/read, atomic purge, re-purge conflict, direct-set rejection, resurrection rejection, invalid input)      |
| `tests/database/frontend-history-payload-state-postgres.test.ts` | 5 tests (canonical atomic purge + audit, settings reuse, guards, EXTERNAL_ACTION RESULT/AUDIT_EVENT resolution)       |

## 4. WP2-C — ProjectTombstone / DeletedProjectAuditScope (owner: project-administration/security)

Authoritative read/write over `project_audit.project_tombstones` +
`project_audit.deleted_project_audit_scopes` (migration 031). Past membership alone never
grants deleted-project audit access; read-time Capability revalidation is fail-closed
(ADR-112 §11/§12, ADR-131 §6).

| File                                                      | Content                                                                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `modules/project-administration/src/project-tombstone.ts` | `ProjectTombstoneRecord`, `DeletedProjectAuditScopeRecord`, `ProjectTombstoneStorePort`, `isDeletedProjectAuditReadPermitted` |
| `modules/project-administration/src/index.ts`             | module exports                                                                                                                |
| `adapters/settings-project-admin-in-memory/src/index.ts`  | `InMemoryProjectTombstoneStore`                                                                                               |
| `adapters/postgres/src/index.ts`                          | `PostgresProjectTombstoneStore`                                                                                               |
| `tests/unit/project-tombstone.test.ts`                    | 4 tests (tombstone lifecycle, revalidation, scopes, invalid input)                                                            |
| `tests/database/project-tombstone-postgres.test.ts`       | 2 tests (full lifecycle + revalidation, invalid input)                                                                        |

## 5. WP1 Foundation Correction (032)

Per GPT review gate: WP2-B preparation discovered that the purge AuditEvent persistence
needed owner-local tables for Canonical and Review (which have no generic audit stream).
Migration 032 Scope C was augmented with `canonical.history_payload_audit_events` and
`frontend_review.history_payload_audit_events` (append-only: INSERT ALLOWED /
UPDATE·DELETE·TRUNCATE FORBIDDEN; `new_availability = 'PURGED_BY_POLICY'` and
`previous_availability <> 'PURGED_BY_POLICY'` CHECK invariants). External Action and Settings
reuse existing generic audit streams. WP1 Foundation Correction ACCEPTED (head `e6e9d556a`,
CI #680 SUCCESS).

Focused DB test added in `tests/database/frontend-history-persistence.test.ts` (append-only +
purge semantic negatives).

## 6. Verification

- Focused suites: WP2-A 7 tests, WP2-B 11 tests, WP2-C 6 tests, 032 append-only 3 tests —
  all PASS (27 focused DB/unit tests).
- Full `npm run test:database`: **194 tests PASS** (36 files).
- `tsc --noEmit`, ESLint, Prettier clean.
- WP2 implementation head `647b580c16171af70a74f824ed5e72b7b91e50d0` automatic CI **#681 /
  run 31287525830: SUCCESS** (Quality, Frontend, Required Gates). No manual/duplicate CI
  dispatch; no previously-passed head re-run.

## 6.1 WP2 Round 1 — CHANGES_REQUIRED corrections

The WP2 integrated Review (Round 1) returned CHANGES_REQUIRED with five items, all corrected
within WP2 scope:

1. **WP2-A three authoritative sources** — Policy History now exposes ALL THREE authoritative
   settings sources (`settings_revisions`, `policy_context_revisions`, `settings_audit_events`)
   through a discriminated `PolicyHistorySourceKind` (`SETTINGS_REVISION` /
   `POLICY_CONTEXT_REVISION` / `SETTINGS_AUDIT_EVENT`). Stable source identity is preserved
   (`sourceId`), ordering/cursor is `(timestamp, sourceKind, sourceId)` with in-memory and
   PostgreSQL identical lexical ordering. PostgreSQL adapter UNIONs the three sources.
2. **WP2-B purge atomicity guards** — `setPayloadState` now REJECTS `PURGED_BY_POLICY` (only
   `purgeByPolicy` may produce a purge) and REJECTS resurrection of an already-purged row to
   AVAILABLE/REDACTED/UNAVAILABLE. In-memory and PostgreSQL parity. Negative tests added.
3. **WP2-B External Action source resolution** — the implicit `sourceEventId == action_id`
   assumption is removed. For `EXTERNAL_ACTION`, `sourceEventKind`+`sourceEventId` resolves the
   authoritative source row (`RESULT` → `frontend_external_action.results`, `AUDIT_EVENT` →
   `frontend_external_action.audit_events`) to its `action_id` server-side, verifies the
   project identity, then appends the purge audit on that action using the existing per-action
   sequence (`MAX(sequence)+1`). Focused DB tests for both RESULT and AUDIT_EVENT added.
4. **WP2-C current capability revalidation** — `isDeletedProjectAuditReadPermitted` now takes a
   `DeletedProjectAuditReadContext` and requires ALL of: scope exists, `scope.projectId ==
requested project`, principal currently bound, scope not revoked, AND current server-derived
   capability set includes `project:deleted-audit:read` (`DELETED_PROJECT_AUDIT_READ_CAPABILITY`).
   Negative cases added (capability missing, no scope, wrong project, revoked).
5. **Evidence/Governance** — evidence metadata corrected to the exact full implementation SHA
   (`647b580c16171af70a74f824ed5e72b7b91e50d0`) with CI number/run ID separated; Prettier
   normalized; PR #80 body updated to cumulative WP1+WP2 scope.

## 7. Preserved boundaries

Not implemented in this Work Package (remain unauthorized):

- WP3 Reversal DraftChangeSet.
- WP4 Federated History Projection + Product API.
- WP5 History Workspace UI.
- WP6 Integrated Verification + Security + Performance.
- Central authoritative History ledger: FORBIDDEN (never created).
- Historical approval authority reuse: FORBIDDEN.
- Direct canonical restore: FORBIDDEN.
- PR #80 Ready/Merge: user approval required, remains DRAFT.

## 8. Next action

Report WP2 implementation (WP2-A/B/C all PASS) for the GPT integration Review. Do not begin
WP3 until WP2 is reviewed and accepted.
