# ADR-116 — Zero-project Session·Principal Command·Project Bootstrap Persistence Boundary

## Status

Accepted.

- Approval date: 2026-07-28
- Approver: User
- Implementation status: blocked pending implementation authorization
- Scope: Frontend Phase 1 Section 3
- Preceding ADR: ADR-115

## Context

ADR-115 accepted a valid zero-project `ProductSessionView 2.0.0` and a `PRINCIPAL`-scoped `project.create.v1`, but the current persistence model cannot represent them safely:

- `AuthSession` and `auth.sessions.active_project_id` require an active Project.
- The command ledger requires `target_project_id` and assumes project-bound idempotency.
- Local Owner authentication creates a default `shotgun` Project and Owner Membership.
- The existing owner uniqueness rule prevents one Principal from owning multiple Projects.

Fabricated Project IDs and sentinel Projects are rejected because they would violate the Principal/Project authority split.

## Decision 1 — Separate Principal authentication from Project authorization

- A Session represents Principal authentication.
- `AuthSession.activeProjectId` is `string | null`.
- Introduce a `TrustedPrincipalContext` that is independent from Project context.
- Keep `TrustedSecurityContext` project-bound.
- Authentication always returns Principal context and returns Project context only when an active Project and valid Membership exist.
- `activeProjectId = null` is valid only when the accessible Project set is empty.
- When accessible Projects exist but no authoritative active Project can be resolved, fail closed. The browser must not select one arbitrarily.
- Retain the V1 decoder. Represent zero-project sessions only in `ProductSessionView 2.0.0`.

## Decision 2 — Version the command-ledger scope, digest, and idempotency contract

Keep one command ledger as the command outcome truth and add:

- `envelope_version`
- `scope_kind`
- `active_project_id`
- `scope_binding_key`

Relax `target_project_id` so `PRINCIPAL` commands can be represented without a fake Project.

`scope_kind` is one of:

```text
PRINCIPAL
PROJECT
RESOURCE
```

Use a deterministic, versioned canonical encoding for `scope_binding_key`.

The V2 idempotency uniqueness meaning is:

```text
(principal_id,
 envelope_version,
 scope_kind,
 scope_binding_key,
 command_type,
 command_schema_version,
 idempotency_key)
```

Keep `(principal_id, client_request_id)` unique.

Backfill existing V1 rows as `envelope_version = 1.0.0` and `scope_kind = PROJECT` using the existing target Project binding. Do not reclassify old rows as `RESOURCE`, and do not recalculate V1 digests or outcomes.

The V2 digest includes accepted Principal, normalized scope context, command type/schema, payload, sorted typed preconditions, and accepted policy binding. It excludes transport/replay identifiers such as `clientRequestId`, `idempotencyKey`, `commandId`, trace/correlation fields, and `clientIssuedAt`.

A `clientRequestId` lookup whose Principal, envelope, scope, command, schema, or semantic digest differs must fail with a typed mismatch result.

## Decision 3 — Durable accept followed by atomic Project bootstrap

Project creation is ordered as follows:

1. Persist command-ledger `ACCEPTED` independently.
2. In one `ProjectBootstrapUnitOfWork` database transaction:
   - lock the zero-project Session row,
   - revalidate Principal and Session,
   - verify the project-access revision and zero-project precondition,
   - create the Project,
   - create the creator Owner Membership,
   - set the zero-project Session `active_project_id` to the created Project,
   - record domain audit and operation binding.
3. Commit the transaction.
4. Mark the ledger `COMPLETED` and return the produced Project resource.
5. Refetch the authoritative `ProductSessionView`.

Project, Owner Membership, and first-session activation must not partially commit.

Concurrent first-Project creation for the same Session is serialized by a Session lock. Same-request replay returns the existing outcome. A different concurrent request ends with a typed revision/precondition conflict and must not create an implicit second Project.

If the bootstrap transaction committed but ledger completion failed, recover through `commandId` or `clientRequestId`; do not resubmit with a new idempotency key.

Creating an additional Project for a Principal that already has an active Project does not automatically switch the active Project.

## Decision 4 — One Owner per Project, multiple owned Projects per Principal

