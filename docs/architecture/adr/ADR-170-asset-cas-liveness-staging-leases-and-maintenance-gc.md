# ADR-170 — Asset CAS Liveness, Staging Leases, and Maintenance GC

Status: Accepted for TS-5 Phase B correction (2026-09-19)

## Context

Shotgun's final Original Asset rows and pre-submit Sources staging receipts use
the same content-addressed storage namespace. A valid 30-day staging receipt can
therefore protect a physical CAS blob before a final `asset.original_assets`
row exists, and the client-held receipt is not itself a durable server-side GC
root. File mtime cannot represent that liveness because an identical put may
reuse an existing blob without refreshing its mtime.

## Decision

1. `asset.original_assets.storage_key` is a conservative hard physical root.
   A missing or inconsistent SourceVersion graph is reported as
   `DB_ORPHAN_ROW`; its CAS bytes remain protected for manual review.
2. Migration 077 adds the narrow `asset.staging_asset_leases` maintenance
   authority. It records the sealed reference digest, input kind, storage key,
   content hash, size, issue time, and exact 720-hour expiry. It is physical
   CAS liveness authority only, never Sources Product, Canonical, Evidence, or
   Review truth.
3. Staging persists the lease after `put()` and before returning a receipt. A
   persistence failure returns no usable receipt and never rollback-deletes the
   bytes; an unreferenced blob is handled by the normal conservative GC path.
   Production receipt issuance and `resolve()` use one `StagingTimeAuthorityPort`
   backed by PostgreSQL `clock_timestamp()`; the sealed token and durable lease
   therefore share the same authoritative expiry boundary. Deterministic clocks
   are permitted only in test composition, and an unavailable production time
   authority fails closed.
4. One PostgreSQL advisory-lock identity is shared by the runtime, staging
   writes, backup, restore, and GC. The runtime holds `SHARED` for its lifetime;
   backup holds `SHARED`; GC quarantine/sweep and restore require fail-fast
   `EXCLUSIVE` acquisition.
5. GC is an explicit dry-run-by-default maintenance tool. It uses PostgreSQL
   time for lease expiry, lease cleanup, and the legacy 30-day cutover. Process
   time is limited to operator reporting and filesystem-age filters.
6. `PROTECTED_CAS` is the union of final DB roots, active DB-time staging lease
   roots, and maintenance/backup roots. Only verified canonical blobs outside
   that set can enter first-grace quarantine.
7. Quarantine is an atomic same-filesystem rename beneath the asset root. Each
   item records its canonical identity and explicit `quarantinedAt`. A second
   positive safety period is required before final deletion. Manifest-less runs
   are reconstructed conservatively after a crash and restart their safety
   period.
8. Corrupt, temporary, unknown, malformed, symlink/reparse, path-escape,
   collision, and database-anomaly cases are report-only/fail-closed. A newly
   protected blob is restored when its canonical path is absent; an existing
   canonical duplicate is retained for manual review.
9. Destructive apply is explicitly bounded by a positive operator-supplied
   `maxCandidates` batch. Candidates retain deterministic storage-key ordering;
   dry-run may report the complete set, while apply mutates only the selected
   prefix under the exclusive maintenance barrier.

## Rejected alternatives

- mtime-only plus grace: rejected because identical CAS reuse does not refresh
  mtime and can misclassify a live staging receipt.
- separate staging namespace: rejected for this bounded correction because it
  adds promotion I/O, a crash window, backup complexity, and dedupe divergence.
- client-token inspection by GC: rejected because GC must not decrypt or possess
  arbitrary client-held staging tokens.
- always-on GC or deletion in `AssetStoragePort`: rejected because Product
  writes remain put/read-only and maintenance mutation must be explicit.
- reference counting or SourceVersion deletion: rejected as unrelated authority
  changes.

## Migration, backup, and rollback

Migration 077 is additive and runner-transaction-owned; it has no local
`BEGIN`/`COMMIT` and no destructive rollback migration. When 077 is applied,
backup integrity includes the lease table and asset enumeration includes
unexpired staging-only bytes, deduplicated by storage key with hash/size
agreement required. Older manifests preserve their pre-077 behavior.

Rollback is a code revert before publication. Destructive GC remains disabled
until the migration's applied time plus 30 days has elapsed, including after a
rollback to a pre-lease runtime.

## Verification boundary

The C1/C2 review must pass the focused unit and mutation/recovery tests, the real
PostgreSQL apply-path and lock-graph tests against the dedicated `shotgun_test`
database, staging lease and backup/restore tests, typecheck, lint, formatting,
architecture and documentation validation before any commit, push, PR, or TS-6
request.

## References

- Issue #354 — TS-5 CAS lifecycle Phase A/A.1 and Phase B C1 correction
- ADR-169 — Authority-Critical PostgreSQL Commit-Ambiguity Reconciliation
- `db/migrations/077_ts5_asset_cas_lifecycle.sql`
