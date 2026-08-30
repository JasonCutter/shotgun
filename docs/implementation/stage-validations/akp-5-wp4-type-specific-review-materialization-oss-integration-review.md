# AKP-5 WP4 Type-Specific Discovery Review Materialization OSS Integration Review

Date: 2026-08-31

## Decision

`AUGMENT` applies to the existing AKP-5 WP2/WP3 persistence boundary and ADR-128
Review Context/Item/Decision authority. `NO_RELEVANT_OSS` applies to the new
seven-type normalization mapping: no external package provides this
Shotgun-specific Finding-to-Review semantic contract without introducing a
second authority or runtime. The existing deterministic mapping is therefore
implemented as a small exhaustive boundary behind the existing module Port.

The worker reloads the authoritative persisted Finding and derived Candidate,
verifies their identity, frozen bases, approved revision set, provenance,
project scope and security constraints, and then writes only the existing WP3
immutable Review resource. Candidate `NOT_ELIGIBLE` remains unchanged; the
Review resource alone carries `ELIGIBLE_AFTER_VALIDATION`.

## Reviewed candidates

| Candidate                                  | Repository / version                                                                        | Decision           | WP4 boundary                                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing Shotgun ADR-128 Review            | `main@37d3f09e1bb81d6a56fdcee50eb888c0c7ed6e49`                                             | `AUGMENT`          | Reuses the existing Review adapter, Context/Item materialization and decision path; no second Approval or Canonical writer.                                                |
| Existing Shotgun AKP-5 WP2/WP3 persistence | `main@37d3f09e1bb81d6a56fdcee50eb888c0c7ed6e49`                                             | `AUGMENT`          | Reuses Finding, Manifest, Candidate, lifecycle, root and resource tables; no migration 055, duplicate store or queue.                                                      |
| PostgreSQL                                 | Existing deployment baseline `16.14`                                                        | `ADOPT` (existing) | Uses the existing repository and immutable JSON resource projection. No new dependency.                                                                                    |
| garrytan/gbrain                            | https://github.com/garrytan/gbrain, commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`       | `REFERENCE_ONLY`   | Job/Fact/Search/Graph patterns do not provide the requested type-specific Review contract. Runtime, DB model and authority are excluded. MIT.                              |
| lucasastorian/llmwiki                      | https://github.com/lucasastorian/llmwiki, commit `ad626a3d81be1480e35ef4e94234de8dbb27a61e` | `NO_RELEVANT_OSS`  | Conversion, annotation and validation runtime are outside this boundary. Apache-2.0.                                                                                       |
| ddsyasas/llm-wiki                          | https://github.com/ddsyasas/llm-wiki, commit `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`     | `REFERENCE_ONLY`   | Action-oriented UX is not a replacement for server-owned normalization. Backend, SQLite and LLM client are excluded. MIT.                                                  |
| Inkeep OpenKnowledge                       | https://github.com/inkeep/open-knowledge, commit `f2834c237639e2cff603817ed88182b33f83cf91` | `REFERENCE_ONLY`   | Review/activity presentation patterns are outside this server-side contract. Runtime, storage, Canonical Markdown/Yjs, Git and MCP engines are excluded. GPL-3.0-or-later. |

No external package, fork, lockfile entry or moving `latest` branch is added.
The Open-source Role Matrix remains unchanged.

## Boundary and evidence

Target: AKP-5 WP4, `DiscoveryReviewMaterializer`, the existing WP3
`DiscoveryReviewResourceWriterPort`, `DiscoveryCandidateReviewTargetAdapter`
and production PostgreSQL composition.

- The seven mappings are explicit and exhaustive:
  `KNOWLEDGE_GAP` to `KNOWLEDGE_GAP_INVESTIGATION`, `EVIDENCE_GAP` to
  `EVIDENCE_GAP_INVESTIGATION`, `RELATION_HYPOTHESIS` to `RELATION_CANDIDATE`,
  `PATTERN_HYPOTHESIS` to `DERIVED_CLAIM_CANDIDATE`, `CONFLICT_HYPOTHESIS` to
  `CONFLICT_REVIEW`, `CLARIFICATION_QUESTION` to `CLARIFICATION_WORK_ITEM`,
  and `ACTION_SUGGESTION` to `ACTION_CANDIDATE`.
- Type-specific material preserves the Finding payload and lineage while
  keeping gaps investigative, relations staged, patterns proposed, conflicts
  dual-statement, clarification investigative and actions `CANDIDATE_ONLY`.
- Comparison material explicitly uses
  `NOT_AVAILABLE` with
  `NO_AUTHORITATIVE_PREVIOUS_CANONICAL_VALUE`; it never treats unknown as
  known absence or fabricates a prior Canonical value.
- Impact material uses the existing `AFFECTED_ITEM`, `RELATION`, `CLAIM` and
  `CONFLICT` vocabulary without creating Facts, SourceVersions, Canonical
  writes or external Action execution.
- The materializer accepts only a lookup identity, reloads the persisted pair,
  rechecks manifest and candidate bindings, rejects project/access/sensitivity
  widening, and writes through the existing WP3 immutable resource repository.
- `discovery-review-root-identity:v1` remains based only on project,
  candidate, candidate revision and `DERIVED_DISCOVERY`. Same immutable content
  is idempotent; same identity with changed content conflicts; an intentional
  revision is explicit.
- The production worker now runs the materializer after a newly created or
  already persisted WP2 intake. The PostgreSQL reader returns normalized impact
  material to the existing ADR-128 adapter.
- No fake SourceVersion or direct-evidence behavior is introduced. No new
  Review/Approval/Canonical/Action persistence authority is introduced.

Focused local evidence:

- WP4 integration: 5/5 passed.
- WP1/WP2 contracts and WP3 integration: 27/27 passed.
- Existing Review, comparison and AKP-3 regression selection: 1124/1124
  passed across 67 files.
- Typecheck, targeted ESLint, architecture boundaries and `git diff --check`:
  passed.
- Real PostgreSQL execution is represented by the existing WP3 database suite;
  local execution remains conditional on `TEST_DATABASE_URL` and automatic PR
  CI must provide the database evidence.

## Migration, replacement and rollback

Migration is `NONE`. WP4 stores normalized material in the existing WP3
`content` JSON and uses the existing 053/054 tables. No migration 055,
database column, duplicate queue, shadow store or dependency is required.

The normalization boundary is replaceable behind the existing
`DiscoveryReviewResourceWriterPort` and `DiscoveryCandidateReviewTargetAdapter`
contracts. A replacement must preserve strict seven-type mapping, exact
authoritative lineage, frozen bases, project/security narrowing, neutral
comparison semantics, no-fake-SourceVersion behavior, stable root identity and
idempotent immutable persistence.

Rollback is a code deployment rollback after the worker is drained. Existing
WP2 candidates remain validation-only and existing WP3 resources remain
readable; the additive Review projection is not dropped by application
rollback. Any data removal requires a controlled DBA backup/restore operation
after verifying Review Context dependencies.
