---
id: FRONTEND-PHASE-5-SECTION-1-AGENT-JOB-ACTIVITY-GAP-AUDIT
classification: CANONICAL
status: approved_contract_frozen_implementation_not_authorized
created_at: 2026-08-06
approved_at: 2026-08-06T12:28:00+09:00
approved_by: user
subject_base: 8c00519d7498ef1783de1a4e4e48da1a2b4bb8bd
tracking_issue: https://github.com/JasonCutter/shotgun/issues/71
---

# FE-P5-S1 — Agent and Job Activity Workspace Gap Audit

## 1. Authority and scope

This audit records the approved FE-P5-S1 contract preparation result against
`main@8c00519d7498ef1783de1a4e4e48da1a2b4bb8bd`.

Current authority:

- FE-P4 and FE-P4-S2: `COMPLETE / FINAL_AFTER_MERGE`.
- FE-P5 and FE-P5-S1: `NOT_STARTED`.
- ADR-130 and FE-P5-S1 contract: accepted/frozen.
- Product code and migration implementation: `NOT_AUTHORIZED`.

## 2. Existing capability inventory

### Common runtime

`packages/job-runtime` supplies in-memory Job and Attempt records with automatic retry. It has no Project scope, Run, Stage, Event, Attention, durable persistence or Projection Watermark and cannot serve as Product authority.

Message envelopes already separate message, correlation, causation, trace, Job and Attempt identities. Connector Runtime supplies deduplication, timeout, dead letter, replay and in-memory trace/audit diagnostics.

### Sources

Sources persistence contains IntakeSubmission, submission-item state, IntakeAttempt, retry/cancel kinds, correlation/causation, Attention and Project binding. It is sufficient for a Sources Activity adapter.

### Ask

Ask persistence contains AnswerRun, AnswerRunAttempt, AnswerRunEvent, partial result, cancel, Outcome Unknown, lease, heartbeat and recovery metadata. Ask has no durable Job above AnswerRun; Activity must use Run as root rather than invent a Job.

### External Action

External Action persistence contains Action aggregate, Execution, ordered ExecutionAttempt, Verification, Result and append-only AuditEvent. It maps naturally to Job, Run, Domain Attempt and Event views.

### Frontend and Product API

The application already has Project-bound route guards, typed API clients, cache isolation, queue-to-detail patterns, accessibility infrastructure and deterministic browser performance gates. `/activity` is still a placeholder and there is no Activity Product API.

## 3. Gap matrix

| Layer | Existing foundation | Approved gap disposition |
| --- | --- | --- |
| Domain Contract | Domain-specific execution resources and distinct IDs | Add federated Activity view contracts; preserve Domain ownership |
| Product API | Project-bound typed APIs | Add Queue, Detail, continuation and refresh reads |
| Persistence | Sources, Ask and External Action durable stores | Add only Activity index and adapter watermarks |
| Frontend | Workspace, queue/detail and cache patterns | Build Activity Queue/Detail/hierarchy UI |
| Security | Principal, Project, Capability and sensitivity guards | Apply non-disclosing cross-domain reads and deep-link revalidation |
| Accessibility | Keyboard/focus/list/table patterns | Add hierarchy/timeline semantics and restrained live updates |
| Recovery | Outcome resolution and stale handling patterns | Add authoritative polling refresh, partial adapter results and revision ordering |
| E2E | Browser lifecycle harness | Verify identity, retry meaning, lag, partial results, isolation and recovery |
| Performance | Approved deterministic median pattern | Apply 2,000 ms Queue and Queue-to-Detail gates |

## 4. Approved decisions

### Architecture

Use a Federated Activity Read Projection. Activity is not a common execution ledger. An Activity root may be Job or Run, and concrete Domain identity remains authoritative.

### ADR

ADR-130 is required and accepted. It refines the implementation boundary of consolidated ADR-111 and preserves ADR-112's Activity/History separation.

### Migration

An additive migration is required but not authorized for implementation. Its allowed persistence is limited to:

- `frontend_activity.activity_index`;
- `frontend_activity.projection_watermarks`.

Full duplicate Job/Run/Attempt/Event histories and FE-P5-S2 data are prohibited.

### Runtime dependency

No new runtime dependency is required. PostgreSQL, Fastify, React Query, React Router and current test infrastructure are sufficient.

### Refresh

Polling is the baseline. SSE is deferred.

### Action authority

Activity may expose server-derived available actions, but Retry and Cancel execute through existing owning Domain commands. Transport Retry never becomes a Domain Attempt.

## 5. Reuse decisions

| Asset | Decision |
| --- | --- |
| PostgreSQL | ADOPT |
| Fastify Product API patterns | ADOPT |
| React Query scoped cache patterns | ADOPT |
| Existing Domain persistence | AUGMENT with read adapters |
| Envelope/correlation/trace contracts | AUGMENT |
| InMemoryJobRuntime | REFERENCE_ONLY; Product authority forbidden |
| OpenKnowledge Agent Activity UX | REFERENCE_ONLY |
| gbrain Minion patterns | REFERENCE_ONLY |
| SSE infrastructure | DEFER |
| New workflow engine | REJECT |

## 6. Frozen Acceptance Criteria

The authoritative set is exactly `FE-P5-S1-AC-01` through `FE-P5-S1-AC-16` in the frozen Contract Snapshot. Addition, removal, renumbering or semantic change requires an explicit amendment.

## 7. Excluded alternatives and effects

- Universal Job identity: rejected because some Domains have only a Run root.
- Observability authority: rejected because retention and availability differ from Domain state.
- Browser-side authoritative composition: rejected because it moves scope and ordering authority to the client.
- Generic Activity commands: rejected because they obscure Domain policy and retry semantics.
- Full Activity event ledger: rejected because it overlaps FE-P5-S2.
- SSE-only design or a new workflow engine: rejected because no material gap requires them.

## 8. Current authority

- Gap Audit: `APPROVED`
- ADR-130: `ACCEPTED`
- Contract Snapshot r1: `FROZEN`
- Implementation Request r1: `FROZEN / NOT_AUTHORIZED`
- Migration: `REQUIRED / IMPLEMENTATION_NOT_AUTHORIZED`
- Runtime Dependency: `NOT_REQUIRED`
- Product implementation: `NOT_AUTHORIZED`
