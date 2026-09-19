# TS-5 Phase B C2 Correction Report

Date: 2026-09-19
Issue: #354
Parent: #344
Canonical base/head: `96099de87afff8a99b465028525535ba90425c59`
Branch: `codex/ts5-phase-b-cas-lifecycle`
Worktree: `C:\dev\shotgun-ts5-phase-b-cas-lifecycle`

## Formal boundary

This report covers only the four C2 safety closures requested by the Make
Shotgun GPT review:

- production quarantine run-id generation and validation;
- real dedicated-PostgreSQL GC apply-path and bounded-batch proof;
- one authoritative staging clock for token issuance, resolve, and lease liveness;
- canonical and quarantine reparse/symlink fail-closed handling.

No commit, push, PR, TS-6 work, owner-database reset, owner-asset mutation, or
full `npm run check` was performed.

## C2 correction result

### C2.1 — Run-id generator

`scripts/asset-cas-gc.ts` now exports one `createQuarantineRunId()` generator
and one matching validator. The format is the fixed-width UTC form
`YYYYMMDDHHMMSSmmm-<UUIDv4>`. The generator validates its own output before
returning it, and the unit proof uses the production generator rather than a
hand-authored run id.

### C2.2 / C2.6 — Real apply path and bounded mutation

`--apply` now requires an explicit positive integer `--max-candidates`. The
candidate list remains deterministic by storage key; only the selected prefix
is mutated under the exclusive maintenance lock. Reports expose the total
eligible count, selected batch count, and configured limit.

The dedicated PostgreSQL test created two old, unreferenced canonical blobs in
an isolated temporary root, opened the migration-077 cutover gate in the
dedicated `shotgun_test` database, and executed the real
`runAssetCasGc({ apply: true, ... })` path twice with `maxCandidates: 1`.
The first invocation moved exactly the first deterministic storage key and the
second invocation moved the remaining key. Each generated run id passed the
production validator; each manifest matched the moved hash, size, and bytes;
canonical paths disappeared; quarantine paths remained under the configured
root; and the quarantine-age gate prevented same-run deletion.

The test restored the migration registry timestamp in `finally`. No owner DB or
owner asset root was used.

### C2.3 — Staging and lease time authority

`StagingTimeAuthorityPort` was added to the staging module. The PostgreSQL
staging lease repository implements it with `SELECT clock_timestamp()`.
Production application wiring passes the same repository as both durable lease
persistence and staging time authority.

Both `stageBytes()` and `stageUrl()` now obtain the authoritative time after
the CAS put, derive the exact 720-hour expiry, persist the same timestamps in
the lease, and only then return the receipt. `resolve()` uses the same
authority; an unavailable authority fails closed. Test-only compositions retain
deterministic injected clocks.

The focused proof covered an artificially advanced process clock, an
artificially behind process clock, the exact expiry boundary, and URL staging.
The existing PostgreSQL GC proof separately confirms that active staging roots
use database time rather than the process clock.

### C2.4 / C2.5 — Reparse and symlink safety

Before any canonical read, restore, overwrite, or deletion decision, sweep now
proves canonical storage-key containment and checks every ancestor and existing
target with `lstat`-based reparse/symlink validation. The pre-rename candidate
path is revalidated for identity, regular-file status, hash, and size while the
exclusive lock is held.

Focused temporary-root proofs cover both a canonical collision symlink pointing
outside the asset root and a quarantine-side symlink. Both remain report-only:
the outside bytes and quarantine bytes are unchanged and no outside target is
read or mutated. Platform link-creation permission failures are treated as an
explicit platform skip; the current Windows test environment executed both
supported symlink cases.

## Verification

Dedicated database target: `shotgun_test` on local PostgreSQL port `5433`.
The owner `shotgun` database was not used. Credentials were supplied only via
the process environment and were not written to artifacts.

- Phase A/A.1 proofs, LocalAssetStorage, frontend staging, staging lease, GC,
  and backup/restore focused unit suite: **7 files / 33 tests PASS**.
- Dedicated PostgreSQL TS-5 migration, lock, DB-time, anomaly, backup/restore,
  real GC apply, generated run-id, and bounded-batch suite: **2 files / 8 tests
  PASS**.
- Startup/readiness affected integration suite: **3 files / 51 tests PASS**.
- `npm run db:test:verify`: **PASS**.
- `npx tsc --noEmit`: **PASS**.
- Focused ESLint: **PASS**.
- Prettier checks: **PASS**.
- `git diff --check`: **PASS**.
- `npm run test:architecture`: **PASS**.
- `npm run docs:adr-index`: **PASS**.
- `npm run docs:validate`: **PASS**.
- Full `npm run check`: **NOT RUN**, as required by the official review scope.

The host-level `pg_dump`/`pg_restore` executable drill remains unavailable and
was not reopened as a C2 blocker. The backup authority logic remains covered
by dedicated PostgreSQL and isolated-root enumeration/deduplication/conflict/
restore-helper tests from C1.

## OSS and dependency gate

No new OSS was adopted, extracted, augmented, or added. No dependency or
lockfile changed. Existing Node filesystem primitives, `pg`, and the current
backup/restore boundary remain the implementation boundary. External restic,
OCI, containerd, Nix, and Git LFS remain `REFERENCE_ONLY`.

## Changed files

In addition to the C1 Phase B files already listed in the C1 report, C2 changed:

- `scripts/asset-cas-gc.ts`
- `modules/frontend-sources-staging/src/index.ts`
- `adapters/frontend-sources-staging-postgres/src/index.ts`
- `adapters/frontend-sources-staging-sealed/src/index.ts`
- `assemblies/shotgun-app/src/application.ts`
- `tests/unit/ts5-asset-cas-gc.test.ts`
- `tests/unit/ts5-staging-lease.test.ts`
- `tests/database/ts5-asset-cas-lifecycle.database.test.ts`
- `docs/architecture/adr/ADR-170-asset-cas-liveness-staging-leases-and-maintenance-gc.md`

## Rollback and protected artifacts

Rollback is a code revert before publication. No destructive rollback migration
was introduced. The legacy 30-day cutover gate remains authoritative after a
revert to a pre-lease runtime.

The four protected user verification documents, existing Phase A/A.5 proof
files, and `.data/launcher/runtime.stale-pid-reuse-20260918-095459.json` remain
preserved locally and are excluded from the review bundle. `.env`, `.env.test`,
credentials, secrets, `node_modules`, owner asset bytes, and actual backups are
also excluded.

## Stop point

C2 implementation and focused verification are complete and ready for the
next independent review. The current working tree is intentionally uncommitted.
Stop before commit, push, PR, TS-6, or any additional implementation until the
Make Shotgun GPT issues the next formal review result.
