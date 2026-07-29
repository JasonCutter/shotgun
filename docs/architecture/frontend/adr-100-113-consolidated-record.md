---
id: FRONTEND-ADR-100-113-CONSOLIDATED-RECORD
classification: CANONICAL
status: accepted_historical_decisions_consolidated
approved_by: user
approved_at: 2026-07-29
source_state: accepted_notion_decisions
---

# Frontend ADR-100–ADR-113 Consolidated Record

## Record boundary

This document is the Git authoritative owner for accepted Frontend ADR identifiers ADR-100 through ADR-113.

The decisions were originally approved as separate Notion pages. This migration preserves their accepted decision, consequences, rejected alternatives and later Contract Normalization outcomes in a consolidated Git record. The Notion pages remain Legacy References and historical source text. Current detailed cross-phase implementation contracts are also represented by:

- [`Frontend Architecture`](README.md)
- [`Cross-Phase Contract and Completion Audit`](cross-phase-contract-and-completion-audit.md)
- the applicable individual ADR, contract snapshot and engineering evidence files.

Consolidation does not renumber, merge or delete the original identifiers.

## ADR-100 — Active Project·Resource Project·Draft Project Binding

- Status: **Accepted**
- Legacy source: `3a65181d-71ad-8182-ab8f-c67e791ebd85`

### Context

App Shell Active Project, existing Resource Project and an in-progress Draft Project may differ. Treating them as one authority risks wrong Project attribution and cache contamination.

### Decision

1. Distinguish `Active Project`, `Resource Project`, `Draft Project` and `Effective Project`.
2. New Resources default to Active Project.
3. Existing Resource reads and Resource-local Actions bind to Resource Project.
4. Deep Links do not automatically change Active Project.
5. Show Active and Resource Project when they differ.
6. `/sources` is initially Server-scoped to Active Project.
7. The first Source Draft fixes Draft Project; Project changes do not migrate it automatically.
8. `IntakeSubmission.targetProjectId` is fixed at creation.
9. Follow-up questions keep the Conversation Resource Project; new independent questions use Active Project.
10. Cache keys include both Active and Resource Project and all Project decisions require Server validation and Capability.
11. Project switching does not cancel or migrate running Server Resources or `OUTCOME_UNKNOWN` Resources.
12. Home Attention is Active-Project-scoped; Global Background and Notification may include accessible cross-project Resources with Project labels.

### Consequences

Cross-project Deep Links remain readable without silently changing authority, Draft and Intake attribution is protected, and cache invalidation can follow actual Resource ownership.

### Rejected alternatives

- automatic Active Project change on Deep Link;
- overwriting Resource Project with Active Project;
- automatic Draft migration;
- Client-only Project authority.

## ADR-101 — Frontend Async Command·Resource Snapshot·Outcome Unknown

- Status: **Accepted**
- Legacy source: `3a65181d-71ad-815c-8c23-e6b1cbe8d962`

### Context

Sources, Ask, Export, Feedback and Knowledge Transition all create Server Resources from Browser Drafts and require asynchronous processing, cancellation, retry and recovery. Different idempotency and snapshot rules would create duplicate Resources and incorrect completion states.

### Decision

1. Browser Product API writes use a versioned `FrontendCommandRequest`; Browser code does not construct the internal Kernel Message Envelope.
2. The Request contains command and schema versions, `clientRequestId`, `idempotencyKey`, Project Context, Policy Binding, typed Preconditions, Correlation Context, client time and typed Payload.
3. `commandId`, accepted Principal·Project·Policy Context, Semantic Digest, Correlation, Causation and Trace are Server-authoritative receipt and outcome data.
4. CSRF is required transport security context and is not stored in durable Command payload or history.
5. Common outcomes are `ACCEPTED`, `COMPLETED`, `REJECTED` and `OUTCOME_UNKNOWN`; completion disposition separately distinguishes `SUCCEEDED`, `FAILED`, `PARTIAL` and `NO_OP`.
6. `OUTCOME_UNKNOWN` is not failure and must not trigger automatic submission with a new key. Resolve by `clientRequestId`, idempotency and semantic digest ledger, then expected Domain Resource.
7. Resource Snapshots are authoritative; SSE is only a live-update mechanism. Cursor loss, expiration or reconnect requires Snapshot re-read.
8. Transport retry preserves the same Request, key and digest and creates no new Domain Attempt. Domain retry is a new Command and Attempt connected by Correlation and Causation.
9. Typed Preconditions replace one generic expected revision and are atomically checked for target, draft, canonical base, review, evidence, approval, action manifest, preflight, external target and dependency scopes.
10. Cancellation is exposed only by Server Capability and follows Domain-specific effects.
11. Sources include `ACTION_REQUIRED`; Submission summaries distinguish user attention and state-resolution needs.
12. Important Commands, Resources and Attempts preserve Server-interpreted `FrontendPolicyContext`.

