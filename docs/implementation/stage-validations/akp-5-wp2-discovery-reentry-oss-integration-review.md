# AKP-5 WP2 Durable FindingReady Consumer and Re-entry OSS Integration Review

Date: 2026-08-30

## Decision

`AUGMENT` for the existing Shotgun FindingReady, Finding lifecycle and
PostgreSQL transaction primitives. `NO_RELEVANT_OSS` applies to the new
consumer/re-entry boundary: WP2 adds no external queue, workflow engine,
event bus, model runtime or provider SDK.

The existing durable `discovery.finding_ready` ledger remains the notification
authority. The PostgreSQL adapter owns the normalized non-Canonical re-entry
manifest/candidate tables and the narrow consumption-disposition ledger; it
uses the existing lifecycle transition authority. No second outbox, queue table
or generalized workflow database was introduced. The Open-source Role Matrix
is unchanged.

## Reviewed candidates

| Candidate                                                             | Repository / version                                                                        | Decision           | WP2 scope and exclusion                                                                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL                                                            | Existing deployment baseline `16.14`                                                        | `ADOPT` (existing) | Transaction, row locking, unique constraints and append-only persistence. No new package or runtime dependency.                                                  |
| garrytan/gbrain                                                       | https://github.com/garrytan/gbrain, commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`       | `REFERENCE_ONLY`   | Durable Job/lock/recovery patterns were inspected. Runtime, DB model, IDs and authority remain outside Shotgun. MIT.                                             |
| lucasastorian/llmwiki                                                 | https://github.com/lucasastorian/llmwiki, commit `ad626a3d81be1480e35ef4e94234de8dbb27a61e` | `NO_RELEVANT_OSS`  | Conversion, annotation and validation runtime are outside this durable consumer boundary. Apache-2.0.                                                            |
| ddsyasas/llm-wiki                                                     | https://github.com/ddsyasas/llm-wiki, commit `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`     | `REFERENCE_ONLY`   | Action-oriented UX and its backend/storage are outside WP2. MIT.                                                                                                 |
| Inkeep OpenKnowledge                                                  | https://github.com/inkeep/open-knowledge, commit `f2834c237639e2cff603817ed88182b33f83cf91` | `REFERENCE_ONLY`   | Review/activity patterns are outside WP2. Runtime, storage, Canonical Markdown/Yjs, Git and MCP engines are excluded. GPL-3.0-or-later.                          |
| Temporal / NATS JetStream / Redis Streams / pg-boss / Graphile Worker | Versions not selected                                                                       | `DEFER`            | A second queue/workflow runtime is not required for the current single-DB bounded consumer. Re-evaluate only with measured throughput or isolation requirements. |

No candidate is `EXTRACT` or `AUGMENT` beyond the existing Shotgun
primitives. No lockfile, SBOM, fork or upstream patch was added.

## Boundary and evidence

Target: AKP-5 WP2, `DiscoveryReentryConsumer`, the
`DiscoveryApprovedResourceRevisionResolverPort`, and durable PostgreSQL
re-entry intake.

- FindingReady is strictly decoded and treated as a notification/reference.
- The persisted Finding is loaded by exact project, Finding identity and
  revision; fingerprint, fingerprint version and both frozen bases are checked.
- `DERIVED_PROVENANCE_VALIDATION` is server-owned and the WP1 logical identity
  function supplies deterministic manifest/candidate identities.
- Raw Finding refs remain in the manifest. Only the resolver's authoritative
  `APPROVED` refs with real revisions reach the candidate.
- The resolver reuses the existing PostgreSQL Knowledge Model and Compiled
  Truth authorities. `CANONICAL_CLAIM` resolves to the historical canonical
  revision at or before the frozen base; `CANONICAL_ENTITY`,
  `CANONICAL_RELATION`, `CANONICAL_EVENT`, `CANONICAL_DECISION` and
  `CANONICAL_CONFLICT` resolve to the matching approved Knowledge candidate
  revision. `COMPILED_TRUTH_ITEM` resolves its actual canonical or approved
  underlying authority. No latest substitution or synthetic SourceVersion is
  allowed.
- The candidate remains `DERIVED_DISCOVERY`, `NOT_ELIGIBLE` for Review and has
  no synthetic SourceVersion or Canonical write authority.
- One PostgreSQL transaction persists manifest, candidate and
  `NEW -> VALIDATING` with `GOVERNED_WORKFLOW / VALIDATION_STARTED`, plus a
  `PROCESSED` consumption disposition.
- Deterministic authority and lifecycle outcomes are durably recorded as
  `BLOCKED_NON_RETRYABLE` or `INELIGIBLE`; pending selection excludes those
  states and only permits a future-due `RETRYABLE` record. This prevents a
  permanent one-second hot loop and preserves the decision across restart.
- Explicitly classified transient failures are durably recorded as
  `RETRYABLE` with `RETRYABLE_INFRASTRUCTURE_FAILURE` and a bounded one-second
  eligibility delay aligned with the existing discovery worker retry baseline.
  A due retry reuses the same identity, advances `next_eligible_at` on another
  retryable failure, and transitions to `PROCESSED` atomically on success. If
  the disposition store itself is unavailable, the failure remains at the
  existing worker/polling boundary; no in-process retry loop is added.
- Unique logical identity, row locking and durable reads provide duplicate,
  restart and concurrent-consumer safety without an additional queue.
- Recovery, terminal lifecycle, project isolation, unresolved revision and
  transaction-failure paths fail closed.

Evidence executed for this boundary:

- WP2 contract suite: 5/5 passed.
- WP2 PostgreSQL suite: the focused success/replay/concurrency/crash, current
  approved authority matrix, terminal lifecycle, durable-disposition and
  retry-transition tests are present; local execution was skipped because
  `TEST_DATABASE_URL` was unset. Automatic PR CI #1123 exposed the missing
  Claim reason classification, which this correction narrows to
  `NO_APPROVED_REVISION_AT_FROZEN_BASE`; a new automatic run is required.
- Repository typecheck: passed.

## Migration, replacement and rollback

Migration `053_akp_5_wp2_discovery_reentry.sql` adds
`discovery.reentry_manifests`, `discovery.reentry_candidates` and the narrow
`discovery.reentry_consumption` table. The disposition key is
`(project_id, finding_id, finding_revision, requested_reentry_purpose)` and
supports `PROCESSED`, `INELIGIBLE`, `BLOCKED_NON_RETRYABLE` and `RETRYABLE`,
with typed reason codes and optional `next_eligible_at`. Retryable upserts
advance the same row, while a successful intake transitions that row to
`PROCESSED` in the existing transaction. Pending selection excludes terminal
dispositions and not-due retries. All tables are
non-Canonical and project-bound; Finding-bound resources are strict-decoded on
reads.

The resolver is replaceable through
`DiscoveryApprovedResourceRevisionResolverPort`; a replacement must preserve
the frozen-base, project-scope and real-approved-revision contract and pass the
same contract/PostgreSQL tests. The persistence adapter is replaceable behind
`DiscoveryReentryPersistencePort`.

Rollback is a code rollback after the consumer is drained. Because this
repository has no down-migration workflow, removing the additive 053 tables is
only a controlled DBA/backup-restore operation after verification; it is not
part of the application rollback. Existing FindingReady, Finding, lifecycle
and Canonical history remain readable, and no historical migration is modified.
