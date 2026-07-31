# ADR-123 — Ask Command, Conversation Aggregate, Persistence and Outcome Recovery Boundary

- Status: **Accepted**
- Decision date: 2026-08-01
- Approved by: user
- Scope: Frontend Phase 2 Section 2 — Slices 4–5
- Supersedes: none
- Related ADRs: ADR-103, ADR-114, ADR-118, ADR-119, ADR-121, ADR-122
- Related contract: `frontend-phase-2-section-2-slices-4-5-frozen-implementation-contract-260801001.md`

## Context

Frontend Phase 2 Section 2 Slices 1–3 established the read-only Ask and Conversations foundation: protected Product API reads, Server-derived authority, Active Project and Conversation Resource Project binding, Browser-private drafts, Project-scoped Conversation projections, SourceVersion- and Evidence-pinned Citation navigation, and an authoritative `AskAnswerRunSnapshot` read model.

A later Write and Persistence candidate added Submit Question contracts, Browser submission, an in-memory mutation path, an outcome lookup route, and migration `021_frontend_phase2_ask_product_persistence.sql`. Review found that the candidate followed several surface contracts but did not preserve the approved Frontend write architecture:

1. the existing Frontend Command Ledger was bypassed;
2. read projection, command handling, domain mutation, idempotency and outcome lookup were combined in one in-memory projection;
3. PostgreSQL tables existed without a production Ask repository or application assembly wiring;
4. follow-up writes lacked expected Conversation and Branch revisions;
5. idempotency compared only part of the semantic payload;
6. outcome lookup was not bound to Principal and Resource Project authority;
7. Browser outcome recovery was not implemented;
8. local identifiers such as `branch-main` and `turn-1` were incompatible with globally unique database primary keys;
9. SourceSelection identifiers were accepted without authoritative existence, access and relationship validation;
10. the Section contract referenced ADR-123 before an authoritative ADR owner existed.

The Ask write boundary must be fixed before additional Product code, model execution, streaming, cancellation, retry, export, feedback or transition seed work continues.

## Decision

### 1. Ask Product API owns the Browser write boundary

The Browser submits Ask commands only through protected, versioned Product API routes.

The Product API:

- derives Principal, Session, Active Project, Resource Project, capability, sensitivity, access revision and policy context revision on the Server;
- rejects Browser-supplied authority fields, internal repository identifiers and arbitrary persistence directives;
- runtime-validates request and response contracts;
- calls an Ask Command Coordinator rather than mutating a read projection;
- returns typed command, outcome and resource views rather than raw database rows or internal repository envelopes.

A new question binds to the Server Active Project. A follow-up binds to the Server-resolved Conversation Resource Project. A Browser-supplied Project identifier is never authoritative.

### 2. Command, domain write, persistence and read projection are separate responsibilities

The implementation uses the following boundaries:

- `AskCommandCoordinator`: validates command intent, authority, revisions, SourceSelections and orchestration order;
- `FrontendCommandGateway`: owns accepted command identity, semantic digest, idempotency replay, durable outcome and outcome recovery;
- `AskConversationRepositoryPort`: owns transactional persistence of Conversation aggregates;
- `AskConversationQueryPort` or equivalent projection port: owns bounded Project-scoped reads;
- `InMemoryAskConversationRepository`: test and local development adapter only;
- `PostgresAskConversationRepository`: production persistence adapter;
- `AskWorkspaceProjection`: read-only projection and presentation mapping.

The read projection must not own the command ledger, domain mutation, idempotency map or durable outcome store.

### 3. Every Submit Question write uses the Frontend Command Ledger

Submit Question is a versioned `FrontendCommandRequest` command.

The durable protocol is:

1. **Transaction A — ACCEPT**
   - derive Principal and target Project on the Server;
   - validate the request envelope and semantic digest;
   - insert or replay the command in `ACCEPTED` state;
   - persist immutable accepted context, including revisions and policy context;
   - return the original accepted command identity for an exact replay.
2. **Transaction B — APPLY AND COMPLETE**
   - lock or otherwise serialize the accepted command;
   - revalidate that it is still eligible for execution;
   - apply the Conversation aggregate write;
   - persist the resulting resource identities and authoritative AnswerRun snapshot;
   - transition the command to `COMPLETED` in the same transaction as the aggregate write.
3. **REJECT**
   - when validation or a domain precondition fails before an aggregate commit, record `REJECTED` with a typed safe failure descriptor;
   - a failed transaction must not leave a committed aggregate without its completed command outcome.

