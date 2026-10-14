# TS5 maintenance backend exit — post-merge CI correction

## Failure and scope

PR387 merged the accepted head into main `6dbc8af26297d29f3b900580e3a91fb028365426` with exactly the accepted tree. Its [post-merge CI38564365458](https://github.com/JasonCutter/shotgun/actions/runs/38564365458) failed: PostgreSQL745 PASS/1 FAIL/2 SKIP, Quality/Required Gates FAILURE, Frontend SUCCESS. The failure is preserved and is not replaced by the preceding [PR CI38561147594](https://github.com/JasonCutter/shotgun/actions/runs/38561147594) success.

The unchanged existing [TS5 test](../../../tests/database/ts5-asset-cas-lifecycle.database.test.ts) called `runtime.release(true)` then immediately expected `acquireMaintenanceLock(gc, 'exclusive', true)` to be `true`; actual result was `false` at old line157. This was an assertion mismatch, not a timeout. The user requested correction after the failure report. This follow-up is a test observation correction under [ADR-170](../../architecture/adr/ADR-170-asset-cas-liveness-staging-leases-and-maintenance-gc.md), not a production lock-policy change.

## Root cause and independently observed behavior

The pinned `pg-pool` destruction path invokes asynchronous `client.end(callback)` and returns without a PostgreSQL backend-exit acknowledgement. The [official pool API](https://node-postgres.com/apis/pool#releasing-clients) declares `release(destroy)` returns void. PostgreSQL session-level advisory locks are released on explicit unlock or session end, per its [PostgreSQL16 contract](https://www.postgresql.org/docs/16/explicit-locking.html#ADVISORY-LOCKS). A local pool release return is therefore insufficient proof that the server has released the lock.

An external diagnostic against the owned isolated PostgreSQL placed a controlled barrier before the real `pg.end` operation. Actual lock adapter and server SQL stayed unchanged:

| Point                                                   | Original backend present | Advisory locks on that PID | Exclusive try-lock |
| ------------------------------------------------------- | ------------------------ | -------------------------- | ------------------ |
| Shared acquired                                         | true                     | 1                          | unavailable        |
| `release(true)` returned; real disconnect still pending | true                     | 1                          | false              |
| Actual backend exit observed                            | false                    | 0                          | true               |

This reproduces the invalid ordering assumption with real PostgreSQL. It does not reconstruct the original CI backend's unrecorded PID/packet timeline. The diagnostic’s artificial disconnect barrier is disclosed; it is not a production adapter or a new crash-recovery authority. Its isolated database was dropped, live provider calls0.

Production inspection found the actual application shutdown already awaits explicit shared unlock and client end; GC keeps its existing fail-fast exclusive barrier. Neither path, the lock adapter, migration077, nor any runtime/configuration/budget/semantic policy byte changes here.

## Minimum correction and safety checks

- Capture the exact runtime backend PID while its shared lock is held.
- After the same one `release(true)`, observe from the existing independent checked-out GC session until that PID is absent from both `pg_stat_activity` and advisory `pg_locks`.
- Keep the original single exclusive try-lock success assertion and every preceding shared/exclusive mutual-exclusion assertion. The helper does not acquire/unlock locks or retry the assertion under test.
- The observation bound is5s, matching the existing C4 bounded availability observation; the repository's60s PostgreSQL test/hook gates are unchanged. The10ms pause only paces state reads; elapsed sleep is never accepted as proof of teardown.
- Query errors propagate immediately; malformed/missing observations and timeout fail. No uncertain response becomes an absent backend.
- A new real-PG negative case holds the shared-lock session live, requires the observer to fail, and verifies exclusive acquisition remains denied. Cleanup protects the first client even if the second checkout fails; explicit unlock is attempted only after confirmed acquisition and the runtime client is destroyed.

## Verification and retained preparation failures

| Local verification                                                    | Result                                           |
| --------------------------------------------------------------------- | ------------------------------------------------ |
| Corrected lock graph and CAS lifecycle file                           | 8/8 PASS (original7 plus live-backend negative1) |
| Runtime maintenance session loss/shutdown with actual child processes | 3/3 PASS                                         |
| Staging/backup/restore byte authority                                 | 2/2 PASS                                         |
| Related CAS/staging/runtime/frontend staging unit tests               | 32/32 PASS                                       |
| AssetStorage adapter contract                                         | 6/6 PASS                                         |
| Root typecheck, full lint, standard full format, architecture         | PASS; lint retains existing2 warnings            |

The diagnostic's first external `.ts` launch failed transformation before SQL because the artifact directory is CommonJS. Its `.mts` launch with the same SQL/lock logic passed; the first source/log is retained. The first combined runtime/backup run had C4 3 PASS but the backup setup was blocked by the external bridge's test-only namespace allowlist; its two setup-blocked cases were not PASS. The external bridge now permits the helper's exact `shotgun_restore_<digits>_<12hex>` format on the same pinned owned container/volume/network/port and explicit roles. Backup then passed2/2. Database cleanup uses the helper-returned owned names. No production guard, role, assertion, skip or timeout was changed to recover these results.

A cleanup-only amendment to the new negative case is separately checked. New exact-head CI must independently run all gates; local scoped results are not substituted for that run. No rerun of the failed main CI was used to erase its outcome. Merge remains separately approved; production activation remains held.

## Reuse, rollback, and residual boundary

Reuse the existing PostgreSQL maintenance adapter/ADR-170 lock identity, `node-postgres` and Node timers. `pg8.22.0` and `pg-pool3.14.0` are existing MIT dependencies with exact lockfile integrity pins; no dependency upgrade or upstream code fork is introduced. Official API/source inspection is REFERENCE_ONLY. Existing C4 bounded-observation tests supply the test pattern; no new operation framework, runtime authority, reviewer service or OSS Role Matrix adoption is needed. The general product helper would import the full AI/application fixture into this low-level lock test, so the narrow observer stays file-local and fails query errors directly.

Rollback removes this test/report amendment. Production DB, data, policy and migration rollback is unnecessary because those bytes are unchanged. Protected worktrees/stash/configuration and frozen72/432/B12/B24/Gold-B-7 evidence remain preserved. No live AI, operating app/worker start or operating configuration change is performed. Whole VP final acceptance is still incomplete; this correction closes only a CI observation defect.

Raw records reside under `C:\dev\artifacts\vp-full-completion-2026-10-12`: `ts5-release-order-reproduction.mts/json`, initial and run2 diagnostic logs, `ts5-corrected-database.log`, `ts5-runtime-backup-database.log`, `ts5-backup-database-correct-target.log`, `ts5-negative-cleanup-regression.log`, unit/contract/typecheck/lint/format/architecture logs, pinned bridge/runner sources and follow-up publication/CI evidence. Artifact hashes and final exact-head CI are recorded separately after publication; no certification Gold or new semantic metric is generated.
