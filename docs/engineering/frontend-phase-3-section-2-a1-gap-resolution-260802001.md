---
id: FRONTEND-PHASE-3-SECTION-2-A1-GAP-RESOLUTION-260802001
classification: ARCHITECTURE_CONTRACT_PREPARATION
status: REVIEW_PENDING
revision: 4
review_round: 3
review_result: CHANGES_REQUIRED
work_item: FE-P3-S2
governing_adr: ADR-126
contract_snapshot: docs/architecture/contracts/snapshots/frontend-phase-3-section-2/frontend-phase-3-section-2-contract-snapshot-260802001.md
base_commit_requested: cc3f50904f947c8d6d920c28e8ca542cb5d63569
actual_local_content_base: 917463a06749eab15ebab8dd3b511c2a3cb77b3d
branch: codex/frontend-phase-3-section-2-contract
implementation_authorized: false
---

# FE-P3-S2 A1 Gap Resolution Record

## Decision state

This record translates the A0 audit into proposed ADR and Contract Snapshot
decisions. It is submitted for GPT/user review. It does not claim Product
implementation, test evidence, CI evidence, approval, Ready or merge.

## A0 gap matrix

| Gap | A0 classification | A1 resolution | State |
|---|---|---|---|
| Generic Seed persistence, lookup, `PROPOSED`, request-id replay | `NO_GAP` for existing Ask Seed | Reuse `frontend_ask.transition_seeds`; keep it immutable and separate from Draft | `RESOLVED_BY_CONTRACT` |
| One Seed to one Draft | `PERSISTENCE_MISSING` | Add materialization identity and a unique Seed-to-Draft boundary | `RESOLVED_BY_ADR` |
| Knowledge Page seedless start | `PRODUCT_API_MISSING` | Define an explicit server-authoritative Start Seedless Draft command | `RESOLVED_BY_CONTRACT` |
| Knowledge Editor Draft aggregate | `CONTRACT_MISSING` | Introduce `FrontendKnowledgeDraftChangeSet v1`; do not widen Stage 5 | `RESOLVED_BY_ADR` |
| Typed Fact/Claim/Entity/Relation/Event/Decision/Evidence/Temporal/Conflict/Knowledge Gap/NO_OP operations | `CONTRACT_MISSING` | Freeze discriminated operation union, versioned payloads and common operation fields | `RESOLVED_BY_CONTRACT` |
| Canonical/Projection base pinning | `CONTRACT_MISSING` | Freeze immutable base snapshot and lineage fields | `RESOLVED_BY_CONTRACT` |
| Active/Resource/Draft/Effective Project binding | `SECURITY_OR_AUTHORITY_GAP` | Reuse ADR-100 and enforce server-derived immutable binding | `RESOLVED_BY_ADR` |
| Evidence/Rationale/Before/After/Expected Impact | `CONTRACT_MISSING` | Bind fields to every typed operation; server impact remains authoritative | `RESOLVED_BY_CONTRACT` |
| Validation/Comparison/Conflict/Recursive Impact orchestration | `DOMAIN_MAPPING_MISSING` | Define separate server commands and artifact references | `RESOLVED_BY_CONTRACT` |
| Draft save versus Review submission | `PRODUCT_API_MISSING` | Freeze separate Save, Validate, Preview and Submit commands | `RESOLVED_BY_CONTRACT` |
| `STALE`, `CONFLICT`, `PARTIAL`, `OUTCOME_UNKNOWN` separation | `CONTRACT_MISSING` | Draft lifecycle excludes `PARTIAL`; Validation/Impact artifacts own `PARTIAL`; Command outcome owns `OUTCOME_UNKNOWN` | `RESOLVED_BY_ADR` |
| Dirty Draft versus background refetch | `FRONTEND_STATE_MISSING` | Reuse ADR-119 and Settings Draft Controller pattern | `RESOLVED_BY_ADR` |
| Project/access revision drift | `FRONTEND_STATE_MISSING` | Preserve pinned Draft, mark stale/inaccessible, require explicit reset | `RESOLVED_BY_CONTRACT` |
| Product API, API Client and route placeholders | `PRODUCT_API_MISSING` | Freeze protected command family; implementation remains A2 candidate | `RESOLVED_BY_CONTRACT` |
| In-memory/PostgreSQL adapter parity | `PERSISTENCE_MISSING` | Define new Draft Repository boundary; retain Stage 5 adapters unchanged | `RESOLVED_BY_ADR` |
| Database persistence shape | `REQUIRED_WITH_EVIDENCE` | Additive migration is required for future durable implementation | `RESOLVED_BY_ADR` |
| Runtime dependency | `NOT_REQUIRED` | Reuse current React Query, Router, Command Ledger and ports | `RESOLVED_BY_ADR` |

