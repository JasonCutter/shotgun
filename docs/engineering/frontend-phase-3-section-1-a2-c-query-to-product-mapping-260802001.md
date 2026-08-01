---
id: FRONTEND-PHASE-3-SECTION-1-A2-C-QUERY-TO-PRODUCT-MAPPING-260802001
classification: ENGINEERING_MAPPING
status: BLOCKED_ON_BOUNDED_QUERY_EXTENSION
work_item: FE-P3-S1
sub_slice: A2-C
authorization: PR-53-COMMENT-5153411017
base_commit: cb2513bc311891ac89f53c7d67d6a401da65a2a8
branch: codex/frontend-phase-3-section-1-knowledge-workspace
---

# FE-P3-S1 A2-C Query-to-Product Mapping

## 1. 조사 범위와 판정

이 문서는 A2-C Persistent Adapter 구현 전에 실제 Stage 6·7·9·10 Query
handler의 파일·handler·return type과 Knowledge Product field의 연결을
고정한다. Product Adapter는 Query 경계만 사용해야 하며 PostgreSQL, SQL,
Domain Repository 또는 내부 row type에 직접 의존하지 않는다.

현재 판정은 `BLOCKED_ON_BOUNDED_QUERY_EXTENSION`이다. 다음 두 경계를 기존
Query를 조합하는 것만으로는 충족할 수 없다.

1. `SearchCanonicalKnowledge`는 `CANONICAL` Claim 검색만 반환한다. A2-C
   shared contract가 요구하는 `APPROVED_KNOWLEDGE`, `COMPILED_TRUTH`,
   `DERIVED_INFERENCE` 검색 match의 server score·match type·pre-ranked order를
   제공하지 않는다.
2. `GetCompiledTruth`는 Compiled Truth status가 `READY`가 아니면
   `NOT_FOUND`를 반환한다. 따라서 `STALE`, `DEGRADED`, `NOT_BUILT` 상태에서
   마지막 Compiled Truth 또는 해당 상태의 typed item을 보존할 수 없다.

이 두 값은 Adapter에서 local ranking, synthetic projection, stale-result
재구성으로 만들 수 없다. A2-C 지시의 fail-closed 규칙에 따라 Query extension
후보를 보고하고 구현을 중지한다.

## 2. 실제 Query 표면

| 영역                    | 실제 handler               | 파일                                       | return type                                                                    | Product에 제공하는 값                                                                                                     |
| ----------------------- | -------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Stage 6 Canonical | `GetCanonicalSnapshot` | `modules/canonical-knowledge/src/index.ts` | `CanonicalSnapshot` | `projectId`, `version`, `digest`, claim의 `claimId`, `text`, `revisionNumber`, `evidenceIds` |
| Stage 6 Canonical | `GetCanonicalClaim` | `modules/canonical-knowledge/src/index.ts` | `CanonicalClaim` | `claimId`, `projectId`, `claimText`, `sourceVersionId`, `evidenceIds`, `createdFromManifestId`, access scope, sensitivity |
| Stage 6 Canonical | `ListCanonicalHistory` | `modules/canonical-knowledge/src/index.ts` | `{ items: CanonicalHistoryEvent[] }` | claim별 `commitId`, `manifestId`, `changeSetId`, versions, history event, actor, time |
| Stage 6 Canonical | `GetCanonicalCommit` | `modules/canonical-knowledge/src/index.ts` | `CanonicalCommitResult` | `revisionId`, commit/manifest/change-set IDs, canonical versions, snapshot digest, commit time |
| Stage 7 Search | `SearchCanonicalKnowledge` | `modules/projection-search/src/index.ts` | `CanonicalSearchResponse` | query, Canonical search item의 score·match type·claim/revision/commit/sourceVersion/evidence, Search readiness |
| Stage 7 Search | `GetProjectionReadiness` | `modules/projection-search/src/index.ts` | `ProjectionReadiness` | Search status, canonical/projected version, lag, digest, last commit, reason, updatedAt |
| Stage 9 Knowledge Model | `GetKnowledgeGroup` | `modules/knowledge-model/src/index.ts` | `{ group: KnowledgeReviewGroup; modelDisagreements: ModelDisagreementView[] }` | typed approved-group identity, revision, sourceVersion, candidate item, evidence, access/sensitivity |
| Stage 9 Knowledge Model | `ListKnowledgeGroups` | `modules/knowledge-model/src/index.ts` | `{ items: KnowledgeReviewGroup[] }` | access-filtered review groups and typed candidate items |
| Stage 9 Knowledge Model | `GetKnowledgeImpact` | `modules/knowledge-model/src/index.ts` | `KnowledgeImpactResult` | approved typed edge impact paths; no current Product field consumes this in A2-C |
| Stage 9 Knowledge Model | `GetKnowledgeGraph` | `modules/knowledge-model/src/index.ts` | `KnowledgeGraphView` | approved typed nodes/edges and list/table fallback; graph UI is outside A2-C |
| Stage 10 Compiled Truth | `GetCompiledTruth` | `modules/compiled-truth/src/index.ts` | `CompiledTruthProjection` | typed compiled item IDs, labels, temporal state, evidence IDs, canonical version, projection digest and graph |
| Stage 10 Compiled Truth | `GetCompiledTruthStatus` | `modules/compiled-truth/src/index.ts` | `CompiledTruthProjectionStatus` | `NOT_BUILT`/`READY`/`STALE`/`DEGRADED`, versions, lag, digest, error, updatedAt |
| Stage 10 Discovery | `ListDerivedInferences` | `modules/compiled-truth/src/index.ts` | `{ items: DerivedInferenceCandidate[] }` | derived candidate ID, question, related node IDs, evidence IDs, source projection digest, reentry phase, createdAt |

