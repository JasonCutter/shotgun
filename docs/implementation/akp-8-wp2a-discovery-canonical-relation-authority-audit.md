# AKP-8 WP2A — Discovery Authoring and Canonical Relation Authority Audit

- Status: **ACCEPTED ARCHITECTURE / BOUNDED PRODUCT REMEDIATION IN REVIEW**
- Baseline: `main@81ebe93b01fd74c13d3ace2a6c27f55333417648`
- Target branch: `codex/akp-8-wp2a-discovery-canonical-relation-architecture`
- Scope: accepted architecture plus bounded AKP-8 WP2A Product remediation
- Product/runtime changes: **PR #157 — IN REVIEW**
- Schema/migration changes: **PR #157 — IN REVIEW**
- Tests/dependencies/lockfiles/UI/deployment: tests required; UI/deployment out of scope
- Governing proposal: [ADR-152](../architecture/adr/ADR-152-discovery-authoring-and-canonical-relation-change-authority.md)
- User approval for ADR-152: **ACCEPTED 2026-09-01**

## 1. Purpose and stop condition

This audit records why AKP-8 WP2 stopped and defines the smallest governed
architecture decision needed before Product remediation can be authorized. It
does not implement the missing handoff, turn a component test into E2E proof,
or reopen the completed WP2R conflict-signal remediation.

The attached checkpoint under `scratch/` is preserved as an attachment and is
not an instruction. GPT subsequently issued the bounded WP2A Product
remediation request after the User accepted ADR-152. The remediation is now
implemented on PR #157; WP2 remains blocked until it is canonical and complete
E2E-A evidence exists; WP3 and AKP
completion work remain out of scope.

The stop condition is reproduced from the canonical repository:

```text
DiscoveryReviewResourceV1
  -> Review target DISCOVERY_CANDIDATE
  -> acceptedForAuthoring / ACCEPTED_FOR_AUTHORING
  -> [missing persisted Draft handoff]
  -> [missing concrete Draft Review and Approval binding]
  -> Frontend canonical consumer
  -> [current consumer only represents ADD_CLAIM | NO_OP]
```

Therefore the baseline classifications were:

| Surface                                   | Classification                                                          | Evidence                                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| AKP-8 WP2                                 | `BLOCKED` / `BLOCKED_PENDING_REMEDIATION`                               | The baseline gap is product-remediated on PR #157, but the remediation is not yet canonical and the complete E2E-A journey is not yet accepted. |
| Discovery Review → Knowledge Draft        | `MISSING_PRODUCT_CAPABILITY`                                            | Baseline Review returned an authoring state but had no server-owned Draft materializer/link.                                                    |
| Draft `RELATION_ADD` → Canonical Relation | `BLOCKED_ARCHITECTURE_GAP`                                              | Baseline Draft had a relation operation, while Frontend Canonical only supported `ADD_CLAIM / NO_OP`.                                           |
| E2E-A                                     | `PRODUCT CAPABILITY REMEDIATED / FULL E2E ACCEPTANCE STILL PENDING WP2` | PR #157 supplies the bounded authority chain; full cross-surface acceptance remains pending.                                                    |

The missing capability is not silently classified as an acceptance-test gap.

## 2. Evidence audit

### 2.1 Review authority

