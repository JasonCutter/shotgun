# Durable Ask refresh correction

Date: 2026-10-12. Development implementation, not operating deployment or final
VP release acceptance.

## Root cause and correction

The worker previously committed a known stale publication as FAILED, then called
`retryAndClaim()` outside that transaction. An interruption left manual-only
FAILED; the immediate retry also bypassed normal pending-knowledge gating.

The existing repository `fail()` Port receives one additive optional v1 input,
`requeueForCurrentKnowledge`. Only a known `complete-vp-snapshot` stale error with
a known result, retryable status, and attempt number below three sets this input.
Both supported adapters retain the FAILED attempt and failure event, then queue
the same AnswerRun. PostgreSQL performs both changes in one transaction.
Existing callers omitting the option retain their behavior; no public API,
migration, provider policy, prompt, output schema, confidence gate or new
authority is added.

Normal worker scanning waits for source knowledge to settle, rechecks authorized
context and execution identity, and creates a fresh `RETRY_CURRENT_POLICY`
attempt. The stale response is never reused as a current answer. Maximum
publication attempts remain three; exhausted attempts terminate FAILED.
OUTCOME_UNKNOWN, cancellation and unrelated stale errors do not enter automatic
requeue. Duplicate failure acknowledgements cannot reactivate the closed attempt.

QUEUED answers now explain, in English and Korean, that source processing and
execution readiness are pending and the same question continues automatically.
No retry or knowledge-review click is introduced.

## Boundaries and reuse

The correction reuses `AskAnswerExecutionRepositoryPort`, the existing queue,
FAILED/QUEUED states, attempt table, event table, SourceVersion watermark,
Evidence context authorization, and existing policy resolution. PostgreSQL is
the existing ADOPT store, augmented behind its existing Shotgun adapter.
gbrain `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` (MIT) remains REFERENCE_ONLY
for job/attempt patterns; its runtime and database cannot replace Shotgun
AnswerRun and Evidence contracts. ddsyasas remains Ask UX REFERENCE_ONLY. No
relevant new OSS package or generic job system is required. Existing source
registry/role decisions remain applicable; no lockfile change or new adoption.

Rollback restores only the old service and adapters/UI; existing attempts,
failure events and source versions remain. Already queued runs are compatible
with the old normal worker, though the old ordering defect would recur on a
future stale publication. No database rollback is necessary.

## Verification

- Ask execution unit suite: **15/15 PASS**, sanitized test wrapper. Includes
  durable requeue then a fresh worker, failure/queue event retention, bounded
  exhaustion, unknown and unrelated stale exclusion, and defensive repository
  rejection when an unknown outcome requests requeue.
- Ask Workspace frontend suite: **32/32 PASS**, sanitized test wrapper. New
  queued waiting explanation, same-run polling, no new submission or retry
  requirement; existing historical freshness and conversation isolation pass.
- Targeted ESLint: PASS on service, both adapters, unit/database tests, UI and
  localization. Final combined checks remain parent integration gates.
- Root `tsc --noEmit`, targeted Prettier, and `git diff --check`: PASS.
- New PostgreSQL regression in
  `frontend-ask-uploaded-source-resolution.database.test.ts` checks known stale
  requeue with a still-pending newer SourceVersion, a fresh repository observing
  QUEUED, preserved failed attempt digest and no statements, and idempotent
  duplicate failure acknowledgement. **1/1 PASS** against the parent's new
  isolated PostgreSQL container via the guarded DockerSocket transport.
- Older fake13 `automaticAvailability=false` is retained unchanged: its helper
  treated the first FAILED read as final, so it was not proof of the new worker's
  eventual state. Parent actual-application acceptance must require eventual
  same-run success, latest citations, old failed attempt history and no premature
  no-supported-answer while source work remains pending.

Initial frontend test startup failed because app-local dependencies were absent;
this was resolved with the parent's existing dependency junction and Vite runner
config loader, without dependency version or test assertion changes. A relative
config-path invocation also failed before tests and was corrected. The first
PostgreSQL suite setup returned ECONNREFUSED because Vitest forks omitted the
preloader; the documented `--execArgv=--require=<guarded pg-bridge.cjs>` option
propagated the parent-approved isolated transport and the suite then passed.
These are test setup failures, not product regressions.

No real provider, operating application, operating database, production
authority, protected worktree, frozen evaluation or stash was touched by this
subtask. Installed launcher/reboot and real AI billing/semantic acceptance remain
separate from these fake/isolated proofs.
