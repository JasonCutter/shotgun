# TS-5 Phase B C1 Correction Report

## Review disposition addressed

This report addresses the official independent review disposition
`TS-5 Phase B = CHANGES_REQUIRED / DO NOT COMMIT`. It records only the
approved C1 corrections. The worktree remains uncommitted; no push, PR, or
TS-6 work was started.

- Canonical base: `96099de87afff8a99b465028525535ba90425c59`
- Working branch: `codex/ts5-phase-b-cas-lifecycle`
- Working HEAD: `96099de87afff8a99b465028525535ba90425c59`
- Working tree: intentionally contains the uncommitted Phase B/C1 patch

## C1 implementation corrections

- PostgreSQL blocking advisory-lock calls now treat query resolution as
  success; only `pg_try_advisory_lock[_shared]` reads a boolean result.
- Runtime startup acquires the single authoritative shared lock with a
  fail-fast try-lock and closes its client on startup failure. Backup uses a
  bounded shared try-lock; restore and GC use bounded exclusive try-locks.
- Production application wiring no longer passes the redundant per-staging
  advisory barrier. The runtime-wide shared lock is authoritative; the
  staging repository remains the durable lease persistence adapter.
- Lease expiry, lease pruning, and the legacy 30-day cutover use PostgreSQL
  `clock_timestamp()`. Process time remains limited to filesystem-age and
  operator-reporting behavior.
- Migration 077 is runner-transaction-owned: local `BEGIN`/`COMMIT` were
  removed. The lease contract uses `input_kind` and exact `interval '720
hours'` expiry.
- CAS quarantine keys, run identifiers, manifest identity, derived quarantine
  paths, path containment, reparse boundaries, symlink handling, and content
  hashes are validated before any read, rename, or delete.
- Manifest-less quarantine runs are scanned under the same canonical rules,
  reconstructed with explicit `recovered` and `quarantinedAt` fields, and
  receive a full new second safety period. Malformed/future timestamps fail
  closed.
- GC now reports database anomalies where an `original_assets` row lacks a
  SourceVersion graph while retaining every original-asset row as a physical
  protection root; no database repair is attempted.
- ADR-170 was added and the ADR README/registry were updated. It explicitly
  defines the lease table as a CAS-liveness authority, not Product or
  Canonical truth.
- Backup asset enumeration includes active staging-only bytes, deduplicates
  final/staging authority by storage key with hash/size agreement, fails closed
  on disagreement, and restores verified bytes beneath a contained root.

## OSS and architecture gate

No new dependency was adopted, extracted, or augmented. Existing `pg`, Node
filesystem primitives, and the established backup/restore infrastructure are
reused behind Shotgun ports and adapters. The reviewed reference candidates
remain `REFERENCE_ONLY`: `garrytan/gbrain`, `lucasastorian/llmwiki`,
`ddsyasas/llm-wiki`, Inkeep OpenKnowledge, restic, OCI Distribution,
containerd, Nix, and Git LFS. They do not own Shotgun Source, Evidence,
Approval, Canonical, or CAS-liveness authority. No lockfile change was made.

## Verification executed

All database verification below used only the dedicated PostgreSQL test target
`postgres://shotgun:shotgun@localhost:5433/shotgun_test`; the owner database was
not used. `npm run db:test:reset` had already applied the migration set, and
`npm run db:test:verify` passed.

Focused tests passed:

```text
5 files, 25 tests passed
  tests/unit/ts5-asset-cas-gc.test.ts
  tests/unit/ts5-staging-lease.test.ts
  tests/unit/backup-restore.test.ts
  tests/database/ts5-asset-cas-lifecycle.database.test.ts
  tests/database/ts5-backup-restore.database.test.ts
```

The tests cover canonical-path and malicious-manifest rejection, symlink/path
containment, explicit `quarantinedAt`, manifest-less recovery and the second
safety period, staging resurrection, duplicate retention, input-kind and exact
lease constraints, active DB-time protection under process clock skew,
database anomaly reporting, staging-only backup enumeration, deduplication,
conflict failure, restored bytes, and the shared/exclusive lock graph.

Additional focused verification passed:

- `npx tsc --noEmit`
- focused ESLint for all changed implementation and test files
- Prettier check for all changed TypeScript, JSON, Markdown, and package files
- `git diff --check`
- `npm run test:architecture`
- `npm run docs:adr-index`
- `npm run docs:validate`
- startup/readiness contract set: 51 tests passed across
  `local-launch-serving`, `launch-core-contract`, and `launch-canonical`

The full `pg_dump`/`pg_restore` owner backup command was not invoked because
the host has no local `pg_dump`/`pg_restore` binaries and the existing compose
service targets the owner DB rather than the dedicated 5433 test container.
The focused database/temp-root backup and restore helper tests were run; no
owner data was modified.

## Migration, rollback, and limits

Migration 077 is additive and has no destructive rollback migration. A code
revert before publication leaves destructive GC disabled until the migration
cutover gate is satisfied. GC remains explicit and dry-run by default. The
known verification limit is the unavailable full dump/restore tool gate noted
above; it is not represented as a commit or completion claim.

Protected owner artifacts and proof preservation:

- four protected user verification documents;
- `.data/launcher/runtime.stale-pid-reuse-20260918-095459.json`.

The four user verification documents and the stale launcher PID artifact remain
outside the patch and review bundle. The Phase A/A.5 repository proof files
were preserved unchanged and are included in the review bundle as supporting
evidence. The final review ZIP path and SHA-256 are reported with the handoff
message so the archive hash does not self-reference its own contents.
