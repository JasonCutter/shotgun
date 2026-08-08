---
id: FRONTEND-PHASE-5-SECTION-1-WP5-EVIDENCE-260808001
classification: CANONICAL
status: wp5_implemented_pending_review
work_item: FE-P5-S1
created_at: 2026-08-08
subject_base: 8c00519d7498ef1783de1a4e4e48da1a2b4bb8bd
wp4_accepted_head: a645b9e31b00b9e82f2749dc0a9eb2e9dbb9c466
wp4_accepted_ci_number: 634
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
ACCEPTED by GPT review (round 2, implementation head `a645b9e31`, CI #634).

Implemented:

- **Server-derived available actions**: the Activity Detail now carries
  `availableActions: readonly ActivityActionKindV1[]` (`'CANCEL' | 'RETRY'`), derived by each
  owning-Domain Activity adapter from that Domain's server-derived capabilities. Empty when the
  owning Domain does not allow Retry/Cancel for the Activity (deny-by-default, AC-13).
- **Delegation, not ownership**: Activity exposes no generic Retry/Cancel command endpoint. The
  client delegates execution:
  - Sources → `SourcesWriteClient.cancel/retry` (owning-Domain command route).
  - Ask → `AskWorkspaceClient.cancelAnswerRun/retryAnswerRun` (owning-Domain command route).
  - External Action → deep link to the owning-Domain command surface (`/external-action?action=:id`)
    because the Activity projection cannot assemble the governance fields required by
    `CancelExternalActionRequestV1` (action revision) / `RetryExecutionAttemptRequestV1`
    (execution/attempt/causation ids).
- **Revalidation at execution time**: the owning-Domain command routes revalidate state and
  authority; Domain Retry causation is preserved by the owning-Domain command; Transport Retry
  is never presented as a Domain Attempt (the projection is unchanged on that boundary).

Not included (preserved boundaries): WP6, Connector Diagnostics, SSE, additional migrations,
new runtime dependency, FE-P5-S2, Ready/Merge, deployment and production verification.

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

| File                                                            | Content                                                                                                                                                                                                               |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/frontend-activity.ts`                   | Additive `ActivityActionKindV1` (`'CANCEL' \| 'RETRY'`) + `availableActions` on `ActivitySnapshotV1`/`ActivityDetailV1`; strict decoder allow-list (`ACTIVITY_ACTION_KINDS`)                                          |
| `packages/shotgun-api-client/src/frontend-activity-client.ts`   | Re-exports `ActivityActionKindV1` to the browser                                                                                                                                                                      |
| `modules/frontend-activity/src/activity-domain-mapping.ts`      | `activityAvailableActionsFrom` helper (deterministic `CANCEL`, then `RETRY`)                                                                                                                                          |
| `modules/frontend-activity/src/activity-domain-read-ports.ts`   | Additive `capabilities` on `AskActivityAnswerRunRow`                                                                                                                                                                  |
| `adapters/frontend-ask-execution-postgres/src/activity-read.ts` | Reads `frontend_ask.answer_runs.capabilities` (existing column, no migration)                                                                                                                                         |
| `adapters/frontend-activity-sources/src/index.ts`               | `availableActions` from `IntakeSubmissionSnapshot.capabilities`                                                                                                                                                       |
| `adapters/frontend-activity-ask/src/index.ts`                   | `availableActions` from run capabilities (InMemory read port)                                                                                                                                                         |
| `adapters/frontend-activity-external-action/src/index.ts`       | `availableActions` from `ExternalActionV1.capabilities`                                                                                                                                                               |
| `apps/shotgun-web/src/routes/activity-workspace.tsx`            | Detail action row: Retry/Cancel rendered only from `availableActions`; Sources/Ask invoke owning-Domain command clients; External Action deep links to the owning-Domain command surface; refresh + live announcement |
| `apps/shotgun-web/src/activity/activity-workspace-state.ts`     | `CANCELLED` / `RETRY_SENT` announcements                                                                                                                                                                              |
| `apps/shotgun-web/src/styles/application.css`                   | `.activity-actions` styles                                                                                                                                                                                            |

## 5. Tests

- `tests/contract/frontend-activity.contract.test.ts` — `availableActions` decode, unknown kind
  rejection, missing-field rejection.
- `tests/integration/frontend-activity-domain-adapters.test.ts` — capability-derived actions per
  Domain + deny-by-default when no capability.
- `apps/shotgun-web/src/routes/activity-workspace.test.tsx` — Sources Cancel/Retry delegate to the
  owning-Domain command URLs with the concrete `submissionId`; Ask Cancel delegates to the Ask
  command route; External Action actions are owning-Domain surface deep links; no actions when
  `availableActions` is empty.

**116 web tests PASS** (20 files) and **154 Activity contract/integration/unit tests PASS**.
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
