# ADR-132 — Conversation-Bound Source Context and Resource-Project Read Authority

- Status: **ACCEPTED**
- Decision date: 2026-08-11
- Accepted by: user
- Scope: PR #90 Ask Workspace architecture correction
- Subject base: `5ea933c8306d44a577ae0ddd8c696640f0a656e9`
- Related ADRs: ADR-118, ADR-119, ADR-122, ADR-123
- Related contract revision:
  `frontend-phase-2-section-1-conversation-source-context-contract-revision-260811001.md`
- Product implementation: **NOT_AUTHORIZED**

## Context

The approved Frontend Phase 2 Section 1 Sources contract defines the Sources
Workspace Library as a bounded Server projection scoped to the Session Active
Project. Its existing Product route remains:

```text
POST /product-api/frontend/sources/query
```

ADR-123 defines a different authority rule for Ask:

- a new question binds to the Server Active Project;
- a follow-up binds to the Server-resolved Conversation Resource Project;
- the Active Project and Conversation Resource Project may differ;
- the Browser never supplies Project authority.

PR #90 added an Ask SourceVersion picker but could use the existing Sources
Library route only when the Active Project matched the Ask Workspace Project.
For an Active Project B and an existing Conversation owned by Project A, the
picker therefore failed closed. That behavior prevented leakage, but it also
prevented the user from selecting an authorized Project A SourceVersion for a
Project A follow-up.

The existing Sources route cannot resolve this conflict. It derives its read
scope only from `session.activeProjectId`, and `SourceLibraryQuery` intentionally
contains no Project or Conversation selector. Reusing `workspace.projectId` as
Browser authority, switching the Active Project, or adding a test-only bridge
would violate the approved Project and authority boundaries.

## Decision

### 1. Ask owns a Conversation-bound Source Context route

Ask Product API adds this versioned, protected read boundary:

```text
POST /product-api/frontend/ask/conversations/:conversationId/source-context/query
```

The route is an Ask-owned cross-workspace read. It is not a second Sources
Workspace Library route and does not broaden the authority of
`/product-api/frontend/sources/query`.

Browser input is limited to:

- `conversationId` in the resource path;
- the query, filter, sort, limit and cursor fields of the bounded Source Library
  query contract.

The request contains no `projectId`, `activeProjectId`, `targetProjectId`,
`resourceProjectId`, membership, sensitivity, access, policy or storage
authority field.

### 2. Conversation identity is a locator, not Project authority

The Server performs the authority sequence:

1. resolve Principal and Session;
2. resolve the Conversation by `conversationId` through the authoritative Ask
   query boundary;
3. mask an absent or inaccessible Conversation as `NOT_FOUND`;
4. take `conversation.projectId` as the Resource Project;
5. revalidate the Principal's current Resource Project membership;
6. derive current access scopes, sensitivity clearance, access revision and
   policy context revision for that Resource Project;
7. perform the bounded Sources read using only that Server-derived scope;
8. bind every returned item, cursor and response identity to the Resource
   Project.

Knowledge of a Conversation ID grants no access. Resource existence and Project
membership remain Server decisions.

### 3. Active Project remains presentation context

Opening or querying a Conversation owned by Project A while Project B is active
does not switch the Session Active Project. It does not move the Conversation,
Draft, Source, SourceVersion, Evidence or any cache entry between Projects.

The required behavior is:

```text
Active Project B
→ open Conversation A
→ Server resolves Resource Project A
→ Source Context returns only authorized Project A Sources
→ select an immutable Project A SourceVersion
→ submit follow-up
→ ADR-123 binds the command and Conversation to Project A
→ Active Project remains B
```

Project B Sources are neither displayed nor selectable in that Source Context.

### 4. Sources Workspace Library contract remains unchanged

The following route remains strictly Session Active Project-scoped:

```text
POST /product-api/frontend/sources/query
```

Frontend Phase 2 Section 1 AC-20 is unchanged. The new route does not add a
Project or Conversation selector to `SourceLibraryQuery` and does not allow the
Sources Workspace to query an arbitrary Resource Project.

### 5. Internal read authority is explicit and reusable

Sources read internals may introduce a shared abstraction named
`ServerAuthorizedProjectSourcesReadScope`, or an equivalent explicit name. Its
meaning is an already-authorized Project read scope, not necessarily the Session
Active Project.