Supporting source/evidence Queries are already available and remain Query-only:

| Supporting value                                 | Query                 | File                                  | return type                                               |
| ------------------------------------------------ | --------------------- | ------------------------------------- | --------------------------------------------------------- |
| `sourceId` and transformation revision authority | `GetDocumentRevision` | `modules/transformation/src/index.ts` | `TransformationRevision` / `get-document-revision-output` |
| Evidence span identity and source-version check | `GetEvidenceSpan` | `modules/evidence/src/index.ts` | `EvidenceSpan` |

## 3. Product field mapping within the available boundary

### Scope and authority

`FrontendReadScope` is supplied by the server-authorized caller of
`KnowledgeWorkspaceProjectionPort`. `principalId`, `sessionId`, active Project ID,
`accessRevision`, and `policyContextRevision` are copied exactly into Product
responses. Every Query envelope must use the same non-null active Project,
principal-derived actor, security access scope, and sensitivity. A project or
access-scope mismatch is `NOT_FOUND`; no browser header or client-selected Project
is accepted as authority.

### Canonical item

- `authority` is the explicit `CANONICAL` Product classification of the Stage 6
  Query result.
- `kind` is `CLAIM`; `label`/`content` come from `CanonicalClaim.claimText` (or
  `CanonicalSnapshotClaim.text` for snapshot listing).
- `lineage.canonicalResourceId` is `CanonicalClaim.claimId`.
- `lineage.sourceVersionId` and `lineage.evidenceIds` come from
  `CanonicalClaim.sourceVersionId` and `CanonicalClaim.evidenceIds`.
- `lineage.sourceId` is present only when the existing
  `GetDocumentRevision` result for that source version supplies it.
- `lineage.canonicalRevisionId` comes from `CanonicalCommitResult.revisionId`,
  reached through the matching `CanonicalHistoryEvent.commitId`; it is not
  generated from a claim ID or array position.
- `lineage.commitId`, `manifestId`, and `changeSetId` come from the matching
  history/commit Query result. Absent values remain absent.
- `lineage.canonicalVersion` comes from the matching snapshot/search/commit
  version. Evidence targets may be returned only when source, source version, and
  evidence identity are all available; no target is fabricated.

### Approved Knowledge item

- `authority` is `APPROVED_KNOWLEDGE` only for a `KnowledgeReviewGroup` whose
  Query result has `status: APPROVED`.
- Candidate `candidateId`, `candidateType`, `sourceVersionId`, `evidenceIds`,
  and the type-specific label (`name`, `relationType`, `title`, `decisionText`,
  `actionText`, `summary`, or `question`) remain source-owned.
- Group ID and group revision number are the only available group resource
  identity/version. No Canonical ID, commit, manifest, or ChangeSet is inferred
  for an approved Knowledge item.
- `GetKnowledgeImpact`/`GetKnowledgeGraph` are recorded but not consumed by the
  A2-C read contract; graph/impact Product fields belong to the later graph slice.

### Compiled Truth item

- `authority` is `COMPILED_TRUTH`; `kind`, `label`, `temporalState`, and
  `evidenceIds` come from `CompiledTruthItem.type`, `.label`, `.state`, and
  `.evidenceIds`.
- `lineage.projection` is built only from `GetCompiledTruthStatus` and is always
  `projectionKind: COMPILED_TRUTH`. Status, canonical/projected versions, lag,
  error reason, logical digest, and updatedAt are preserved.
- `CompiledTruthItem.id` remains a Product resource identity candidate, but it is
  never promoted to a Canonical resource ID. `source` determines whether the
  item originated from a Canonical claim or approved Knowledge; it does not change
  the Product authority.
