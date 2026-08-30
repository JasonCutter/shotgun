# AKP-5 WP5 Stale Provenance and Security Closure OSS Integration Review

## Decision

WP5 augments the existing Shotgun Finding lifecycle, Discovery re-entry,
PostgreSQL Review-resource, Evidence, and ADR-128 Review authorities. The new
`discovery-reentry-freshness:v1` evaluator is a narrow Port-facing contract;
it does not add a scheduler, event bus, second lifecycle store, Canonical
writer, Approval Resource, or external-action path. No new npm dependency is
introduced and no lockfile change is required.

Target: AKP-5 WP5, stale-base/provenance/security closure, based on
`21648d52d05ea08c7f6e11ebb15959ab91d036b4`.

## Candidate decisions

| Candidate                                                         | Repository / reviewed version                     | License                   | Decision          | Included / excluded scope                                                                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------- | ------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing Shotgun AKP-5 WP1-WP4 authorities                        | `main@21648d52d05ea08c7f6e11ebb15959ab91d036b4`   | Shotgun repository policy | `AUGMENT`         | Reuse Finding lifecycle, approved-revision resolution, immutable Review resource, Evidence and ADR-128 decision boundaries. No duplicate store or migration 055.              |
| [garrytan/gbrain](https://github.com/garrytan/gbrain)             | commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` | MIT                       | `REFERENCE_ONLY`  | Lock, retry, idempotency, and recovery patterns inform fail-closed evaluation. Runtime, DB schema, IDs, and authority remain excluded.                                        |
| [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki) | commit `ad626a3d81be1480e35ef4e94234de8dbb27a61e` | Apache-2.0                | `NO_RELEVANT_OSS` | Its conversion, annotation, watcher, and reconcile components do not provide a replaceable stale-provenance authority. SQLite, FTS, VaultFS, and MCP runtime remain excluded. |
| [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki)         | commit `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` | MIT                       | `REFERENCE_ONLY`  | Action-oriented review UX is outside this server-side evaluator. Backend, SQLite, ingest/query, and LLM client remain excluded.                                               |
| [Inkeep OpenKnowledge](https://github.com/inkeep/open-knowledge)  | commit `f2834c237639e2cff603817ed88182b33f83cf91` | GPL-3.0-or-later          | `REFERENCE_ONLY`  | Review/activity and source-visibility patterns are outside the evaluator. GPL runtime, storage, Canonical Markdown/Yjs, Git, and MCP engines remain excluded.                 |

## Boundary and verification record

- `DiscoveryReentryFreshnessAssessmentV1` is the versioned contract, fixed at
  `discovery-reentry-freshness:v1`; the server owns all binding and current
  authority inputs. Browser values cannot override them.
- Freshness compares only relied-on resources, evidence lineage, derivation
  provenance, validation profile, Review target, project scope, and
  sensitivity. A later unrelated Canonical version is a negative control and
  does not invalidate a Finding.
- Guard A runs before re-entry intake; Guard B runs before and immediately
  after immutable Review-resource save; Guard C runs before ADR-128 context
  materialization and decision. A stale result cannot become `REVIEW_READY` or
  `ACCEPTED_FOR_AUTHORING`; an immutable crash-gap resource is retained but
  hidden by the existing lifecycle-aware reader.
- Existing Finding lifecycle is the only stale authority. Terminal
  `STALE`/`SUPERSEDED`/`RESOLVED`/`DISMISSED`/`SUPPRESSED` states cannot be
  reopened by replay or restart. Discovery APPROVE remains an authoring
  acceptance without an Approval Resource or Canonical mutation.
- Migration is `NONE`. Migrations 053 and 054 are unchanged; migration 055 is
  intentionally absent. Rollback is a code/branch rollback because no schema
  or durable payload shape changes are required.
- Focused contract and integration results are recorded in the WP5 completion
  report and Draft PR. Required follow-up conditions are a change to the
  freshness contract version, a new authoritative resource kind, or a need to
  replace the server-owned evaluator Port.