It contains only Server-derived authority such as:

- Principal and Session identity;
- authorized Project identity;
- access scopes and sensitivity clearance;
- access and policy context revisions;
- authority provenance sufficient to audit the owning Product route.

The Sources Workspace route constructs it from `session.activeProjectId`. The
Ask Conversation route constructs it from the Server-resolved
`conversation.projectId`. The current `SourcesReadScope.activeProjectId` name
must not be reused with a Resource Project value whose meaning is different.

Both callers reuse the existing bounded Sources projection, repository and
readiness logic behind this internal authority boundary. The shared machinery
does not become the owner of Conversation authority.

### 6. Response, cursor and cache isolation

The Ask route returns a typed Ask-owned Conversation Source Context view. It may
reuse the existing Source item projection shape internally, but the response
must identify the Conversation and Server-resolved Resource Project explicitly.

The Server enforces:

- every Source and pinned SourceVersion belongs to the Resource Project;
- visibility, `SELECT_FOR_ASK`, sensitivity and policy checks use the Resource
  Project context;
- cursor identity includes the Resource Project, query digest and projection
  revision and becomes stale after relevant authority or projection drift;
- inaccessible Conversation, Source and SourceVersion existence is masked;
- no SourceVersion silently advances to the latest version.

Browser query/cache identity includes Principal, Session, Conversation,
Resource Project, Active Project presentation context, access revision, policy
context revision, projection revision and query digest as applicable. Protected
data is purged or masked after Session revocation or Resource Project access
loss.

### 7. Submit authority remains ADR-123

The Source Context route is read-only. It does not authorize a follow-up write.
Submit continues through ADR-123, where the Server resolves the Conversation
Resource Project again and validates the selected Source, SourceVersion and
Evidence relationships against that target Project before the aggregate write.

Canonical, Claim, Evidence, Review, Approval and transition authority are
unchanged.

## Rejected alternatives

### Add `projectId` or `resourceProjectId` to `/sources/query`

Rejected because it would let the Browser nominate Project authority and create
a confused-deputy boundary at the general Sources Workspace route.

### Add a Conversation selector to `/sources/query`

Rejected because it would mix Active-Project and Conversation-Resource modes in
one route. Mode-dependent authorization, cursor and cache semantics would make
cross-Project leakage and stale-scope reuse easier and obscure Product ownership.

### Embed the full Source Library in `AskWorkspaceView`

Rejected because it couples Ask workspace loading to Source pagination,
filtering, refresh and failure behavior, expands the protected response and
duplicates query lifecycle concerns.

### Automatically switch the Active Project

Rejected because opening a Resource Project deep link must not mutate Session
authority, move Draft context or invalidate unrelated Product state.

### Trust Browser-supplied Project authority

Rejected because `workspace.projectId`, route state, headers and request fields
are presentation inputs, not authorization proof.

### Add a fixture-only or test-only bridge

Rejected because it would demonstrate behavior that the production Product API
cannot authorize and would create false completion evidence.

## Consequences

- Sources Workspace AC-20 and its existing route remain unchanged.
- Ask gains one explicit Server-authoritative cross-workspace read boundary.
- Source projection and repository logic remain reusable behind a clearer
  authorized-Project read scope.
- Conversation authority stays with Ask; Source eligibility stays with Sources;
  follow-up write authority stays with ADR-123.
- Focused implementation evidence must prove Active B → Conversation A → A-only
  Source selection → Project A follow-up, with no B leakage and no Active Project
  mutation.
- No database migration is required by this decision because Conversation
  ownership, Project membership and Project-scoped Source reads already exist.
- No runtime dependency is required.
- Product implementation, PR Ready transition, merge and deployment remain
  separately unauthorized.

## Verification requirements for later implementation

- route request and response runtime-decoder tests;
- Browser Project-authority-field rejection tests;
- inaccessible Conversation and Source masking tests;
- Resource Project membership, sensitivity and policy revalidation tests;
- cursor and cache Resource Project binding tests;
- focused browser proof for Active B and Conversation A without B Source
  leakage or Active Project switching;
- existing Active-Project `/sources/query` contract regression evidence;
- exact-head automatic CI.

These requirements authorize no Product code in this documentation step.
