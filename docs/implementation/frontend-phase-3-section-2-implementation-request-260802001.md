---
id: FRONTEND-PHASE-3-SECTION-2-IMPLEMENTATION-REQUEST-260802001
classification: IMPLEMENTATION_REQUEST_CANDIDATE
status: REVIEW_PENDING
revision: 2
review_round: 1
review_result: CHANGES_REQUIRED
work_item: FE-P3-S2
governing_adr: ADR-126
contract_snapshot: docs/architecture/contracts/snapshots/frontend-phase-3-section-2/frontend-phase-3-section-2-contract-snapshot-260802001.md
branch: codex/frontend-phase-3-section-2-contract
implementation_authorized: false
---

# FE-P3-S2 Implementation Request Candidate

This is a candidate request for a later implementation review. It is not an
authorization to edit Product code, add SQL, add dependencies, run tests or
start A2.

## Candidate dependency order

1. Contract and decoder package: versioned Draft aggregate, typed operations,
   strict schemas and failure mapping.
2. Server Domain/Repository boundary: materialization, immutable base binding,
   Draft revisions and operation persistence ports.
3. In-memory and PostgreSQL adapters: parity for Draft, materialization,
   validation and impact artifact references.
4. Protected Product API and Command Gateway: materialize, seedless start, save,
   validate, preview, submit, abandon and outcome resolution.
5. Browser Draft State Machine: ADR-119 ownership, dirty protection, project and
   access drift, leave guard and recovery.
6. Server validation/comparison/impact orchestration: no browser authority and
   no automatic stale merge.
7. Review submission boundary: produce a Review Resource reference only; no
   Approval, Canonical Commit or Review Center decision.

The first seven API contracts are fixed in the revised ADR and Contract
Snapshot: Materialize, Seedless Start, Save, Validate, Impact Preview, Submit
for Review and Resolve Command Outcome. Abandon remains a separate lifecycle
command but is not required for the initial seven-contract Product API slice.
Each contract now has mandatory input, typed failures, no automatic mutation
retry, original-key outcome recovery and explicit compatibility with Ask Seed,
FE-P3-S1 read and legacy Stage 5.

## Reusable surfaces

- Ask transition Seed repository and PostgreSQL idempotency pattern;
- `FrontendProjectContext` and server-derived Product scope;
- existing Frontend Command Gateway/Ledger and typed failure taxonomy;
- FE-P3-S1 Knowledge read coordinator, lineage and query-key dimensions;
- Settings Draft Controller and Leave Guard as client-state patterns;
- Stage 4 validation, Stage 5 comparison/review and Stage 9 knowledge-model
  ports behind new Draft orchestration boundaries;
- Canonical Knowledge commit boundary as a downstream consumer only.

## Deliberate non-reuse

- Stage 5 `DraftChangeSet` is not widened;
- Stage 5 `review.change_sets` is not treated as the v1 persistence schema;
- Ask Seed payload is not treated as typed operation content;
- Knowledge Page read DTOs are not mutated into Draft DTOs;
- Browser DOM, Markdown, WYSIWYG, local storage and React Query cache are not
  Draft authority;
- no external OSS runtime, Yjs/CRDT, graph editor or new dependency is added.

## OSS integration decision for the candidate

`REFERENCE_ONLY` applies to previously reviewed UI/workflow patterns from
gbrain, lucasastorian/llmwiki, ddsyasas/llm-wiki and Inkeep OpenKnowledge.
`NO_RELEVANT_OSS` applies to the server-owned Draft aggregate, Canonical and
Evidence authority, Project binding, persistence invariants and approval
boundary. No external package is adopted by this request. Any later
`ADOPT`, `EXTRACT` or `AUGMENT` decision requires exact upstream commit,
license, security, maintenance, adapter boundary, replacement test and
rollback evidence before implementation.

## Future implementation gates

The future implementation request must include:

- strict contract and negative tests;
- materialization replay/idempotency tests;
- Project/access/revision authority negative tests;
- Draft dirty/refetch and stale/conflict state tests;
- in-memory/PostgreSQL adapter parity;
- persistence migration and rollback rehearsal;
- no Canonical write or Approval bypass evidence;
- accessibility evidence;
- applicable OSS Integration Gate evidence;
- exact implementation head, remote CI and approval evidence separately.

## Exclusions

FE-P3-S3, Review Center, Approval, Canonical Commit, User Directive Proposal,
external Action, Graph editing, Yjs/CRDT, deployment and production
verification remain excluded.