### Consequences

Double submission and timeout duplication are controlled, asynchronous state can recover from snapshots, and all Workspaces share one safe retry and outcome model.

### Rejected alternatives

- treating timeout as failure and automatically rerunning;
- using SSE events as the only authority;
- optimistic cancellation completion;
- Workspace-specific idempotency;
- overwriting earlier Attempts.

## ADR-102 — Source Library·Ask Exploration·Intake Re-entry Boundary

- Status: **Accepted**
- Legacy source: `3a65181d-71ad-81e3-b95e-eae1a0ca61fb`

### Context

A Source may be visible in the Library before a stable SourceVersion or Evidence is ready. Ask exploration requires a fixed version or evidence, and newly discovered material must not bypass Intake validation.

### Decision

1. Separate Library visibility from Ask usability.
2. Server provides `askUsageState` and typed selection Capabilities.
3. `askUsageState` distinguishes `NOT_READY`, `SOURCE_VERSION_READY`, `EVIDENCE_READY`, `ACTION_REQUIRED`, `FAILED` and `ACCESS_RESTRICTED`.
4. Source selection pins a specific SourceVersion and never silently advances to the latest version.
5. Ask Source Picker uses Source Discovery search; SourceVersion is required and Evidence is optional.
6. Ask does not create `IntakeSubmission` directly.
7. Ask, Feedback and External Research create `IntakeDraftSeed` and re-enter Sources Workspace validation and user submission.
8. External material kinds remain explicit, and AI answers are not stored as original Evidence.
9. Citation or Evidence errors create `EvidenceRevalidationRequest`.
10. `CitationReturnTarget` preserves Conversation, Branch, Turn, Result Revision, Assertion, scroll, focus and panel context.

### Consequences

Visible-but-not-usable Sources can be explained, SourceVersion drift is blocked, Intake policies are reused and Evidence correction remains traceable.

### Rejected alternatives

- unconditional Ask use for all Library items;
- Client status-string inference;
- automatic latest SourceVersion;
- direct Ask-to-Intake submission;
- treating all external material as public URL;
- storing AI answer text as original Evidence.

## ADR-103 — Settings as Typed Project Policy Control Plane

- Status: **Accepted**
- Legacy source: `3a65181d-71ad-8176-9f37-e50336c18f0c`

### Context

Settings changes Principal preferences, Project, model, cost, privacy, Connector, Directive, schema and diagnostic policy. Treating every field as one low-risk form would bypass Canonical, security, egress, budget and retention boundaries.

### Decision

1. Settings is a typed Project Policy Control Plane.
2. Scope is Principal, Project, System or Resource.
3. Server `Settings Snapshot`, `SettingDescriptor`, Risk, Application Mode and Capability are authoritative.
4. Application modes are `IMMEDIATE`, `CONFIRM_REQUIRED`, `REVIEW_REQUIRED`, `RESTART_REQUIRED`, `MIGRATION_REQUIRED`, `READ_ONLY` and `UNAVAILABLE`.
5. Frontend does not infer risk or Capability from field names, categories or role labels.
6. All writes use CSRF, idempotency, expected revision and `OUTCOME_UNKNOWN` recovery.
7. Archive and delete are separate. Delete, sensitivity reduction, retention shortening, credential revoke, hard budget, schema migration, Directive and Fact Priority changes use high-risk flows.
8. User Directive, Fact Priority and Canonical-semantic changes cannot bypass Proposal and Review.
9. Connector secrets are masked, never redisplayed in full or stored in Browser storage.
10. Existing Resource settings bind to Resource Project.
11. Ask default mode comes from Server Ask UI Policy; `CANONICAL_MODE` is a system fallback.
12. Policy revision changes trigger Capability and cache revalidation and are not silently applied to existing Results.

### Consequences