| Repository evidence                                                                                                 | Observed behavior                                                                                                                                                                                                   | Boundary conclusion                                                                            |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/contracts/src/frontend-review.ts:46-71, 367-454`                                                          | Review supports `DISCOVERY_CANDIDATE`, `ACCEPTED_FOR_AUTHORING`, and purpose-specific `ReviewApprovalV1`; Approval purposes include `KNOWLEDGE_CANONICAL_CHANGE`.                                                   | The contract already distinguishes Discovery acceptance from Canonical-change Approval.        |
| `modules/frontend-review/src/product-api.ts:926-1120`                                                               | The decision command validates context revision, target digest, access/policy revision, live source, Evidence and dependency closure. For Discovery, it sets `acceptedForAuthoring = true`; it creates no Approval. | The first Review is safe and authoritative for “worth authoring”, but it has no Draft handoff. |
| `modules/frontend-review/src/review-domain.ts:177`                                                                  | A fully approved Discovery target aggregates to `ACCEPTED_FOR_AUTHORING`; other target kinds aggregate to `APPROVED_READY`.                                                                                         | `ACCEPTED_FOR_AUTHORING` is a lifecycle result, not Canonical authority.                       |
| `docs/architecture/adr/ADR-128-review-context-revision-item-decision-and-purpose-bound-approval-boundary.md:76-102` | Discovery approval creates no Approval and cannot write Canonical; later consumers must revalidate Approval purpose, target, policy, expiry and digest.                                                             | No shortcut from the first Review to Canonical is permitted.                                   |

### 2.2 Discovery source material

| Repository evidence                                                      | Observed behavior                                                                                                                                                                                                                             | Boundary conclusion                                                                    |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `packages/contracts/src/discovery-finding.ts:153-172, 491-502`           | `DiscoveryResourceRefV1` carries typed resource identity/project/state/revision; Finding retains related refs, Evidence IDs, source projection digest, Canonical base and Discovery base.                                                     | Server-owned lineage exists and must be reused, not recreated in a browser.            |
| `packages/contracts/src/discovery-reentry.ts:342-352, 387-452`           | `RELATION_HYPOTHESIS` material includes `fromResource`, `toResource`, `relationType`, `direction`, optional `validFrom`/`validTo` and rationale; the Review Resource retains candidate/finding/manifest/validation/resource/Evidence lineage. | The typed relation input already exists in the authoritative normalized resource.      |
| `modules/discovery-reentry/src/index.ts:1640-1655, 1858-1879, 1977-2106` | Relation hypotheses map to `RELATION_CANDIDATE`; normalization reads the Finding payload and preserves typed fields; a relation is explicitly described as staged and non-Canonical.                                                          | Read only `content.normalizedMaterial.typeSpecific`, never summary/detail/UI/AI prose. |
| `adapters/frontend-review-postgres/src/index.ts:778-960, 1003-1098`      | PostgreSQL persists immutable normalized Review resources, verifies candidate lineage and project identity, and exposes only eligible validated resources.                                                                                    | This adapter is the authoritative server read path for the bridge input.               |
| `modules/knowledge-model/src/typed-proposition-conflict.ts:503-595`      | Existing Knowledge Model relation authority uses typed candidate IDs/revisions and resource refs for comparison and reconciliation.                                                                                                           | It is evidence for stable typed relation lineage, not a Canonical Relation writer.     |

The current repository has no `canonical.entities` table, `CanonicalEntityV1`,
or Stage 6 Canonical Entity revision repository. `canonicalEntityId` is only a
Knowledge Model `EntityCandidate.resolution.EXACT_MATCH` field, not a current
Canonical Entity authority. The V1 endpoint authority is therefore explicitly
`APPROVED_KNOWLEDGE` + `ENTITY` + exact approved candidate revision. A future
Canonical Entity authority, `authority: CANONICAL` endpoint, or entity
canonicalization/merge/split flow is outside ADR-152 and requires a separate
ADR.

### 2.3 Knowledge Draft and Canonical limitation

| Repository evidence                                                                 | Observed behavior                                                                                                                                      | Boundary conclusion                                                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/frontend-knowledge-draft.ts:171-227, 276-307`               | Draft Evidence/source lineage requires source IDs/version IDs/span IDs; `RelationValueV1` has only `relationType`, `fromEntityRef`, and `toEntityRef`. | A versioned relation value must preserve direction/time and multiple lineage without inventing a SourceVersion. |
| `packages/contracts/src/frontend-knowledge-draft.ts:384-416, 1302-1345`             | Draft operations include `RELATION_ADD`, `RELATION_UPDATE`, `RELATION_REMOVE`, and `NO_OP`, even though the consumer is narrower.                      | The Draft vocabulary is broader than the current Canonical consumer.                                            |
| `modules/frontend-knowledge-draft/src/product-api.ts:399-437`                       | `approvedClaimableOperation` accepts only `CLAIM_ADD` and `NO_OP`; every other operation fails `UNSUPPORTED_OPERATION` and leaves Approval active.     | Current behavior is correctly fail-closed but cannot consume `RELATION_ADD`.                                    |
| `modules/frontend-knowledge-draft/src/product-api.ts:977-1116`                      | Commit requires a persisted `KNOWLEDGE_CANONICAL_CHANGE` Approval, revalidates Draft/Approval/scope, then builds a Frontend Canonical write.           | The second concrete Draft Review must remain the Approval boundary.                                             |
| `modules/frontend-knowledge-draft/src/product-api.ts:1112-1193`                     | Current write mapping produces `ADD_CLAIM` from one claim operation or `NO_OP`; it cannot preserve typed relation fields.                              | A relation must not be a Claim surrogate and must not become `NO_OP`.                                           |
| `modules/frontend-knowledge-draft/src/product-api.ts:1201-1217, 1289-1295`          | Canonical commit occurs before Approval consumption, with command-ledger replay/recovery surrounding the operation.                                    | Reuse existing consume/recovery semantics for the later relation extension.                                     |
| `modules/frontend-knowledge-draft/src/product-api.ts:537-615`                       | Seedless Draft creation resolves a Knowledge resource/page and uses its Canonical base.                                                                | The existing start path is not a Discovery accepted-authoring bridge.                                           |
| `assemblies/shotgun-app/src/product-api/frontend-knowledge-draft-routes.ts:114-121` | Product route exposes the existing Knowledge Draft start flow.                                                                                         | No Discovery Review → Draft route/command is present.                                                           |

