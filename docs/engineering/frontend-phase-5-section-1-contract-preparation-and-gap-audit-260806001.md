---
id: FRONTEND-PHASE-5-SECTION-1-CONTRACT-PREPARATION-260806001
classification: CANDIDATE
status: review_required
work_item: FE-P5-S1
tracking_issue: https://github.com/JasonCutter/shotgun/issues/71
canonical_base: 8c00519d7498ef1783de1a4e4e48da1a2b4bb8bd
prepared_by: ChatGPT
prepared_at: 2026-08-06
---

# FE-P5-S1 — Agent and Job Activity Workspace

## Contract Preparation, Gap Audit, Contract Snapshot Candidate and Implementation Request Candidate

## 1. Authority and scope

This document is a review candidate. It does not authorize Product implementation, a database migration, a runtime dependency change, Ready transition, merge, deployment, production verification or FE-P5-S2.

Canonical inputs:

- `docs/architecture/frontend/phase-5-operations-audit.md`
- `docs/implementation/frontend-phase-1-5-plan-v1.0.md`
- `docs/project/frontend-work-items.json`
- Shotgun Knowledge Flow Baseline v1.0
- Shotgun Knowledge Flow Detailed Map, especially the cross-cutting Job·Agent Activity and observability/recovery concerns
- Existing repository modules, frontend application, migrations and completed FE-P1 through FE-P4 evidence at `main@8c00519d7498ef1783de1a4e4e48da1a2b4bb8bd`

Excluded:

- FE-P5-S2 History, Audit and Rollback
- Cross-Phase Product Verification
- Deployment and Production Verification
- FE-P4 changes
- A real external workflow runtime or queue replacement
- Product code, test, migration or dependency implementation in this preparation change

## 2. Canonical meaning

Activity is a current operational projection over authoritative Domain Resource snapshots. It is not the durable historical ledger.

The Section must distinguish:

- Job: durable unit of requested work.
- Run: one orchestration run of a Job.
- Attempt: one domain execution attempt within a Run; a Domain Retry creates a new Attempt.
- Stage: a typed progress segment within an Attempt.
- Event: an append-only observation used to update or explain current activity.

Transport retry of the same Command does not create a new Domain Attempt. Job ID, Run ID, Attempt ID, Stage ID, frontend command ID, internal message ID and trace ID remain separate identities connected by typed correlation and causation fields.

SSE, polling and timeline presentation are refresh and observation mechanisms. They never become authority over the Domain Resource snapshot.

## 3. Existing capability inventory

### 3.1 Reusable foundations

The repository already contains foundations that FE-P5-S1 must reuse rather than replace:

1. Kernel/connector runtime concepts for Commands, Events, Queries, correlation, causation, trace, idempotency and retry.
2. Job and Attempt runtime foundations established in the implementation baseline.
3. PostgreSQL persistence and migration discipline.
4. Domain-specific execution records and status transitions from Source processing, Ask execution, Canonical operations and External Action execution.
5. Frontend Product API boundary, authenticated project binding, route guards, typed decoders, recovery surfaces and command outcome resolution.
6. Existing global shell and Action Center navigation patterns.
7. Existing accessibility, E2E and performance-gate conventions.
8. OpenKnowledge Agent Activity and changed-item grouping as a reference pattern, not as a canonical runtime.

### 3.2 Missing integrated Product capability

No completed FE-P5-S1 authority currently establishes all of the following as one project-scoped Product surface:

- A normalized Activity summary across heterogeneous Job kinds.
- Explicit Job → Run → Attempt → Stage hierarchy.
- A current authoritative detail snapshot with separately labeled event/timeline observations.
- Domain Retry versus Transport Retry visibility.
- Projection watermark and lag/freshness state.
- Partial-success and partial-failure representation without collapsing the whole Job to a misleading single state.
- User Attention reasons and resolvable deep links.
- Exact links to the owning Domain Resource rather than generic activity-only objects.
- Recovery actions whose availability is derived from current capability and domain state.
- A complete keyboard-accessible Activity Workspace with list/table alternatives and deterministic focus behavior.

These are implementation gaps, not evidence that the underlying Job runtime is absent.

## 4. Layer-by-layer gap audit

