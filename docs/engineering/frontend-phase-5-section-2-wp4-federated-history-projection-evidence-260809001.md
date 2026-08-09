---
id: FRONTEND-PHASE-5-SECTION-2-WP4-EVIDENCE-260809001
classification: CANONICAL
status: wp4_implemented_pending_review
work_item: FE-P5-S2
created_at: 2026-08-09
subject_base: 701e0bfac5af60daa48d9155185956b91650ecbd
wp3_accepted_head: fe5ab21b2
wp4_implementation_head: PENDING
wp4_implementation_ci_number: PENDING
wp4_implementation_ci_run_id: PENDING
wp4_implementation_ci_conclusion: PENDING
tracking_issue: https://github.com/JasonCutter/shotgun/issues/71
contract_pr: https://github.com/JasonCutter/shotgun/pull/70
product_pr: https://github.com/JasonCutter/shotgun/pull/80
governing_adr: ADR-131
contract_snapshot: docs/architecture/contracts/snapshots/frontend-phase-5-section-2/frontend-phase-5-section-2-contract-snapshot-260808001.md
implementation_request: docs/implementation/frontend-phase-5-section-2-implementation-request-260808001.md
---

# FE-P5-S2 — WP4 Federated History Projection + Product API Evidence

## 1. Scope

WP4 — Federated History Projection + Product API (Implementation Request r1 §5 WP4)
implemented on `feat/fe-p5-s2-wp1-contracts-persistence` (PR #80, Draft) after WP3 was
ACCEPTED (head `fe5ab21b2`, Round 3).

Implemented flow (IR r1 §5 WP4):

```text
Canonical adapter / Review adapter / External Audit adapter / Policy History adapter
  → persistent rebuildable History projection (frontend_history.*, migration 030)
  → ListHistoryWorkspace / GetHistoryEntry (History Workspace Product API)
```

The projection is NON-AUTHORITATIVE and rebuildable (IR r1 §4): the owning Domain
histories remain authoritative; the projection index never becomes a second ledger and
never replaces source Domain identity (`sourceEventId`/`domainResourceId` preserved).

## 2. Implemented files

| File                                                                  | Content                                                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `modules/frontend-history/src/history-index-store-port.ts`            | `HistoryIndexRecordV1` + `HistoryIndexStorePort` (upsert/findByIdentity/queryProject/delete/rebuild + frozen-tuple cursor)            |
| `modules/frontend-history/src/history-watermark-store-port.ts`        | `HistoryWatermarkRecordV1` + `HistoryWatermarkStorePort`                                                                              |
| `modules/frontend-history/src/history-read-model-store-port.ts`       | `HistoryReadModelStorePort.commitProjectProjection` (atomic project-scoped commit)                                                    |
| `modules/frontend-history/src/history-adapter-port.ts`                | `HistoryAdapterPort` + `HistoryAdapterRegistryPort` (one adapter per mandatory family)                                                |
| `modules/frontend-history/src/history-projection-builder.ts`          | `HistoryProjectionBuilder` (deterministic, atomic, fail-closed per adapter)                                                           |
| `modules/frontend-history/src/product-api.ts`                         | `HistoryProductCoordinator` (`ListHistoryWorkspace` / `GetHistoryEntry` / refresh, capability gate)                                   |
| `modules/frontend-history/src/index.ts`                               | module exports                                                                                                                        |
| `modules/frontend-review/src/review-store-port.ts`                    | `ReviewApprovalStorePort.listByProject` added                                                                                         |
| `adapters/frontend-review-in-memory/src/index.ts`                     | `listByProject` in-memory                                                                                                             |
| `adapters/frontend-review-postgres/src/index.ts`                      | `listByProject` PostgreSQL (`DISTINCT ON (approval_id)`)                                                                              |
| `adapters/frontend-history-canonical/src/index.ts`                    | `CanonicalHistoryAdapter` (Canonical listHistory → HistoryEntryV1)                                                                    |
| `adapters/frontend-history-review/src/index.ts`                       | `ReviewHistoryAdapter` (contexts + decisions + approvals inside review boundary)                                                      |
| `adapters/frontend-history-external-action/src/index.ts`              | `ExternalActionHistoryAdapter` (aggregates + audit inside boundary, sourceSequence preserved)                                         |
| `adapters/frontend-history-policy/src/index.ts`                       | `PolicyHistoryAdapter` (PolicyHistoryReadPort → HistoryEntryV1)                                                                       |
| `adapters/frontend-history-postgres/src/history-projection-store.ts`  | `PostgresHistoryIndexStore` / `PostgresHistoryWatermarkStore` / `createPostgresHistoryReadModelStore` (advisory lock + watermark CAS) |
| `adapters/frontend-history-in-memory/src/history-projection-store.ts` | in-memory counterparts                                                                                                                |
| `assemblies/shotgun-app/src/product-api/frontend-history-routes.ts`   | `/product-api/frontend/history/{workspace,entry,refresh}` routes (server-derived scope)                                               |
| `assemblies/shotgun-app/src/server.ts` / `src/main.ts`                | wiring (in-memory default + PostgreSQL runtime)                                                                                       |
| `scripts/database.ts`                                                 | `requiredTables` += frontend_history (db:verify)                                                                                      |
| `tests/unit/frontend-history-projection.test.ts`                      | 11 tests (ordering/cursor, index store, builder fail-closed, coordinator capability/pagination)                                       |
| `tests/unit/frontend-history-adapters.test.ts`                        | 5 tests (domain adapters identity/availability mapping)                                                                               |
| `tests/database/frontend-history-projection-postgres-parity.test.ts`  | 6 tests (in-memory vs PostgreSQL parity on migration 030)                                                                             |

## 3. Federated History projection (non-authoritative, rebuildable)

`frontend_history.history_projection_index` + `projection_watermarks` (migration 030) are
written through `HistoryReadModelStorePort.commitProjectProjection` in ONE atomic
project-scoped transaction (IR r1 §4):

- project-scoped advisory lock (`pg_advisory_xact_lock`) serializes concurrent builds;
- watermark snapshot-revision CAS: a lower revision never replaces a newer one, even with an
  empty index (a concurrent build that already committed revision N is rejected);
- index replace + every watermark (successful and failed adapters) publish together or not
  at all — the index and watermarks never diverge;
- source Domain History is never modified; source identity is preserved exactly.

`HistoryProjectionBuilder` runs one deterministic build per project: every adapter is read
in registry order; a failed adapter contributes NO rows AND receives a current-revision
`UNAVAILABLE` watermark (no stale AVAILABLE observation is ever presented as current).
`snapshotRevision` is monotonic (newest watermark + 1). Ordering/cursor uses the frozen
tuple `occurred_at + domain_kind + source_event_kind + source_event_id + source_sequence`
(ADR-131 §2), and the projection never becomes a global chronology authority.

## 4. Domain adapters (source identity preserved)

| Adapter                      | Authoritative source                                           | Mapping                                                                                         |
| ---------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| CanonicalHistoryAdapter      | `CanonicalKnowledgeRepositoryPort.listHistory`                 | `domainKind=CANONICAL`, `sourceEventId=historyEventId`, `domainResourceId=claimId\|changeSetId` |
| ReviewHistoryAdapter         | review boundary transaction (contexts + decisions + approvals) | `sourceEventId=decisionId\|approvalId`, `sourceEventKind=DECISION\|APPROVAL`                    |
| ExternalActionHistoryAdapter | external action boundary transaction (aggregates + audit)      | `sourceEventKind=AUDIT_EVENT`, `sourceSequence=audit.sequence`                                  |
| PolicyHistoryAdapter         | `PolicyHistoryReadPort.listPolicyHistory`                      | `sourceEventKind=sourceKind`, `sourceEventId=sourceId`                                          |

Payload availability is resolved through the owner-side `PayloadStateStorePort` sidecar
(migration 032): `AVAILABLE / REDACTED / PURGED_BY_POLICY / UNAVAILABLE` — event identity is
never deleted. `historyEntryId` is projection identity only.

## 5. History Workspace Product API

`HistoryProductCoordinator` (server-derived scope):

- `listHistoryWorkspace` — project-scoped unified events, `domainKinds` filter, frozen-tuple
  keyset cursor, `limit` is positive integer (Contract); non-disclosing (only the requested
  project's projection is returned).
- `getHistoryEntry` — single entry by projection identity; missing/cross-project produces the
  same NOT_FOUND (no existence leak).
- `refreshHistoryProjection` — deterministic project-scoped rebuild; returns the build
  summary (indexCount, adapterStatus, partial, failures, metadata).

Capabilities: `history:read` (LIST_HISTORY_WORKSPACE + READ_HISTORY_ENTRY), `history:refresh`
(REFRESH_HISTORY_PROJECTION). Deny-by-default scope validation; browser never authors
principal/project/revision/capability. Reversal creation is NOT a History route (WP3 owns it).

Routes (`registerHistoryRoutes`):

- `POST /product-api/frontend/history/workspace`
- `POST /product-api/frontend/history/entry`
- `POST /product-api/frontend/history/refresh`

## 6. Verification

- WP4 focused suites: unit 16 + DB parity 6 = **22 tests PASS**.
- Full `npm run test:database`: **205 tests PASS** (38 files).
- `tsc --noEmit`, ESLint, Prettier clean.
- Automatic CI on push (PR #80, Draft).

## 7. Preserved boundaries

Not implemented in this Work Package (remain unauthorized):

- WP5 History Workspace UI.
- WP6 Integrated Verification + Security + Performance.
- Central authoritative History ledger: FORBIDDEN (projection is NON-AUTHORITATIVE).
- Source Version / Ask history integration: DEFER.
- PR #80 Ready/Merge: user approval required, remains DRAFT.

## 8. Next action

Report WP4 implementation for the GPT Review. Do not begin WP5 until WP4 is reviewed and
accepted.
