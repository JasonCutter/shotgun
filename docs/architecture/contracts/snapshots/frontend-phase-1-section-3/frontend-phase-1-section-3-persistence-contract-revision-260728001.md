# Frontend Phase 1 Section 3 Persistence Contract Revision

- Revision ID: `frontend-phase-1-section-3-persistence-contract-revision-260728001`
- Date: 2026-07-28
- Status: Approved and frozen
- Governing ADR: [ADR-116](../../../adr/ADR-116-zero-project-session-principal-command-project-bootstrap-persistence-boundary.md)
- Base snapshot: `frontend-phase-1-section-3-contract-snapshot-260726001.md`
- Acceptance criteria: AC-01 through AC-27 retain their existing numbers and meanings

## Purpose

This revision makes the already approved zero-project Session and `PRINCIPAL project.create.v1` contract implementable without changing the frozen Section 3 acceptance criteria.

It adds persistence and bootstrap contracts only. It does not add persistent read projections, a new SSE runtime, or a new product completion claim.

## 1. Principal and Project context

```ts
interface TrustedPrincipalContext {
  principalId: string;
  actorType: string;
  authenticationMethod: string;
  credentialId?: string;
}

interface TrustedProjectContext {
  projectId: string;
  membershipId: string;
  projectAccessRevision?: string;
}

interface AuthenticationResult {
  principalContext: TrustedPrincipalContext;
  projectContext?: TrustedProjectContext;
}
```

Rules:

- Principal authentication exists independently from Project authorization.
- `TrustedSecurityContext` remains project-bound and is created only when both contexts are valid.
- `AuthSession.activeProjectId` is nullable.
- A null active Project is valid only when the accessible Project set is empty.
- Accessible Projects plus null active Project is a typed invalid state; no browser auto-selection is allowed.

## 2. Product session V2

A normal first-run response may be:

```json
{
  "version": "2.0.0",
  "sessionReady": true,
  "projectReady": false,
  "activeProject": null,
  "accessibleProjects": []
}
```

In this state:

- Home Action Center is not queried.
- `/settings/projects` renders Project creation onboarding.
- The state is not mapped to `SESSION_REQUIRED`, `NOT_FOUND`, or `BACKEND_UNAVAILABLE`.
- The V1 decoder remains available for existing project-bound sessions.

## 3. Frontend command V2 scope

```ts
type FrontendProjectContextInputV2 =
  | {
      scope: 'PRINCIPAL';
      activeProjectId?: never;
      targetProjectId?: never;
      resourceProjectId?: never;
      observedProjectAccessRevision?: string;
    }
  | {
      scope: 'PROJECT';
      activeProjectId: string;
      targetProjectId: string;
      resourceProjectId?: never;
      observedProjectAccessRevision?: string;
    }
  | {
      scope: 'RESOURCE';
      activeProjectId: string;
      targetProjectId: string;
      resourceProjectId: string;
      observedProjectAccessRevision?: string;
    };
```

`project.create.v1` in a zero-project Session uses `scope: 'PRINCIPAL'`.

The browser never fabricates Project authority and never supplies an internal created-Project binding.

## 4. Command ledger V2

Required additive fields:

```text
envelope_version
scope_kind
active_project_id
scope_binding_key
```

`target_project_id` becomes nullable for V2 `PRINCIPAL` rows.

The accepted scope kinds are:

```text
PRINCIPAL
PROJECT
RESOURCE
```

The deterministic idempotency identity is:

```text
principalId
+ envelopeVersion
+ scopeKind
+ canonical scopeBindingKey
+ commandType
+ commandSchemaVersion
+ idempotencyKey
```

Keep `(principal_id, client_request_id)` unique.

V1 rows are backfilled as `1.0.0` and `PROJECT`, using the existing target-Project binding. Existing V1 semantic digests and outcomes are immutable.

## 5. Semantic digest V2

Digest inputs:

- envelope version,
- accepted Principal identity,
- normalized scope context,
- command type and schema version,
- canonical payload,
- sorted typed preconditions,
- accepted policy binding.

Excluded:

- `clientRequestId`,
- `idempotencyKey`,
- server-generated `commandId`,
- correlation/causation/trace values,
- `clientIssuedAt`.

A replay lookup with the same `clientRequestId` but different accepted meaning returns a typed request mismatch failure.

## 6. Atomic Project bootstrap

The application boundary exposes a `ProjectBootstrapUnitOfWork` or equivalent transaction port that atomically performs:

1. zero-project Session row lock,
2. Principal and Session revalidation,
3. zero-project and access-revision precondition validation,
4. Project creation,
5. creator Owner Membership creation,
6. Session active-Project activation,
7. domain audit and operation binding.

The command ledger `ACCEPTED` row is durable before the transaction. Ledger `COMPLETED` is written after commit.

Project, Owner Membership, and first-session activation cannot partially commit.

A commit-before-ledger-completion failure is recovered through the original command/request identity, not a new idempotency key.

## 7. Owner cardinality

```text
A Principal may own multiple Projects.
A Project has at most one current Owner Membership.
```

Database protection:

```sql
CREATE UNIQUE INDEX auth_single_owner_per_project_idx
ON auth.project_memberships (project_id)
WHERE is_owner;
```

Preflight stops when a Project already has multiple Owner rows.

## 8. Local Owner installation states

### Fresh

```text
Principal/Credential ready
Session ready
activeProjectId = null
accessibleProjects = []
Project onboarding route
```

Authentication does not create a Project or Membership.

### Existing

Preserve existing Project, Membership, and valid project-bound Session state.

### Ambiguous

Return typed `LOCAL_PROJECT_SELECTION_REQUIRED` instead of picking the first Project or recreating a hidden default Project.

## 9. Migration sequence

```text
Preflight
-> Schema Expand
-> V1/V2 Compatibility Application
-> V2 Activate
-> Validate and Constrain
```

Required schema changes:

- nullable `auth.sessions.active_project_id`,
- additive command-ledger V2 scope fields,
- version-aware scope constraints,
- per-Project Owner uniqueness.

The compatibility application must read both Session forms and both ledger versions before V2 writes are enabled.

After V2 data exists, rollback is to the compatibility application. Schema downgrade and fake-Project backfill are prohibited.

## 10. Typed failure additions

At minimum, the following situations must remain distinguishable:

```text
LOCAL_PROJECT_SELECTION_REQUIRED
ZERO_PROJECT_PRECONDITION_FAILED
PROJECT_ACCESS_REVISION_CONFLICT
CLIENT_REQUEST_MEANING_MISMATCH
PROJECT_BOOTSTRAP_ALREADY_COMPLETED
PROJECT_BOOTSTRAP_OUTCOME_UNKNOWN
```

Exact transport status mapping is an implementation choice, but the typed product meaning is stable.

## 11. Required tests

- V1 session compatibility
- valid zero-project Session V2
- invalid null active Project with accessible Projects
- V1 command-ledger digest/outcome immutability
- V2 Principal/Project/Resource scope validation
- idempotency separation across scope kinds and bindings
- same `clientRequestId` meaning mismatch
- atomic rollback at every bootstrap transaction step
- concurrent first-Project commands
- commit-before-ledger-completion recovery
- existing-install preservation
- fresh-install no hidden Project creation
- one Owner per Project and one Principal owning multiple Projects
- migration preflight stop on conflicting data
- compatibility-application rollback after V2 activation

## Unchanged

- AC-01 through AC-27
- non-persistent initial Shell/Home projections
- no initial SSE infrastructure
- Browser drafts remain outside server Action Center ranking
- `OUTCOME_UNKNOWN` is not automatically resubmitted
- Section 3 product implementation and Frontend Phase 1 completion remain unapproved