| Layer | Existing foundation | FE-P5-S1 gap | Candidate disposition |
|---|---|---|---|
| Domain Contract | Command/Event/Query identities, job/attempt concepts, domain status models | One normalized Activity contract; explicit Run and Stage view identities; typed attention, lag, partial outcome and deep-link models | Extend contracts additively; preserve domain ownership |
| Product API | Authenticated, project-bound Product API and typed decoders | Activity list/detail/filter/read endpoints; refresh cursor/watermark; optional stream endpoint; capability-derived recovery commands | Add project-scoped read API and narrowly bounded commands |
| Persistence | PostgreSQL job/domain records and append-only event patterns | Efficient cross-domain activity projection and stable query ordering; possible missing Run/Stage projection fields | Migration candidate; final necessity must be proven against exact schema during implementation preparation review |
| Frontend client | Typed client, route guards, outcome resolution and recovery patterns | Activity decoders, query keys/cache isolation, refresh policy, lag and partial-result handling | Reuse existing client boundary |
| UI | Global shell, Action Center and workspace patterns | `/activity` workspace, filters, summary rows, detail hierarchy, timeline, attention and deep links | New FE-P5-S1 Product workspace |
| Security | Principal/project binding and capability checks | Resource-existence non-disclosure across mixed activity kinds; capability-filtered actions and links | Reuse and extend existing authorization rules |
| Accessibility | Existing keyboard/focus conventions | Hierarchical status semantics, live-update restraint, table/list alternative, focus preservation after refresh | New Section-specific evidence required |
| Recovery | Domain-specific retry/cancel/outcome resolution | Unified presentation without inventing generic retry/cancel authority; stale capability prevention | Delegate every action to owning domain command |
| E2E | Prior workspace and governed command E2E patterns | Cross-kind list→detail, lag, attention, retry/cancel distinction, project isolation and refresh scenarios | New focused E2E required |
| Performance | Existing route and governed-command median gates | Activity list→detail and refresh/query budgets with bounded event loading | New focused performance evidence required |

## 5. Architecture decisions

### 5.1 New ADR

**Candidate decision: no new ADR is required for the base implementation.**

Reason:

- The canonical Phase 5 contract already fixes the authority split between Domain Resource snapshots and Activity projections.
- It already fixes Job/Run/Attempt/Stage separation, retry semantics and identity non-equivalence.
- Existing ADR-111/ADR-112 are cited by the canonical Phase 5 document as governing decisions.

A new ADR becomes mandatory only if implementation proposes one of these changes:

- a new external workflow/queue runtime;
- a new canonical owner for Job or Activity data;
- replacement of the snapshot-authority rule;
- a cross-Section retention/history decision belonging to FE-P5-S2;
- a new streaming infrastructure dependency or protocol that changes system boundaries.

### 5.2 Database migration

**Candidate decision: migration likely required, but not yet authorized.**

The Product needs a stable, performant project-scoped Activity projection with explicit Run/Attempt/Stage identity, watermark/freshness and attention data. Existing job/domain tables should be reused. Migration scope must remain additive and may include only fields, indexes or projection tables that cannot be derived efficiently and correctly from existing authoritative records.

Before authorization, the implementation request must provide a schema mapping proving:

- which existing tables/columns are authoritative;
- which values are derived;
- why each new persisted field or index is necessary;
- migration rollback and rebuild behavior;
- that Activity persistence does not become a second canonical history ledger.

### 5.3 Runtime dependency

**Candidate decision: no new runtime dependency.**

Use the existing TypeScript/React frontend, Product API, PostgreSQL, connector/job runtime and current transport mechanisms. Do not add Temporal, NATS, Redis Streams, a second event store, a second state-management library or an OpenKnowledge runtime merely to implement the workspace.

### 5.4 OSS and internal reuse

| Candidate | Decision | Scope |
|---|---|---|
| Existing Shotgun Job/Attempt and domain execution records | ADOPT / AUGMENT | Authoritative status and command ownership |
| Existing Product API, auth/project binding and typed client | ADOPT | Security and transport boundary |
| Existing Global Shell, Action Center and workspace components | AUGMENT | Navigation and presentation consistency |
| OpenKnowledge Agent Activity | REFERENCE_ONLY / AUGMENT pattern | Hierarchy, grouping, progress and changed-item presentation; no runtime or storage adoption |
| OpenKnowledge Burst Diff | DEFER to contexts that already own a typed diff | FE-P5-S1 must not duplicate Review/History semantics |
| gbrain Minion patterns | REFERENCE_ONLY | Recovery and attempt semantics already mediated by Shotgun contracts |
| New workflow/streaming OSS | REJECT for this Section | No demonstrated gap requiring a new runtime |

## 6. Contract Snapshot candidate

Status: `CANDIDATE / NOT_FROZEN`.

### 6.1 Resource views

`ActivitySummaryView`