- A Principal may own multiple Projects.
- A Project has at most one concurrent Owner Membership.
- Replace the global owner uniqueness rule with a per-Project partial unique index.

```sql
CREATE UNIQUE INDEX auth_single_owner_per_project_idx
ON auth.project_memberships (project_id)
WHERE is_owner;
```

Before migration, detect Projects with multiple owners. Do not pick an owner automatically; stop the migration.

Owner transfer, co-owners, relinquishment, and last-owner removal are outside this ADR.

## Decision 5 — Local Owner installation compatibility

### Fresh installation

- Local Owner authentication creates or resolves only the Principal and Credential.
- Authentication does not create a domain Project or Membership.
- No login or credential-entry screen is shown.
- The server establishes the Principal Session only after validating loopback, same-origin, and Local Owner Mode conditions.
- A fresh installation starts with `activeProjectId = null` and `accessibleProjects = []`.
- The first Project is created only by `project.create.v1` with `PRINCIPAL` scope and the atomic bootstrap transaction.

### Existing installation

- Preserve the existing `shotgun` Project, Owner Membership, and accessible Projects.
- Preserve a valid existing project-bound Session.
- Do not force an existing installation into zero-project state.

### Ambiguous intermediate state

- Never select the first accessible Project arbitrarily.
- When Principal authentication succeeds but no authoritative active Project can be resolved, fail closed with typed `LOCAL_PROJECT_SELECTION_REQUIRED`.
- Authentication adapters do not create hidden recovery/default Projects.
- Tests and development fixtures explicitly seed either `ZERO_PROJECT` or `PROJECT_READY`.

## Decision 6 — Expand, compatibility, activate, validate

Migration order is fixed:

1. **Preflight** — check duplicate owners per Project, Session/Membership mismatch, orphan relations, ledger conflicts, and migration state.
2. **Schema expand** — make the Session active Project nullable, add ledger V2 scope columns and version-aware constraints, and add the per-Project owner index.
3. **Compatibility application** — deploy code that reads existing project-bound Sessions, zero-project Sessions, V1 ledger rows, and V2 ledger rows.
4. **V2 activation** — enable identity-only Local Owner bootstrap, zero-project Sessions, `PRINCIPAL project.create.v1`, and atomic Project bootstrap.
5. **Validate and constrain** — validate new constraints and remove only the replaced indexes/constraints.

Rollback rules:

- Before any V2 row or zero-project Session exists, the previous application may be restored.
- After V2 activation, rollback targets the V1/V2 compatibility application, not the older application.
- Do not convert V2 `PRINCIPAL` rows into V1 rows or insert fake Projects.
- Do not automatically restore `active_project_id NOT NULL` while zero-project Sessions exist.
- Treat schema migration as forward-only and prefer forward fixes.

## Relationship to ADR-115

ADR-115 remains accepted and is not silently rewritten.

ADR-116 explicitly replaces ADR-115's initial no-migration boundary only for:

1. nullable `auth.sessions.active_project_id`,
2. command-ledger V2 scope/digest/idempotency persistence,
3. the per-Project single-owner index.

Projection tables, persistent read-projection storage, new SSE infrastructure, and unrelated domain migrations remain unapproved.

AC-01 through AC-27 keep their existing numbers and meanings.

## Impact

- Authentication types, ports, adapters, and Local Owner provisioning
- Principal and Project security contexts
- `ProductSessionView 2.0.0`
- `FrontendCommandRequest 2.0.0`
- Command digest, idempotency, outcome recovery, and audit
- Project bootstrap transaction and repositories
- Session, ledger, and owner-index migrations
- Compatibility, migration, concurrency, and recovery tests

## Excluded

- General signup/login UX
- OAuth, MFA, or password recovery
- Co-owners or owner transfer
- Persistent projection storage
- New SSE infrastructure
- AC-01 through AC-27 changes
- Frontend Phase 1 completion declaration

## Approval boundary

This ADR accepts the architecture and persistence contract. It does not authorize Section 3 product implementation, migration execution, dependency adoption, PR-ready transition, merge, or Frontend Phase 1 completion.
