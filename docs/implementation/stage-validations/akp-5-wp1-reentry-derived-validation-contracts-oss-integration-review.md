# AKP-5 WP1 Re-entry and Derived-Validation OSS Integration Review

Date: 2026-08-30

## Decision

`NO_RELEVANT_OSS` for the AKP-5 WP1 implementation boundary. WP1 adds only
versioned TypeScript contract, decoder, identity and factory definitions under
`packages/contracts`. No external runtime, database, queue, model engine,
provider SDK, or review system is introduced.

The existing internal Discovery Finding, FindingReady, security, semantic
serialization and direct ClaimCandidate contracts are the relevant reusable
components. `ClaimCandidate.evidenceMode = DIRECT_EVIDENCE` remains unchanged.
The Open-source Role Matrix is unchanged.

## Reviewed candidates

| Candidate                  | Repository / version                                                                        | Decision          | WP1 scope and exclusion                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gbrain                     | https://github.com/garrytan/gbrain, commit `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`       | `REFERENCE_ONLY`  | Job/Fact/Search/Graph/Timeline/MCP patterns are not a contract dependency here. Runtime, DB model, IDs and authority are excluded. MIT.                           |
| lucasastorian/llmwiki      | https://github.com/lucasastorian/llmwiki, commit `ad626a3d81be1480e35ef4e94234de8dbb27a61e` | `NO_RELEVANT_OSS` | Conversion, annotation and validation runtime are outside the re-entry contract boundary. Apache-2.0.                                                             |
| ddsyasas/llm-wiki          | https://github.com/ddsyasas/llm-wiki, commit `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`     | `REFERENCE_ONLY`  | Action-oriented UX is outside WP1. Backend, SQLite, ingest/query and LLM client are excluded. MIT.                                                                |
| Inkeep OpenKnowledge       | https://github.com/inkeep/open-knowledge, commit `f2834c237639e2cff603817ed88182b33f83cf91` | `REFERENCE_ONLY`  | Visual/source and review patterns are outside the contract package. Runtime, storage, Canonical Markdown/Yjs, Git and MCP engines are excluded. GPL-3.0-or-later. |
| Existing Shotgun contracts | `main@e8715528ddb485f3865cf4af8e538cf8718d731c`                                             | `AUGMENT`         | Reuses the existing Finding/ResourceRef/CanonicalBase/DiscoveryBase/Provenance/FindingReady contracts and semantic stable JSON. No external package is added.     |

No candidate is `ADOPT` or `EXTRACT` for WP1. Therefore there is no new
lockfile entry, fork, upstream patch, runtime migration or provider/model
dependency to audit.

## Contract boundary and evidence

Target: AKP-5 WP1, `packages/contracts`, re-entry manifest and derived
provenance validation input family.

The implementation provides:

- strict `DiscoveryReentryManifestV1` decoding and a server-owned factory;
- versioned deterministic logical identity based on project, finding,
  revision, type, purpose, source projection digest and Canonical base;
- explicit `SOURCE_EVIDENCE` versus `DERIVED_DISCOVERY` origin types;
- strict `DerivedKnowledgeCandidateV1` with Finding, manifest, frozen base,
  server-resolved approved resource revisions, Evidence lineage, derivation
  provenance and a versioned derived-validation profile;
- an explicit `DiscoveryApprovedResourceRevisionRefV1` boundary and one-to-one
  resolution check. The original Finding/Manifest refs are immutable lineage
  and may be CURRENT/unversioned; candidate refs are separately supplied by a
  later server resolver through required `approvedRelatedResourceRefs` input
  and must be APPROVED with a revision;
- one typed governance mapping for each of the seven Finding types;
- separate re-entry eligibility and post-validation Review eligibility;
- stale/base fields preserved without implementing a stale policy or consumer;
- project, access-scope and sensitivity inheritance checks; and
- `ACTION_SUGGESTION` constrained to `CANDIDATE_ONLY`.

No Canonical, Evidence, Review, ChangeSet, Action, database, migration,
worker, consumer, route, UI or external side effect is authorized by WP1.
Unknown fields, fake SourceVersion fields, unsupported origins/mappings,
cross-project refs, access widening, sensitivity weakening and confidence or
executable-action fields are rejected at the contract boundary.

Focused evidence is the WP1 contract suite plus existing Finding and direct
ClaimCandidate regression suites, including a production-shaped unversioned
Finding, successful server-side revision enrichment and negative one-to-one
resolution cases. Golden Corpus, retrieval benchmark and adapter replacement
tests are not applicable because WP1 adds no transformation engine or adapter;
they remain required at the later runtime/adapter stages.

## Migration, replacement and rollback

Migration: `NONE`. The change is additive TypeScript contract code and tests;
no database schema, durable row or event version is changed. Existing
`FindingReady` remains the current versioned boundary.

Replacement requires another implementation of the exported contract/factory
surface with the same strict decoder and focused contract tests. Rollback is a
code deployment rollback that removes the additive export; existing Finding,
FindingReady and ClaimCandidate data remain readable.
