# VP reliability and product acceptance audit

Date: 2026-10-12. Baseline: `aba6ff27f9620ee1a3f408f8df81e8aad21cc584`.

## Evidence classification

Historical reports describe narrow tests, not full VP completion. PRs 381, 382,
and 383 passed their exact-head and post-merge gates; their scopes respectively
cover execution authority, historical AnswerRun freshness, and evaluation
governance. None certifies live AI semantic accuracy or installed release
acceptance. The actual application/Fake Provider acceptance at
`C:/dev/artifacts/vp05-answer-freshness-2026-10-11/app-release/checks.json`
contains 13 passing checks, including latest citations, historical freshness,
project isolation, known failure, insufficient evidence, and same-run queued
processing. Fake responses test plumbing and fail-closed behavior only.

## Gap matrix

| Gate                   | Implemented and reusable evidence                                                                                                             | Actual remaining gap                                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VP-03 product flow     | Source intake, A/B and revision handling, Ask source-grounded citations; fake13 actual app/PG path                                            | Installed empty-space journey and minimum authorized real-provider acceptance; queued/refresh UI and automatic recovery need stronger assertions          |
| VP-06 execution        | Bounded attempts, ACK readback, output-stored recovery, terminal UNKNOWN, duplicate fences, replay; PostgreSQL relation and P0 runtime suites | Known stale Ask failure is committed before automatic retry; interruption can leave manual-only FAILED; billing comparison is external evidence           |
| VP-07 operations       | Parent/child IPC supervisor, transient backoff, PostgreSQL proxy outage and disposable server restart; owner verified backup/clean restore    | Installed parent termination/Windows reboot and deployment cutover/rollback remain unproved; child supervision does not auto-start a dead parent          |
| VP-09 security/product | Project/sensitivity/citation authorization, egress policy, hidden review route; fake13 cross-project and authority read failure               | Pending source work appears QUEUED without explicit automatic waiting explanation; recovery/unknown presentation and end-to-end leakage assertions remain |
| VP-11 release          | Canonical-main launcher identity, clean tracked worktree, exact SHA, proven process ownership, nonce reservation                              | Development branch is intentionally rejected by installed canonical launcher; safe isolated tests are not final main installation acceptance              |

## First correction

`modules/frontend-ask-execution/src/index.ts` already retries a known
`complete-vp-snapshot` error up to three attempts. The older fake13 helper stops
at the first FAILED read, so `automaticAvailability=false` does not by itself
prove eventual retry failure. Do not introduce another retry loop.

The code does reveal a durable boundary gap: `repository.fail()` commits FAILED
before `retryAndClaim()`. A process interruption or context lookup failure leaves
FAILED outside the QUEUED worker scan. The retry also bypasses the normal queue's
`isProjectKnowledgePending()` check. Reuse the existing failure transaction and
queue to atomically preserve the failed attempt and requeue only the known stale
publication outcome, bounded by the existing attempt limit. UNKNOWN must never
enter this path. Resolve fresh authorized context when normal pending work has
settled; never republish a stale provider response.

## Reused OSS decisions

- Node `child_process.fork` and IPC: existing `NO_RELEVANT_OSS` decision for a new
  dependency; the built-in platform API needs no daemon or package. Existing
  source registry and ADR-167 record the reviewed runtime.
- PostgreSQL `pg_dump`/`pg_restore`: existing ADOPT behind Shotgun
  `shotgun-backup-v1`, image digest
  `sha256:ccc6e83d6e35e931dc7c5def2022729d5a6c370318d099181995567ff1fb4d6b`.
- gbrain `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT:
  REFERENCE_ONLY job/lease/idempotency patterns. Its runtime and schema cannot
  own AnswerRun, SourceVersion, Evidence or execution authority.
- PM2 `cd6b1b4c592117212d7349d6932288613f336c15`, AGPL-3.0: existing
  REJECT; a second process authority is unnecessary.
- pgBackRest, WAL-G and Barman: existing DEFER pending PITR/remote DR requirements.

No new OSS dependency, generic supervisor or reviewer authority is justified.

## Isolated verification targets

Parent coordinates disposable PostgreSQL and synthetic provider infrastructure.
Use explicit test-only environment and never load operating `.env` files.

- `tests/unit/frontend-ask-execution.test.ts`: known stale queue/restart,
  bounded exhaustion, UNKNOWN exclusion, retained failed attempt/event.
- `tests/database/vp-relation-priority.database.test.ts`: existing ACK,
  stored-output, killed worker, retry-cap and clean restore cases.
- `tests/database/vp05-p0-runtime.database.test.ts`: actual app execution authority.
- `tests/integration/vp-runtime-database-recovery.live.test.ts`: test-only TCP
  proxy interruption, not operating PostgreSQL interruption.
- `tests/integration/vp-runtime-postgres-server-restart.live.test.ts` with
  `VP_RUNTIME_POSTGRES_CONTAINER_RESTART=1`: creates its own uniquely named
  disposable container; never supply an operating container name.
- `tests/integration/launch-canonical.test.ts` and
  `tests/integration/launch-supervisor-process.test.ts`: temporary Git origin and
  fixture child only, not operating launcher.

Windows reboot and installed production rollout cannot be simulated as complete
by these tests. Record separate release acceptance evidence and authorization.
