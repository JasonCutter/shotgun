---
id: FRONTEND-PHASE-5-SECTION-2-WP4-EVIDENCE-260809001
classification: CANONICAL
status: wp4_accepted
work_item: FE-P5-S2
created_at: 2026-08-09
subject_base: 701e0bfac5af60daa48d9155185956b91650ecbd
wp3_accepted_head: fe5ab21b2
wp4_implementation_head: 03f6fb9c6
wp4_implementation_ci_number: 698
wp4_implementation_ci_run_id: 31295374255
wp4_implementation_ci_conclusion: SUCCESS
wp4_round1_fix_head: eb1659704
wp4_round1_fix_ci_number: 700
wp4_round1_fix_ci_run_id: 31296506420
wp4_round1_fix_ci_conclusion: SUCCESS
wp4_round2_fix_head: 323036595
wp4_round2_fix_ci_number: 702
wp4_round2_fix_ci_run_id: 31297344803
wp4_round2_fix_ci_conclusion: FAILURE_QUALITY_PRETTIER_DOCS_ONLY
wp4_round2_final_ci_number: 703
wp4_round2_final_ci_run_id: 31297510534
wp4_round2_final_ci_conclusion: SUCCESS
wp4_round3_fix_head: 64eb60dfc
wp4_round3_fix_ci_number: 705
wp4_round3_fix_ci_run_id: 31298313103
wp4_round3_fix_ci_conclusion: SUCCESS
wp4_round4_fix_head: 6917452
wp4_round4_fix_ci_number: 707
wp4_round4_fix_ci_run_id: 31298917656
wp4_round4_fix_ci_conclusion: SUCCESS
wp4_accepted_head: 001f56b43
wp4_accepted_by: GPT_IMPLEMENTATION_REVIEW_ACCEPTED (Round 5)
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

## 1a. GPT Review Round 1 — fixes applied (head `eb1659704`, CI #700 SUCCESS)

GPT Review Round 1 (CHANGES_REQUIRED, 5 items) was resolved as follows:

- **A — Atomic rebuild, fail-closed**: any mandatory adapter failure aborts the entire
  rebuild with NO commit; the previous complete projection remains; the failed adapter's
  watermark does NOT advance. (`history-projection-builder.ts`)
- **B — RESULT + AUDIT_EVENT completeness**: `ExternalActionHistoryAdapter` now projects
  BOTH result and audit event kinds; the audit 1000-row hard cap was removed and replaced
  with complete pagination (`listByAction(actionId, limit, offset)`, budget 500/page until
  exhausted). 1200-row audit test verifies full pagination.
- **C — Authoritative detail**: `getHistoryEntry` no longer returns projection-only data;
  it re-resolves from the owning Domain's authoritative source via
  `registry.adapterFor(domainKind).resolveHistoryEntry(...)` and fails closed (NOT_FOUND)
  when the source is unresolved.
- **D — Project binding**: `request.resourceProjectId === scope.activeProjectId` is now
  validated for both `ListHistoryWorkspace` and `GetHistoryEntry`; cross-project requests
  are denied (historyDenied / historyNotFound). Negative tests added.
- **E — Refresh removal**: the browser-exposed `/refresh` route and
  `REFRESH_HISTORY_PROJECTION` capability were REMOVED (not amended); raw adapter/provider
  error messages are never surfaced to the browser.

## 1b. GPT Review Round 2 — fixes applied

GPT Review Round 2 (CHANGES_REQUIRED: A/B/C partially resolved, D/E resolved, F/G new
blockers) was resolved as follows (code head recorded in frontmatter):

- **A — Mandatory adapter exact-set**: `createHistoryAdapterRegistry` now enforces the four
  mandatory families (CANONICAL / REVIEW / EXTERNAL_ACTION / POLICY) exactly once each.
  Missing / duplicate / unknown adapter kinds fail closed at wiring time, so a wiring
  mistake can never produce a silently partial build that commits as complete.
- **B/C — Audit Detail > 500**: `ExternalActionAuditStorePort.findById(auditEventId)` added
  (in-memory + PostgreSQL); `resolveHistoryEntry(AUDIT_EVENT)` now resolves by append-only
  identity with project-binding check — an event past the first 500 resolves exactly like
  the first one. Regression: audit:50 / audit:750 / audit:1199 resolve, unknown fails
  closed.
