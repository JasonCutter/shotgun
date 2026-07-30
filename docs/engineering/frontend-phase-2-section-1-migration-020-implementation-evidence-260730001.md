# Frontend Phase 2 Section 1 — Migration 020 Implementation Evidence

- Record ID: `frontend-phase-2-section-1-migration-020-implementation-evidence-260730001`
- Date: 2026-07-30
- Canonical Base: `9c3690162c33e02c5d0b3b3cdf79bce67cedc63b`
- Branch: `codex/frontend-phase-2-section-1`
- Draft PR: #46
- Revision 2 Review Head: `d333aa4f8d9b68a4c892942517042f9390cbda72`
- Verified implementation Head: `5b0bb1dbac51725ee48b435e57bdf7530adc07ee`
- CI Run: `30523826431`
- Status: **PERSISTENCE FOUNDATION IMPLEMENTED / VERIFIED**
- Product write activation: **NOT AUTHORIZED / NOT ACTIVE**
- Browser Submit: **DISABLED**
- PR Ready and merge: **NOT AUTHORIZED**

## 1. User authorization

The user authorized the following on 2026-07-30:

1. Migration 020 SQL creation;
2. related transaction-aware persistence Adapter and Domain Unit of Work implementation;
3. required tests;
4. isolated development and CI Database execution.

The authorization did not include Product write-route activation, Browser Submit,
a new Runtime Dependency, PR Ready transition, merge, Section completion or
Phase 2 Section 2.

## 2. Implemented scope

### 2.1 Migration 020

Created:

```text
db/migrations/020_frontend_phase2_sources_product_persistence.sql
```

It provides:

- the additive `source_product` schema;
- exactly seven Product lifecycle, attempt, duplicate-choice and URL provenance relations;
- Project, Principal, Session, Command Ledger, Stage 2 and Asset foreign-key bindings;
- `ON DELETE RESTRICT`, composite ownership keys, uniqueness, validation checks and indexes;
- monotonic state/revision triggers;
- immutable Duplicate Decision, Disposition and URL Receipt records;
- Stage 2 channel compatibility expansion with `url_acquisition`;
- no historical Product-row backfill;
- no V1 relation or route removal.

### 2.2 Sources persistence port and PostgreSQL Adapter

Created:

```text
modules/frontend-sources-write/src/index.ts
adapters/frontend-sources-write-postgres/src/index.ts
```

The implementation currently provides the persistence foundation for:

- accepted Sources submit Command verification;
- Server-only submission and item identities;
- safe Ledger Manifest enforcement that rejects raw direct text, Base64/file bytes,
  local paths and credential fields;
- one-`PoolClient` Domain transaction across Product Submission/Item/Attempt,
  existing Stage 2 Submission, OriginalAsset, Source, SourceVersion and
  StorageReceipt records;
- same-command replay without duplicate Domain resources;
- direct-text, file and successful URL provenance persistence under the approved
  one MiB Plain Text/Markdown boundary;
- exact-duplicate Decision and immutable Disposition persistence methods;
- stable Project-scoped advisory lock order.

The Unit of Work deliberately leaves the Frontend Command in `ACCEPTED` after
Domain commit. Completion remains a separate post-commit Command Gateway step,
preserving ADR-116 recovery semantics.

### 2.3 Database and quality runner integration

Updated:

```text
scripts/database.ts
scripts/quality-search-baseline.ts
```

`source_product` is now included in reset/drop/verify lifecycle. The isolated
quality baseline uses the canonical `migrateUpTo()` runner so Migration Registry
preconditions match development and CI execution.

## 3. Added verification

Created:

```text
tests/database/frontend-phase-2-section-1-sources-persistence.test.ts
tests/database/frontend-phase-2-section-1-migration-020.test.ts
```

Verified:

- Fresh Database creates exactly seven `source_product` relations;
- Migration 019 to 020 upgrade succeeds;
- repeat Migration application is a no-op through the registry;
- conflicting Stage 2 channel preflight stops without registering Migration 020;
- no historical Product rows are fabricated;
- `url_acquisition` is distinct from `file_upload`;
- Product, Stage 2 and Asset writes commit in one transaction;
- accepted-command replay creates no duplicate Domain resource;
- raw input in the Command Ledger is rejected before Domain writes;
- late StorageReceipt failure rolls back Product, Stage 2 and Asset rows;
- successful URL provenance is stored in redacted form with existing Asset and
  SourceVersion ownership;
- the Command remains `ACCEPTED` after Domain commit for post-commit completion.

## 4. Failure and correction history

### Initial implementation Head

- Head: `1c60df2d44698977603744b61698f1944a62c9a5`
- Run: `30522188561`
- Result: FAIL
- Causes:
  - SQL helper argument used reserved identifier `values`;
  - PostgreSQL Adapter used a value import where all imported symbols were types.

Corrections:

- renamed the SQL helper argument;
- converted `pg` imports to type-only imports and normalized the Adapter.

### Intermediate runner failure

- Head: `b53cc8a50b46d72d6cc8333c49a6e492bfa4f540`
- Run: `30522955346`
- Result: Frontend PASS; Quality FAIL at Stage 12 quality baseline.
- Cause: the quality baseline applied SQL files directly and did not create or
  populate `runtime.schema_migrations`, unlike the canonical runner.

Correction:

- the isolated quality baseline now uses `migrateUpTo()`.

### Verified implementation

- Head: `5b0bb1dbac51725ee48b435e57bdf7530adc07ee`
- Run: `30523826431`
- Frontend typecheck/test/build: PASS
- Chromium E2E: PASS
- Documentation governance/format/lint/typecheck/dependency audit: PASS
- Database reset: PASS
- Stage 12 reuse and operations gate: PASS
- full CI test suite: PASS
- Database suite: PASS
- Required Gates: PASS

## 5. AC status

This checkpoint does not change the aggregate AC status.

```text
PASS:
AC-01 through AC-05
AC-20 through AC-28

BLOCKED:
AC-06
AC-09 through AC-19
AC-30
AC-32

NOT_RUN:
AC-07
AC-08
AC-29
AC-31

FAIL:
none
```

The new evidence advances the persistence implementation underneath AC-06,
AC-08, AC-10 through AC-19 and AC-30, but those criteria remain incomplete
until their complete Product, security, recovery and end-to-end requirements
are verified.

## 6. Remaining implementation boundary

The following remain outside this verified checkpoint:

- protected raw-input Staging transport and actual immutable byte write before
  Ledger Manifest acceptance;
- production `UrlAcquisitionPort` with SSRF, redirect, DNS/IP and credential
  negative corpus;
- failed/cancelled URL Receipt execution paths;
- Product cancel and retry coordinators and recovery routes;
- automatic exact-duplicate detection before Source creation;
- duplicate disposition race and stale-policy/source integration tests;
- Product write-route activation and Browser Submit;
- accessibility/performance/end-to-end completion evidence;
- PR Ready transition, merge and Section completion.

No claim of Product activation, Section completion or merge readiness is made by
this evidence record.
