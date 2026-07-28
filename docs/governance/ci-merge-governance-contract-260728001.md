# CI·Merge Governance Contract — Required Gates·Branch Protection

## Status

Accepted.

- Approval date: 2026-07-28
- Approver: User
- Implementation status: blocked pending implementation authorization
- Scope: Project Shotgun CI and pull-request merge governance

## Context

The current GitHub Actions workflow runs `quality` and `frontend` jobs. The `stage12:reuse-operations-gate` script is invoked directly by CI, and `quality:gate` is one of its mandatory internal steps.

CI execution alone does not prove that GitHub blocks merge when a check fails. Required status checks and branch protection are a separate repository-governance boundary.

## Decision 1 — Required Gates aggregator

Add a final aggregator job after `quality` and `frontend`.

- Job name: `Required Gates`
- Stable check name: `CI / Required Gates`
- Use `if: always()` so the aggregator still evaluates when an upstream job fails, is cancelled, or is skipped.
- Pass only when both `needs.quality.result` and `needs.frontend.result` equal `success`.

Representative structure:

```yaml
required-gates:
  name: Required Gates
  if: always()
  needs:
    - quality
    - frontend
  runs-on: ubuntu-latest
  steps:
    - name: Verify required jobs
      run: |
        test "${{ needs.quality.result }}" = "success"
        test "${{ needs.frontend.result }}" = "success"
```

## Decision 2 — `main` branch merge rules

The `main` branch ruleset must require:

- pull-request-based changes,
- required status check `CI / Required Gates`,
- the branch to be up to date before merge,
- merge blocking for failed, cancelled, or skipped required checks,
- direct-push blocking,
- force-push blocking,
- branch-deletion blocking.

This is currently a single-developer repository, so a separate reviewer approval is not mandatory.

## Decision 3 — Quality Gate execution boundary

- `quality:gate` remains a mandatory internal step of `stage12:reuse-operations-gate`.
- Do not invoke `quality:gate` again as a duplicate standalone CI step.
- Do not remove `quality:gate` from the Stage 12 gate.

The intended execution path is:

```text
CI quality job
-> stage12:reuse-operations-gate
   -> quality:gate
```

## Decision 4 — Preserve the current job structure initially

Keep the current `quality` and `frontend` jobs for the first implementation.

Do not split or parallelize the jobs until measured CI duration and bottleneck evidence justify another decision.

## Decision 5 — CI stability requirements

Add:

- pull-request-scoped `concurrency`,
- `cancel-in-progress: true`,
- a bounded `timeout-minutes` on every job,
- explicit names for every `run` step.

A representative concurrency key is:

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

## Decision 6 — Relationship to the Developer Workflow Contract

The accepted Developer Workflow Contract defines `test:quick` and `test:ci`.

- Until CI explicitly adopts `test:ci` and duplicate coverage is resolved, `npm test` must preserve the current full CI-oriented test scope.
- This decision does not change `npm test` to `test:quick`.
- CI job restructuring and test-script alias changes remain implementation work.

## Required verification

1. A Quality Gate failure causes `stage12:reuse-operations-gate`, `quality`, and `Required Gates` to fail, and merge is blocked.
2. A Stage 12 package-test failure blocks merge.
3. A database-test failure blocks merge.
4. A frontend test, build, or Playwright failure blocks merge.
5. A cancelled or skipped upstream job still causes `Required Gates` to fail.
6. Pushing a newer commit cancels the stale CI run and only the latest commit determines merge eligibility.
7. Direct pushes and force pushes to `main` are blocked.
8. Merge is possible only when every required gate succeeds.

## Excluded

- CI job splitting and parallelization
- Live AI tests as required merge checks
- gates that require external provider credentials
- mandatory reviewer approval
- product implementation
- database migration execution

## Approval boundary

This document accepts the CI and merge governance contract only. It does not authorize GitHub Actions edits, branch-ruleset changes, negative-test execution, PR-ready transition, or merge.