- **F — Payload redaction**: `redactHistoryPayload` (payload-state.ts) enforces the
  invariant AVAILABLE → bounded payload; REDACTED / PURGED_BY_POLICY / UNAVAILABLE → raw
  payload FORBIDDEN (tombstone metadata only). Applied at build time (projection cache
  never stores raw payload for non-AVAILABLE rows) AND at read time
  (`HistoryAdapterPort.redactEntry` re-checks current availability for every List/Detail
  row, so a purge after a cached projection cannot leak raw payload — AC-05).
- **G — Audit capability revalidation**: `READ_HISTORY_AUDIT` is a separate capability
  (scopes `history:audit:read` / `action:audit:read` / owner / admin, AC-13 read-time
  revalidation). List hides EXTERNAL_ACTION AUDIT_EVENT rows without it via a keyset
  over-fetch that keeps pages full (no leak of inaccessible-row counts, no skipped
  visible rows); Detail returns the same non-disclosing NOT_FOUND.

## 1c. GPT Review Round 3 — remaining F blocker resolved

GPT Review Round 3 (CHANGES_REQUIRED — ONE retention blocker F) was resolved as follows
(code head recorded in frontmatter):

- **F1 — explicit snapshot overwrite**: `redactHistoryPayload` now ALWAYS returns a
  `payloadSnapshot` key on non-AVAILABLE rows (tombstone metadata, or `undefined` when
  absent) so `{ ...entry, ...redacted }` explicitly OVERWRITES any prior raw snapshot
  instead of leaving it in place. Previously an absent tombstone meant the key was simply
  omitted and the cached raw value survived (`payloadAvailability = PURGED_BY_POLICY`
  with `payloadSnapshot = OLD_RAW_PAYLOAD` was possible).
- **F2 — persistent projection cache sanitize**: `PostgresPayloadStateStore` now
  sanitizes `frontend_history.history_projection_index` in the SAME transaction as the
  availability transition — `purgeByPolicy` and any `setPayloadState` transition away
  from AVAILABLE update the cached row's `payload_availability` and replace
  `payload_snapshot` with the (nullable) tombstone metadata. The previous raw payload is
  never left in persistent storage after a purge/redaction (AC-05 acceptance: no API raw
  payload exposure AND no prior raw payload in the persistent projection cache).
- **Focused negative tests**: unit (purge without tombstone → read-time redaction and
  authoritative detail carry no raw payload) + PostgreSQL (cached AVAILABLE projection
  row → purge without/with tombstone → persistent row sanitized; REDACTED transition
  sanitizes too).

## 1d. GPT Review Round 4 — setPayloadState atomicity fixed

GPT Review Round 4 (CHANGES_REQUIRED — ONE ATOMICITY BLOCKER F2-B) was resolved:

- **F2-B — setPayloadState shares the purge transaction boundary**: `setPayloadState` now
  runs inside one PostgreSQL transaction exactly like `purgeByPolicy`:
  `BEGIN → SELECT ... FOR UPDATE (current sidecar state, resurrection guard) → sidecar
UPSERT → sanitizeProjectionCache (non-AVAILABLE transitions) → COMMIT`, with
  `ROLLBACK` on failure. A sanitize failure can no longer leave a partial retention state
  (sidecar REDACTED + projection AVAILABLE + old raw payload) — the sidecar transition
  and the projection sanitize commit together or not at all.
- **Focused failure test**: the projection sanitize is forced to fail inside the
  transaction; `setPayloadState(REDACTED)` rejects and the sidecar stays AVAILABLE
  (full rollback verified).

## 2. Implemented files

