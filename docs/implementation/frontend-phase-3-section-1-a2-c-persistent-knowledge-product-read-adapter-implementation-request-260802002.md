---
id: FRONTEND-PHASE-3-SECTION-1-A2-C-PERSISTENT-KNOWLEDGE-PRODUCT-READ-ADAPTER-IMPLEMENTATION-REQUEST-260802002
classification: IMPLEMENTATION_REQUEST
status: PENDING_REVIEW
work_item: FE-P3-S1
sub_slice: A2-C
approved_by: null
approved_at: null
review_id: 4836723439
review_decision: APPROVED_FOR_A2_C_CONTRACT_AMENDMENT
implementation_authorization: NOT_GRANTED
follow_up: docs/implementation/frontend-phase-3-section-1-a2-c-product-contract-amendment-and-identity-addendum-260802003.md
accepted_contract: docs/implementation/frontend-phase-3-section-1-a2-c-product-contract-amendment-and-identity-addendum-260802003.md
next_decision: APPROVED_FOR_A2_C_PERSISTENT_ADAPTER
base_commit: ec409b16190f72199556c2c1e01dae513a2387ca
branch: codex/frontend-phase-3-section-1-knowledge-workspace
tracking_issue: 52
tracking_pr: 53
supersedes: docs/engineering/frontend-phase-3-section-1-a2-c-query-to-product-mapping-260802001.md
---

# FE-P3-S1 A2-C Persistent Knowledge Product Read Adapter

## 1. Decision state

This is an implementation-scope and approval request. It is not an approval
record and it does not authorize code changes yet.

The side-panel review confirms that QX-01 `SearchKnowledgeWorkspace` and QX-02
`GetCompiledTruthReadSnapshot` are PASS and available for reuse:

- QX-01 final PASS: side-panel review `4836523482`; follow-up confirmation
  `4836574882`; exact-head CI `30727558866` passed.
- QX-02: accepted ADR-125 review `4835947919`, limited hardening review
  `4836032427`, and exact-head database/CI evidence recorded in the QX-02
  verification report.

Those judgments close the bounded Query-extension blocker. They do not approve
the Persistent Product Adapter, Product API, browser client/cache, `/knowledge`
UI, Ready transition, Merge, deployment, or Phase 3 completion.

The requested decision is therefore:

> Approve or reject the bounded A2-C implementation described in this document.

### 1.1 Review outcome and follow-up

Side-panel review `4836723439` first returned `CHANGES_REQUIRED`. The follow-up
review accepted the bounded Product contract amendment as
`APPROVED_FOR_A2_C_CONTRACT_AMENDMENT`, based on the contract content submitted
in the review message. It did not independently verify the local amendment file
or local commit because those were not available through the connected review
surface. Implementation authorization remains `NOT_GRANTED`.

The bounded follow-up is documented in
`docs/implementation/frontend-phase-3-section-1-a2-c-product-contract-amendment-and-identity-addendum-260802003.md`.
The original approval-request base is `ec409b16190f72199556c2c1e01dae513a2387ca`;
the approval-request subject is `18f48c4504d1510ad310cd85c00a0a3503ac65e6`.
The next requested decision is a separate
`APPROVED_FOR_A2_C_PERSISTENT_ADAPTER` implementation authorization. Until
that decision is explicit, no Product Search `1.1.0` code, adapter code, API,
client/cache, or UI implementation files are to be created.

### 1.2 Accepted contract and implementation boundary

The accepted amendment fixes these implementation inputs:

- Search Product response `1.1.0` preserves QX-01 `canonicalSearch`,
  `sourceProjections[]`, and `partial`; the existing `1.0.0` decoder remains
  strict and a separate `1.1.0` decoder/schema/negative-test path is required.
- `pageId`, `productId`, and `matchId` use the approved namespaced stable JSON
  SHA-256 rules over complete authority-specific source tuples. Missing source
  identity fails closed; no UUID, array position, counter, timestamp,
  placeholder, fallback, or Product identity storage is allowed.
