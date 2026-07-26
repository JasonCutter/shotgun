# ADR-114 — Project Administration and Settings Repository Ownership Boundary

## Status

Accepted for Phase 1 Section 2 implementation.

Canonical synchronization is pending explicit user approval.

## Context

In Frontend Phase 1 Section 2 (`Settings · Project Administration`), Shotgun introduces server-authoritative Project Administration and Settings Policy control. A clear ownership boundary is required between user authentication, project identities, and settings policies to prevent domain coupling and ensure atomic transaction safety.

Previously, `AuthRepository` owned Principal, Session, Membership, and API Token entities. Conflating Project Identity, Project Metadata, and Policy Configuration into `AuthRepository` would violate single-responsibility boundaries, complicate auditability, and create tight database schema coupling.

## Decision

1. **Strict Repository Ownership Separation**:
   - `AuthRepository`: Principal, Session, Membership, API Token, Authentication Audit.
   - `ProjectAdministrationRepository`: Project Identity, Project Metadata, Project Lifecycle Status (`ACTIVE`, `ARCHIVING`, `ARCHIVED`, `RESTORING`, `DELETE_REQUESTED`, `DELETING`, `DELETED`, `RECOVERY_REQUIRED`), Project Revision.
   - `SettingsRepository`: Principal Preference, Project Policy, System Setting, Resource-bound Setting, Settings Revision, Policy Context Revision.

2. **Atomic Project Creation Coordinator**:
   - Creating a new project requires updating both `ProjectAdministrationRepository`, `AuthRepository` (for Owner Membership), and `SettingsRepository` (for default Policy and initial Settings Snapshot).
   - Project creation is orchestrated by an atomic database transaction (or an explicit compensating saga coordinator in distributed setups). Partial failures revert the entire operation; a partial project creation is never returned as successful.
   - Project creation is a principal-scoped administrative command. The request binds to the current session's active project for administrative authority while `payload.newProjectId` identifies the produced Project resource. The new Project is not represented as an existing `resourceProjectId`.

3. **Versioned Command, Typed Preconditions, and Policy Context Pinning**:
   - All state-changing operations use a versioned `FrontendCommandRequest` with one or more typed preconditions. Revisions, digests, Project binding, and policy conditions are validated atomically by the server before the domain write.
   - The browser supplies `clientRequestId` and `idempotencyKey`; the server creates `commandId`, derives authoritative Principal, Project, Security, and Policy contexts, and computes `commandSemanticDigest`.
   - The same idempotency key and semantic digest resolve to the existing command outcome. Reuse with a different digest is rejected with `IDEMPOTENCY_KEY_REUSE_MISMATCH`.
   - Policy changes increment `policy_context_revision` monotonically, allowing downstream engines to detect `POLICY_CONTEXT_CHANGED` and invalidate stale caches.

4. **Frontend Command Gateway Ownership**:
   - `FrontendCommandGateway` owns browser request validation, accepted context capture, semantic digest deduplication, command outcome state, and `clientRequestId`-based outcome resolution.
   - Domain repositories do not expose browser-authored Principal, Actor, Capability, Security Context, Trace, accepted context, or command digest as authority.
   - `commandId` is the Product API command resource identifier and remains distinct from any internal Kernel `messageId`.

## Rejected Alternatives

- **Conflating Project Metadata and Settings into AuthRepository**:
  - _Rejected_: Would violate single-responsibility, bloat authentication security boundary, and obscure audit logs.

- **Client-authoritative Risk Level or Application Mode Computation**:
  - _Rejected_: All `riskLevel`, `applicationMode`, and `capability` evaluations must remain strictly server-authoritative to enforce security boundaries.

## Impact Scope

- `packages/contracts`: Adds typed settings and project administration vocabularies, views, snapshots, and runtime decoders.
- `modules/project-administration` & `modules/settings-policy`: Defines domain ports and repositories.
- `modules/frontend-command-gateway`: Defines command acceptance, idempotency, outcome persistence, and recovery ports.
- `adapters/postgres`: Implements PostgreSQL tables (`projects`, `project_settings`, `settings_revisions`, etc.).
- `adapters/frontend-command-gateway-*`: Implements in-memory and PostgreSQL command ledger adapters.
- `assemblies/shotgun-app`: Exposes `/api/v1/projects/*` and `/api/v1/settings/*` endpoints.
- `apps/shotgun-web`: Implements `/settings/*` workspaces, Draft Controller, and Option B Leave Guard.

## Migration and Rollback

- Database migrations add `project_admin`, `settings`, and `frontend_command` schema tables incrementally. The command ledger is migration `018` because migration `017` was already committed for the Project owner-scope correction and is not rewritten.
- Application rollback disables the new write paths, preserves compatibility readers, and gates migration-dependent behavior behind an application feature switch.
- Destructive down migrations are prohibited for production rollback. Schema corrections use a forward corrective migration.
- Data recovery uses a verified backup restore or point-in-time recovery procedure.
- Project tombstones, command outcomes, audit records, and revisions are retained according to policy. `DROP SCHEMA` is permitted only as part of an explicitly destructive development/test database reset, never as the production rollback contract.
