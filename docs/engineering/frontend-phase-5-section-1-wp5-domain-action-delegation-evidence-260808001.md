---
id: FRONTEND-PHASE-5-SECTION-1-WP5-EVIDENCE-260808001
classification: CANONICAL
status: wp5_implemented_pending_review
work_item: FE-P5-S1
created_at: 2026-08-08
subject_base: 8c00519d7498ef1783de1a4e4e48da1a2b4bb8bd
wp4_accepted_head: a645b9e31b00b9e82f2749dc0a9eb2e9dbb9c466
wp4_accepted_ci_number: 634
wp5_implementation_head: 3a8f892ba512f7f2c845d86dfe2639d17a6f9e51
wp5_implementation_ci_number: 639
tracking_issue: https://github.com/JasonCutter/shotgun/issues/71
contract_pr: https://github.com/JasonCutter/shotgun/pull/70
product_pr: https://github.com/JasonCutter/shotgun/pull/73
governing_adr: ADR-130
contract_snapshot: docs/architecture/contracts/snapshots/frontend-phase-5-section-1/frontend-phase-5-section-1-contract-snapshot-260806001.md
implementation_request: docs/implementation/frontend-phase-5-section-1-implementation-request-260806001.md
---

# FE-P5-S1 — WP5 Existing Domain Action Delegation Evidence

## 1. Authority

User authorization (2026-08-08): **FE-P5-S1 WP5 — Existing Domain Action Delegation:
AUTHORIZED**. WP5 proceeds only within the scope of delegating Retry/Cancel to the existing
owning-Domain command routes; Activity does NOT own new generic commands. WP6, Connector
Diagnostics, SSE, additional migrations, new runtime dependency and PR Ready/Merge remain
excluded.

## 2. Scope

