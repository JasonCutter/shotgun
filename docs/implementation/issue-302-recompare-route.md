# Issue #302 — Recompare Product route alignment

Status: implementation in progress on the controller-approved correction
branch.

## Scope and source audit

Canonical base: `main@6e2f07e9ceefae131e60e22a0be40414764ad68a`.

The Product API client calls `request('/comparisons/recompare')`; the shared
client request helper prefixes `/api/v1`, so the browser request is
`POST /api/v1/comparisons/recompare`. The application had registered the
handler only at `POST /comparisons/recompare`, while the integration and
PostgreSQL tests called that legacy path directly. The client unit test mocked
the `/api/v1` path, so no test bound the real client to the real application.

Current consumers found by repository search:

- Product client source: the shared `request()` helper plus
  `recompareCandidate()` (the source argument remains `/comparisons/recompare`
  because the helper owns the `/api/v1` namespace);
- application server: the Recompare handler;
- integration/PostgreSQL tests: direct in-process Product route callers;
- client unit tests: mocked `/api/v1/comparisons/recompare` request.

Historical validation prose may mention the old route, but no supported runtime
consumer is retained at that path.

## Approved correction

- Register the authoritative server handler at
  `POST /api/v1/comparisons/recompare`.
- Move direct integration/PostgreSQL Recompare calls to that canonical Product
  route and assert that the old path is not a supported alias.
- Add a real `ShotgunApiClient.recompareCandidate()` → application regression
  using the actual in-process server and authenticated session. The test must
  exercise the structured Change Set locator, V2 success decoding, and one
  typed V2 non-success result.

The existing server-owned locator, idempotency, rollout, Candidate resolution,
bounded response decoder, and domain authority remain unchanged. Browser
presentation text is never used as authority.

## Integration decision

`NO_RELEVANT_OSS`: this is a Shotgun-owned HTTP namespace seam. The reviewed
reference candidates remain `REFERENCE_ONLY`; no external runtime or package
can replace the server/client Contract boundary:

- `garrytan/gbrain`, commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT;
- `lucasastorian/llmwiki`, commit `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0;
- `ddsyasas/llm-wiki`, commit `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`, MIT;
- Inkeep OpenKnowledge, commit `f2834c237639e2cff603817ed88182b33f83cf91`, GPL-3.0-or-later.

No Adapter, Extract, Fork, dependency, ADR, frozen Contract Snapshot
amendment, or database migration is introduced.

## Safety boundaries

- Recompare remains the sole explicit operator re-entry boundary;
- only the existing bounded V2 result can be reported as success
  (`V2_ACTIVE + COMPLETED + DRAFT_CREATED`);
- `BLOCKED`, `INCOMPLETE`, and `FAILED` remain typed recovery outcomes;
- no V1 fallback, automatic approval, ReviewDecision, approval token,
  Canonicalization, or Canonical write is added;
- normal rollback is a revert of the correction commit.

## Verification record

Local verification on the correction branch:

- focused stale-reentry integration and API-client tests: 23 passed;
- all unit tests: 1126 passed;
- all contract tests: 673 passed;
- root typecheck and changed-file ESLint: passed;
- changed-file Prettier check and `git diff --check`: passed;
- PostgreSQL Recompare regression: skipped because `TEST_DATABASE_URL` is not
  configured in this environment;
- full integration suite: 469 tests passed, with the database-backed
  `recovery-harness-isolation.test.ts` suite blocked by the same missing
  `TEST_DATABASE_URL` prerequisite.

The completion update must record the exact branch, head SHA, changed files,
route-consumer audit, real client/server evidence, typed non-success evidence,
and exact-head CI gates before this correction is reported complete.
