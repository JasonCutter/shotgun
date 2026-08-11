# Frontend Phase 2 Section 1 — Conversation Resource Source Context Contract Revision

- Revision ID:
  `frontend-phase-2-section-1-conversation-source-context-contract-revision-260811001`
- Date: 2026-08-11
- Status: **APPROVED AND FROZEN**
- Approved by: user
- Base snapshot:
  `frontend-phase-2-section-1-contract-snapshot-260730001`
- Relationship: **ADDITIVE AUTHORITY / CROSS-WORKSPACE EXTENSION**
- Governing ADR:
  [ADR-132](../../../adr/ADR-132-conversation-bound-source-context-and-resource-project-read-authority.md)
- Related ADRs: ADR-118, ADR-119, ADR-122, ADR-123
- Product implementation: **NOT_AUTHORIZED**

## 1. Revision purpose and preservation rule

This revision freezes the Ask-owned Conversation Resource Project Source Context
boundary discovered during PR #90 local-use review.

It does not replace or silently edit the base Sources contract. AC-01 through
AC-32 retain their existing numbers and meanings. In particular, AC-20 remains:

> The Source Library is a bounded Server projection scoped to the active
> Project.

The existing Sources Workspace route remains Active Project-scoped:

```text
POST /product-api/frontend/sources/query
```

This revision adds a separate Ask cross-workspace read contract. It does not
make the Sources Workspace Library Resource Project-selectable.

## 2. Cross-Workspace Resource Project Source Context

### XW-01 — Ask-owned route

The protected, versioned Product route is:

```text
POST /product-api/frontend/ask/conversations/:conversationId/source-context/query
```

It is owned by the Ask Product boundary. It reuses Sources read machinery only
after Ask has resolved the Conversation authority.

### XW-02 — Bounded Browser input

Browser input is limited to:

- the Conversation locator in the route;
- bounded query text;
- Source filters;
- sort order;
- page limit;
- opaque cursor.

The Browser does not send `projectId`, `activeProjectId`, `targetProjectId`,
`resourceProjectId`, membership, sensitivity, access, policy or storage
authority.

### XW-03 — Conversation locator and Server resolution

`conversationId` is a resource locator, not Project authority. The Server
resolves the Conversation through the authoritative Ask query boundary and
takes its owning `conversation.projectId` as the Resource Project.

Knowledge of a Conversation ID grants no access and does not bypass current
membership checks.

### XW-04 — Resource Project authorization

After resolving the Conversation, the Server separately revalidates current
Resource Project membership, access scopes, sensitivity clearance, access
revision and policy context revision.

Absent or inaccessible Conversation, Source and SourceVersion existence is
masked according to the shared typed failure contract. The Browser does not
distinguish an inaccessible resource from a missing one.

### XW-05 — Resource Project-only projection

The Source Context returns only Sources whose Project equals the
Server-resolved Conversation Resource Project and that are visible and eligible
under its current authority context.

For:

```text
Active Project = B
Conversation Resource Project = A
```

the result contains authorized Project A Sources only. Project B Sources are not
displayed, counted, ranked or selectable.

### XW-06 — Cursor and response binding

The typed response identifies the Conversation and Server-resolved Resource
Project. Every returned item belongs to that Project.

The cursor binds at least:

- Resource Project;
- query and filter digest;
- ordering;
- projection revision.

Authority or projection drift invalidates the cursor safely. A cursor issued
for one Resource Project cannot be replayed for another.

### XW-07 — Cache isolation

Protected Browser query identity includes, as applicable:

- Principal;
- Session;
- Active Project presentation context;
- Conversation;
- Resource Project;
- access revision;
- policy context revision;
- Source projection revision;
- query digest.

Session revocation and Resource Project access loss cancel, purge or mask the
affected protected Source Context. Cache reuse never changes the authoritative
Project.

### XW-08 — Immutable SourceVersion pin

Selecting a Source pins the exact Server-returned SourceVersion. Refresh,
pagination, new Source versions and Active Project changes do not silently
replace the pin.

The follow-up Submit command re-resolves Conversation authority and validates
the Source, SourceVersion and optional Evidence relationships under ADR-123.
The read response alone does not authorize the write.

### XW-09 — No implicit Active Project mutation

Opening a Conversation or querying its Source Context does not switch the
Session Active Project. It does not move the Conversation, Browser Draft,
Source, SourceVersion, Evidence or query cache between Projects.

### XW-10 — Authority preservation

This extension changes no Canonical, Claim, Evidence, Review, Approval or
transition authority. Ask Statements, answers and Source selections do not
become Canonical knowledge through this route.

## 3. Internal read boundary

Sources internals expose a clearly named Server-authorized Project read scope,
or an equivalent abstraction, rather than treating every authorized Project as
`activeProjectId`.

The construction rules are:

```text
Sources Workspace
session.activeProjectId
→ Server authorization
→ authorized Project Sources read scope

Ask Conversation Source Context
conversation.projectId
→ Server authorization
→ authorized Project Sources read scope
```

The shared Sources projection, repository, readiness and pagination logic may
be reused behind this boundary. It does not resolve Conversation ownership and
does not accept Browser authority.

## 4. Rejected contract shapes

The following remain forbidden:

1. adding `projectId` or `resourceProjectId` selectors to `/sources/query`;
2. adding Conversation-selectable dual authority modes to `/sources/query`;
3. embedding the full Source Library in `AskWorkspaceView`;
4. switching Active Project when opening a Conversation;
5. trusting Browser route state, response fields or headers as Project
   authority;
6. using a fixture-only or test-only bridge without a production Product route.

These alternatives either create a confused-deputy boundary, mix cursor/cache
authority modes, couple unrelated projection lifecycles, mutate Session context
implicitly or provide false production evidence.

## 5. Required later implementation evidence

The Product implementation is not authorized by this revision. When separately
authorized, it must provide focused evidence for:

1. request and response runtime decoding;
2. rejection of Browser Project authority fields;
3. inaccessible Conversation and Source masking;
4. Resource Project membership, sensitivity and policy revalidation;
5. cursor and cache Resource Project isolation;
6. exact immutable SourceVersion selection;
7. Active B → Conversation A deep link → A Source selection → follow-up Submit
   → Resource Project A retained;
8. absence of Project B Source leakage;
9. no Session Active Project mutation;
10. unchanged Active-Project behavior of `/sources/query`.

The already accepted PR #90 layout and basic Source picker behavior are not
reopened by this verification scope.

## 6. Migration, dependency and change control

- Database migration: **NOT_REQUIRED** by this contract revision.
- Runtime dependency: **NOT_REQUIRED**.
- Existing AC-01 through AC-32: **UNCHANGED**.
- Existing AC-20: **UNCHANGED**.
- Product implementation: **NOT_AUTHORIZED**.
- PR Ready transition, merge, deployment and production verification:
  **NOT_AUTHORIZED**.

Any change to these frozen extension clauses requires a later explicit Contract
Snapshot revision and user approval. Implementation convenience, Browser state
or a fixture is not authority to weaken them.
