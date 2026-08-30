# AKP-5 WP3 Persistent Discovery Review Bridge OSS Integration Review

Date: 2026-08-31

## Decision

`AUGMENT` applies to the existing Shotgun ADR-128 Review Context/Item/Decision
authority and AKP-5 PostgreSQL persistence primitives. `NO_RELEVANT_OSS`
applies to the new normalized derived-resource bridge: it adds no external
review, workflow, queue, event-bus or model runtime.

The bridge keeps `discovery.reentry_candidates` as WP2 validation inputs with
`NOT_ELIGIBLE` semantics. A separate immutable `discovery.reentry_review_resources`
projection is the only Review source. The existing
`DiscoveryCandidateReviewTargetAdapter` materializes that projection into the
existing ADR-128 authority; it does not create a second Review ledger or
Approval authority. The Open-source Role Matrix is unchanged.

## Reviewed candidates

| Candidate                                                             | Repository / version                                                                        | Decision           | WP3 boundary                                                                                                                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL                                                            | Existing deployment baseline `16.14`                                                        | `ADOPT` (existing) | Uses existing `pg`, migrations, typed columns, FK/unique constraints and immutable trigger pattern. No new dependency.                                            |
| Existing Shotgun ADR-128 Review                                       | `main@60eae4176a2835a92cd6c05170d2a96e3f5c4173`                                             | `AUGMENT`          | Reuses Review Context/Item/Decision persistence and the existing Discovery target adapter. Review remains the authority; no new approval or canonical write path. |
| Existing Shotgun AKP-5 WP2 persistence                                | `main@60eae4176a2835a92cd6c05170d2a96e3f5c4173`                                             | `AUGMENT`          | Reuses Finding, Manifest, Candidate, project and lifecycle boundaries. WP2 migration 053 is not modified.                                                         |
| garrytan/gbrain                                                       | https://github.com/garrytan/gbrain, commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`       | `REFERENCE_ONLY`   | Job/Fact/Search/Graph/Timeline patterns do not supply a replaceable Review bridge. Runtime, DB model, IDs and authority are excluded. MIT.                        |
| lucasastorian/llmwiki                                                 | https://github.com/lucasastorian/llmwiki, commit `ad626a3d81be1480e35ef4e94234de8dbb27a61e` | `NO_RELEVANT_OSS`  | Conversion, annotation and validation runtime are outside WP3. Apache-2.0.                                                                                        |
| ddsyasas/llm-wiki                                                     | https://github.com/ddsyasas/llm-wiki, commit `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`     | `REFERENCE_ONLY`   | Action-oriented UX is outside this server-side bridge. Backend, SQLite and LLM client are excluded. MIT.                                                          |
| Inkeep OpenKnowledge                                                  | https://github.com/inkeep/open-knowledge, commit `f2834c237639e2cff603817ed88182b33f83cf91` | `REFERENCE_ONLY`   | Review/activity presentation patterns are outside the bridge. Runtime, storage, Canonical Markdown/Yjs, Git and MCP engines are excluded. GPL-3.0-or-later.       |
| Temporal / NATS JetStream / Redis Streams / pg-boss / Graphile Worker | Versions not selected                                                                       | `DEFER`            | WP3 is a persisted read/materialization bridge and needs no second queue or workflow runtime. Re-evaluate only with measured throughput/isolation requirements.   |

No external package, lockfile entry, fork or upstream patch is added. For
`ADOPT`/`AUGMENT`, the fixed Shotgun base and existing PostgreSQL baseline are
the version boundary; there is no moving `latest` dependency.

## Boundary and evidence

Target: AKP-5 WP3, the normalized persistent Review resource, the existing
`ReviewDiscoveryCandidateReader` Port, `DiscoveryCandidateReviewTargetAdapter`
and production PostgreSQL composition.

- `DiscoveryReviewResourceV1` is strict-decoded and explicitly requires
  `REVIEW_READY` plus `ELIGIBLE_AFTER_VALIDATION`.
- The resource keeps candidate/finding/manifest identity, canonical and
  discovery bases, approved related-resource revisions, Evidence IDs and
  lineage, derivation provenance, validation result identity, access scope and
  sensitivity.
- The PostgreSQL reader selects only the latest revision per stable Review
  resource identity, exact project, derived origin, Review-ready lifecycle and
  explicit eligibility. Raw Findings, WP2 candidates, malformed rows, stale or
  terminal revisions are not targets.
- Stable `(project, review_resource_id, resource_revision)` identity is
  immutable. Repeated equal writes are idempotent; different content at the
  same identity fails closed; a new revision is a new row and preserves old
  history.
- The adapter places derived lineage in ADR-128 `artifactRefs.discoveryLineage`
  and emits a validation artifact reference. It exposes only real
  `sourceId/sourceVersionId/evidenceSpanId` triples as Review evidence. Missing
  SourceVersion data is not synthesized.
- Production `application.ts` injects the PostgreSQL reader into the existing
  Review coordinator. Discovery APPROVE remains
  `ACCEPTED_FOR_AUTHORING`; no Approval Resource, Canonical mutation, Action or
  second command/Review ledger is introduced.

Focused local evidence:

- WP3 integration contract: 4/4 passed.
- Existing Review domain and negative regression: 19/19 passed.
- Repository typecheck and targeted ESLint: passed.
- `git diff --check`: passed.
- Real PostgreSQL WP3 test is present but local execution was skipped because
  `TEST_DATABASE_URL` was unset; automatic PR CI must provide the required DB
  evidence.

## Migration, replacement and rollback

Migration `054_akp_5_wp3_persistent_review_bridge.sql` is additive and leaves
053 unchanged. It creates the immutable normalized resource table, project and
WP2 lineage FKs, explicit eligibility/lifecycle checks, latest-revision index
and immutable mutation trigger. The database bootstrap verification list now
includes the new table.

The source reader is replaceable behind `ReviewDiscoveryCandidateReader`; a
replacement must preserve exact project filtering, latest immutable revision,
eligible-only selection, strict decoding, lineage preservation and no-fake-
SourceVersion behavior. The existing target adapter remains the shared
materialization boundary.

Rollback is a code deployment rollback after any producer is drained. The
additive table is not removed by application rollback; removal requires a
controlled DBA backup/restore operation after verifying no Review Context
depends on the projection. Existing 053 re-entry, FindingReady, Review and
Canonical data remain readable.
