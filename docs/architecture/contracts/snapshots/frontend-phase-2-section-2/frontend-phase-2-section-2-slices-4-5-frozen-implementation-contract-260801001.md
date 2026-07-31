# Frontend Phase 2 Section 2 — Slices 4–5 Frozen Implementation Contract

- Contract ID: `frontend-phase-2-section-2-slices-4-5-frozen-implementation-contract-260801001`
- Date: 2026-08-01
- Status: **APPROVED AND FROZEN**
- Approval actor: user
- Governing ADR: ADR-123
- Scope: Slice 4 — Protected Submit Question Command and AnswerRun creation; Slice 5 — Conversation Aggregate persistence
- Canonical base: `main@e24725eac8c44722c7937eca5cb6a28122a4fef3`
- Reviewed candidate baseline: `codex/frontend-phase-2-section-2-write@8c8cdc542e3c598d10fd62aaa2e10f2ed28a01b1`
- Draft PR: `#48`

This contract freezes the implementation boundary for Frontend Phase 2 Section 2 Slices 4–5. It preserves the meanings of AC-01 through AC-24 in `frontend-phase-2-section-2-contract-snapshot-260731001.md` and adds concrete implementation gates required to evaluate the Write and Persistence slices. It does not renumber, delete or silently redefine the original Section acceptance criteria.

## 1. Goal

Implement a protected, Server-authoritative Submit Question command that durably creates or appends a Project-bound Conversation aggregate, records command acceptance and outcome through the existing Frontend Command Ledger, persists the aggregate through an approved PostgreSQL adapter, supports safe idempotency and outcome recovery, and returns an authoritative `AskAnswerRunSnapshot` without automatically committing Canonical knowledge.

## 2. Frozen baseline and current candidate disposition

Slices 1–3 are merged and remain the approved read foundation.

The reviewed Slices 4–5 candidate provides useful contract and UI groundwork but is not accepted as the frozen implementation because it:

- combines read projection, command ledger, mutation and outcome state in `InMemoryAskWorkspaceProjection`;
- bypasses the existing Frontend Command Gateway;
- lacks a production PostgreSQL Ask repository and runtime wiring;
- lacks expected Conversation and Branch revision preconditions;
- uses incomplete semantic idempotency comparison;
- does not implement Browser outcome recovery;
- does not authority-scope outcome lookup;
- accepts SourceSelection identifiers without authoritative relationship validation;
- uses local identifiers incompatible with the proposed global primary keys;
- adds DDL without complete reset, verify, transaction and restart evidence.

Candidate status at freeze: **BLOCKED — ARCHITECTURE REMEDIATION REQUIRED**.

## 3. Required architecture

The implementation must contain equivalent, separately testable responsibilities for:

1. `AskCommandCoordinator`
   - Server authority derivation;
   - request validation;
   - revision validation;
   - SourceSelection validation;
   - Command Gateway orchestration;
   - aggregate transaction orchestration.
2. `FrontendCommandGateway`
   - accepted command identity;
   - semantic digest;
   - idempotency replay and conflict;
   - durable outcome;
   - clientRequestId outcome recovery.
3. `AskConversationRepositoryPort`
   - transactional aggregate create and append;
   - optimistic concurrency;
   - durable resource lookup.
4. `InMemoryAskConversationRepository`
   - deterministic unit and integration tests only;
   - behaviorally compatible with the PostgreSQL adapter for frozen invariants.
5. `PostgresAskConversationRepository`
   - production persistence;
   - database transaction ownership;
   - restart durability.
6. `AskConversationQueryPort` or equivalent
   - bounded Project-scoped reads from authoritative persistence.
7. `AskWorkspaceProjection`
   - read-only Product projection;
   - no command ledger or aggregate mutation ownership.

Equivalent names are allowed. Equivalent responsibility separation is mandatory.

## 4. Frozen command contract

### 4.1 Request fields

`SubmitAskQuestionRequest` must include:

- `schemaVersion`;
- `clientRequestId`;
- `idempotencyKey`;
- `question`;
- `mode`;
- ordered `sourceSelections`;
- optional `conversationId`;
- optional `branchId`;
- required `expectedConversationRevision` for follow-up commands;
- required `expectedBranchRevision` for follow-up commands.

The Browser must not provide:

- Principal ID;
- Session ID;
- Active Project ID;
- target Project ID;
- Resource Project ID;
- access revision as authority;
- policy context revision as authority;
- sensitivity clearance;
- capability claims;
- command ID;
- answerRunId;
- database identity, table or transaction directives.

Unknown fields fail closed.

### 4.2 Server-derived authority

For a new question:

- target Project = Server Active Project.

For a follow-up:

- target Project = Server-resolved Conversation Resource Project;
- the Active Project may remain different;
- the Conversation must not move to the Active Project.

All capability, access, sensitivity and policy checks are performed against the Server-derived target Project.

### 4.3 Semantic digest

The semantic digest includes every meaning-bearing request field:

- command type and schema version;
- normalized question text according to the frozen contract decoder;
- Ask mode;
- Conversation ID;
- Branch ID;
- expected Conversation revision;
- expected Branch revision;
- ordered SourceSelections;
- Source IDs;
- pinned SourceVersion IDs;
- ordered Evidence IDs.

Presentation-only Browser state is excluded.

## 5. Frozen command lifecycle

### 5.1 Accept

Before domain mutation, the Server must durably call the Frontend Command Gateway with:

- Principal ID;
- target Project ID;
- command type;
- command schema version;
- clientRequestId;
- idempotency key;
- semantic digest;
- accepted access revision;
- accepted policy context revision;
- accepted Conversation and Branch revisions when applicable.

The accepted result is either:

- a newly persisted `ACCEPTED` command;
- an exact replay of the original accepted command and known resource identity;
- a typed conflict with zero domain writes.

### 5.2 Apply and complete

For an accepted command, one database transaction must:

- lock or serialize the command execution;
- create or append the Conversation aggregate;
- persist initial AnswerRun and SourceSelections;
- persist aggregate revisions;
- record resulting Conversation, Branch, Turn and AnswerRun identities;
- transition the command to `COMPLETED`.

A committed aggregate without its `COMPLETED` outcome is prohibited.

### 5.3 Reject

Validation, access, policy, revision and domain precondition failures before aggregate commit transition the accepted command to `REJECTED` with a typed safe failure descriptor.

A rejected command performs zero domain writes.

### 5.4 Outcome uncertainty

When the Browser cannot determine whether a previously accepted command completed:

- the Browser enters `OUTCOME_UNKNOWN` presentation state;
- automatic mutation retry remains disabled;
- the original clientRequestId and idempotency key are retained;
- the Browser resolves the existing outcome;
- a new command key is not generated automatically.

## 6. Frozen aggregate contract

### 6.1 Conversation

A Conversation:

- is the aggregate root;
- belongs to exactly one Project;
- has one active Branch that belongs to the Conversation;
- has a durable Conversation revision;
- cannot be moved between Projects by a follow-up command.

### 6.2 Branch

A Branch:

- belongs to exactly one Conversation;
- has a globally unique opaque identity;
- has a durable Branch revision;
- may reference a parent Branch and origin Turn only within the same Conversation;
- owns an ordered sequence of Turns.

### 6.3 Turn

A Turn:

- belongs to one Conversation and one Branch;
- has a globally unique opaque identity;
- has a durable Turn revision;
- has an ordinal unique within the Branch;
- is append-only in Slices 4–5.

### 6.4 AnswerRun

An AnswerRun:

- belongs to one Conversation, Branch and Turn;
- has a globally unique opaque identity;
- has a durable Answer revision;
- records accepted access and policy context revisions;
- owns SourceSelections, Statements and Citations;
- is represented by the authoritative `AskAnswerRunSnapshot`.

Slices 4–5 create the initial AnswerRun only. Domain retry and multiple attempts remain outside this contract.

## 7. New-question transaction

The new-question write passes only when one atomic transaction creates:

1. Conversation;
2. initial Branch;
3. Turn ordinal 1;
4. initial AnswerRun;
5. ordered SourceSelections;
6. initial Conversation, Branch, Turn and Answer revisions;
7. completed command outcome.

Required invariants:

- all identities are globally unique;
- target Project is the Server Active Project;
- the initial Branch is the Conversation active Branch;
- every child belongs to the same Conversation and target Project;
- rollback removes all aggregate writes when completion cannot be recorded.

## 8. Follow-up transaction

The follow-up write passes only when:

- Conversation exists and is accessible;
- target Project is the Conversation Resource Project;
- Branch exists in the Conversation;
- expected Conversation revision equals the current revision;
- expected Branch revision equals the current revision;
- the next Turn ordinal is allocated under serialization or a database uniqueness constraint;
- Turn, initial AnswerRun, revision increments and command completion commit atomically.

Revision mismatch returns `STALE_RESOURCE` or the repository’s equivalent typed conflict and writes nothing.

Two concurrent valid submissions must either serialize into distinct ordinals or cause one typed stale/conflict result. Lost updates and silent overwrite are prohibited.

## 9. Frozen idempotency contract

The durable uniqueness boundary includes:

`principalId + targetProjectId + commandType + commandSchemaVersion + idempotencyKey`

The semantic digest is stored with the accepted command.

Required behavior:

- same key + same digest before completion → original accepted command;
- same key + same digest after completion → original Conversation, Branch, Turn and AnswerRun identities;
- same key + different digest → conflict, zero writes;
- same clientRequestId + different semantic command → conflict, zero writes;
- replay after process restart → same durable result.

An in-memory `Map` is insufficient evidence for this gate.

## 10. Frozen SourceSelection contract

For each SourceSelection, the Server validates:

- Source existence;
- SourceVersion existence;
- SourceVersion ownership by Source;
- target Project and Principal access;
- Ask eligibility under the accepted policy context;
- Evidence existence;
- Evidence ownership by the pinned SourceVersion;
- no implicit latest-version substitution.

Invalid or inaccessible selections fail closed before aggregate write.

Evidence selection remains optional. SourceVersion pinning is mandatory whenever a Source is selected.

## 11. Frozen persistence contract

### 11.1 Production adapter

Production application assembly must inject `PostgresAskConversationRepository` or an explicitly approved equivalent. The default production path must not silently fall back to in-memory persistence.

### 11.2 Managed schema

The default database owner is `frontend_ask` unless repository architecture review identifies an existing canonical schema owner.

Before activation, migration 021 must be aligned to:

- managed schema creation and ownership;
- globally unique IDs;
- foreign keys and same-aggregate relationship constraints where enforceable;
- unique Branch Turn ordinal;
- revision columns and optimistic update predicates;
- indexes for Project Conversation lists and resource lookup;
- ordered SourceSelections, Statements and Citations;
- no duplicate command ledger tables;
- reset and verification registration.

### 11.3 Migration governance

Because migration 021 exists only in the draft branch, it may be corrected in place before merge. After merge, schema corrections require a new additive migration.

The migration proposal must record:

- final table and schema ownership;
- transaction model;
- application adapter wiring;
- ID generation strategy;
- revision update strategy;
- reset and verify impact;
- rollback or forward-repair strategy;
- compatibility and activation steps.

### 11.4 Restart durability

A Conversation submitted before application restart must remain readable and outcome-resolvable after restart using the same durable identities.

## 12. Frozen read-after-write contract

A completed response is built from committed authoritative repository state.

The response includes:

- authoritative AnswerRun snapshot;
- Conversation, Branch, Turn and AnswerRun identities;
- current revisions;
- Project-scoped Workspace projection or exact invalidation instructions;
- command outcome identity sufficient for recovery.

The Server must not return a completed projection constructed only from uncommitted local objects.

## 13. Frozen Browser contract

The Browser:

- keeps the Draft route-scoped and Project-fixed;
- submits only when the Server exposes `SUBMIT_QUESTION`;
- disables submission for stale, inaccessible or offline write state;
- disables automatic mutation retry;
- retains request identity during outcome uncertainty;
- clears the Draft only after verified completion or explicit discard;
- navigates to the Server-returned Conversation identity after a new question;
- updates or invalidates only the exact affected Ask queries;
- never changes the Shell Active Project because a Resource Project Conversation was opened or appended.

## 14. Answer execution boundary

External model execution is not required for Slices 4–5.

The initial AnswerRun may be:

- `ACTION_REQUIRED`;
- reason `MODEL_EXECUTION_NOT_CONFIGURED`.

This is a valid persisted run state only when the command, aggregate and outcome contracts pass. It must not be presented as a generated answer.

Model routing, provider identity, cost accounting, streaming and final answer generation remain outside this frozen scope.

## 15. Canonical safety

Submit Question must not:

- create or modify Canonical knowledge;
- treat generated Statements as Original Evidence;
- create a `DraftChangeSetSeed` automatically;
- create a `UserDirectiveProposalSeed` automatically;
- silently change SourceVersion selections.

Ask output remains a result resource until a separately approved transition is explicitly invoked.

## 16. Frozen implementation gates

The following gates are mandatory.

