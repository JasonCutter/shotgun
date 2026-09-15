# ADR-168 — Canonical-Driven Semantic Projection Convergence and Recovery

_Status: Accepted for RUS-2-C7 (2026-09-16)_

## Context

Semantic vectors are a rebuildable derived projection. A `CanonicalCommitted`
event can be published before a process restarts, while its semantic generation
remains on the previous Canonical snapshot. Ask must exclude that generation
until it is current; however, a restart must also recover the already-published
gap without replaying approval or mutating Canonical.

## Decision

`stage7.semantic-projection-convergence` consumes the existing
`CanonicalCommitted@1.0.0` contract and compares the active READY generation
with the current `SemanticCorpusSourceWatermark`. The exact-current predicate
uses the existing `semanticGenerationMatchesSourceWatermark` contract and one
shared, server-authoritative execution-compatibility resolver also used by the
Product status surface. Compatibility includes the provider/model/profile and
credential revisions, provider registry and capability catalog revisions,
provider policy fingerprint, representation version, dimension, distance
metric, and normalization policy. An exact-current generation is a `NO_OP`;
an unverifiable resolver result is stale/fail-closed.

When the generation is absent or stale, the consumer calls the existing
`SemanticProjectionRefreshPort.refresh(...)`. `SemanticGenerationBuilder`
remains the only authority that creates, validates, and activates generations;
the convergence consumer does not write semantic tables, construct a
generation, or introduce a second refresh service.

The event handoff is durable and reconstructable, while its consumer handler
is intentionally non-required for publisher acknowledgement. A semantic provider or policy failure is
independently dead-lettered by Connector Runtime and cannot prevent Canonical
outbox acknowledgement or other CanonicalCommitted consumers. The old
generation remains durable but stale and therefore fail-closed at query time.
Only bounded `READY`, `NOT_CONFIGURED`, `RECOVERY_PENDING`, and `DEGRADED`
observations are retained in the application operational projection; provider
payloads, secrets, query text, and raw exception text are never recorded.

Startup and periodic recovery scan the existing Canonical project identity
list. This catches a historical event that was already published before the
restart. Recovery calls the same convergence port, is bounded by the existing
worker cadence, is independently retryable, and never replays a review,
approval, Canonical commit, or new Canonical outbox record. Startup recovery is
scheduled as an asynchronous initial tick of that existing worker and never
blocks application/Product readiness on an external embedding provider. Startup
and periodic outcomes use the same bounded operational recorder, including safe
failure containment for periodic exceptions, so health and recovery state are
not lost after a background failure. The existing recovery interval boundary
may be set to `false` by deterministic harnesses to disable automatic startup
and periodic semantic reconciliation for that application instance; explicit
semantic APIs, CanonicalCommitted consumer delivery, and freshness enforcement
remain enabled. Per-project convergence is serialized in-process; persistent
generation activation retains the existing database CAS boundary for
multi-process races and duplicate event delivery.

No semantic refresh is attempted when a project has no current profile. A
non-refreshable profile, unavailable provider, denied policy, stale build, or
CAS conflict produces a safe degraded/retry state. There is no automatic
provider substitution, DeepSeek embedding fallback, Ask-triggered refresh,
unbounded reconciliation loop, or lexical retrieval redesign.

## Module and port boundary

- Canonical owns `Source`, `SourceVersion`, Claim, commit, approval, and outbox.
- Semantic Corpus owns the source snapshot and watermark read port.
- Semantic Generation owns generation lifecycle and the activation CAS.
- Semantic Projection Convergence owns only event coordination and bounded
  operational observations.
- Ask and Hybrid Retrieval continue to use the existing stale-generation
  fail-closed predicate and Canonical Claim → Evidence → citation flow.

## OSS integration decision

`NO_RELEVANT_OSS` applies to the exact CanonicalCommitted-to-
`SemanticProjectionRefreshPort` convergence authority. The existing Shotgun
Connector Runtime, Canonical outbox, recovery registry, corpus watermark, and
generation CAS are the authoritative boundaries.

The reviewed references remain bounded as follows:

- `garrytan/gbrain` at `a25209b` (MIT): `REFERENCE_ONLY` for bounded recovery,
  replay, and idempotency patterns; its runtime and database are not adopted.
- `lucasastorian/llmwiki` at `ad626a0` (Apache-2.0): `REFERENCE_ONLY` for
  validation/reconcile patterns; its SQLite, FTS, VaultFS, and MCP runtime are
  not adopted.
- `ddsyasas/llm-wiki` at `e8dd69e` (MIT): `REFERENCE_ONLY` for UX/status
  patterns only; its backend and storage are not adopted.
- Inkeep OpenKnowledge at `f2834c237639e2cff603817ed88182b33f83cf91`
  (GPL-3.0-or-later): `REFERENCE_ONLY` for visual review
  patterns only; its runtime, Canonical Markdown/Yjs, Git, and MCP engines are
  not adopted. Yjs remains `DEFER`.
- PostgreSQL `pgvector` remains `DEFER` as an adapter candidate; C7 adds no
  dependency or vector-store migration.

## Verification, migration, and rollback

Focused Contract/Unit/Integration tests cover exact-current no-op across the
full execution compatibility identity, stale refresh through the existing
port, no-profile no-op, safe failure state, best-effort event declaration,
duplicate delivery, recovery/event race, periodic failure recording, and
bounded startup recovery. The PostgreSQL causal acceptance tests cover
Canonical v1 commit → stale fail-closed semantic query → real
`CanonicalCommitted` delivery → current generation → grounded Ask evidence and
citation, restart recovery of an already-published gap, provider-failure
isolation and restoration, and Canonical immutability.

No database migration, new outbox, or new recovery authority is required.
Rollback is a code revert of the convergence module, manifest handoff, and
composition wiring; existing Canonical, lexical, semantic generation, and
Connector Runtime data remain valid. A replacement must preserve the existing
refresh port, generation CAS, stale fail-closed retrieval, safe diagnostics,
and the same causal acceptance tests.