- `canonicalResourceId`, source, commit, manifest, ChangeSet, and Evidence fields
  remain absent when `CompiledTruthItem` does not provide them.

### Derived Inference item

- `authority` is `DERIVED_INFERENCE`, `kind` is `KNOWLEDGE_GAP`, and the label or
  content comes from `question`.
- `candidateId`, `relatedNodeIds`, `evidenceIds`, `createdAt`, and
  `reentryPhase` remain derived-source data.
- `sourceProjectionDigest` is the only available source projection identity; it
  may be used only as an explicitly named projection identity if the Product
  contract accepts that meaning. It is never a Canonical ID or approved item ID.
- No Canonical resource, revision, source version, commit, manifest, ChangeSet,
  or Evidence target is inferred from a derived candidate.

### Search and readiness

- Canonical search maps `CanonicalSearchResponse.items` to search matches. Score
  and `matchType` come only from Stage 7; Search readiness is only
  `projectionKind: CANONICAL_SEARCH`.
- Compiled Truth readiness maps only `CompiledTruthProjectionStatus`; it is never
  marked `READY` when source status is `STALE`, `DEGRADED`, or `NOT_BUILT`.
- Canonical results must remain available when a projection is degraded or not
  built; a projection failure cannot overwrite or hide Canonical data.

## 4. Bounded Query extension candidates

These are proposals for ChatGPT review, not implemented in A2-C:

### QX-01 — Product-facing multi-authority Search Query

Add a versioned server Query (preferably under the existing Stage 7 projection
boundary) that returns pre-ranked Product-search source records for Canonical,
approved Knowledge, Compiled Truth, and Derived Inference. The output must carry
the exact score, match type, authority, source identity, and readiness needed by
the Product contract. It must apply Project, sensitivity, and access-scope
filtering before returning data. The Adapter must not concatenate four independent
queries and invent ranking locally.

### QX-02 — Non-ready Compiled Truth read Query

Add a versioned read Query that returns the last persisted Compiled Truth segment,
when present, together with the authoritative
`CompiledTruthProjectionStatus`, including `STALE`, `DEGRADED`, and `NOT_BUILT`.
The Query must preserve the current fail-closed write/build behavior and must not
promote a non-ready projection to Canonical or Approved Knowledge. A missing
projection may remain absent; the status must remain visible.

Both candidates require their own contract/security/database tests and explicit
review before the Persistent Adapter can claim A2-C parity. No SQL, PostgreSQL
repository, local ranking, pre-stored Product result, or wrapper around the
existing InMemory Product Adapter is an acceptable substitute.

## 5. OSS Integration decision for this slice

The Adapter is a Shotgun Query-to-Product boundary, not a new Knowledge/Search/
Graph engine. Existing OSS decisions remain in force:

| Candidate                                                         | Baseline                                   | License          | A2-C decision    | Reason                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------ | ---------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| [garrytan/gbrain](https://github.com/garrytan/gbrain) | `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` | MIT | `REFERENCE_ONLY` | Query/Graph concepts are reference material; its runtime/DB is not a Shotgun Product source. |
| [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki) | `ad626a3d81be1480e35ef4e94234de8dbb27a61e` | Apache-2.0 | `REFERENCE_ONLY` | No conversion, Evidence, or watcher component is needed in this read Adapter. |
| [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki) | `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` | MIT | `REFERENCE_ONLY` | Product workflow patterns do not replace server Query authority. |
| [Inkeep OpenKnowledge](https://github.com/inkeep/open-knowledge) | `f2834c237639e2cff603817ed88182b33f83cf91` | GPL-3.0-or-later | `REFERENCE_ONLY` | UI/Graph patterns only; no runtime, Markdown/Yjs, or search engine is imported. |

No new dependency, lockfile change, migration, or OSS runtime is authorized by
this mapping.

## 6. Required next decision

Pause A2-C implementation and submit QX-01/QX-02 to the ChatGPT review thread.
After an explicit bounded Query-extension approval, re-run this mapping against
the approved Query contracts, implement only the Persistent Adapter, and execute
the unchanged shared contract suite against actual In-Memory and Persistent Query
fixtures.

Current control remains:

```text
A2-B                     PASS
A2-C Persistent Adapter  BLOCKED_ON_BOUNDED_QUERY_EXTENSION
QX-01/QX-02              NOT AUTHORIZED
A3 API/Client/Cache      NOT AUTHORIZED
/knowledge UI            NOT AUTHORIZED
PR #53                   OPEN / DRAFT
Ready / Merge            NOT AUTHORIZED
DB Migration             NONE
Runtime Dependency       NONE
Deployment               NOT STARTED
```
