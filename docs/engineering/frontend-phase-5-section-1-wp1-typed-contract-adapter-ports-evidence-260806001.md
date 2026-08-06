---
id: FRONTEND-PHASE-5-SECTION-1-WP1-EVIDENCE-260806001
classification: CANONICAL
status: wp1_implemented_pending_review
work_item: FE-P5-S1
created_at: 2026-08-06
subject_head: ab0c8749f6db475b16df674250c3b66dc3c63cdb
exact_head: d78b234b8a992e72011184cf7721eeee03869f69
ci_number: 600
ci_run: 31088763496
ci_conclusion: SUCCESS
tracking_issue: https://github.com/JasonCutter/shotgun/issues/71
contract_pr: https://github.com/JasonCutter/shotgun/pull/70
product_pr: https://github.com/JasonCutter/shotgun/pull/73
governing_adr: ADR-130
contract_snapshot: docs/architecture/contracts/snapshots/frontend-phase-5-section-1/frontend-phase-5-section-1-contract-snapshot-260806001.md
implementation_request: docs/implementation/frontend-phase-5-section-1-implementation-request-260806001.md
---

# FE-P5-S1 — WP1 Typed Contract and Adapter Ports Evidence

## 1. Scope

WP1 — Typed contract and adapter ports (Implementation Request r1 §4) implemented on
`codex/frontend-phase-5-section-1-product-implementation`, derived from the approval head
`ab0c8749f6db475b16df674250c3b66dc3c63cdb` (Product Implementation Authorization
`2026-08-06T17:28:00+09:00`, CI #599 PASS).

WP1 covered:

- Activity root, Run, Domain Attempt, Transport Attempt, Stage, Event and Projection metadata.
- Sources, Ask and External Action adapter ports.
- Domain-state mapping and separate projection dimensions.
- Contract decoders that reject browser-authored authority.

## 2. Implemented files

| File                                                       | Content                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| `packages/contracts/src/frontend-activity.ts`              | Activity V1 typed contracts and strict decoders            |
| `packages/contracts/src/index.ts`                          | Exports `frontend-activity`                                |
| `modules/frontend-activity/src/activity-adapter-port.ts`   | Sources/Ask/External Action adapter ports, scope, registry |
| `modules/frontend-activity/src/activity-domain-mapping.ts` | Domain-state mapping and separate dimensions               |
| `modules/frontend-activity/src/activity-error.ts`          | Typed adapter error (fail closed, safe)                    |
| `modules/frontend-activity/src/index.ts`                   | Module exports                                             |

## 3. Contract coverage (Contract Snapshot §4–§5, ADR-130)

- `ActivityRootReferenceV1` — `rootKind JOB|RUN`, `activityId` (projection identity),
  `domainKind`, `domainResourceKind`, `domainResourceId`, `resourceProjectId`, `resourceHref`,
  optional `jobId`, required `runId`. JOB root requires `jobId`; RUN root forbids it.
- `ActivityRunViewV1` — run identity, sequence, state, timestamps, Domain Attempt refs,
  correlation and causation refs. Timestamp ordering is enforced.
- `ActivityDomainAttemptViewV1` — attempt identity, number, kind, state, retryability, safe
  failure, access/Policy Context refs, Stage refs.
- `ActivityTransportAttemptViewV1` — transport identity, Command/Message ref, delivery
  sequence/result, safe failure. A Transport Attempt is never a Domain Attempt.
- `ActivityStageViewV1` — stable `stageId`, `stageKey`, label, sequence, state, bounded progress.
- `ActivityEventViewV1` — bounded operational evidence (not FE-P5-S2 History).
- `ActivityProjectionMetadataV1` — `snapshotRevision`, timestamps, `freshness`
  (CURRENT/LAGGING/STALE/UNKNOWN), `lagMilliseconds`, `adapterStatus`, `partial`, cursor.
- `ActivityDimensionsV1` — separate Progress, Attention, Failure, Retryability, Projection
  Freshness and Adapter Availability dimensions.
- `ActivitySnapshotV1` composite decoder enforces root/run binding and per-run attempt binding.

## 4. Browser-authored authority rejection

Decoders are strict (unknown fields rejected) and additionally reject any payload that carries
browser-authored authority fields. `ACTIVITY_BROWSER_AUTHORITY_FIELDS` covers `actor`,
`principalId`, `activeProjectId`, `capability`, `capabilities`, `policyContext`,
`policyContextId`, `approval`, `credential` and `budget`. `activityId` never replaces the
concrete Domain Resource identity (`domainResourceId` is required).

## 5. Adapter ports and mapping

- `ActivityAdapterPort` common surface (`readQueue`, `readDetail`, `readStages`, `readEvents`,
  `health`) with `ActivityAdapterScopeV1` server-only scope (never browser-authored).
- `SourcesActivityAdapterPort`, `AskActivityAdapterPort`, `ExternalActionActivityAdapterPort`
  domain-typed ports and `ActivityAdapterRegistryPort` for the federated read.
- `ActivityAdapterError` fails closed with safe, non-disclosing classification.
- Domain-state mapping: `activityStateFromSourcesState/ItemState`, `activityStateFromAskState`,
  `activityStateFromExternalActionState` map owning-Domain states into the common lifecycle
  (Ask never invents a Job). `activityFreshnessFrom`, `activityRetryabilityFrom`,
  `activityAttentionFrom`, `activityFailureKindFrom`, `activityAdapterStatusFrom`,
  `combineAdapterAvailability` compute the separate dimensions.

## 6. Verification

Focused tests only (no previously-passed head re-run):

- `tests/contract/frontend-activity.contract.test.ts` — 33 tests (decoders, authority rejection,
  identity and cross-field invariants).
- `tests/unit/frontend-activity-domain-mapping.test.ts` — 16 tests (state mapping, dimensions).
- `tests/integration/frontend-activity-adapter-ports.test.ts` — 5 tests (typed ports, registry,
  partial failure preservation, server-only scope).

Local: 54/54 PASS. `tsc --noEmit`, ESLint and Prettier clean. Governance gates
(`docs:validate`, `docs:frontend-work-items`, `docs:completion-invariants`,
`docs:frontend-projections:check`) PASS after the Work Item transition.

Automatic CI on exact head `d78b234b8a992e72011184cf7721eeee03869f69` (PR #73, draft for
auto CI only) — **CI #600 / `31088763496`: Quality, Frontend, Required Gates SUCCESS**
(Quality 3m42s, Frontend 3m9s, Required Gates 2s). No manual or duplicate CI was dispatched
and no previously-passed head was re-run.

## 7. Work Item transition

The first WP1 Product commit transitions FE-P5-S1 `NOT_STARTED` → `IN_PROGRESS` and FE-P5 Phase
`NOT_STARTED` → `IN_PROGRESS` (a Phase must be IN_PROGRESS while a child Section is
IN_PROGRESS) in `docs/project/frontend-work-items.json`, with Frontend status projections
regenerated.

## 8. Preserved boundaries

Not implemented in this Work Package (remain unauthorized):

- WP2 additive read-model migration (`frontend_activity.activity_index`,
  `frontend_activity.projection_watermarks`).
- Activity Workspace UI, Product API, SSE.
- New runtime dependency.
- Generic Activity retry/cancel command authority.
- FE-P5-S2, Ready/Merge, deployment and production verification.
- Product code was NOT added to PR #70.

## 9. Next action

Report WP1 implementation, verification and evidence. Do not begin WP2 until this Work Package is
reviewed and accepted for progression.