Settings rendering is descriptor-driven, Server impact and risk remain authoritative, and low-risk preference changes are separated from review or migration-required policy changes.

### Rejected alternatives

- one long form and one save button for all settings;
- hardcoded Client model, provider, risk or Capability;
- immediate toggles for sensitivity, retention, Directive or schema changes;
- optimistic Project deletion;
- Browser credential storage;
- automatic resubmission after timeout.

## ADR-104 — Global Shell and Server-ranked Action Center Boundary

- Status: **Accepted**
- Legacy source: `3a65181d-71ad-81c7-8fb3-c5b70df73304`

### Context

Global Shell and Home aggregate many Domain states but must not become owners of Domain authority or high-risk execution.

### Decision

1. Global Shell expresses Session, Principal, Active Project, Navigation, Feature Availability, Background Summary and global warnings.
2. Home is an Active-Project-scoped Action Center.
3. Server supplies Attention items, priority and `PrimaryActionView` Capability.
4. Shell and Home do not create or modify Source, Ask, Knowledge, Review, Activity or History Domain state.
5. Primary Actions navigate to Domain Workspaces; high-risk Commands are not executed directly.
6. Project switching is Server-confirmed, non-optimistic and does not rewrite Resource Project or cancel running Resources.
7. Notification deletion is not Domain resolution; persistent important states are not toast-only.
8. Global Search and Command Palette focus on navigation and cannot directly delete Projects, approve changes, revoke credentials, change Canonical Knowledge or execute external Actions.
9. First-run readiness is Server state rather than a Client flag.
10. Home Attention and Global Background/Notification have separate scope, cache keys, Snapshots, SSE subscriptions and invalidation lifecycles.
11. Global items retain `resourceProjectId`, safe metadata and typed Resource references; access loss removes or masks protected metadata.
12. Phase 1 completion and overall Frontend completion remain separate.

### Consequences

Server View Models are required, later Phase Workspaces can expose summaries and Deep Links without giving Shell duplicate authority, and caches remain scope-safe.

### Rejected alternatives

- all Domain details and high-risk execution in Home;
- Client-side Attention ranking from API counts;
- automatic Active Project switching on Deep Link;
- optimistic Project switch;
- notification deletion as problem resolution;
- LocalStorage-only first-run state;
- Phase 1 completion as total Frontend completion.

## ADR-105 — Frontend Policy Context Pinning and Current-policy Revalidation

- Status: **Accepted**
- Legacy source: `3a65181d-71ad-81b7-bf83-e54de4d814e6`

### Context

Long-running Intake, Ask, Export, Feedback and Knowledge Transition need a reproducible accepted policy context while sensitive Actions must still respect current strengthened policy.

### Decision

1. Important Commands, long-running Resources and Attempts record Server-interpreted `FrontendPolicyContext`.
2. Context may include Project lifecycle, privacy, sensitivity, retention, model routing, budget, feature availability and schema revision.
3. Server returns accepted context and each Attempt preserves the actually used context.
4. Existing Result meaning and provenance remain pinned to creation-time context.
5. Current policy and Capability are revalidated before external provider or Connector use, protected Citation access, copy, Export, Download, Feedback, Knowledge Transition, retry, archive or delete.
6. Stronger policy may block, mask or stop existing Actions. Relaxed policy never automatically expands existing access.
7. Same-context retry, current-policy retry and new run with current settings remain distinct Server Capabilities.
8. Frontend never infers policy effects from setting diffs or state strings.

### Consequences

Reproducibility and auditability are preserved without allowing old snapshots to bypass current security policy.

### Rejected alternatives

- silently applying current settings to all running Resources;
- skipping current security revalidation;
- automatic access expansion after policy relaxation;
- one undifferentiated retry action;
- Client-only execution eligibility calculation.

## ADR-106 — Knowledge Workspace as Projection-based Read Model

- Status: **Accepted**
- Legacy source: `3a65181d-71ad-8197-984c-cb1e6e7b7117`

### Context

Canonical Knowledge is approved authority. Compiled Truth, search, timeline and related views are rebuildable projections. The UI must not treat derived views as a writable ledger or hide projection lag.

### Decision