`OUTCOME_UNKNOWN` is a Browser recovery state caused by uncertainty about a previously accepted command. It is not permission to create a new command or idempotency key.

### 4. Conversation is the aggregate root

The durable aggregate contains:

- `Conversation` as the Project-bound aggregate root;
- `Branch` as a Conversation child with optional parent Branch and origin Turn;
- append-only `Turn` records ordered within one Branch;
- one or more `AnswerRun` records associated with a Turn as later retry work requires;
- `Statement`, `Citation` and `SourceSelection` records owned by an AnswerRun;
- separate Conversation, Branch, Turn and AnswerRun revisions.

All durable identities are globally unique opaque identifiers generated by the Server. Local constants such as `branch-main`, `turn-1` or revision values derived only from local array length are prohibited in production paths.

The active Branch must belong to the same Conversation. A Branch parent and origin Turn, when present, must belong to the same Conversation and satisfy the branch creation contract.

### 5. New-question and follow-up transactions are distinct

A new question transaction creates, atomically:

1. Conversation;
2. initial Branch;
3. first Turn;
4. initial AnswerRun;
5. SourceSelections and any initial child records;
6. initial aggregate revisions;
7. completed Command outcome.

A follow-up transaction:

1. resolves the Conversation Resource Project on the Server;
2. validates Conversation and Branch ownership and accessibility;
3. requires `expectedConversationRevision` and `expectedBranchRevision`;
4. allocates the next Turn ordinal under a database uniqueness constraint or equivalent serialized append mechanism;
5. creates the Turn and initial AnswerRun;
6. increments Conversation and Branch revisions;
7. completes the Command outcome in the same transaction.

A revision mismatch produces `STALE_RESOURCE` or the repository’s equivalent typed conflict with zero domain writes.

### 6. Idempotency is semantic and authority-scoped

The idempotency scope includes:

- Principal ID;
- target Project ID;
- command type;
- command schema version;
- idempotency key;
- semantic digest.

The semantic digest includes every field that changes the meaning of the command, including at least:

- question text;
- Ask mode;
- Conversation ID, when present;
- Branch ID, when present;
- expected Conversation revision;
- expected Branch revision;
- ordered SourceSelections;
- Source ID;
- pinned SourceVersion ID;
- selected Evidence IDs;
- command schema version.

The same idempotency key and same semantic digest replay the original accepted command and resulting resource identity. The same key with a different digest returns a conflict and performs no write.

`clientRequestId` is unique within the Principal scope and cannot be rebound to another semantic command.

### 7. Outcome recovery is authority-bound

Outcome resolution uses the existing command identity and requires Server-derived Principal and target Resource Project scope.

The Browser:

- preserves `clientRequestId`, idempotency key and semantic request identity while the outcome is unresolved;
- does not enable automatic mutation retry;
- queries the outcome endpoint after a transport timeout or indeterminate response;
- does not generate a new key until the previous command is resolved or explicitly abandoned by a separate approved workflow.

The Server masks inaccessible command outcomes as `NOT_FOUND` and does not reveal cross-Project or cross-Principal command existence.

### 8. SourceSelections are validated Server-side

A SourceSelection is optional, but when present the Server validates that:

- Source and SourceVersion exist;
- the SourceVersion belongs to the selected Source;
- the Principal can access the SourceVersion in the target Project;
- every Evidence ID exists and belongs to the pinned SourceVersion;
- the selected version is eligible for the requested Ask mode and policy context;
- no selection silently advances to a newer SourceVersion.

A string-shaped identifier alone is not sufficient evidence of a valid pin.

### 9. `AskAnswerRunSnapshot` remains the authoritative run state

Command completion means the command and initial aggregate write completed. It does not mean external model execution succeeded.

When no model execution provider is configured, the initial AnswerRun may be persisted as:

- state: `ACTION_REQUIRED`;
- reason: `MODEL_EXECUTION_NOT_CONFIGURED`.

The authoritative snapshot owns run identity, state, revisions, SourceSelections, Statements, Citations, model metadata when available, cost metadata when available and user-attention reason.

Streaming and partial events may later project progress, but they never replace the authoritative snapshot.

### 10. Production persistence uses a PostgreSQL adapter

The production application must assemble `PostgresAskConversationRepository` or an equivalent approved PostgreSQL adapter. The in-memory adapter is limited to tests and explicit local development modes.

Migration `021_frontend_phase2_ask_product_persistence.sql` remains a candidate until it is aligned with this ADR and the frozen contract. Before activation it must:

