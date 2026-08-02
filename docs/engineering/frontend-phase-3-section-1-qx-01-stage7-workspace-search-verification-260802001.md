---
id: FRONTEND-PHASE-3-SECTION-1-QX-01-STAGE7-WORKSPACE-SEARCH-VERIFICATION-260802001
classification: IMPLEMENTATION_VERIFICATION
status: PASS
work_item: FE-P3-S1
slice: QX-01
authorization: SIDE_PANEL_REVIEW_4836523482
subject_commit: eec1cd61008029f01b58953f9713d0507710bae3
base_commit: cb2513bc311891ac89f53c7d67d6a401da65a2a8
branch: codex/frontend-phase-3-section-1-knowledge-workspace
pull_request: https://github.com/JasonCutter/shotgun/pull/53
remote_exact_head_ci: 30727558866
remote_exact_head_ci_run: 394
---

# FE-P3-S1 QX-01 Stage 7 Workspace Search Verification

## Scope and authority

This record covers the additive `SearchKnowledgeWorkspace@1.0.0` Stage 7
handler authorized by side-panel review `4836089195`, amended by the QX-01.1
correction authorization in review `4836218304`, and further amended by the
QX-01.2 limited correction authorization in review `4836399738`. Final PASS
review `4836523482` confirms the implementation. The implementation keeps
`stage7.projection-search` as the only matching, normalization, filtering,
ranking and cursor owner.

The handler composes only the approved existing Query boundaries:

- Canonical candidates use the existing Stage 7 repository search path. The
  existing `SearchCanonicalKnowledge@1.0.0` contract and output semantics are
  unchanged. `GetCanonicalCommit` and `GetDocumentRevision` are used only to
  verify and expose existing lineage identity.
- Approved Knowledge candidates use `ListKnowledgeGroups@1.0.0`, retaining
  only `APPROVED` groups in the envelope Project after access-scope and
  sensitivity checks.
- Compiled Truth candidates use only the visible result of
  `GetCompiledTruthReadSnapshot@1.0.0`; READY, STALE, DEGRADED and NOT_BUILT
  status identity remains explicit.
- Derived Inference candidates use `ListDerivedInferences@1.0.0` only when a
  visible Compiled Truth projection exists. Candidates are retained only when
  the source projection digest, related visible nodes and evidence IDs all
  correlate to that projection.

No Product-result storage, Persistent Knowledge Adapter, new repository port,
SQL/table/index, event fan-out, migration, runtime dependency, API, Client,
Cache or `/knowledge` UI was added. PR Ready, Merge, FE-P3-S1 completion and
Deployment remain unauthorized.

## Delivered implementation

- Registered the additive Query contract and executable/module manifests.
- Added one locale-independent `UNIT_INTERVAL_V1` scorer for all four
  authorities. Canonical repository score and match type remain retrieval
  metadata only; existing `SearchCanonicalKnowledge@1.0.0` semantics are
  unchanged. The Stage 7 handler applies the shared scorer after candidate
  composition.
- Applied Project, access, sensitivity, resource, authority, kind, temporal
  and projection-status filtering before ranking. Canonical sensitivity is
  checked in Stage 7 even though the existing repository search owns access
  filtering; Stage 9 and Stage 10 Query boundaries remain authoritative for
  their visible data.
- Added stateless opaque, request-bound cursors containing the cursor version,
  next offset, ranking version and digest of normalized query/resource/filter
  inputs. Canonical retrieval is capped independently at 100; cursor offsets
  accept any non-negative safe integer so handler-issued offsets beyond 100
  remain usable. Malformed, mismatched or unsafe cursors fail closed; no
  cursor storage was added. Ranks are contiguous and global across pages.
- Replaced locale-sensitive matching/order behavior with locale-independent
  lower-casing and a code-point comparator for deterministic source identity
  ties.
- Correlated Derived Inference only against visible `CompiledTruth` graph nodes,
  logical digest and visible evidence IDs. Relation-only IDs, hidden/missing
  nodes, digest mismatches and invisible evidence are rejected.
- Added a real PostgreSQL `PostgresSearchProjectionRepository` QX-01 handler
  parity test using the same deterministic dual-backend fixture. It compares
  actual authority-specific source identities, score, match type, rank and
  label across SUBSTRING, FULL_TEXT and TRIGRAM queries; it also covers equal
  score/source-ID tie-break, reversed repository input order and PostgreSQL
  cursor mismatch.
- Preserved non-ready semantics: Canonical results are not synthesized when
  Search Projection is not READY, while visible Compiled Truth status is
  returned as partial and never promoted to READY.
- Added contract coverage for all authorities, lineage, pagination, typed
  filters, non-ready/stale projection behavior, caller sensitivity and cursor
  negative cases. Existing Stage 7 cited-search and Query compatibility tests
  remain green.

## Lineage and security rules