- activityId
- projectId
- jobId
- currentRunId
- currentAttemptId
- jobKind
- title
- lifecycleState
- outcomeState
- progress summary
- attention summary
- startedAt / updatedAt / completedAt
- projection watermark and freshness
- owning resource deep link
- capability summary

`ActivityDetailView`

- summary
- authoritative job snapshot reference
- runs[]
- attempts[] grouped by run
- stages[] grouped by attempt
- event observations with bounded pagination/cursor
- failures and partial outcomes
- correlation/causation/trace links as separate identifiers
- current attention reasons
- current recovery capabilities
- exact owning resource links

`ActivityRunView`

- runId, jobId, sequence, state, start/end timestamps and attempt IDs

`ActivityAttemptView`

- attemptId, runId, sequence, command reference, state, policy context summary, failure/outcome and retry relation

`ActivityStageView`

- stageId, attemptId, typed stage kind, state, progress, timestamps and failure summary

`ActivityAttentionView`

- reason kind, severity, user-readable explanation, owning resource, required capability and resolution deep link

`ActivityFreshnessView`

- snapshotVersion/watermark, projection watermark, observedAt and state: `CURRENT | LAGGING | STALE | UNAVAILABLE`

### 6.2 Lifecycle rules

- Lifecycle and outcome are separate dimensions where necessary.
- `AWAITING_APPROVAL`, `PAUSED`, `RETRY_SCHEDULED`, `OUTCOME_UNKNOWN`, partial success and partial failure must not be collapsed into generic `RUNNING` or `FAILED`.
- Cancel is not rollback.
- Retry does not erase the prior Attempt.
- Domain Retry creates a new Attempt; transport redelivery does not.
- Timeline events cannot override the authoritative snapshot.
- A stale Activity response cannot offer an action that current capability no longer permits.
- Missing authorization must not reveal that another project’s resource exists.

### 6.3 Product API candidate

Read:

- `GET /product-api/frontend/activity`
- `GET /product-api/frontend/activity/:activityId`
- `GET /product-api/frontend/activity/:activityId/events`
- optional existing-transport-compatible refresh/stream endpoint only if justified without a new dependency

Commands must remain domain-owned. FE-P5-S1 may expose a command façade only when it resolves current capability and dispatches the exact owning-domain command; it must not implement generic state mutation.

### 6.4 UI candidate

Route: `/activity`

Required surfaces:

- Project-scoped activity list with stable filters and ordering.
- Attention-first and active-work views without hiding completed/failed outcomes.
- List/table representation; no canvas-only or color-only state.
- Detail hierarchy for Job, Run, Attempt and Stage.
- Bounded event timeline with explicit “observed” semantics.
- Projection lag/freshness and partial-result indicators.
- Exact owning-resource deep links.
- Capability-derived Retry/Cancel/Resume/Resolve actions where the owning domain supports them.
- Refresh that preserves focus, selection and useful scroll context.

## 7. Acceptance Criteria candidates

Status: `CANDIDATE / NOT_FROZEN`.

- **FE-P5-S1-AC-01**: `/activity` is available only inside an authenticated active-project boundary.
- **FE-P5-S1-AC-02**: Activity list results are server-bound to the active project and do not reveal cross-project resource existence.
- **FE-P5-S1-AC-03**: List rows expose stable Job identity, kind, lifecycle, outcome, updated time, attention and owning-resource link.
- **FE-P5-S1-AC-04**: Job, Run, Attempt and Stage are represented as distinct typed identities and hierarchy levels.
- **FE-P5-S1-AC-05**: Frontend command ID, message ID, Job ID, Run ID, Attempt ID and trace ID are not treated as interchangeable.
- **FE-P5-S1-AC-06**: Domain Retry creates and displays a new Attempt while preserving the prior Attempt and failure context.
- **FE-P5-S1-AC-07**: Transport retry/redelivery does not create a false Domain Attempt.
- **FE-P5-S1-AC-08**: Authoritative snapshot state is visually and contractually distinguished from event/timeline observations.
- **FE-P5-S1-AC-09**: Projection freshness is exposed as current, lagging, stale or unavailable with watermark/observed-time evidence.
- **FE-P5-S1-AC-10**: Partial success, partial failure, outcome unknown, paused, awaiting approval and retry scheduled remain distinguishable.
- **FE-P5-S1-AC-11**: User Attention includes a typed reason, required capability and exact resolution deep link.
- **FE-P5-S1-AC-12**: Recovery actions are derived from current server capability and delegated to the owning domain command.
- **FE-P5-S1-AC-13**: Cancel is never presented as rollback, reversal or compensation.
- **FE-P5-S1-AC-14**: Filters and ordering are stable across refresh and pagination.
- **FE-P5-S1-AC-15**: Event loading is bounded and does not require loading an unbounded history to render current state.
- **FE-P5-S1-AC-16**: Refresh, polling or streaming preserves keyboard focus and does not repeatedly announce non-actionable updates.
- **FE-P5-S1-AC-17**: Every visual status has text and semantic equivalents; the hierarchy is operable by keyboard and available as list/table content.
- **FE-P5-S1-AC-18**: Client caching is project-scoped and is purged or invalidated on project/session boundary changes.
- **FE-P5-S1-AC-19**: Unauthorized or stale action attempts fail closed and preserve the authoritative current state.
- **FE-P5-S1-AC-20**: Focused E2E covers list→detail, project isolation, attention deep link, lag display and retry-attempt preservation.
- **FE-P5-S1-AC-21**: Performance evidence proves bounded list→detail and refresh/query behavior using the repository’s established median-gate convention.
- **FE-P5-S1-AC-22**: No new runtime dependency is introduced unless separately approved through an ADR and dependency review.
- **FE-P5-S1-AC-23**: Any migration is additive, rollback/rebuild documented and does not establish Activity as a second canonical history ledger.
- **FE-P5-S1-AC-24**: FE-P5-S2 History/Audit/Rollback and Cross-Phase verification remain outside this Section.