- use the repository’s managed database schema convention, with `frontend_ask` as the default approved schema unless an existing canonical schema owner is explicitly selected;
- use globally unique identifiers compatible with runtime generation;
- define required foreign keys, uniqueness constraints and revision columns;
- support serialized Branch Turn ordinal allocation;
- avoid duplicating the Frontend Command Ledger tables;
- register Ask schema ownership with database reset and verification tooling;
- include migration integrity and restart durability tests;
- preserve additive migration and rollback governance.

Because migration 021 is not merged to Canonical `main`, it may be corrected in place on the draft branch before approval. Once merged, corrections require a new additive migration and explicit history.

### 11. Read-after-write uses authoritative persistence

After a completed command, the Product API returns or reloads a projection built from the committed repository state. It must not construct a success response from an uncommitted local object graph.

Cache updates and invalidation follow ADR-119:

- update the exact affected Conversation and AnswerRun resources when safe;
- invalidate only affected Project-scoped Ask lists and projections;
- purge or mask protected Ask data after access loss, Session revocation or Project switch;
- never move a Conversation between Projects through a cache update.

### 12. Browser Draft and durable resources remain separate

The question Draft remains route-scoped Browser presentation state until command acceptance.

The Draft:

- is fixed to its originating Project context;
- is not Canonical, Evidence, Conversation, Turn or AnswerRun data;
- is cleared only after a verified completed submission or explicit user discard;
- is preserved during outcome uncertainty;
- is disabled when the Workspace projection is stale, inaccessible, offline for writes or lacks `SUBMIT_QUESTION` capability.

### 13. Ask does not commit Canonical knowledge

Ask Statements, Citations and generated answers are result records, not automatically approved Canonical knowledge.

Any future Canonical change candidate must use `DraftChangeSetSeed`. Any future directive proposal must use `UserDirectiveProposalSeed`. Both remain separately reviewed Product transitions and require explicit user action.

### 14. Migration, dependency, PR Ready, merge and Section completion remain separate controls

This ADR authorizes the architecture and frozen Slices 4–5 implementation contract. It does not by itself authorize:

- a new runtime dependency;
- an external model provider or API key;
- Streaming, Cancel or Domain Retry;
- Export or Feedback;
- transition seed implementation;
- PR Ready transition;
- merge to `main`;
- Frontend Phase 2 Section 2 completion;
- Frontend Phase 2 Section 3 start.

## Consequences

- Existing Frontend Command Ledger semantics are reused rather than duplicated.
- Command acceptance, aggregate commit and durable outcome become recoverable across process restarts.
- Read projection and write domain responsibilities are separated.
- Concurrent follow-up submissions fail safely or serialize without lost Turns.
- Idempotency replay remains stable across retries and process boundaries.
- SourceVersion and Evidence pinning becomes an authority-checked domain invariant.
- Production operation requires a PostgreSQL repository, database assembly wiring and migration lifecycle integration.
- The current in-memory Submit candidate requires remediation before Slices 4–5 can pass.

## Rejected alternatives

- keeping command state in `Map` objects inside `AskWorkspaceProjection`;
- treating a completed HTTP response as the durable command outcome;
- using question text and Conversation ID alone as the idempotency payload;
- generating a new idempotency key after an uncertain response;
- allowing follow-up writes without expected revisions;
- allocating Turn ordinals from an unlocked in-memory array length;
- using local constant Branch or Turn identifiers with global database primary keys;
- accepting SourceVersion and Evidence identifiers without Server relationship checks;
- adding Ask-specific command ledger tables parallel to the existing Frontend Command Ledger;
- considering DDL presence sufficient evidence of production persistence;
- clearing a Draft while the command outcome is unknown;
- automatically committing Ask output to Canonical knowledge.

## Verification requirements

Slices 4–5 are not complete until the frozen implementation contract passes, including:

- strict request and response decoder tests;
- Browser authority-field rejection tests;
- Command Gateway acceptance, replay, digest conflict and clientRequestId rebinding tests;
- Principal- and Project-scoped outcome lookup tests;
- new Conversation aggregate transaction tests;
- follow-up append, stale revision and concurrent ordinal tests;
- transaction rollback tests proving no orphan aggregate or completed write without completed outcome;
- PostgreSQL repository integration and production assembly tests;
- database reset, verify and restart durability tests;
- Source, SourceVersion and Evidence relationship validation tests;
- exact-head Frontend unit, Contract, integration, database and Chromium E2E evidence;
- separate user approval before PR Ready, merge or Section completion.