| File                                                                  | Content                                                                                                                                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modules/frontend-history/src/history-index-store-port.ts`            | `HistoryIndexRecordV1` + `HistoryIndexStorePort` (upsert/findByIdentity/queryProject/delete/rebuild + frozen-tuple cursor)                                  |
| `modules/frontend-history/src/history-watermark-store-port.ts`        | `HistoryWatermarkRecordV1` + `HistoryWatermarkStorePort`                                                                                                    |
| `modules/frontend-history/src/history-read-model-store-port.ts`       | `HistoryReadModelStorePort.commitProjectProjection` (atomic project-scoped commit)                                                                          |
| `modules/frontend-history/src/history-adapter-port.ts`                | `HistoryAdapterPort` (+ `redactEntry` read-time redaction) + `HistoryAdapterRegistryPort` (exact-set mandatory registry, Round 2 A)                         |
| `modules/frontend-history/src/history-projection-builder.ts`          | `HistoryProjectionBuilder` (deterministic, atomic; ANY adapter failure aborts with no commit)                                                               |
| `modules/frontend-history/src/payload-state.ts`                       | `redactHistoryPayload` (payload redaction invariant, Round 2 F)                                                                                             |
| `modules/frontend-history/src/product-api.ts`                         | `HistoryProductCoordinator` (`ListHistoryWorkspace` / `GetHistoryEntry`, capability gate + `READ_HISTORY_AUDIT`, authoritative detail, read-time redaction) |
| `modules/frontend-history/src/index.ts`                               | module exports                                                                                                                                              |
| `modules/frontend-review/src/review-store-port.ts`                    | `ReviewApprovalStorePort.listByProject` added                                                                                                               |
| `modules/frontend-review-in-memory                                    | postgres` (adapters)                                                                                                                                        | `listByProject` in-memory + PostgreSQL  |
| `modules/frontend-external-action/src/external-action-store-port.ts`  | `ExternalActionAuditStorePort.findById` added (Round 2 B/C)                                                                                                 |
| `adapters/frontend-external-action-in-memory                          | postgres/src/index.ts`                                                                                                                                      | `audit.findById` in-memory + PostgreSQL |
| `adapters/frontend-history-canonical/src/index.ts`                    | `CanonicalHistoryAdapter` (listHistory → HistoryEntryV1, redaction)                                                                                         |
| `adapters/frontend-history-review/src/index.ts`                       | `ReviewHistoryAdapter` (contexts + decisions + approvals inside review boundary, redaction)                                                                 |
| `adapters/frontend-history-external-action/src/index.ts`              | `ExternalActionHistoryAdapter` (RESULT + AUDIT_EVENT both, complete audit pagination, findById detail, redaction)                                           |
| `adapters/frontend-history-policy/src/index.ts`                       | `PolicyHistoryAdapter` (PolicyHistoryReadPort → HistoryEntryV1, redaction)                                                                                  |
| `adapters/frontend-history-postgres/src/history-projection-store.ts`  | `PostgresHistoryIndexStore` / `PostgresHistoryWatermarkStore` / `createPostgresHistoryReadModelStore` (advisory lock + watermark CAS)                       |
| `adapters/frontend-history-in-memory/src/history-projection-store.ts` | in-memory counterparts                                                                                                                                      |
| `assemblies/shotgun-app/src/product-api/frontend-history-routes.ts`   | `/product-api/frontend/history/{workspace,entry}` routes (server-derived scope)                                                                             |
| `assemblies/shotgun-app/src/server.ts` / `src/main.ts`                | wiring (in-memory default + PostgreSQL runtime)                                                                                                             |
| `scripts/database.ts`                                                 | `requiredTables` += frontend_history (db:verify)                                                                                                            |
| `tests/unit/frontend-history-projection.test.ts`                      | 18 tests (ordering/cursor, index store, builder fail-closed + exact-set registry, coordinator capability/audit-gate/redaction/pagination)                   |
| `tests/unit/frontend-history-adapters.test.ts`                        | 7 tests (domain adapters identity/availability + payload redaction)                                                                                         |
| `tests/unit/frontend-history-external-action-completeness.test.ts`    | 5 tests (RESULT+AUDIT both, 1200 audit pagination, findById detail >500, redaction)                                                                         |
| `tests/database/frontend-history-projection-postgres-parity.test.ts`  | 6 tests (in-memory vs PostgreSQL parity on migration 030)                                                                                                   |

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
in registry order; ANY adapter failure aborts the ENTIRE rebuild — NO index write, NO
watermark advance — and the previous complete committed projection stays visible (Round 1
A + Round 2 A exact-set registry). `snapshotRevision` is monotonic (newest watermark + 1).
Ordering/cursor uses the frozen tuple
`occurred_at + domain_kind + source_event_kind + source_event_id + source_sequence`
(ADR-131 §2), and the projection never becomes a global chronology authority.

## 4. Domain adapters (source identity preserved)

| Adapter                      | Authoritative source                                           | Mapping                                                                                           |
| ---------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| CanonicalHistoryAdapter      | `CanonicalKnowledgeRepositoryPort.listHistory`                 | `domainKind=CANONICAL`, `sourceEventId=historyEventId`, `domainResourceId=claimId\|changeSetId`   |
| ReviewHistoryAdapter         | review boundary transaction (contexts + decisions + approvals) | `sourceEventId=decisionId\|approvalId`, `sourceEventKind=DECISION\|APPROVAL`                      |
| ExternalActionHistoryAdapter | external action boundary transaction (RESULT + AUDIT_EVENT)    | `sourceEventKind=RESULT\|AUDIT_EVENT`, `sourceSequence=audit.sequence`, complete audit pagination |
| PolicyHistoryAdapter         | `PolicyHistoryReadPort.listPolicyHistory`                      | `sourceEventKind=sourceKind`, `sourceEventId=sourceId`                                            |

Payload availability is resolved through the owner-side `PayloadStateStorePort` sidecar
(migration 032): `AVAILABLE / REDACTED / PURGED_BY_POLICY / UNAVAILABLE` — event identity is
never deleted. Raw payload is FORBIDDEN on non-AVAILABLE rows (Round 2 F): only tombstone
metadata survives, and the projection cache never stores raw payload for purged rows.

## 5. History Workspace Product API

`HistoryProductCoordinator` (server-derived scope):

- `listHistoryWorkspace` — project-scoped unified events, `domainKinds` filter, frozen-tuple
  keyset cursor, `limit` is positive integer (Contract); non-disclosing (only the requested
  project's projection is returned). `request.resourceProjectId === scope.activeProjectId`
  is enforced (Round 1 fix D).
- `getHistoryEntry` — single entry; requires the requesting project to match the entry's
  project binding; the owning Domain's authoritative source is re-resolved via
  `resolveHistoryEntry` and NOT_FOUND is returned when unresolved (fail-closed, Round 1
  fix C); missing/cross-project produces the same NOT_FOUND (no existence leak).

No browser refresh route or refresh capability exists (Round 1 fix E).

Capabilities: `history:read` (LIST_HISTORY_WORKSPACE + READ_HISTORY_ENTRY) and the separate
`READ_HISTORY_AUDIT` (scopes `history:audit:read` / `action:audit:read` / owner / admin,
AC-13 read-time revalidation, Round 2 G). EXTERNAL_ACTION AUDIT_EVENT rows are hidden from
List and denied (non-disclosing NOT_FOUND) in Detail without the audit capability. Every
returned row is re-checked for payload redaction through the owning adapter (Round 2 F).
Deny-by-default scope validation; browser never authors principal/project/revision/
capability. Reversal creation is NOT a History route (WP3 owns it).

Routes (`registerHistoryRoutes`):

- `POST /product-api/frontend/history/workspace`
- `POST /product-api/frontend/history/entry`

## 6. Verification

- WP4 focused suites: unit 31 + DB parity 13 = **44 tests PASS** (Round 4 fixes):
  projection/cursor 18, adapter identity 8, external-action completeness 5, payload-state
  postgres 7 (incl. projection cache sanitize + setPayloadState transaction rollback),
  history postgres parity 6.
- Full unit suite: **480 tests PASS** (64 files; `stage-8-format-expansion` is a known
  flaky parallel run — 14/14 PASS standalone, unrelated to this delta).
- `tsc --noEmit`, ESLint, Prettier clean.
- Automatic CI on push (PR #80, Draft) — latest head recorded in frontmatter.

## 7. Preserved boundaries

Not implemented in this Work Package (remain unauthorized):

- WP5 History Workspace UI.
- WP6 Integrated Verification + Security + Performance.
- Central authoritative History ledger: FORBIDDEN (projection is NON-AUTHORITATIVE).
- Source Version / Ask history integration: DEFER.
- PR #80 Ready/Merge: user approval required, remains DRAFT.

## 8. Next action

WP4 is ACCEPTED (Round 5). WP5 — History Workspace UI is AUTHORIZED to implement.
WP6 remains NOT_AUTHORIZED. PR #80 stays DRAFT / DO NOT MERGE.
