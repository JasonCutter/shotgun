# AKP-4 WP5 Discovery Activity OSS Integration Review

Date: 2026-08-30

## Decision

`AUGMENT` the existing FE-P5-S1 Activity projection with a narrow Discovery
read adapter. The adapter observes the already-authoritative AKP-4 Discovery
runtime tables through a server-only Port and does not adopt an external
runtime, database, queue, Finding store, or Activity ledger.

The existing Open-source Role Matrix is unchanged. Its existing Discovery and
Activity decisions remain authoritative.

## Reviewed candidates

| Candidate             | Repository / version                                                                        | Decision                  | Scope and reason                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gbrain                | https://github.com/garrytan/gbrain, commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`       | `REFERENCE_ONLY`          | Job/retry/recovery and bounded operational evidence patterns only. MIT; existing registry records the reference status. Its runtime, DB model, IDs and operation authority are excluded.  |
| Inkeep OpenKnowledge  | https://github.com/inkeep/open-knowledge, commit `f2834c237639e2cff603817ed88182b33f83cf91` | `REFERENCE_ONLY`          | Agent Activity grouping and cockpit presentation patterns only. GPL-3.0-or-later; no code, runtime, storage or Yjs model is included.                                                     |
| ddsyasas/llm-wiki     | https://github.com/ddsyasas/llm-wiki, commit `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`     | `REFERENCE_ONLY`          | Action-oriented busy-state UX only; MIT. Backend, SQLite, ingest/query and LLM client are excluded.                                                                                       |
| lucasastorian/llmwiki | https://github.com/lucasastorian/llmwiki, commit `ad626a3d81be1480e35ef4e94234de8dbb27a61e` | `NO_RELEVANT_OSS` for WP5 | Transformation/Evidence components are unrelated to exposing durable Discovery runtime state; Apache-2.0. No package is added.                                                            |
| PostgreSQL            | Existing pinned PostgreSQL 16.14 runtime adapter                                            | `ADOPT` (existing)        | The existing Discovery runtime repository and `frontend_activity` projection store remain the persistence adapters. No new PostgreSQL dependency or alternate schema owner is introduced. |

Maintenance and security status were taken from the repository's existing
OSS registry/matrix review. No candidate was promoted to a new production
dependency for WP5, so no new lockfile entry, fork, or upstream patch exists.

## Shotgun boundary

- Target: AKP-4 WP5, `frontend-activity` module and Discovery Activity adapter.
- Port: `DiscoveryActivityReadPort`; implementation is the existing
  PostgreSQL Discovery runtime adapter plus an in-memory test adapter.
- The adapter reads Job/Run/Attempt/Stage snapshots and append-only lifecycle
  history only. It does not read stage outputs or Finding payloads.
- Stable Activity identity remains the Discovery `jobId`; duplicate logical
  triggers remain owned by the existing runtime uniqueness contract.
- Project binding is server-derived and revalidated through the existing
  Activity coordinator and adapter access check. Browser authority fields are
  rejected by the frozen Activity decoders.
- Runtime retry, lease, scheduler, provider routing, FindingReady and
  AKP-5 governance boundaries are unchanged.

## Evidence

- Contract tests cover the new `DISCOVERY` discriminant, old domain
  compatibility, deterministic cursor/identity behavior, malformed identity,
  browser authority rejection and `DISCOVERY_EXECUTION` attempt typing.
- Integration tests cover queue/detail/stages/events/refresh through the
  existing Activity projection and Product API coordinator, retry history,
  `PARTIAL`, terminal failure, cancellation, projection wait mapping and
  project isolation.
- PostgreSQL tests cover the real Discovery runtime read boundary, one Job
  root across repeated reads, duplicate logical identity, retry history,
  safe failure context, reconciliation stage evidence and side-effect-free
  reads. They run when `TEST_DATABASE_URL` is configured.
- Adapter failure is fail-closed through the existing projection builder:
  inaccessible rows are not fabricated, the adapter receives an UNAVAILABLE
  watermark, and the Discovery runtime tables are not mutated.
- The new read paths are bounded (Activity stage/event caps remain 50) and use
  existing project/job/run/attempt/stage indexes. No separate benchmark is
  required for this additive read-only mapping; no production latency claim is
  made here.

## Migration, replacement and rollback

Migration `052_akp_4_wp5_discovery_activity.sql` is additive and only extends
the existing Activity domain/root CHECK allow-list with `DISCOVERY`. Historical
migrations 029 and 048–051 are untouched. Rollback is a forward-compatible
deployment rollback: remove the Discovery adapter registration and stop
projecting the domain; the Discovery runtime remains intact. Database rollback
must first remove Discovery Activity rows and then restore the old CHECK
allow-list only when no Discovery rows remain. Replacing the adapter requires
another implementation of `DiscoveryActivityReadPort` with the same contract
tests; no canonical or runtime ID migration is needed.