WP5 — Existing Domain action delegation (Implementation Request r1 §4 WP5), after WP4 was
ACCEPTED by GPT review (round 2, implementation head `a645b9e31`, CI #634). Final verified head
`3a8f892ba` (CI #639) includes the round-1 corrections.

Implemented:

- **Server-derived available action descriptors**: the Activity Detail now carries
  `availableActions: readonly ActivityAvailableActionV1[]`. Each descriptor is derived by the
  owning-Domain Activity adapter from that Domain's server-derived capabilities and preserves the
  exact command semantics/context:
  - Sources/Ask Cancel → `{ kind: 'CANCEL' }` when the Domain exposes `CANCEL`.
  - Sources/Ask Retry → `{ kind: 'RETRY', retryMode: 'SAME_CONTEXT' | 'CURRENT_POLICY' }` — one
    descriptor per exposed `RETRY_SAME_CONTEXT` / `RETRY_CURRENT_POLICY` capability, so the
    browser never invents a mode.
  - External Action Cancel → `{ kind: 'CANCEL', actionRevision }` (the expected Action aggregate
    revision required by `CancelExternalActionRequestV1`).
  - External Action Retry → `{ kind: 'RETRY', executionId, sourceAttemptId, causationId }` (the
    retry command context required by `RetryExecutionAttemptRequestV1`).
  - Empty when the owning Domain allows no Retry/Cancel for the Activity (deny-by-default, AC-13).
- **Delegation, not ownership**: Activity exposes no generic Retry/Cancel command endpoint. Every
  action is executed through the existing owning-Domain command client:
  - Sources → `SourcesWriteClient.cancel/retry` with the server-derived retry mode.
  - Ask → `AskWorkspaceClient.cancelAnswerRun/retryAnswerRun` with the server-derived retry mode.
  - External Action → `FrontendExternalActionClient.cancelExternalAction/retryExecutionAttempt`
    with the server-derived action revision / execution / source-attempt / causation context.
- **Revalidation at execution time**: the owning-Domain command routes revalidate state and
  authority; Domain Retry causation is preserved by the owning-Domain command; Transport Retry
  is never presented as a Domain Attempt (the projection is unchanged on that boundary).

Not included (preserved boundaries): WP6, Connector Diagnostics, SSE, additional migrations,
new runtime dependency, FE-P5-S2, Ready/Merge, deployment and production verification.

## 2a. Review round 1 corrections (GPT verdict CHANGES_REQUIRED)

GPT review round 1 returned `CHANGES_REQUIRED` with two blockers and one evidence defect. All
were corrected on head `3a8f892ba`, verified by CI **#639** (Frontend / Quality / Required Gates
all green).

| #   | Defect (verdict)                                                                                                                         | Correction                                                                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Retry capability mode lost — `RETRY_SAME_CONTEXT`/`RETRY_CURRENT_POLICY` collapsed to one `RETRY`, and the UI always sent `SAME_CONTEXT` | `availableActions` are now descriptors that preserve `retryMode` (`SAME_CONTEXT`/`CURRENT_POLICY`) one-per-exposed-capability; the UI renders a button per mode and executes with the exact server-derived mode                                   |
| 2   | External Action did not delegate — actions were workspace deep links instead of the owning-Domain command routes                         | The External Action adapter now exposes `{ kind: 'CANCEL', actionRevision }` and `{ kind: 'RETRY', executionId, sourceAttemptId, causationId }`; the UI invokes `cancelExternalAction` / `retryExecutionAttempt` with that server-derived context |
| 3   | Evidence pointed to the pre-correction head/CI (`d275dfd`/`a494f8b`; #637 failed)                                                        | This evidence now records the final verified head `3a8f892ba` (CI #639) in the frontmatter and registry                                                                                                                                           |

Focused tests were extended: contract tests for descriptor decode (retry mode, action revision,
allow-lists), adapter tests for per-mode and External Action command context, and web tests for
mode-preserving retry and External Action command invocation with the server-derived context.

## 3. Acceptance criteria coverage

- **FE-P5-S1-AC-06** (Domain Retry creates a new Attempt with causation): preserved — Retry is
  delegated to the owning-Domain retry command which creates the new Attempt and preserves
  causation.
- **FE-P5-S1-AC-07** (Transport Retry is not a Domain Attempt): preserved — the projection still
  exposes Transport Attempts separately; delegation never converts a Transport Retry into a
  Domain Attempt.
- **FE-P5-S1-AC-13** (Retry and Cancel shown only when the owning Domain allows them; server
  revalidates state and authority): implemented — `availableActions` is server-derived from
  owning-Domain capabilities and the owning-Domain command route revalidates at execution time.

## 4. Implemented files

| File                                                            | Content                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/frontend-activity.ts`                   | Additive `ActivityRetryModeV1` + `ActivityAvailableActionV1` descriptors (retry mode, action revision, execution/source-attempt/causation context) on `ActivitySnapshotV1`/`ActivityDetailV1`; strict `decodeActivityAvailableActionV1`                                                |
| `packages/shotgun-api-client/src/frontend-activity-client.ts`   | Re-exports `ActivityAvailableActionV1` / `ActivityRetryModeV1` to the browser                                                                                                                                                                                                          |
| `modules/frontend-activity/src/activity-domain-mapping.ts`      | Available-action constructors (`activityCancelAction`, `activityCancelActionForRevision`, `activityRetryAction`, `activityExecutionRetryAction`)                                                                                                                                       |
| `modules/frontend-activity/src/activity-domain-read-ports.ts`   | Additive `capabilities` on `AskActivityAnswerRunRow`                                                                                                                                                                                                                                   |
| `adapters/frontend-ask-execution-postgres/src/activity-read.ts` | Reads `frontend_ask.answer_runs.capabilities` (existing column, no migration)                                                                                                                                                                                                          |
| `adapters/frontend-activity-sources/src/index.ts`               | `availableActions` descriptors from `IntakeSubmissionSnapshot.capabilities` (CANCEL + per-mode RETRY)                                                                                                                                                                                  |
| `adapters/frontend-activity-ask/src/index.ts`                   | `availableActions` descriptors from run capabilities (InMemory read port)                                                                                                                                                                                                              |
| `adapters/frontend-activity-external-action/src/index.ts`       | `availableActions` descriptors with `actionRevision` and retry context (execution/source-attempt/causation) from `ExternalActionV1.capabilities` + current execution/attempts                                                                                                          |
| `apps/shotgun-web/src/routes/activity-workspace.tsx`            | Detail action row rendered only from `availableActions` descriptors; Sources/Ask invoke owning-Domain commands with the server-derived retry mode; External Action invokes `cancelExternalAction`/`retryExecutionAttempt` with the server-derived context; refresh + live announcement |
| `apps/shotgun-web/src/activity/activity-workspace-state.ts`     | `CANCELLED` / `RETRY_SENT` announcements                                                                                                                                                                                                                                               |
| `apps/shotgun-web/src/styles/application.css`                   | `.activity-actions` styles                                                                                                                                                                                                                                                             |

## 5. Tests

- `tests/contract/frontend-activity.contract.test.ts` — descriptor decode (retry mode, action
  revision), unknown kind/mode rejection, missing-field rejection.
- `tests/integration/frontend-activity-domain-adapters.test.ts` — per-mode Retry descriptors and
  External Action command context per Domain + deny-by-default when no capability.
- `apps/shotgun-web/src/routes/activity-workspace.test.tsx` — Sources Cancel/Retry delegate to the
  owning-Domain command URLs with the concrete `submissionId` and the exact server-derived retry
  mode; Ask Cancel delegates to the Ask command route; External Action invokes
  `cancelExternalAction`/`retryExecutionAttempt` with the server-derived action revision and
  execution/source-attempt/causation context; no actions when `availableActions` is empty.

**116 web tests PASS** (20 files) and **157 Activity contract/integration/unit tests PASS**.
`tsc --noEmit` (root and `@shotgun/web`), `test:architecture`, ESLint, Prettier and
`oss:audit` all PASS.

## 6. Boundaries preserved

- WP6 (Focused verification and evidence) — NOT_STARTED.
- Connector Diagnostics, SSE, new runtime dependency, additional migrations — NOT included.
- FE-P5-S2 History/Audit/Rollback — NOT included.
- Ready/Merge of PR #73, deployment, production verification — NOT authorized.

## 7. Next action

Report WP5 implementation, verification and evidence to the GPT review gate. Do not begin WP6
until this Work Package is reviewed and accepted for progression.