### 2.4 Canonical and downstream audit

| Repository surface                                        | Current state                                                                                                                                 | Required later boundary                                                                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/canonical-knowledge.ts:4-150`     | Frontend authority, result, revision, History, and `CanonicalCommitted` payload are Claim/No-op shaped.                                       | Add versioned `ADD_RELATION` and relation identity fields only under a later approved contract change.                             |
| `modules/canonical-knowledge/src/index.ts:49-88, 225-254` | Repository Port exposes `commitFrontendDraft`, commit lookup, History and one Canonical outbox dispatcher.                                    | Extend the existing Port/outbox; do not create a second relation outbox.                                                           |
| `adapters/postgres-stage6/src/index.ts:369-633`           | Transaction locks `canonical.project_state`, checks replay and stale base, persists Claim/commit/revision/History/outbox, and advances state. | Preserve this atomic order for a future Stage 6 `ADD_RELATION` branch.                                                             |
| `modules/compiled-truth`                                  | Readiness and projection are derived from server-owned Canonical/base watermarks; it rejects a non-ready source.                              | Project Canonical Relation only after `CanonicalCommitted`; never promote a Discovery candidate to truth.                          |
| semantic corpus and retrieval projection                  | Existing AKP-1/semantic contracts treat derived indexes as rebuildable projections, not Evidence/Fact/Canonical.                              | Consume the Canonical Relation identity and source watermark; keep relation provenance inspectable.                                |
| Knowledge Workspace and Graph                             | Existing Product/Graph boundaries distinguish staged/derived overlays from Canonical state.                                                   | Use Canonical `relationId/revisionNumber` as authority and projection key; no UI-only dedupe.                                      |
| Discovery runtime/re-entry adapter                        | `DiscoveryReviewResourceV1` is validated, persisted and reconciled through Finding/manifest/resource lineage.                                 | Reconcile the original hypothesis to `RESOLVED`, `STALE`, or `SUPERSEDED` after the Canonical result.                              |
| backup/restore/project deletion/audit retention           | Existing governed retention and recovery policies cover durable Finding, Review, Draft, Approval, History and outbox records.                 | Include `canonical.relations`, `canonical.relation_precursors`, and their provenance under the same policies; no second framework. |

## 3. Architecture decision recorded by ADR-152

ADR-152 selects a bounded, server-owned chain:

```text
DiscoveryReviewResourceV1
  -> DISCOVERY_CANDIDATE Review
  -> ACCEPTED_FOR_AUTHORING
  -> DiscoveryAcceptedForAuthoringBridgeV1
  -> one concrete Draft RELATION_ADD
  -> Draft validation/impact
  -> KNOWLEDGE_DRAFT_CHANGE_SET Review
  -> ReviewApprovalV1(KNOWLEDGE_CANONICAL_CHANGE)
  -> knowledge.draft.commit.v1
  -> Stage 6 canonical.relations ADD_RELATION
