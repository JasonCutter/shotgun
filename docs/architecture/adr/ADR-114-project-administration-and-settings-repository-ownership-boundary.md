# ADR-114 — Project Administration and Settings Repository Ownership Boundary

## Status

Accepted (Proposed for Phase 1 Section 2 Implementation)

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

3. **Expected Revision & Policy Context Pinning**:
   - All state-changing operations require an `expectedRevision` parameter for optimistic concurrency control.
   - Policy changes increment `policy_context_revision` monotonically, allowing downstream engines to detect `POLICY_CONTEXT_CHANGED` and invalidate stale caches.

## Rejected Alternatives

- **Conflating Project Metadata and Settings into AuthRepository**:
  - _Rejected_: Would violate single-responsibility, bloat authentication security boundary, and obscure audit logs.

- **Client-authoritative Risk Level or Application Mode Computation**:
  - _Rejected_: All `riskLevel`, `applicationMode`, and `capability` evaluations must remain strictly server-authoritative to enforce security boundaries.

## Impact Scope

- `packages/contracts`: Adds typed settings and project administration vocabularies, views, snapshots, and runtime decoders.
- `modules/project-administration` & `modules/settings-policy`: Defines domain ports and repositories.
- `adapters/postgres`: Implements PostgreSQL tables (`projects`, `project_settings`, `settings_revisions`, etc.).
- `assemblies/shotgun-app`: Exposes `/api/v1/projects/*` and `/api/v1/settings/*` endpoints.
- `apps/shotgun-web`: Implements `/settings/*` workspaces, Draft Controller, and Option B Leave Guard.

## Migration and Rollback

- Database migrations add `project_admin` and `settings` schema tables incrementally.
- Rollback can be executed cleanly via `DROP SCHEMA IF EXISTS project_admin CASCADE; DROP SCHEMA IF EXISTS settings CASCADE;`.
