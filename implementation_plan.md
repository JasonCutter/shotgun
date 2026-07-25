# Frontend Phase 1 Section 2 — Settings & Project Administration (Fixes)

This plan outlines the fixes and refactoring required to address the PR #20 review comments.

## User Review Required
> [!IMPORTANT]
> The PR #20 review dictates that we connect real PostgreSQL persistence to Settings, enforce full backend authorization (Project Membership & Capability), and create an atomic Project Creation flow. Please review this plan to ensure the approach aligns with your expectations.

## Proposed Changes

### `assemblies/shotgun-app` (Server Runtime)
We will formally wire the repositories to avoid type-casting hacks.

#### [MODIFY] `assemblies/shotgun-app/src/server.ts`
- Add `projectAdminRepository?: ProjectAdministrationRepositoryPort` and `settingsRepository?: SettingsRepositoryPort` to `ApplicationOptions`.
- Remove the `as Record<string, unknown>` hacks.

#### [MODIFY] `assemblies/shotgun-app/src/main.ts`
- Instantiate `PostgresProjectAdministrationRepository(pool)` and `PostgresSettingsRepository(pool)` and pass them to `createApplication()`.

#### [MODIFY] `assemblies/shotgun-app/src/product-api/project-routes.ts` & `settings-routes.ts`
- **Target Project Access Control**: Enforce `AuthRepository.listMemberships(principalId)` to ensure the user actually belongs to the target project.
- **Server Capability Check**: For actions like Rename, Archive, Restore, and Delete Request, we will verify that the backend capability allows it.
- **Idempotency**: All `POST` commands will verify `clientRequestId` and `idempotencyKey`, validating against previous payloads to prevent mismatched replays (`IDEMPOTENCY_KEY_REUSE_MISMATCH`).

### `adapters/postgres` (Postgres Repositories & SQL)

#### [MODIFY] `db/migrations/016_stage1_section2_settings_project_admin.sql`
- Add new tables if missing: `project_settings`, `system_settings`, `resource_settings`, `settings_revisions`, `policy_context_revisions`, `settings_commands`, `settings_command_results`, `settings_review_proposals`, `settings_audit_events`.
- Add CHECK constraints: `status IN ('ACTIVE', 'ARCHIVED', 'DELETE_REQUESTED')`, `scope IN (...)`, `application_mode IN (...)`, `risk_level IN (...)`, `revision > 0`.

#### [MODIFY] `adapters/postgres/src/index.ts`
- **`PostgresSettingsRepository`**: Replace hardcoded snapshots (e.g. `getSettingsSnapshot`, `getModelDescriptors`, `getCostBudget`, `getPrivacyRetention`, `getDiagnostics`) with actual DB queries or return `UNAVAILABLE` where features are missing.
- Implement transactional `applyCommand` that updates setting values, bumps `settings_revisions` monotonically, and stores the command result and audit log.

### Project Provisioning Coordinator

#### [NEW] `assemblies/shotgun-app/src/product-api/project-creation.ts`
- We will build an atomic `ProjectCreationCoordinator` (or handle it securely inside the Postgres adapter using a transaction via `Pool`) that performs:
  1. `INSERT INTO project_admin.projects` and `project_admin.project_revisions`
  2. Owner membership creation for the calling principal in Auth Schema
  3. `INSERT INTO settings.policy_context_revisions` (Initial Policy context)
  4. `INSERT INTO settings.settings_revisions` (Initial Settings Snapshot)
  5. `INSERT INTO settings.settings_audit_events` (Log Audit)
- If any step fails, the entire transaction rolls back, preventing orphaned projects.

### `apps/shotgun-web` (Frontend Clients)

#### [MODIFY] `apps/shotgun-web/src/session/settings-draft-controller.ts`
- Fix Draft controller to pin `targetProjectId`, `resourceProjectId`, `expectedRevision`, `clientRequestId`, and `idempotencyKey` at draft creation.
- Map string errors to typed errors (`REVISION_CONFLICT` -> `STALE`, etc.).

#### [MODIFY] `apps/shotgun-web/src/app/query-keys.ts` & `routes`
- Actually utilize the 5D `settings5DQueryKey` within the workspaces (Preferences, Models, Costs, Privacy, Policy, etc.).
- Remove ad-hoc keys like `['settings', category, targetProjectId]`.

#### [MODIFY] `apps/shotgun-web/src/routes/settings/settings-layout.tsx` & Workspace components
- Wire up the UI to consume real Impact Previews and properly handle `CONFIRM_REQUIRED`, `REVIEW_REQUIRED`, and `MIGRATION_REQUIRED`.
- Update dialogs to have strict `aria-labelledby`, focus trapping, escape dismissal, and focus restore.

## Verification Plan

### Automated Tests
- Run `npm run check:core` to verify all linters, type checks, and contract/unit/integration tests.
- Run `npm run test:database` to ensure Postgres queries are sound.
- Run `npm run frontend:check` to verify Playwright E2E browser tests and Vite builds.
- Added tests will explicitly cover: Cross-project access denial, Settings Idempotency, Draft pinning, and Atomic Project Rollback.

### Manual Verification
- We will not merge the PR; it will remain Draft. We will report the `npm run` outputs as evidence of compliance.