1. Knowledge Workspace is read, search and exploration only.
2. The default user unit is a `Knowledge Page` Product View.
3. Compiled Truth is a versioned `ProjectionKind`, not a Canonical Knowledge kind or editable Domain Resource.
4. Fact, Claim, Entity, Relation, Event, Decision, Conflict, Gap and temporal state remain typed.
5. Server provides ranking, readiness and status for Search, Timeline and Related Knowledge.
6. Every display remains traceable to Canonical Statement, Approval, ChangeSet, EvidenceSpan and SourceVersion.
7. Projection lag, stale and partial failure are visible.
8. Edits move to Knowledge Editor and DraftChangeSet.
9. Compiled Truth lineage is `Canonical Snapshot → CompiledTruthProjection → CompiledTruthSnapshot/Blocks`.
10. Stable projection Block IDs support focus and navigation but never replace Canonical Statement IDs.
11. Projection regeneration failure does not roll back Canonical Commit.
12. Search results distinguish Canonical and projection matches.

### Consequences

Canonical authority, projection health and Claim/Fact meaning stay separate, while read models remain rebuildable.

### Rejected alternatives

- Compiled Truth Markdown as Canonical;
- inline Canonical editing from the Knowledge read view;
- Client ranking or temporal validity calculation;
- presenting stale projections as current;
- direct approval or commit of Compiled Truth blocks.

## ADR-107 — Knowledge Editor as DraftChangeSet Authoring Boundary

- Status: **Accepted**
- Legacy source: `3a65181d-71ad-8159-af15-e1467969ebbf`

### Context

Users need to propose official knowledge changes, but editor DOM, Markdown or WYSIWYG state must never overwrite Canonical records directly.

### Decision

1. Knowledge Editor authors `DraftChangeSet`; it is not a Canonical Editor.
2. Editing starts from pinned Canonical and projection snapshots.
3. Visual and source editing normalize into the same typed Operations.
4. Fact, Claim, Entity, Relation, Event, Decision, Evidence, time and Directive intent remain explicit.
5. Every operation carries base revision, target, before/after, rationale, evidence and expected impact.
6. Server Validation, Comparison and Recursive Impact precede Review submission.
7. Stale, Conflict, partial failure and `OUTCOME_UNKNOWN` remain separate states.
8. Saving means Draft save or Review submission, not Canonical application.
9. Ask creates immutable `DraftChangeSetSeed`; only Knowledge Editor materializes, authors, validates and submits `DraftChangeSet`.
10. Allowed path is `Ask → DraftChangeSetSeed → Knowledge Editor → DraftChangeSet → Review Center`.
11. One Seed materializes at most one Draft for the fixed Resource Project and all Commands use idempotency and outcome recovery.
12. Yjs/CRDT remains inactive until a separate ADR.

### Consequences

Approval bypass is blocked, visual edits become auditable typed changes, and partial approval and dangling references remain Server-validated.

### Rejected alternatives

- whole-document WYSIWYG overwrite;
- Browser DOM or Markdown as Canonical;
- immediate Canonical application;
- silent merge of stale bases;
- direct Ask-to-Review submission.

## ADR-108 — Typed Semantic Graph Projection with Accessible Fallback

- Status: **Accepted**
- Legacy source: `3a65181d-71ad-81c9-a864-d74dfbbe01b7`

### Context

Graph exploration is useful, but mixing Canonical edges with AI inference or offering only a visual canvas damages meaning, accessibility and auditability.

### Decision

1. Graph Workspace is a Canonical/projection-based read exploration view.
2. Nodes and edges preserve typed Resources, time range, Evidence, revision and provenance.
3. Derived inference, `POSSIBLY_SAME` and Discovery Candidate are distinct from Canonical edges.
4. Client never merges nodes or creates edges by text similarity.
5. Server supplies depth, node limit, traversal budget and snapshot.
6. Equivalent list, table and path-description fallback is mandatory.
7. Canonical relation changes route to Editor and Review.
8. Projection lag and partial failure are visible.
9. View kinds distinguish `KNOWLEDGE_SEMANTIC`, `GOVERNANCE_IMPACT` and `OPERATIONAL_DEPENDENCY`.
10. `ACTION_CANDIDATE` is allowed only as an explicitly scoped governance or operational overlay, never a default Knowledge node or Canonical relation.
11. Graph overlays have separate snapshot, registry and policy revisions, and actions route to Phase 4 Workspaces.

### Consequences

Canonical Graph meaning is preserved, accessibility and scale remain bounded, and AI discovery stays distinguishable from official knowledge.