| Gate | Requirement | Original AC mapping |
| --- | --- | --- |
| S45-G01 | Protected versioned POST and outcome GET with strict decoders | AC-01, AC-07 |
| S45-G02 | Principal, Project, capability and policy authority are Server-derived | AC-02, AC-03 |
| S45-G03 | Read projection and write responsibilities are separated | AC-02, AC-09 |
| S45-G04 | Every write uses Frontend Command Gateway | AC-13, AC-14, AC-20 |
| S45-G05 | Durable ACCEPT before execution; aggregate and COMPLETED outcome commit atomically | AC-09, AC-13, AC-14 |
| S45-G06 | Full semantic digest and durable replay/conflict behavior | AC-14 |
| S45-G07 | Principal- and Project-scoped outcome recovery | AC-13, AC-18, AC-20 |
| S45-G08 | Atomic new Conversation aggregate creation | AC-04, AC-09 |
| S45-G09 | Revision-checked follow-up append and concurrency safety | AC-04, AC-20 |
| S45-G10 | Globally unique identities and durable revisions | AC-04 |
| S45-G11 | Authoritative SourceVersion and Evidence relationship validation | AC-08, AC-15 |
| S45-G12 | PostgreSQL repository and production assembly wiring | AC-04, AC-09, AC-24 |
| S45-G13 | Managed migration, reset, verify and restart durability | AC-20, AC-24 |
| S45-G14 | Read-after-write from committed persistence | AC-09, AC-18, AC-19 |
| S45-G15 | Browser preserves unresolved command identity and never auto-resubmits | AC-13, AC-20 |
| S45-G16 | Valid ACTION_REQUIRED boundary without false answer success | AC-09, AC-17 |
| S45-G17 | No automatic Canonical commit or transition seed | AC-22, AC-23 |
| S45-G18 | Exact-head Contract, unit, integration, DB and E2E evidence | AC-24 |

No gate may be marked PASS from documentation intent alone. PASS requires executable evidence at the exact reviewed Head.

## 17. Required tests

### Contract and decoder

- unknown and Browser-authority fields rejected;
- follow-up revisions required;
- invalid identifier, array, mode and SourceSelection shapes rejected;
- response invariants reject cross-Project or cross-resource identities.

### Command Gateway

- new accept;
- exact replay before and after completion;
- different payload conflict;
- clientRequestId rebinding conflict;
- Principal and Project scope isolation;
- process-restart replay.

### Domain and repository

- atomic new aggregate creation;
- atomic follow-up append;
- stale Conversation revision;
- stale Branch revision;
- concurrent append produces distinct ordinals or one typed conflict;
- rollback produces no orphan resources;
- globally unique IDs across multiple Conversations;
- active Branch and child ownership invariants.

### SourceSelections

- valid SourceVersion pin;
- inaccessible Source or Version;
- Evidence from another SourceVersion;
- Project mismatch;
- no silent latest-version substitution.

### Outcome recovery

- POST response loss followed by outcome resolution;
- accepted but incomplete command resolution;
- completed outcome after restart;
- inaccessible outcome masked as `NOT_FOUND`;
- Browser does not create a new key automatically.

### Database and runtime

- migration reset and verification;
- production assembly selects PostgreSQL adapter;
- no production fallback to in-memory adapter;
- restart durability;
- database constraints and indexes;
- transaction rollback.

### Browser and E2E

- new question submission and Server-returned navigation;
- follow-up append;
- Draft retained during outcome uncertainty;
- Draft cleared after verified completion;
- stale write disabled or rejected safely;
- Resource Project follow-up does not change Active Project;
- keyboard, screen-reader, responsive and 200% zoom coverage for the changed flow.

## 18. Explicit exclusions

The following are not part of Slices 4–5 completion:

- external AI provider or API key;
- model routing and final answer generation;
- streaming and partial event recovery;
- Cancel;
- Domain Retry or accepted-context/current-policy retry selection;
- model and cost disclosure beyond empty/not-available fields;
- Export;
- Feedback;
- `IntakeDraftSeed`;
- `DraftChangeSetSeed`;
- `UserDirectiveProposalSeed`;
- automatic Canonical commit;
- full Frontend Phase 2 Section 2 completion.

## 19. Forbidden completion claims

The following statements are prohibited until their required evidence exists:

- “Persistence complete” when only DDL or an in-memory adapter exists;
- “Command lifecycle complete” when the Frontend Command Gateway is bypassed;
- “Idempotency complete” when replay is not durable across restart;
- “Outcome recovery complete” when only a lookup route exists;
- “SourceVersion pinned” when identifier relationships are not validated;
- “AC-20 PASS” without stale revision and outcome-unknown Browser evidence;
- “Section 2 complete” while remaining Slices are NOT_RUN.

## 20. Submission conditions

A remediation candidate may be submitted for review only when it includes:

1. exact Base and Head SHAs;
2. changed-file inventory;
3. ADR-123 conformance matrix;
4. S45-G01 through S45-G18 evidence matrix;
5. migration and runtime assembly evidence;
6. exact CI Run ID and URL;
7. explicit remaining exclusions;
8. no PR Ready, merge or Section completion claim without separate user approval.

## 21. Governance boundary

This contract is frozen. Changes require:

- an explicit contract revision document;
- reason for change;
- affected gates and implementation scope;
- rejected alternatives;
- user approval before implementation relies on the revision.

This approval authorizes ADR-123 and the Slices 4–5 frozen implementation boundary. It does not authorize PR Ready, merge, Frontend Phase 2 Section 2 completion or the start of another Section.
