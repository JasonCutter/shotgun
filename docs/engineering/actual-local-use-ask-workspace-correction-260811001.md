# Actual Local Use Ask Workspace Correction Evidence

## 1. Starting State

- Canonical base: `main` at `95a489b9165280ffcf6ef4bfb662aec93dbb46ed`
- Verified relationship before branching: `HEAD == main == origin/main`
- Working branch: `codex/actual-local-use-ask-workspace-correction`
- Pre-existing untracked `scratch/` files and stashes were preserved and excluded.

## 2. Root Cause

### Defect A — Ask layout

The Question Draft labels, controls, textarea and submit button were direct children of an
`action-card` without a form layout. Normal inline flow compressed the textarea and controls even
when desktop width was available.

### Defect B — SourceSelection UI

The Browser always submitted `sourceSelections: []` and exposed no Source or SourceVersion picker.
The PostgreSQL and in-memory Ask projections also withheld `SOURCE_EXPLORATION` specifically until
the Browser could pin a server-authorized SourceVersion.

The correction reuses the existing boundaries:

- `ShotgunApiClient.listSources()` and `/product-api/frontend/sources/query` provide the current
  Active Project Source Library.
- `SourceLibraryItemView.capabilities` owns `SELECT_FOR_ASK` eligibility, while `askUsageState` and
  `askUsageExplanation` provide the server-owned state and reason.
- `AskSourceSelectionView` already owns `sourceId`, `sourceVersionId` and `evidenceIds`.
- `SOURCE_EXPLORATION` requires at least one selection; `HYBRID` permits zero or more selections.
- Empty `evidenceIds` are valid because Evidence selection is optional.
- Each turn submits its explicit SourceSelections. No new inheritance policy was introduced.
- New questions use the Active Project. When a follow-up Conversation belongs to a different
  Resource Project, the existing active-Project-only Sources API is not used to infer or expose a
  cross-Project selection; the picker fails closed until the Projects match.

## 3. Implementation

- Added a semantic, responsive Ask form grid with a full-width textarea and grouped actions.
- Added a server-backed Source context picker for `SOURCE_EXPLORATION` and `HYBRID`.
- Preserved the selected immutable SourceVersion identity in Browser state; a later Library refresh
  does not silently replace an already pinned identity.
- Disabled server-declared unavailable Sources and displayed their authoritative readiness reason.
- Filtered any mismatched Project item defensively and required the Source Library page Project to
  match the Ask resource.
- Kept `CANONICAL_ONLY` submissions source-free and enforced the Browser-side
  `SOURCE_EXPLORATION` minimum before the Server performs final validation.
- Enabled `SOURCE_EXPLORATION` in the production PostgreSQL Ask projection. The in-memory adapter
  retains its safe default and enables the mode only when a runtime explicitly supplies a matching
  Source validator.
- No architecture contract, database schema, migration, runtime dependency or citation model
  changed. New ADR: `NOT_REQUIRED`.

## 4. OSS Integration

- Existing decision reused: ddsyasas Ask/Chat UI flow remains `REFERENCE_ONLY`.
- This correction uses the existing Shotgun React, TanStack Query, typed Product API and Port/Adapter
  boundaries. It adds no external package, upstream code, fork, version pin or license obligation.
- Migration and rollback: no data migration. Rollback is the correction commit revert; the prior
  server-side SourceSelection validation and persisted data remain unchanged.

## 5. Acceptance Criteria

| AC    | Result | Evidence                                                                                        |
| ----- | ------ | ----------------------------------------------------------------------------------------------- |
| AC-01 | PASS   | Semantic `.ask-question-form` grid and full-width, minimum-height textarea                      |
| AC-02 | PASS   | `max-width: 760px` single-column rule for labels, controls, actions and status                  |
| AC-03 | PASS   | Component test verifies `CANONICAL_ONLY` sends `sourceSelections: []`                           |
| AC-04 | PASS   | Browser and component tests select a server-returned Ask-usable SourceVersion                   |
| AC-05 | PASS   | Submit remains disabled with a clear message until a Source is selected                         |
| AC-06 | PASS   | Selected `sourceId` and exact `sourceVersionId` are retained in Browser state                   |
| AC-07 | PASS   | Component and Playwright request assertions verify the real submit payload                      |
| AC-08 | PASS   | Targeted browser spec verifies UI selection through Ask command and created turn/AnswerRun path |
| AC-09 | PASS   | Existing pinned citation return test passes with the unchanged citation model                   |
| AC-10 | PASS   | Mismatched Project items are not rendered; Resource/Active mismatch fails closed                |
| AC-11 | PASS   | Existing Ask submit, Leave Guard, deep-link and citation tests pass; command code is unchanged  |
| AC-12 | PASS   | No Canonical, Claim, Evidence, Review or transition authority code changed                      |

## 6. Local Validation

The following bounded checks passed on the correction working tree:

- `npm.cmd --workspace @shotgun/web run test -- src/routes/ask-workspace.test.tsx` — 4/4 PASS
- `npm.cmd run frontend:typecheck` — PASS
- `npm.cmd exec vitest run tests/integration/frontend-ask-product-api.test.ts` — 1/1 PASS
- `node --env-file-if-exists=.env node_modules/playwright/cli.js test tests/browser/frontend-phase-2-section-2.spec.ts --workers=1` — 6/6 PASS
- `npm.cmd exec vitest run tests/unit/frontend-ask-write-postgres.test.ts` — 5/5 PASS
- changed-file `eslint` — PASS
- `npm.cmd run typecheck` — PASS
- `git diff --check` — PASS

The first Playwright invocation stopped in global setup before any browser test because
`DATABASE_URL` was not exported. The successful invocation loaded the repository-local `.env` and
did not repeat an executed browser test.

The full test suite, full browser suite, completed Phase revalidation, launch, backup/restore,
deployment and production verification were intentionally not run. Exact-head remote CI is recorded
in the Draft PR and GitHub Actions metadata; no post-CI evidence-only commit is permitted.

## 7. Residual Issues

- Remote Draft PR and exact-head CI evidence are pending publication.
- GitHub CLI authentication was invalid at the initial preflight and must be available before PR
  creation and CI inspection.