## 8. Implementation Request candidate

Status: `CANDIDATE / NOT_AUTHORIZED`.

### 8.1 Proposed work packages

1. **WP1 — Contract and projection foundation**
   - Finalize typed views, lifecycle/outcome vocabulary and domain adapters.
   - Produce exact schema mapping and migration request if needed.

2. **WP2 — Project-scoped Product API**
   - List/detail/events reads, filters, cursor/watermark and capability resolution.
   - Security and non-disclosure contract tests.

3. **WP3 — Frontend client and Activity list**
   - Typed decoders, project-scoped cache, route, filters, ordering, freshness and attention summaries.

4. **WP4 — Activity detail and recovery delegation**
   - Job/Run/Attempt/Stage hierarchy, bounded observations, failures/partial outcomes, deep links and owning-domain commands.

5. **WP5 — Accessibility, recovery and focused E2E**
   - Keyboard/focus/live-update behavior, stale/unauthorized failure handling and essential lifecycle E2E.

6. **WP6 — Performance and completion evidence**
   - Established median gates, AC evidence matrix, completion authority recording and normal Ready/Merge governance.

### 8.2 Required pre-implementation evidence

Before Product authorization:

- user-approved and frozen AC set;
- exact existing-schema mapping;
- migration decision and bounded migration contract;
- confirmation of no new runtime dependency;
- exact internal modules and frontend surfaces to reuse;
- final scope split proving FE-P5-S2 exclusion;
- Draft PR head and automatic CI success for contract preparation.

### 8.3 Testing policy

Only risk-bearing tests are required:

- active-project isolation and non-disclosure;
- identity and retry semantics;
- snapshot versus event authority;
- stale capability failure;
- attention/deep-link correctness;
- accessible refresh behavior;
- bounded list/detail performance;
- essential list→detail lifecycle E2E.

Do not add duplicate tests for behavior already proven at the same exact head. During implementation, use focused tests per work package and the repository’s full required check only at the final candidate boundary or when automatically run by CI.

## 9. Open questions for user review

1. Approve `24` Acceptance Criteria as the frozen set, or identify removals/merges.
2. Confirm that Activity recovery controls may dispatch existing owning-domain commands from the Activity detail, rather than deep-link-only behavior.
3. Approve the candidate migration posture: likely additive migration, exact scope to be proven before implementation.
4. Confirm no new runtime dependency and no new ADR unless a boundary-changing proposal emerges.
5. Approve the six work-package implementation sequence.

## 10. Current authority state

- FE-P5-S1 Contract Preparation: `IN_REVIEW`.
- Gap Audit: `CANDIDATE COMPLETE`.
- Contract Snapshot: `CANDIDATE / NOT_FROZEN`.
- Implementation Request: `CANDIDATE / NOT_AUTHORIZED`.
- Product implementation: `NOT_AUTHORIZED`.
- Migration implementation: `NOT_AUTHORIZED`.
- Runtime dependency change: `NOT_AUTHORIZED`.
- FE-P5-S2: `NOT_AUTHORIZED`.
- Cross-Phase Product Verification: `NOT_AUTHORIZED`.
- Deployment: `NOT_AUTHORIZED`.
- Production Verification: `NOT_AUTHORIZED`.