### Rejected alternatives

- Graph UI as Canonical store;
- automatic merge of `POSSIBLY_SAME`;
- automatic promotion of AI inference edges;
- canvas without accessible fallback;
- ActionCandidate in default semantic paths;
- direct action approval or execution from the canvas.

## ADR-109 — Review Center as Item-level Approval Gateway

- Status: **Accepted**
- Legacy source: `3a65181d-71ad-813b-9f5f-c2160415321b`

### Context

DraftChangeSet, Candidate, DirectiveProposal, Evidence correction and high-risk policy changes need human judgment. Whole-bundle approval or UI selection as authority creates unsafe partial application and audit gaps.

### Decision

1. Review Center is a unified entry point but does not own Domain Resources.
2. Review is Item/Operation-level and distinguishes full or partial approval, revision request, hold and rejection.
3. Candidate, Canonical Snapshot, Evidence, Conflict and Recursive Impact appear in one Review Context.
4. Approval is a Server Resource bound to Actor, scope, target revision, content digest, policy context and reason.
5. Stale, permission, policy and Evidence changes are revalidated.
6. Server validates dependencies and dangling references for partial approval.
7. User correction type routes to the appropriate Phase.
8. No Canonical write exists before approval.

### Consequences

Item-level safe decisions, reasons, comments, holds and rejection history remain auditable.

### Rejected alternatives

- whole-ChangeSet-only approval;
- treating the approval button as Canonical Commit;
- automatic stale approval application;
- deleting rejected candidates or evidence.

## ADR-110 — External Action Validation·Approval·Preflight·Verify Boundary

- Status: **Accepted**
- Legacy source: `3a65181d-71ad-81bd-a332-e17f354c1305`

### Context

External state change has a different risk boundary from information delivery. Preview state may become stale and Connector success does not prove the actual target result.

### Decision

1. Flow is `Validation → ActionCandidate → Risk Decision → Preview → Approval → Preflight → Execute → Verify`.
2. Information results and Export remain separate from external writes.
3. Server Policy controls risk, approval requirement, Connector and scope.
4. Approval binds exact Action Manifest, target, parameters, digest and expiry.
5. Preflight revalidates permission, credential, target state, budget, policy and idempotency.
6. Stale Preview, changed target or expired approval blocks execution.
7. Execution and Attempts are recorded; `OUTCOME_UNKNOWN` never auto-reruns.
8. Verify compares Connector response with external target state and preserves external IDs, result and audit.
9. Rollback capability and compensating action are shown before execution and are never assumed.

### Consequences

Approval and execution remain aligned, duplicates and stale authority are blocked, and external results are auditable.

### Rejected alternatives

- merging Export and external write;
- unapproved automatic execution;
- indefinitely valid approval;
- automatic rerun after timeout;
- HTTP success as complete verification.

## ADR-111 — Activity Workspace as Job·Attempt·Event Projection

- Status: **Accepted**
- Legacy source: `3a65181d-71ad-8111-8e8e-d9f6ce0dd968`

### Context

Intake, Answer, Projection, Review and External Action are long-running and retriable. UI-managed Job state or raw logs as authority would make recovery and audit unreliable.

### Decision

1. Activity is an operational projection of Job, Run, Attempt and Event.
2. Domain Resource Snapshot is authoritative; SSE, polling and event streams are update mechanisms.
3. Job, Attempt, Stage, Event, user action required and Outcome Unknown remain distinct.
4. Retry, cancel, pause and resume are Domain Commands exposed only by Server Capability.
5. Timeline preserves Correlation, Causation, Trace, Project and Policy Context.
6. User views use safe structured events, not raw logs, prompts, secrets or provider payloads.
7. Home Background Summary is a summary projection and does not duplicate detailed authority.
8. Cross-project Activity requires explicit scope and Project labels.

### Consequences

Long-running work, partial failure and retries are recoverable and explainable without exposing unsafe operational data.

### Rejected alternatives

- SSE-only recovery;
- Client timers as Job state;
- raw logs as user Activity;
- cancelling Jobs on navigation.

## ADR-112 — Immutable History and Reversal ChangeSet Boundary

- Status: **Accepted**
- Legacy source: `3a65181d-71ad-81ba-b9a3-d3ed2b38f6ca`

### Context

Canonical, policy, approval and external Action history must reproduce who changed what and why. Direct rollback to an old snapshot would destroy later changes and audit lineage.

