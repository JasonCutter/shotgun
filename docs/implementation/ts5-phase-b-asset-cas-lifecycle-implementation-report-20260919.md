# TS-5 Phase B — Asset CAS Lifecycle & Garbage Collection

> The C1 correction results supersede the verification snapshot in this
> initial implementation report. See
> `ts5-phase-b-asset-cas-lifecycle-c1-correction-report-20260919.md` for the
> current official-review response and exact results.

## Status

This is an uncommitted implementation review branch based on canonical main
`96099de87afff8a99b465028525535ba90425c59`.

- Branch: `codex/ts5-phase-b-cas-lifecycle`
- Commit/push/PR: not performed
- TS-6: not started
- Product source and additive migration changes are limited to the approved
  TS-5 Phase B boundary.

## Scope and exclusions

Implemented:

- Migration `077_ts5_asset_cas_lifecycle.sql` with durable `asset.staging_asset_leases`.
- A 30-day staging lease written before a staging receipt is returned.
- One PostgreSQL advisory maintenance barrier shared by runtime, backup/restore,
  and the explicit GC tool.
- `scripts/asset-cas-gc.ts`, with default dry-run, deterministic canonical
  scanning, DB/staging protection, cutover/grace gates, atomic quarantine, audit
  manifest, crash-resumable quarantine identity, and conservative final sweep.
- Migration-aware backup/restore asset enumeration and integrity verification.
- Focused unit and PostgreSQL proof tests.

Explicitly excluded:

- reference counting;
- SourceVersion or Canonical deletion;
- failed-write rollback deletion;
- corrupt/temp/unknown/symlink automatic deletion;
- always-on GC loop;
- remote/object-storage redesign;
- TS-6, commit, push, and PR.

## ADR-170 summary

TS-5 uses a separate maintenance boundary. Product storage continues to own
immutable content-addressed writes and reads; it does not gain delete, list,
quarantine, or GC state. The database is the authority for final asset roots and
durable staging leases. A runtime-wide PostgreSQL advisory shared/exclusive
barrier prevents GC quarantine/sweep from racing with runtime, staging, backup,
or restore. GC is explicit and dry-run by default. It may quarantine only a
verified `CAS_UNREFERENCED` canonical blob after migration 077, the 30-day
legacy cutover, an explicit positive first grace, and exclusive maintenance.
Final deletion requires a separate explicit positive quarantine age and a fresh
exclusive lock. Any authority/integrity anomaly is report-only or fail-closed.

## Migration 077

`asset.staging_asset_leases` records the sealed reference digest, project/draft/
item/principal context, CAS key, content hash/size, and issued/expiry times.
The database constraint makes expiry exactly `issued_at + 30 days`. Active rows
(`expires_at > DB_NOW`) are physical roots. The table is additive and is included
in backup integrity and asset enumeration only when migration 077 is present;
old backup manifests retain the legacy `asset.original_assets` behavior.

## Runtime and maintenance barrier

The desktop/runtime composition holds the shared advisory lock for its lifetime.
Staging receipt creation runs under the shared barrier and persists a durable lease
before returning a usable receipt. Backup holds shared maintenance for its full
dump/asset-copy/manifest consistency sequence. Restore holds exclusive
maintenance for the target database. GC uses a non-blocking exclusive attempt so
dry-run reports availability and apply mode fails closed if another runtime,
backup, or restore owns the barrier.

## GC safety model

`PROTECTED_CAS = FINAL_DB_ROOTS ∪ ACTIVE_STAGING_ROOTS ∪ MAINTENANCE/BACKUP_ROOTS`
with the maintenance barrier providing the cross-process exclusion. Every
canonical candidate is checked for exact canonical path, content hash, size, and
non-symlink traversal. Final `asset.original_assets` rows are conservative hard
roots even when their source graph is inconsistent. Corrupt, temporary, unknown,
malformed, and symlink/reparse entries never become automatic delete candidates.

Quarantine uses same-filesystem atomic rename under `.gc/quarantine/<run-id>/`
and writes a manifest containing the original storage key, preserving recovery
identity if the process stops after rename. Sweep rechecks DB/staging roots and
the canonical path. A newly protected item is restored when the canonical path
is absent; a protected canonical duplicate or a new unprotected canonical
collision is report-only.

## OSS/reuse gate

No new dependency was adopted, extracted, or augmented. Existing Node filesystem
primitives, `pg`, and the established backup/restore infrastructure are reused.
restic, OCI Distribution, containerd, Nix, Git LFS, and containers/image remain
`REFERENCE_ONLY`; none owns Shotgun Canonical, Evidence, Approval, or staging
authority. No lockfile change is expected.

## Verification

The focused local suite passed:

```text
7 test files, 24 tests passed
  tests/unit/backup-restore.test.ts
  tests/unit/frontend-sources-staging.test.ts
  tests/unit/ts5-staging-lease.test.ts
  tests/unit/ts5-asset-cas-gc.test.ts
  tests/unit/local-asset-storage.test.ts
  tests/proofs/ts5-phase-a-cas-lifecycle-red-proof.test.ts
  tests/proofs/ts5-phase-a1-staging-liveness-red-proof.test.ts
```

`npx tsc --noEmit` passed using the workspace dependency runtime.

The real PostgreSQL migration/lock proof was added at
`tests/database/ts5-asset-cas-lifecycle.database.test.ts` and was executed
against the dedicated `shotgun_test` target on localhost:5433. The C1 focused
database and backup/restore helper suite passed; the full pg_dump/pg_restore
tool gate remains unavailable on this host.

Focused ESLint passed, Prettier passed for every touched TS/JSON/Markdown file,
`git diff --check` passed, and the architecture boundary test passed. SQL is
reviewed as migration input; the repository Prettier configuration has no SQL
parser. The real PostgreSQL migration, maintenance-barrier, backup/restore, and
migration-077 proof remains the required external verification gate.

The owner worktree protected artifacts were checked and remain unchanged:

- four protected verification documents;
- Phase A/A.5 proof files;
- `.data/launcher/runtime.stale-pid-reuse-20260918-095459.json`.

No protected artifact is included in the review bundle.