## Resolution of GPT review requirements

The first review returned `CHANGES_REQUIRED` because the five items below did
not yet specify mandatory values, failure meaning, retry behavior and
compatibility. Revision 2 fixes them as follows:

| Review item | Fixed A1 rule | State |
|---|---|---|
| Canonical revision identity | Snapshot ID/version/digest are always mandatory; existing Resource edits require Resource ID/revision ID; only a new Resource may omit revision ID; existing Resource without it fails closed | `RESOLVED_BY_CONTRACT` |
| Projection requirement | Projection is optional for the Draft overall but mandatory when the Draft starts from Projection or an operation references Projection content/focus | `RESOLVED_BY_CONTRACT` |
| `PARTIAL` meaning | `PARTIAL` belongs to Validation/Impact artifacts; required partial/unavailable artifacts block `READY_FOR_REVIEW` | `RESOLVED_BY_ADR` |
| Review Resource boundary | FE-P3-S2 Submit may create the immutable Review Resource reference; Phase 4 owns Review Center, decision and Approval | `RESOLVED_BY_ADR` |
| Persistence/retention | Six additive ownership tables including materializations and Review Submissions, append-only revisions, one Seed materialization, audit-retention horizon and explicit retention expiry | `RESOLVED_BY_ADR` |

The seven Product API contracts now specify mandatory input, typed failure,
retry and compatibility rules in ADR-126 and the Contract Snapshot.

The second review found contract-expression gaps in the exact document head.
Revision 3 resolves them without changing the approved architecture:

| Review item | Revision 3 resolution | State |
|---|---|---|
| Projection type completeness | Add `projectionKind` and a discriminated `projectionIdentity` for revision versus version, plus digest/readiness/source pinning | `RESOLVED_BY_CONTRACT` |
| Typed operation union | Replace `unknown` payloads with versioned Fact/Claim/Entity/Relation/Event/Decision/Evidence/Temporal/Conflict/Knowledge Gap/NO_OP payload unions and strict decoder rules | `RESOLVED_BY_CONTRACT` |
| Review Submission fields | Add explicit artifact-reference, Evidence lineage and Project/Policy context types and bind them to the immutable submission | `RESOLVED_BY_CONTRACT` |
| Canonical identity wording | Existing Resource requires Resource ID plus Revision ID; new Resource omits both and uses `NEW_RESOURCE_SNAPSHOT` | `RESOLVED_BY_CONTRACT` |
| Effective Project | Add server-derived immutable `effectiveProjectId` to the aggregate and handoff context; it is never browser authority | `RESOLVED_BY_ADR` |

Revision 4 remains a review candidate; it does not authorize Product code,
migration, tests, CI, Ready, Merge or the next implementation slice.

The third review found one remaining union mismatch: the ADR allowed both add
and update proposals for Conflict and Knowledge Gap, while the Contract
Snapshot exposed only one direction for each. Revision 4 names and binds all
four proposal operations explicitly:

`CONFLICT_PROPOSAL_ADD`, `CONFLICT_PROPOSAL_UPDATE`,
`KNOWLEDGE_GAP_PROPOSAL_ADD`, and `KNOWLEDGE_GAP_PROPOSAL_UPDATE`.

No new architecture or implementation authority is introduced.

The `FE-P3-S2.governingContract` Registry link is a candidate documentation
projection in this branch. It becomes Canonical only through the accepted exact
head and normal merge/publication boundary governed by ADR-124; this A1 commit
does not change Product status or completion authority.

## Unresolved external baseline

The requested merge commit `cc3f50904f947c8d6d920c28e8ca542cb5d63569` is not
available in the local object database, and `git ls-remote origin refs/heads/main`
failed because the environment could not connect to GitHub. The A1 files were
prepared from the checked-out approved PR head
`917463a06749eab15ebab8dd3b511c2a3cb77b3d`. The merge-content equivalence is
not claimed until the canonical main object is available.

## State after A1 preparation

```text
FE-P3-S2 Product implementation: NOT_STARTED
A1 Architecture/Contract preparation: IN_PROGRESS / REVIEW_PENDING
Database Migration execution: NOT_STARTED
Runtime Dependency change: NONE
Ready: NOT_AUTHORIZED
Merge: NOT_AUTHORIZED
FE-P3-S3: NOT_STARTED
Deployment: NOT_STARTED
```