- Compare is a deterministic, read-only Product projection over both pages
  fetched through the same server-authoritative Query path, with the approved
  field set, JSON Pointer paths, value serialization, ordering, and
  `differenceId` rules. It emits no Domain Fact, Command, Event, write
  proposal, Canonical mutation, or cross-authority identity.

The implementation decision requested next covers only the accepted Product
contract code, the persistent adapter for the existing five-method Product
Port, its contract/negative/integration/database tests, and the validation
evidence listed in Sections 3-5. It does not authorize API/client/cache/UI,
migrations, dependencies, Ready, Merge, deployment, or Phase 3 completion.

## 2. Baseline and governing records

| Item                                       | Value                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Base branch                                | `main`                                                                                                                   |
| Base commit                                | `cb2513bc311891ac89f53c7d67d6a401da65a2a8`                                                                               |
| Working branch                             | `codex/frontend-phase-3-section-1-knowledge-workspace`                                                                   |
| Preparation head                           | `ec409b16190f72199556c2c1e01dae513a2387ca`                                                                               |
| Tracking issue                             | [#52](https://github.com/JasonCutter/shotgun/issues/52)                                                                  |
| Draft PR                                   | [#53](https://github.com/JasonCutter/shotgun/pull/53)                                                                    |
| Existing Product Port                      | `modules/frontend-product-read/src/index.ts`                                                                             |
| Existing In-memory contract implementation | `adapters/frontend-product-read-in-memory/src/index.ts`                                                                  |
| Governing architecture                     | `docs/architecture/frontend/phase-3-knowledge-understanding-editing.md`                                                  |
| Governing decision                         | `docs/architecture/adr/ADR-125-knowledge-workspace-multi-authority-search-and-non-ready-compiled-truth-read-boundary.md` |
| Prior mapping                              | `docs/engineering/frontend-phase-3-section-1-a2-c-query-to-product-mapping-260802001.md`                                 |

The initial A2-C mapping is retained as the evidence of the former
QX-01/QX-02 gap. This request supersedes only its current decision state; it
does not widen the Product contract or authorize the later slices.

## 3. Proposed implementation scope

Implement one persistent, server-authoritative adapter for the existing
`KnowledgeWorkspaceProjectionPort`:

1. `getWorkspace`
2. `listPages`
3. `search`
4. `getDetail`
5. `compare`

The proposed adapter location is
`adapters/frontend-product-read-postgres/src/index.ts`, parallel to the
existing In-memory adapter. The final path may change only if the review
decision records the replacement location; no second Product Port is to be
introduced.

The adapter will:

- receive the server-authorized `FrontendReadScope` and active Project;
- dispatch versioned Query envelopes through the existing
  `ShotgunKernel.connector`/Connector Runtime boundary;
- reuse Stage 6 Canonical, Stage 7 Search, Stage 9 Knowledge Model, Stage 10
  Compiled Truth/Discovery, Transformation, and Evidence Query handlers;
- use QX-01 for multi-authority, pre-ranked workspace search;
- use QX-02 for the persisted Compiled Truth segment plus its authoritative
  readiness status, including `STALE`, `DEGRADED`, and `NOT_BUILT`;
- map only source-owned values into the existing strict Product decoders;
- preserve principal, session, active Project, access revision, policy revision,
  authority, resource identity, revision, lineage, evidence and projection
  status without reinterpretation; and
- return typed fail-closed results when the requested resource is unavailable,
  outside the authorized scope, or cannot be proven from an existing Query.

No direct PostgreSQL call is part of the adapter. PostgreSQL persistence is
exercised by registering the existing Stage adapters and invoking their Query
handlers through the Kernel Connector. A narrow adapter-local query executor
may be used only as an injection seam for the existing Connector Runtime; it
must not become a new domain repository Port or a second persistence contract.

## 4. Query-to-Product boundary

The following Query ownership is fixed for implementation review:

| Product operation               | Authoritative Query boundary                                                                                                | Required rule                                                                                                                                                                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace/list pages            | Existing Stage 6/7/9/10 read Queries, including QX-02 for Compiled Truth status/segment                                     | Compose source results; do not persist Product rows or fabricate page identities.                                                                                                                                                                                            |
| Search                          | QX-01 `SearchKnowledgeWorkspace@1.0.0`                                                                                      | Use server score, rank, match type, authority, source identity and readiness exactly; map the accepted readiness shape into Product Search `1.1.0` with the strict versioned decoder and compatibility alias; no local ranking or concatenation of independent result lists. |
| Canonical detail                | Existing Stage 6 Canonical Query plus existing History/Commit, Transformation and Evidence Queries where lineage is present | Missing lineage remains absent; no claim, revision, commit, manifest, ChangeSet, source or evidence identity is inferred.                                                                                                                                                    |
| Approved Knowledge detail       | Existing Stage 9 Knowledge Model and Evidence Queries                                                                       | Only `APPROVED` source groups map to `APPROVED_KNOWLEDGE`; candidate/group identities remain source-owned.                                                                                                                                                                   |
| Compiled Truth detail/readiness | QX-02 `GetCompiledTruthReadSnapshot@1.0.0` and existing Stage 10 status boundary                                            | Non-ready status remains visible; non-ready data is never promoted to Canonical or Approved Knowledge.                                                                                                                                                                       |
| Derived detail                  | Existing Stage 10 `ListDerivedInferences`/source projection identity                                                        | Derived inference remains `DERIVED_INFERENCE`; no Canonical or Approved Knowledge identity is synthesized.                                                                                                                                                                   |
| Compare                         | The same persistent read path for both requested pages                                                                      | Compare is read-only and must preserve left/right request order, revision and project identity.                                                                                                                                                                              |

The Product coordinator remains the final response boundary. The adapter must
not bypass `FrontendProductReadCoordinator` decoders or weaken its checks for
Project, access revision, policy revision, query echo, detail identity, compare
ordering, or `CANONICAL_SEARCH` projection kind. The amended Search `1.1.0`
decoder must additionally enforce readiness alias equality, source-projection
preservation, partial-state visibility, and strict unknown-field rejection.

## 5. Required validation before any completion claim

Implementation may be considered for review only after all applicable checks
have evidence. A local pass cannot substitute for exact-head remote CI.

### Contract and negative tests

- Add and validate the accepted Search Product `1.1.0` schema and strict
  decoder without weakening the existing `1.0.0` decoder.
- Verify QX-01 readiness mapping for all four states, zero/one source
  projections, optional digests/reasons, `partial: true` with empty matches,
  non-ready source projections, unknown fields, and alias equality.
- Verify the approved page/product/match identity tuples, namespaces,
  Project/resource/revision binding, collision failure, source-ID separation,
  and rejection of UUID/index/counter/random/timestamp/storage identities.
- Verify the approved Compare field set, JSON Pointer escaping, stable value
  serialization, deterministic ordering, one-sided values, reversed sides,
  difference IDs, and absence of write/domain capabilities.
- Run the unchanged `defineFrontendKnowledgeProjectionContract` suite against
  both the existing In-memory adapter and the new persistent adapter.
- Verify all five Product Port methods, cursor/page-size behavior, filters,
  requested revision, focus identity, immutability and strict unknown-field
  rejection.
- Verify the same Project, principal/session, access revision, policy revision
  and sensitivity context reaches every Query.
- Verify mismatched Project/access/sensitivity requests fail closed and do not
  disclose a resource through a detail or compare path.
- Verify missing and non-ready projections preserve typed status and reason;
  no fallback to In-memory seed data is permitted.
- Verify lineage, evidence targets, source versions, commits, manifests,
  ChangeSets, projection IDs and canonical IDs are never fabricated.
- Verify search ordering/score/match type comes only from QX-01 and that a
  second local ranking implementation does not exist.

### PostgreSQL and integration tests

- Execute the adapter against the repository's PostgreSQL test path at
  `localhost:5432/shotgun` with the existing Stage 6/7/9/10 adapters.
- Exercise an empty Project, Canonical-only data, approved Knowledge data,
  non-ready Compiled Truth, Derived Inference data, stale/degraded readiness,
  inaccessible resources and two-page comparison.
- Assert that the adapter issues only registered Query messages and does not
  issue SQL or write to any database table.
- Run typecheck, lint, changed-file formatting, focused unit/contract/
  integration/database tests, architecture tests, documentation governance,
  `git diff --check`, and the required repository checks.
- Publish the implementation head to the existing Draft PR and wait for
  exact-head Quality, Frontend and Required Gates before any readiness or merge
  decision.

The implementation report must separate local validation, remote CI, review
approval, merge and production/deployment evidence. A missing script or
unexecuted gate is `NOT_IMPLEMENTED` or `NOT_RUN`, not PASS.

## 6. OSS, migration and replacement boundary

The four previously reviewed references remain `REFERENCE_ONLY` for A2-C:

- [garrytan/gbrain](https://github.com/garrytan/gbrain) — Query/Graph pattern
  reference; no runtime or database reuse.
- [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki) — no
  conversion or Evidence component is needed in this read adapter.
- [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki) — UX pattern only;
  it cannot replace server Query authority.
- [Inkeep OpenKnowledge](https://github.com/inkeep/open-knowledge) — UI/Graph
  pattern only; no runtime, Git, Markdown/Yjs or search engine reuse.

Therefore this slice authorizes no new runtime dependency, lockfile change,
database schema, migration, seed, persistent Product table, cache, background
job, or external service. Rollback is removal of the adapter wiring and its
tests; existing Stage Query handlers and the In-memory adapter remain intact.
Adapter replacement is proven by running the unchanged shared Product Port
contract suite against the In-memory implementation after persistent-adapter
changes.

## 7. Explicit exclusions and control state

The following remain outside this request and unauthorized:

- Product HTTP/API routes or versioned API clients;
- browser cache, optimistic state or client-side authority headers;
- `/knowledge` UI, route replacement, deep-link UI or Chromium E2E;
- `FE-P3-S2` Knowledge Editor and `FE-P3-S3` Semantic Graph Canvas;
- Canonical writes, DraftChangeSet, Approval, Commit, Graph mutation or Action;
- new repository Ports, direct SQL, local ranking, synthetic IDs or Product
  result storage;
- PR Ready transition, Merge, deployment, production verification and
  FE-P3-S1 completion.

Current control:

```text
FE-P3-S1                         IN PROGRESS
QX-01 Stage 7 Handler            PASS / reviewed
QX-02 Stage 10 Handler           PASS / reviewed
A2-C Contract Amendment           APPROVED / review 4836723439
A2-C Persistent Adapter          PENDING EXPLICIT IMPLEMENTATION APPROVAL
Product Search 1.1.0 Code        NOT AUTHORIZED
A3 API/Client/Cache              NOT AUTHORIZED
/knowledge UI                    NOT AUTHORIZED
PR #53                           OPEN / DRAFT
Ready / Merge                    NOT AUTHORIZED
DB Migration                     NOT AUTHORIZED
Runtime Dependency               NOT AUTHORIZED
Deployment                       NOT STARTED
```

## 8. Approval requested

Please issue one of the following decisions in the review thread:

- `APPROVED_FOR_A2_C_PERSISTENT_ADAPTER`: authorize only the accepted Product
  contract implementation, the bounded adapter in Sections 3-4, and the
  applicable validation in Section 5,
  subject to the validation and control boundaries in this document; or
- `CHANGES_REQUIRED`: identify the required scope or contract correction;
  implementation remains stopped until the correction is reviewed.

No code implementation, API/UI work, PR Ready transition, or Merge is
authorized by the existence of this request alone.