### Decision

1. History reads append-only HistoryEvent, AuditEvent and Revision projections.
2. Events are not edited or deleted.
3. Before/After, Actor, reason, Approval, Evidence, policy/model/tool version, Correlation and Causation are preserved.
4. Diff provides typed Operations and user summary.
5. Rollback creates a `Reversal DraftChangeSet` or Compensating Action rather than overwriting current state.
6. Reversal follows current snapshot, impact, Review and Approval.
7. External reversal is never guaranteed.
8. General cache retention cannot remove Approval or Audit history.
9. `PURGED_BY_POLICY` describes Event payload availability, not Event identity deletion. Tombstone metadata and a purge AuditEvent remain.
10. Legal Hold changes retention, not access permission.
11. Deleted Project becomes a `ProjectTombstone`; general Workspace access stops while separately authorized deleted-project audit scope may preserve lineage.
12. Past membership alone never grants deleted-project audit access and restoration creates explicit recovery lineage.

### Consequences

Decision history remains immutable, reversal is reviewed against current state, and retention or deletion cannot silently erase lineage.

### Rejected alternatives

- database overwrite with an old revision;
- HistoryEvent editing or deletion;
- UI Undo as Canonical rollback;
- automatic external rollback;
- deleting Event rows at retention expiry;
- using Legal Hold as access grant;
- hard-deleting Project audit identity.

## ADR-113 — Five-phase Frontend Responsibility Separation and Design Completion Boundary

- Status: **Accepted**
- Legacy source: `3a65181d-71ad-818f-818c-c00af7bd77c4`

### Context

The Frontend was designed as Platform Boundary, Knowledge Input·Question, Knowledge Understanding·Editing, Governance·Execution and Operations·Audit. Phase design completion must not be confused with total Product implementation completion.

### Decision

1. Frontend Architecture uses five Phases and twelve Sections.
2. Phase ownership is:
   - Phase 1: Session, Project, Settings, Shell;
   - Phase 2: Sources and Ask;
   - Phase 3: Knowledge, Editor and Graph;
   - Phase 4: Review and External Action;
   - Phase 5: Activity and History.
3. Domain authority remains in Server Resources, Snapshots and Capabilities; Frontend Presentation, Draft and Projection are not Canonical.
4. All Phases share Active/Resource Project, ResourceSnapshot, versioned command, accepted policy context, AttentionSignal and Capability contracts.
5. Passing Section design and cross-phase consistency establishes Frontend Architecture direction and allows Product API responsibility boundaries to freeze.
6. Design completion does not mean code, E2E, security, accessibility or performance completion.
7. Implementation completion requires Section Gates and full Cross-Phase Verification.
8. Responsibility changes require history and ADR.
9. `UserDirectiveProposal` is an independent Server Domain Resource owned by a common service, separate from DraftChangeSet Operations and from Directive Apply/Commit.
10. Proposal approval and Directive activation remain separate and unresolved outcomes are recovered rather than automatically resubmitted.
11. Home, Notification, Review, Activity and History use a shared versioned `OperationalResourceKindRegistry` that separates Concrete Resource Kind from Aggregate display kind.
12. `EXTERNAL_ACTION` is an Aggregate family; preflight, execution, verification and compensation remain distinct Concrete Resources.

### Consequences

Duplicate authority and approval bypass are reduced, architecture freeze remains distinct from Product completion, and Phase/Section implementation can trace exact contracts and Gates.

### Rejected alternatives

- Route-by-route design without shared contracts;
- treating Phase design as implementation completion;
- duplicate Domain ownership in Home, Review or Activity;
- changing Phase responsibility without ADR;
- independent Directive schemas per Workspace;
- Directive activation inside DraftChangeSet;
- separate Resource Kind enums per Shell, Activity and History;
- using aggregate kind as Resource identity.

## Migration history

- 2026-07-23–2026-07-24: ADR-100–113 accepted in the Frontend Architecture Notion hierarchy.
- 2026-07-24: later Contract Normalization sections resolved Project, Command, Projection, Seed, Directive, Graph, Resource Kind, retention and deleted-project audit gaps without renumbering these ADRs.
- 2026-07-29: accepted decisions consolidated into this Git owner record under ADR-121. Notion pages remain Legacy References; no identifier was reused or silently discarded.
