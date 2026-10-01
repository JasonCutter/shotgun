# VP File Intake 10 MiB Alignment — 2026-10-02

## Change

Raise the active uploaded-file limit from 1 MiB to the existing Stage 8 raw-file
limit of 10 MiB across the product intake form, draft queue, shared staging
contract, authenticated upload route, sealed staging adapter, PostgreSQL write
validation, intake rows, and staging leases. Direct text and URL acquisition
remain bounded at 1 MiB. URL compressed and decompressed response limits remain
1 MiB.

The existing Stage 8 format worker still applies its independent resource
limits after upload: at most 2,048 ZIP entries, 64 MiB total expanded content,
16 MiB per member, 100x expansion ratio, parser-specific page/element/selector
caps, and bounded worker memory, CPU, output, and runtime. Uploading 10 MiB does
not remove those format or URL safety boundaries.

## OSS integration decision

- Feature: align active Product upload with the established Stage 8 raw-file
  contract.
- Decision: `REFERENCE_ONLY` for the Stage 8 format-worker resource-boundary
  design; `NO_RELEVANT_OSS` for the cross-layer upload-size invariant itself.
- Stage 8 reference: [OSS integration review](./stage-validations/stage-8-oss-integration-review.md)
  and [OSS source registry](./oss-source-registry.json). It records the existing
  parser pins, licenses, maintenance/security review, and isolated worker
  boundary. No package, upstream code, lockfile, runtime, or adapter was added
  or changed by this limit alignment.
- Target boundaries: Sources staging contract and sealed adapter, product
  upload route, PostgreSQL intake writer, and their contract/database tests.
  Shotgun retains ownership of Source, Evidence, policy, and provenance.
- Reuse rationale: the 10 MiB bound is a product/API/DB invariant rather than a
  document parser feature. The existing format adapter cannot enforce upload
  body limits or database row constraints. Its worker limits remain unchanged.
- Replacement: no external component is introduced. The file-size constants
  remain contract-owned; replace the limit by updating the contract constants,
  route, DB migration, and the named per-kind regression suite together.

## Verification and rollback

Verification passed:

- Staging unit and authenticated Fastify upload tests: 18/18, including FILE
  at 1 MiB + 1 byte, FILE rejection above 10 MiB, and direct-text/URL rejection
  above 1 MiB.
- PostgreSQL product intake and Stage 5 lease tests: 17/17. A 1 MiB + 1 byte
  FILE reached `SUCCEEDED` and persisted its byte count; a same-sized URL lease
  was rejected.
- Full unit suite: 170 files, 1,326/1,326 tests passed.
- Full contract suite: 77 files, 772/772 tests passed.
- Frontend suite: 50 files, 392/392 tests passed; frontend typecheck and
  production build passed. After adding the oversized-file assertion, the
  affected Sources Workspace test passed again (1 passed, 11 skipped).
- Full backend integration suite: 68 files passed, 4 files skipped; 517/517
  executed tests passed and 5 were skipped.
- Changed-file ESLint, `docs:validate` (541 links), and `oss:verify` (73
  decisions) passed. Root typecheck remains blocked only by the pre-existing,
  user-owned untracked TS7 contract test importing obsolete contract symbols.
- `verify:ts6-c2` passed after refreshing only the generated v8 derived lineage
  line references for the touched adapter; frozen v2–v7 history and approved
  relation inputs remain unchanged.

Migration 127 only widens FILE checks; application rollback is safe with the
wider schema left in place. Do not re-tighten the checks after accepting larger
files unless a data audit first proves no retained row or active lease exceeds
1 MiB.

This change closes only the active raw-file upload limit part of VP-08. It does
not verify URL freshness, image/audio/video intake, independent Golden corpus
labels, or answer-quality/cost bounds.