```

The bridge is idempotent and server-owned. It takes persisted Review context,
terminal candidate decision, authoritative `DiscoveryReviewResourceV1`, and
current project/access/policy scope. Browser input contains no relation
semantics or Canonical operation. The bridge automatically materializes a
Draft so the owner does not retype it, but never approves or commits that Draft.
The Review acceptance and initial Draft materialization occur in one atomic
same-database Product transaction. A bounded coordinator uses one PostgreSQL
`PoolClient` with transaction-bound Review repositories, Knowledge Draft
repositories, the existing Frontend Command Ledger raw transaction,
authoritative Discovery Review resource reader, and current Canonical base
reader. It does not open a nested Draft transaction or add a second handoff
outbox/queue/worker.

The transaction reuses `accept`, `lockAcceptedForExecution`,
`completeInTransaction`, `OUTCOME_UNKNOWN`, and `clientRequestId` semantics:

```text
Frontend command accepted
  -> lockAcceptedForExecution
  -> BEGIN
  -> lock/revalidate Review Context, target, Evidence, freshness, access, policy
  -> append decisions and compute aggregate state
  -> if ACCEPTED_FOR_AUTHORING:
       load authoritative DiscoveryReviewResourceV1
       resolve exact approved Knowledge Entity endpoints
       resolve current Canonical Draft base
       create deterministic materialization identity
       insert Draft and Discovery-to-Draft provenance/linkage
  -> completeInTransaction(command ledger, Review Context + Draft resources)
  -> COMMIT