Canonical `resourceId`/`resourceRevision` come from the existing
`TransformationRevision.sourceId`/`revisionId`; the source also retains the
Canonical claim/revision, commit, manifest/change-set, SourceVersion and
Evidence IDs. Approved Knowledge uses the persisted group ID/revision and
candidate/SourceVersion/Evidence IDs. Compiled Truth uses the actual logical
projection digest, compiled item ID, canonical version, source snapshot digest
and Evidence IDs. Derived Inference uses its persisted candidate ID and actual
source projection digest; no identity is synthesized.

Missing evidence, mismatched Project/revision/source identity, inaccessible
scope, insufficient sensitivity or uncorrelated Derived Inference data is
excluded or fails closed. No browser-supplied authority field is accepted by
the frozen strict request decoder.

## Verification results

| Check                                              | Result                       | Evidence                                                                                                                                                      |
| -------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                            | PASS                         | Implementation subject head `e9ab04d0dba3f4019ef27779d93f4be2a97a9c77`.                                                                                       |
| `npm.cmd run lint`                                 | PASS                         | Implementation subject head; repository lint completed without errors.                                                                                        |
| `npm.cmd run test:contract`                        | PASS                         | 29 files / 230 tests, including 7 QX-01 handler tests at `eec1cd6`.                                                                                           |
| Focused QX-01 contract                             | PASS                         | 1 file / 7 tests: shared scoring, opaque request-bound cursor including offset >100, code-point ordering and Derived graph/evidence correlation.              |
| `npm.cmd run test:unit`                            | PASS                         | 39 files / 211 tests at `eec1cd6`.                                                                                                                            |
| `npm.cmd run test:integration`                     | PASS                         | 15 files / 53 tests at `eec1cd6`, executed sequentially after a resource-contention timeout in a prior parallel run.                                          |
| `npm.cmd run test:database`                        | PASS                         | 23 files / 103 PostgreSQL tests at `eec1cd6`, `.env` database, maxWorkers=1; includes QX-01.2 PostgreSQL handler parity.                                      |
| `npm.cmd run test:architecture`                    | PASS                         | Architecture boundaries verified.                                                                                                                             |
| Documentation and Frontend governance gates        | PASS                         | Existing governance checks passed before this evidence amendment; the same checks are rerun after the documentation patch.                                    |
| Changed-file Prettier and `git diff --check`       | PASS                         | QX-01.2 code/test files formatted; no whitespace errors.                                                                                                      |
| `npm.cmd run format:check`                         | FAIL / pre-existing baseline | 58 repository files remain outside the QX-01.2 changed-file set; no QX-01.2 code/test file appears in the mismatch list. No unrelated formatting was changed. |
| Exact-head GitHub Actions #393 / run `30727376455` | PASS                         | Subject commit `eec1cd6...`; Frontend, Quality including Database, and Required Gates all succeeded.                                                          |
| Exact-head GitHub Actions #394 / run `30727558866` | PASS                         | Final evidence head `ed40a93f...`; Frontend including E2E, Quality including Database, and Required Gates all succeeded.                                      |

## OSS, migration and rollback

`NO_RELEVANT_OSS`: this slice reuses the repository's already reviewed Shotgun
Stage 7/9/10 contracts and does not adopt or extract an external runtime. The
previously reviewed `gbrain`, `llmwiki`, `llm-wiki` and Inkeep OpenKnowledge
references remain design/reference inputs only; no new OSS version, license,
lockfile or runtime dependency is introduced by QX-01.

No database migration or data backfill is required. A bounded rollback is a Git
revert of `eec1cd61008029f01b58953f9713d0507710bae3`, followed by
`e9ab04d0dba3f4019ef27779d93f4be2a97a9c77`,
`b9587d4bf5509e2836c95db706e024b08dd9e9f0` and
`1f73c5705010bdf321391fbdcec780e38d02510c`; the prior QX-P0/QX-02 contracts
remain separately recorded.

## Current control state

```text
FE-P3-S1                         IN PROGRESS
QX-P0.1                         PASS
QX-02.1                         PASS
QX-01.1 correction              AUTHORIZED / IMPLEMENTED
QX-01.2 correction              AUTHORIZED / IMPLEMENTED / PASS (4836523482)
QX-01 Stage 7 Handler           PASS (4836523482)
Persistent Knowledge Adapter    BLOCKED / NOT AUTHORIZED
A3 API/Client/Cache             NOT AUTHORIZED
/knowledge UI                   NOT AUTHORIZED
PR #53                          OPEN / DRAFT
Ready / Merge                   NOT AUTHORIZED
FE-P3-S1 completion             NOT AUTHORIZED
DB Migration                    NONE
Runtime Dependency              NONE
Deployment                      NOT STARTED
```

This is implementation and verification evidence with the side-panel
QX-01.2 PASS judgment recorded as review `4836523482`. It is not an
FE-P3-S1 completion record. The PASS does not authorize the Persistent
Knowledge Adapter, A3 API/Client/Cache, `/knowledge` UI, Ready, Merge,
deployment or FE-P3-S1 completion.
