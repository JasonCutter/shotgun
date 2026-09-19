# TS-5 Phase B C3 Correction Report

Date: 2026-09-19
Issue: #354
Parent: #344
Canonical base/head: `96099de87afff8a99b465028525535ba90425c59`
Branch: `codex/ts5-phase-b-cas-lifecycle`
Worktree: `C:\dev\shotgun-ts5-phase-b-cas-lifecycle`

## Formal boundary

This report covers only the C3 identity-integrity closure requested by the
Make Shotgun GPT independent C2 review. It does not redesign TS-5, migration
077, the maintenance lock, backup/restore, or the staging architecture. No
commit, push, PR, TS-6 work, owner-database reset, owner-asset mutation, or
full `npm run check` was performed.

## C3 correction result

### C3.1 — One storage-key identity helper

`scripts/asset-cas-gc.ts` now exports `expectedContentHash(storageKey)`. It
accepts only the already validated canonical storage-key form and derives the
single expected identity `sha256:<64 lowercase hex>` from the filename. The
production path and manifestless recovery path use this helper; the hash
format is not duplicated in a second storage-key parser.

### C3.2 — Manifest identity validation

`readQuarantineManifest()` now requires a canonical storage key, its derived
quarantine path, a syntactically valid positive integer `sizeBytes`, and a
`contentHash` equal to `expectedContentHash(storageKey)`. A manifest whose
content hash disagrees with its storage-key identity is reported and rejected;
it is never silently repaired.

### C3.3 — Quarantine bytes validation

Before any sweep restore or delete decision, quarantine bytes must satisfy all
three identities: `digest(bytes) === manifest.contentHash`,
`manifest.contentHash === expectedContentHash(storageKey)`, and
`bytes.length === sizeBytes`. Any disagreement remains report-only and leaves
the quarantine item untouched.

### C3.4 — Protection-root authority agreement

Final and active-staging protection-root metadata now carry `contentHash` and
`sizeBytes`. Before restoration, every applicable root must agree with the
quarantine identity, and final and staging metadata must agree with each
other. A final mismatch, staging mismatch, or final/staging disagreement is
reported and fails closed: no restore, delete, or database repair is done and
the quarantine bytes remain in place.

## C3 proof coverage

The updated GC unit/proof suite includes four focused fail-closed cases:

1. storage key hash A, manifest content hash B, quarantine bytes digest B, and
   no protection root;
2. final protection-root metadata disagrees with the quarantine identity;
3. active staging metadata disagrees with the quarantine identity;
4. final and staging protection roots disagree with each other.

Each proof asserts sweep count zero, unchanged quarantine bytes, and absent
canonical storage. The existing C2 run-id, bounded-candidate, database-time,
canonical/quarantine reparse, pre-rename identity, and dedicated-PostgreSQL
apply-path proofs remain preserved.

## Verification

Dedicated database target: `shotgun_test` on local PostgreSQL port `5433`.
The owner `shotgun` database and owner asset root were not used.

- Existing TS-5 focused unit/proof suite: **7 files / 37 tests PASS**.
- Dedicated TS-5 PostgreSQL suite: **2 files / 8 tests PASS**.
- `npm run db:test:verify`: **PASS**.
- `npx tsc --noEmit`: **PASS**.
- `npm run lint -- --quiet`: **PASS**.
- Prettier check: **PASS**.
- `git diff --check`: **PASS**.
- Prior C2 startup/readiness, architecture, ADR-index, and docs-validation
  results remain preserved in the C2 review bundle; no C3 migration or ADR
  change was made.
- Full `npm run check`: **NOT RUN**, outside the official C3 scope.

The host-level `pg_dump`/`pg_restore` executable limitation remains
non-blocking and unchanged from C2.

## OSS and dependency gate

No new OSS was adopted, extracted, augmented, or added. No dependency or
lockfile changed. Existing Node filesystem primitives, `pg`, and the current
backup/restore boundary remain the implementation boundary. External restic,
OCI, containerd, Nix, and Git LFS remain `REFERENCE_ONLY` as recorded in the
C2 report.

## Rollback and protected artifacts

Rollback is a code revert before publication. No destructive rollback
migration was introduced and no database repair path was added. The four
protected user verification documents, existing Phase A/A.5 proof files, and
`.data/launcher/runtime.stale-pid-reuse-20260918-095459.json` remain preserved
locally and are excluded from the review bundle. Credentials, secrets,
`node_modules`, owner asset bytes, and actual backups are also excluded.

## Stop point and review request

C3 implementation and focused verification are complete. The complete C1/C2/C3
review ZIP contains the source patch, all new files, migration and ADR context,
updated tests, this report, verification output, base/head/status, protected
artifact confirmation, and a SHA-256 manifest. It is ready for independent
Make Shotgun GPT review. Stop before commit, push, PR, TS-6, or any further
implementation until the next formal review result is issued.