```

The terminal Review acceptance, initial Draft, provenance/linkage, and command
completion commit together or roll back together. A definite transaction
failure leaves no newly persisted terminal acceptance, no newly persisted Draft,
and no false `COMPLETED` command. Uncertain commit acknowledgement uses the
existing outcome uncertainty and original `clientRequestId` recovery; it is
not reported as rejection. In-memory repositories must provide equivalent
clone/commit/rollback parity. Replay returns the same Draft identity.

Materialization identity uses Review Context ID/revision, Discovery candidate
ID/revision, Discovery Review resource ID/revision, bridge contract version,
and current Canonical base identity. UI wording, summary, rank, timestamp, and
random run ID are excluded. The current Canonical snapshot, access revision,
and policy context revision are resolved in the same transaction after
freshness validation; materially changed authority fails closed or requires
Review revalidation and is never silently rebased.

The Draft contains exactly one typed `RELATION_ADD` using the proposed
`RelationDraftValueV2`:

```text
relationType
fromEndpoint ApprovedKnowledgeEntityRefV1
toEndpoint   ApprovedKnowledgeEntityRefV1
direction: DIRECTED | UNDIRECTED
validFrom? / validTo?
rationale
```

The endpoint contract is:

```text
ApprovedKnowledgeEntityRefV1 {
  projectId
  authority: APPROVED_KNOWLEDGE
  resourceType: ENTITY
  resourceId
  resourceRevision
}
```

`resourceId` is the authoritative `EntityCandidate.candidateId` and
`resourceRevision` is its authoritative `revisionNumber`. Eligibility requires
one same-project, access-authorized, exact candidate ID/revision resolved
through the existing Knowledge Model authority, an approved
`KnowledgeReviewGroup`, and `candidateType: ENTITY`. The server must not
choose a newer revision by `MAX`, timestamp, or last-write ordering. Display
names, aliases, labels, Compiled Truth text, Finding IDs, Review IDs, semantic
rank, and embedding identity are not endpoint authority. Missing, ambiguous,
stale, hidden, cross-project, non-Entity, or wrong-revision references fail
closed. The Canonical Relation edge is `CANONICAL`; its endpoints remain
`APPROVED_KNOWLEDGE` and must not be promoted by projections.

The later Canonical authority is a Stage 6-owned append-only,
current-version-addressable `canonical.relations` table. It stores relation
identity, endpoint revisions, direction/time, Evidence IDs, restrictive access
scope/highest sensitivity, Frontend Approval authority, Discovery provenance,
and creation time. The first implementation supports only `ADD_RELATION` at
revision 1. Update/remove/merge/split remain separately governed.
The accepted Discovery Review Resource revision is linked after the relation
insert through the append-only `canonical.relation_precursors` table to the
resulting `relationId`/revision in the same Canonical transaction; the source
Review Resource remains immutable and non-Canonical.

## 4. Authority and provenance invariants

The bridge and future commit consumer must enforce all of the following:

1. Relation semantics come only from
   `content.normalizedMaterial.typeSpecific`; summary, detail, UI labels,
   generated prose and model scores are not parsed as operations.
2. `fromResource` and `toResource` retain exact server-resolved endpoint
   identity, project, approved revision, and related resource lineage.
3. `direction`, `relationType`, and authoritative temporal values are preserved;
   non-authoritative temporal descriptions remain rationale/provenance.
4. No SourceVersion is fabricated. Existing Evidence IDs and inspectable source
   lineage are retained, including multiple source lineages.
5. Provenance retains Finding ID/revision/type, re-entry manifest, derived
   candidate ID/revision, validation artifact/result, Canonical/Discovery bases,
   source projection digest, related resource revisions, Evidence lineage, and
   applicable algorithm/model/generation versions.
6. Draft base and commit base are current and include current access and policy
   context revisions. Stale inputs trigger revalidation/rebuild or fail closed.
7. The first Discovery Review and second exact Draft Review are distinct. Only
   the second can issue `KNOWLEDGE_CANONICAL_CHANGE` Approval.
8. `ACCEPTED_FOR_AUTHORING` never writes Canonical. There is no auto-commit.

## 5. Canonical transaction and projection authority

The later Stage 6 `ADD_RELATION` transaction is required to be:

```text
lock project_state
-> replay guard
-> stale base/access/policy/Evidence/provenance validation
-> server endpoint resolution and duplicate check
-> insert relation revision 1
-> insert server-owned precursor -> relation linkage
-> write commit result and revision
-> write History ADD_RELATION / CANONICAL_RELATION_ADDED
-> write existing CanonicalCommitted outbox with relation identity
-> advance project state and digest
-> COMMIT
```

An exact command/authority replay returns the original relation result. A
conflicting logical duplicate from another authority fails closed. An approved
`RELATION_ADD` is never silently returned as `NO_OP`; `NO_OP` remains an
explicit Draft operation/replay result. Existing Approval `CONSUMED` and
command-ledger recovery semantics are reused after durable Canonical result
knowledge.

The existing outbox is extended only to carry `operation: ADD_RELATION` and
`relationId`/result identity. There is no relation-specific parallel outbox.
Compiled Truth, semantic corpus, Workspace, Graph and Discovery consumers use
the Canonical relation ID/revision as their edge authority. Projected endpoint
refs retain `APPROVED_KNOWLEDGE`/`ENTITY` and the exact candidate revisions;
they must not be represented as Canonical Entities. The accepted Discovery
precursor is linked/superseded by server state after commit, so rebuilding or
replaying projections cannot create a second relation.

## 6. Failure, rollback, and retention contract

The following fail closed with no partial Draft or Canonical write:

- stale Finding/Review/Draft/Canonical base or changed access/policy context;
- expired/revoked/invalidated/consumed/wrong-purpose Approval;
- unknown command/commit or unrecoverable outcome;
- missing/changed Evidence or provenance;
- unresolved, ambiguous, hidden, or cross-project endpoint;
- malformed Review Resource or unsupported relation operation;
- conflicting logical duplicate;
- any attempt to coerce relation to Claim or No-op.

Rollback disables the bridge and `ADD_RELATION` mapping while preserving
committed relations, Drafts, Review decisions, Approvals, History, outbox and
provenance. Schema removal and deletion are separate governed migrations.
Relations follow existing backup/restore, project-deletion, and audit-retention
policies. Restores preserve relation identity and replay guards.

## 7. OSS review and replacement boundary

The OSS review uses the existing pinned role matrix and evaluations; this audit
adds no external dependency.

| Candidate     | Official repository / exact reviewed pin / license                                                                                | Decision         | Scope and replacement conclusion                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| gbrain        | [garrytan/gbrain](https://github.com/garrytan/gbrain) / `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a` / MIT                          | `REFERENCE_ONLY` | Lock/idempotency/history patterns only; no Runtime, DB, identity or Canonical authority.   |
| lucas         | [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki) / `ad626a3d81be1480e35ef4e94234de8dbb27a61e` / Apache-2.0       | `REFERENCE_ONLY` | Evidence/conversion patterns only; no relation authority, SQLite, FTS, VaultFS or Runtime. |
| ddsyasas      | [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki) / `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c` / MIT                      | `REFERENCE_ONLY` | Authoring/action UX only; no backend, SQLite, ingest/query/lint or LLM client.             |
| OpenKnowledge | [inkeep/open-knowledge](https://github.com/inkeep/open-knowledge) / `f2834c237639e2cff603817ed88182b33f83cf91` / GPL-3.0-or-later | `REFERENCE_ONLY` | Cockpit/Graph/Diff patterns only; no GPL Runtime/storage, Git/MCP, Canonical or Yjs.       |

No reviewed OSS candidate supplies the missing Shotgun Review-to-Draft or
Approval-to-Canonical Relation authority. Future implementation remains behind
Shotgun Ports/Adapters with exact contract, security, replacement and rollback
tests.

## 8. Alternatives and affected acceptance criteria

The alternatives are explicitly rejected or selected as follows:

| Alternative                                | Decision    | Affected boundary                                                                                                  |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| Relation as `CLAIM_ADD`                    | `REJECT`    | Loses typed relation semantics and violates Claim/Evidence separation.                                             |
| Discovery acceptance as Canonical Approval | `REJECT`    | Violates ADR-128 and skips exact Draft Review.                                                                     |
| Review/Compiled Truth only                 | `REJECT`    | Creates projection/Review truth and no Canonical Relation authority.                                               |
| Legacy Stage-5 manifest coercion           | `REJECT`    | Wrong authority and no safe typed relation provenance.                                                             |
| Bounded Stage 6 `ADD_RELATION`             | `PREFERRED` | Preserves ADR-139 and adds only the missing typed Canonical authority.                                             |
| Canonical Entity authority inside ADR-152  | `REJECT`    | No current Stage 6 Canonical Entity authority exists; exact approved Knowledge Entity revisions suffice for E2E-A. |
| Best-effort after-commit Draft handoff     | `REJECT`    | It permits an accepted Review without a materialized Draft after a crash.                                          |
| New Review-to-Draft outbox/worker          | `DEFER`     | Not required for V1 when one same-database transaction closes the handoff.                                         |

The WP2A criteria are recorded in ADR-152 as WP2A-AC-01 through WP2A-AC-16.
The directly affected frozen acceptance rows are:

- E2E-A: `PRODUCT CAPABILITY REMEDIATED / FULL E2E ACCEPTANCE STILL PENDING WP2`;
- PAC-15: the eligible-finding-to-Review handoff is implemented through the
  accepted-for-authoring bridge, with complete E2E-A acceptance still pending;
- AKP8-AC-01: final A-P evidence cannot claim E2E-A until the complete journey
  is accepted;
- AKP8-AC-03: the former E2E-A High architecture gap is remediated, while the
  remaining High evidence gaps still require disposition;
- AKP8-AC-08: no AKP completion or merge declaration is made by WP2A.

Unrelated PAC/AC rows, WP1 history, and the merged WP2R record are not changed.

## 9. Implementation boundary and resume condition

### In scope for the accepted WP2A remediation

- the approved ADR-152 contracts and authority boundaries;
- server-owned Discovery accepted-for-authoring to Draft materialization;
- same-transaction Review/Draft/Approval command completion;
- bounded Stage 6 Canonical Relation persistence, projection, replay, and reconciliation;
- required Contract, security-negative, replay/idempotency, replacement, migration,
  rollback, and end-to-end evidence;
- the live final acceptance matrix blocker disposition.

### Explicitly out of scope

- WP2 resumption or completion declaration;
- WP3 or AKP v1 completion;
- deployment or merge without the recorded review gates;
- UI implementation beyond the existing governed contracts.

### Resume condition

The accepted remediation may proceed on PR #157. WP2 may resume only after all
of the following are true:

1. ADR-152 remains explicitly accepted through the governed record;
2. the approved remediation request includes the required Contract, Golden Corpus, replay/
   idempotency, security/Approval-negative, adapter replacement, migration and
   rollback gates;
3. WP2 remains blocked until the remediation is canonical and the complete
   E2E-A evidence is produced.

No WP3 or AKP v1 closure work begins as a substitute for this remediation.

## 10. Verification and completion record

The Product remediation verification must include:

```text
npm run docs:validate
npm run test:architecture
npm run oss:verify
git diff --check
changed-file Markdown formatting check
```

Product typecheck/lint, database, integration, frontend, and E2E suites are
required in proportion to the changed boundaries. Automatic PR CI may run
normally; no manual rerun is authorized. WP2A is not a stage completion
declaration until the full evidence is reviewed.

Final disposition:

- ADR-152: `ACCEPTED BY USER / BOUNDED PRODUCT REMEDIATION AUTHORIZED`;
- E2E-A: `PRODUCT CAPABILITY REMEDIATED / FULL E2E ACCEPTANCE STILL PENDING WP2`;
- WP2: `BLOCKED_PENDING_REMEDIATION`;
- WP2R: previously merged and complete, unchanged;
- WP3: not started;
- AKP v1: not complete and not declared complete.

## 11. Accepted Product remediation record — 2026-09-01

The User accepted ADR-152 and GPT issued the bounded Product implementation
request on the existing open Draft PR #157. The implementation record is:

- `packages/contracts` now carries authority-qualified approved Knowledge Entity
  endpoint refs, typed relation v2 data, server-owned Discovery provenance,
  Canonical relation fields, snapshot digest relation state, history, outbox,
  and reconciliation payloads;
- the Review coordinator passes its existing PostgreSQL `PoolClient` to a
  server-owned Discovery authoring bridge; exact persisted Review resources,
  candidate revisions, project scope, canonical base, Evidence lineage, and
  approved Knowledge Entity revisions are revalidated before materializing a
  Draft;
- Review command completion, Draft materialization, and command-ledger state
  share one transaction; there is no second Review-to-Draft queue, worker, or
  outbox;
- the Draft commit path consumes only one approved claim or one typed relation,
  maps the relation to Stage 6 `ADD_RELATION`, preserves edge authority as
  `CANONICAL`, keeps endpoint authority as `APPROVED_KNOWLEDGE`, and uses the
  existing Approval/replay/recovery boundary;
- Stage 6 persists the append-only relation, relation-aware snapshot digest,
  History, existing CanonicalCommitted outbox, and project-state update in one
  transaction. Migration `059_akp8_canonical_relation_authority.sql` is
  preflight-gated after exact migration 058;
- the PR remains OPEN/DRAFT. Product capability, relation projection,
  reconciliation, and focused contract evidence are implemented; full E2E-A,
  Golden Corpus, complete security/replay/replacement, migration/rollback
  exercise, UI, and final acceptance evidence remain review gates and are not
  claimed complete by this record.

## 12. GPT correction record — 2026-09-01

The pre-merge correction request was applied on the same guarded branch and PR.
The following authority and fail-closed gaps are now covered:

- ordinary Draft Save rejects a browser-injected `relation.v2` operation unless
  the current persisted Draft contains the exact server-owned Discovery
  provenance and one unchanged semantic relation operation;
- final relation validation re-reads the exact Review Resource, candidate,
  canonical base, approved Knowledge Entity group rows, and their revisions in
  the same PostgreSQL transaction; it never resolves a latest or `MAX`
  revision;
- relation security is the restrictive composition of the Review Resource and
  both approved endpoint Knowledge groups. Actor scope and sensitivity are
  execution gates only and cannot widen persisted authority;
- one shared logical-identity helper is used by materialization, Stage 6
  persistence, reconciliation, and replacement tests. It preserves exact
  temporal absence/value and full authority-qualified endpoint revisions, with
  deterministic endpoint ordering for undirected relations;
- accepted Review Resource lineage is persisted as the exact
  `canonical.relation_precursors` link and is required by compiled-truth
  suppression/reconciliation; loose tuples, wildcards, and missing endpoint
  revisions do not suppress or reconcile a relation;
- the in-memory Canonical fingerprint includes `relations`, matching the
  PostgreSQL relation-aware snapshot identity.

### Correction verification

Focused verification passed:

```text
tests/unit/akp-8-wp2a-relation-reconciliation.test.ts                 2 passed
tests/contract/akp-8-wp2a-canonical-relation-projection.contract.test.ts 3 passed
tests/integration/frontend-knowledge-draft-commit.test.ts            16 passed
```

The PostgreSQL-only correction suite contains positive Review→Draft
materialization, restrictive security, endpoint drift rejection, completion
failure rollback, and exact replay/idempotency checks. It was not executed in
this workspace because `TEST_DATABASE_URL` was unset; the test therefore
skipped rather than substituting an in-memory database. Full PostgreSQL,
Golden Corpus, adapter replacement, migration/rollback exercise, and complete
E2E-A acceptance remain explicit review gates.

### OSS and scope disposition

No new OSS runtime or dependency was introduced by this correction. The
existing reference candidates remain bounded as follows: `garrytan/gbrain`
and `lucasastorian/llmwiki` remain reference/extraction candidates behind
Shotgun Ports, `ddsyasas/llm-wiki` remains UX/view-model reference only, and
Inkeep OpenKnowledge remains UI/review-pattern reference only. No candidate
was promoted to a Shotgun Kernel, Canonical, Evidence, Approval, or Action
boundary, and no unpinned version was adopted. The shared identity and
authority checks are Shotgun-owned contract code because the candidate
runtimes cannot provide these project-, revision-, evidence-, and approval-
qualified semantics without violating the module boundary.

Migration and rollback remain bounded by migration `059_akp8_canonical_relation_authority.sql`:
the migration is preflight-gated after exact migration 058, relation writes
are transactional, and rollback is the existing migration rollback procedure
plus removal of the isolated relation records. No destructive reset, merge,
Ready-for-review action, deployment, WP2 completion, or WP3 work is included.

Final disposition remains:

- E2E-A: `PRODUCT CAPABILITY REMEDIATED / FULL E2E ACCEPTANCE STILL PENDING WP2`;
- WP2: `BLOCKED_PENDING_REMEDIATION` until the required PostgreSQL and full
  acceptance evidence is reviewed;
- this record is not `PROVEN_EXISTING` and does not declare overall AKP
  completion.
