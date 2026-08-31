# AKP-8 WP1 — Final Acceptance Matrix & Evidence Gap Audit

- Status: **WP1 AUDIT OUTPUT — AKP v1 CLOSURE NOT PROVEN**
- Baseline: `main@d6ed927654d04a44be0b3b068e7aef69e22d39f0`
- Target branch: `codex/akp-8-wp1-final-acceptance-evidence-audit`
- Scope: documentation-only acceptance and evidence audit
- Product/runtime changes: **NONE**
- Migration, runtime dependency, lockfile, new ADR: **NONE**
- Final user approval for AKP v1 closure: **not recorded by this WP1 artifact**

## 1. Purpose and boundary

This document is the WP1 audit requested by ADR-142 and the AKP-8 work order. It
maps the final acceptance surface to evidence already present on the canonical
baseline. It does not convert component tests into final end-to-end proof, does
not reopen accepted limitations, and does not implement a missing capability.

The attached checkpoint document under `scratch/` is preserved as an attachment
and is not treated as the current implementation request. The current request is
the GPT-issued AKP-8 WP1 acceptance audit.

The following decisions are deliberately explicit:

1. A component-level Contract, Database, Unit, Integration, or Browser test is
   evidence for the named boundary only. It is not proof of an ADR-142 A-P
   journey unless the complete journey and handoffs are exercised.
2. A missing final test is classified as `MISSING_ACCEPTANCE_TEST` only when the
   underlying product capability is evidenced. A missing capability is not
   silently relabeled as a test gap.
3. `PROVEN_EXISTING` is evaluated independently for each row. It may be used
   when the frozen requirement is directly proven by current canonical evidence,
   even when the complete A-P campaign is not yet present. `PARTIAL_COMPONENT_EVIDENCE`
   is used when the implementation pieces exist but a lifecycle or cross-surface
   handoff remains unproven.
4. `APPROVED_NON_BLOCKING_DISPOSITION` is used only for accepted, bounded
   deferrals such as FACT authority and the fail-closed comparator boundary.
5. No new Canonical authority, Claim-to-Fact promotion, Evidence fabrication,
   external Action authority, cross-project disclosure path, or unapproved scope
   amendment was found in the inspected evidence. The unresolved items below are
   closure blockers, not permission to implement around an authority boundary.

## 2. Acceptance sources inspected

The audit used the repository versions of the required baseline documents and
the accepted AKP records below.

| Source                                                                                                                                                                                                                                                            | Use in this audit                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/architecture/adr/ADR-142-finite-end-to-end-acceptance-gate-and-akp-v1-closure-boundary.md`                                                                                                                                                                  | Exact A-P journeys, closure gate, evidence-reuse rule                                                                                      |
| `docs/architecture/akp/active-knowledge-productization-v1-master-design.md`                                                                                                                                                                                       | Frozen PAC-01..30 and authority boundaries                                                                                                 |
| `docs/architecture/akp/akp-v1-section-detailed-design.md`                                                                                                                                                                                                         | Frozen Section AC rows AKP0..AKP8                                                                                                          |
| `docs/architecture/akp/AKP-V1-ARCHITECTURE-ACCEPTANCE.md`                                                                                                                                                                                                         | Whole-design acceptance record and approved snapshot                                                                                       |
| `docs/architecture/add/phase-05-canonical-knowledge-and-discovery/akp-v1-accepted-amendment-2026-08-12.md`                                                                                                                                                        | Seven finding types and automatic re-entry boundary                                                                                        |
| `docs/architecture/add/phase-06-utilization-results-feedback/akp-v1-accepted-amendment-2026-08-12.md`                                                                                                                                                             | Final closure conditions and v2 boundary                                                                                                   |
| `docs/architecture/adr/ADR-147-akp-1-fact-authority-deferral-and-semantic-product-eligibility.md`                                                                                                                                                                 | Accepted FACT reservation and five-type Product eligibility                                                                                |
| `docs/architecture/adr/ADR-148-akp-1-semantic-runtime-authority-unification.md`                                                                                                                                                                                   | Accepted semantic-runtime implementation-mechanics refinement; current PR #125/R4/R5 evidence takes precedence over historical plan fields |
| `docs/architecture/adr/ADR-149-discovery-semantic-essence-and-pre-persistence-fingerprint-identity-boundary.md`                                                                                                                                                   | Accepted semantic identity refinement for AKP-3                                                                                            |
| `docs/architecture/adr/ADR-150-akp-7-epistemic-comparator-authority-deferral-and-governed-unresolved-reentry-boundary.md`                                                                                                                                         | Accepted fail-closed comparator refinement for AKP-7                                                                                       |
| `docs/implementation/definition-of-done.md`, `implementation-roadmap.md`, `oss-integration-roadmap.md`, `oss-evaluation-plan.md`                                                                                                                                  | Stage and OSS Integration Gate requirements                                                                                                |
| `docs/engineering/AKP-3-WP5-EVALUATION-DEGRADATION-SECURITY-CLOSURE.md`                                                                                                                                                                                           | AKP-3 evaluation, degradation, prompt/privacy, and budget evidence                                                                         |
| `docs/implementation/akp-1-hybrid-semantic-retrieval-implementation-request-260818001.md`                                                                                                                                                                         | Recorded AKP-1R status; historical plan status is not treated as proof of later sections                                                   |
| `docs/implementation/akp-6-wp1-discovery-product-api.md`                                                                                                                                                                                                          | Discovery Product/API boundary and OSS review                                                                                              |
| `docs/implementation/akp-7-wp1-feedback-suppression-ranking-foundation.md`, `akp-7-wp2-feedback-product-commands-state.md`, `akp-7-wp3-ranking-suppression-adaptive-presentation.md`, `akp-7-wp4-epistemic-feedback-reentry.md`, `akp-7-wp5-ui-audit-security.md` | AKP-7 implementation and review records                                                                                                    |
| `tests/contract/`, `tests/database/`, `tests/unit/`, `tests/integration/`, `tests/browser/` AKP/semantic/action/graph/review suites                                                                                                                               | Component evidence inventory                                                                                                               |
| Canonical GitHub PR #154 and automatic CI #1194/#1195                                                                                                                                                                                                             | Exact-head AKP-7 WP5 merge and post-merge evidence                                                                                         |
| Canonical GitHub PR #125 (`beedb6ef822ca1f16483f26e328711a62d084113`)                                                                                                                                                                                             | Merged AKP-1R semantic authority repair and current R4/R5 composition evidence                                                             |
| Canonical GitHub PR #114 and `docs/engineering/a9-final-completion-record-20260814.md`                                                                                                                                                                            | A9 `COMPLETE / FINAL_AFTER_MERGE / ACTUAL_USE_VERIFIED`; provider/credential/privacy closure                                               |

## 3. OSS and reuse audit

WP1 does not add an OSS runtime or dependency. The existing role decisions were
rechecked rather than repeated as new adoption work.

| Candidate and pinned review                                                                                                    | WP1 decision             | Boundary retained                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| [garrytan/gbrain](https://github.com/garrytan/gbrain), `a25209bbb2bacf1b88e06fd5282b27f1bf4a3e7a`, MIT                         | `REFERENCE_ONLY`         | Job, idempotency, history, and Graph patterns only; Runtime, DB, Brain identity, and Canonical authority excluded        |
| [lucasastorian/llmwiki](https://github.com/lucasastorian/llmwiki), `ad626a3d81be1480e35ef4e94234de8dbb27a61e`, Apache-2.0      | `REFERENCE_ONLY` for WP1 | Transformation/Evidence patterns remain independently bounded; SQLite/FTS/VaultFS/runtime excluded                       |
| [ddsyasas/llm-wiki](https://github.com/ddsyasas/llm-wiki), `e8dd69ebba0dc7c395c1b8217bb1c30c14e8c84c`, MIT                     | `REFERENCE_ONLY`         | Action-oriented UX/read-model patterns only; backend, SQLite, ingest/query, and LLM client excluded                      |
| [Inkeep OpenKnowledge](https://github.com/inkeep/open-knowledge), `f2834c237639e2cff603817ed88182b33f83cf91`, GPL-3.0-or-later | `REFERENCE_ONLY`         | Review/cockpit/Graph/Activity patterns only; GPL runtime, storage, Git/MCP, Canonical/Yjs excluded; Yjs remains deferred |

No `ADOPT`, `EXTRACT`, or `AUGMENT` decision is introduced by this document.
There is no new version, lockfile, adapter, migration, or replacement exercise.
Existing AKP-4/5/6/7 integration records remain the evidence for their already
bounded reuse decisions.

### Current semantic/runtime evidence correction

The historical AKP-1R implementation-request metadata is not current status
evidence. PR #125 is merged into canonical `main`, and the current repository
contains R4/R5 evidence. In particular, `tests/database/semantic-runtime-r5-
production-chain.database.test.ts` has the exact test `uses normal
startShotgunApplication composition for durable build, restart, policy, stale,
reuse, and CAS proof`; it exercises the normal application composition, real
PostgreSQL profile/index path, router/vault boundary, deterministic provider
network double, generation pointer, restart, stale/policy, and CAS behavior.
`tests/unit/semantic-runtime-r4.test.ts` covers conservative classification and
lexical health without a generation, while
`tests/unit/semantic-generation-lifecycle.test.ts` covers bounded batches,
persisted candidate activation, pointer switching, and rollback. These facts
remove any Product-capability or unfinished-R4/R5 classification from this audit.

The AKP-3 closure evidence also names the exact tests
`loads an approved closed Golden Query corpus and preserves Product semantic
eligibility`, `compares lexical-only, semantic-only and Hybrid retrieval through
the existing Stage 12 evaluator`, `proves security-before-top-k, request-local
degradation, and privacy-safe evaluation output`, and `records measured local
retrieval latency without asserting an invented universal threshold` in
`tests/unit/akp-1-wp5-closure.test.ts`.

E2E-I is therefore `PROVEN_EXISTING` for its frozen bounded requirement, with
only AKP-specific final-campaign evidence remaining. E2E-O is not an external
acceptance dependency: A9 is already `COMPLETE / FINAL_AFTER_MERGE /
ACTUAL_USE_VERIFIED`, R4/R5 uses a deterministic provider-network boundary, and
the AKP-3 WP5 record proves data-only prompt/privacy handling and fail-closed
negative behavior. Its remaining classification is partial only because the
AKP-specific integrated chain is not yet captured in one acceptance fixture.

## 4. ADR-142 A-P final journey audit

The classification in this table is the required primary classification for each
scenario. Evidence paths identify the strongest existing component evidence; a
row remains non-final when the complete cross-module journey, handoff, or closure
condition is absent.

| ID  | Required final journey                                                                                                                                                                                                                      | Primary classification       | Existing evidence                                                                                                                                                                                                                                                                                                  | Gap / minimum remaining proof                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Canonical change → event → projections → incremental Discovery → durable relation hypothesis → validation/re-entry → Product/Graph → Review/Approval → Canonical relation/change → projection regeneration → later Discovery reconciliation | `PARTIAL_COMPONENT_EVIDENCE` | AKP-4 WP2/WP4 trigger, projection wait, reconciliation tests; AKP-5 re-entry/materialization tests; Graph/Review security integration tests                                                                                                                                                                        | One authorized fixture must prove the entire causal loop and the later reconciliation observation; no integrated A-P proof exists                       |
| B   | Persistent scheduled full scan with non-interactive Job/Run/Attempt/Stage and bounded finding creation/suppression                                                                                                                          | `PARTIAL_COMPONENT_EVIDENCE` | `tests/contract/akp-4-wp3-discovery-scheduler-manual.contract.test.ts`; scheduler database tests; durable execution tests                                                                                                                                                                                          | Scheduled trigger, full scan, finding lifecycle, and bounded suppression need one end-to-end acceptance fixture                                         |
| C   | Feedback and snooze/suppression persist, rerun obeys scope, and confidence/truth authority is unchanged                                                                                                                                     | `PARTIAL_COMPONENT_EVIDENCE` | AKP-7 WP1/WP2 contract/database/integration tests; semantic truth-boundary tests                                                                                                                                                                                                                                   | Cross-surface rerun plus persisted history and unchanged Canonical/Fact/Claim authority are not one final journey                                       |
| D   | Semantic/AI unavailable → Canonical unchanged → deterministic/lexical fallback → explicit degraded/partial state                                                                                                                            | `PROVEN_EXISTING`            | `tests/unit/semantic-runtime-r4.test.ts`: lexical search remains healthy without a generation; AKP-3 WP5 evaluation/degradation/security closure records typed degradation and safe fallback                                                                                                                       | The bounded behavior is proven; a broader presentation journey may be added as closure evidence                                                         |
| E   | Queued/running work survives restart/lease expiry with bounded recovery, one logical outcome, and no duplicate finding                                                                                                                      | `PARTIAL_COMPONENT_EVIDENCE` | AKP-4 WP4 database/contract durable stage, reclaim, retry, and FindingReady replay tests                                                                                                                                                                                                                           | Restart through final Product finding and duplicate-free closure is not proven as one journey                                                           |
| F   | Duplicate `CanonicalCommitted` delivery does not duplicate jobs or findings                                                                                                                                                                 | `PROVEN_EXISTING`            | AKP-4 WP2 trigger uniqueness plus WP4 `FindingReady` replay tests explicitly cover duplicate-safe job/finding delivery                                                                                                                                                                                             | The bounded dedupe behavior is proven; a full A-P causal fixture remains closure evidence                                                               |
| G   | Stale review revalidates or fails closed                                                                                                                                                                                                    | `PROVEN_EXISTING`            | AKP-5 WP5 stale/freshness/security database tests and frontend Review security tests                                                                                                                                                                                                                               | The stale safety boundary is proven; a single user-visible A-P journey remains closure evidence                                                         |
| H   | Cross-project non-disclosure across semantic/Discovery/Graph/Review/Activity/feedback, with restrictive scope and fail-closed egress                                                                                                        | `PARTIAL_COMPONENT_EVIDENCE` | AKP-4/5/7 cross-project tests; frontend history/review security negatives; semantic privacy tests                                                                                                                                                                                                                  | All named surfaces and AI/embedding egress require one common-scope acceptance proof                                                                    |
| I   | New embedding profile → generation build → readiness → active pointer → rollback without Canonical mutation                                                                                                                                 | `PROVEN_EXISTING`            | `tests/unit/semantic-generation-lifecycle.test.ts`; `tests/unit/semantic-runtime-r4.test.ts`; `tests/database/semantic-runtime-r5-production-chain.database.test.ts` (`uses normal startShotgunApplication composition...`) prove profile/build/readiness/pointer/restart/policy/stale/CAS and rollback boundaries | Current R3/R4/R5 production composition is proven after PR #125; remaining work is only AKP-specific closure evidence, not product capability           |
| J   | Action Suggestion becomes governed Candidate but never externally executes without Action authority                                                                                                                                         | `PARTIAL_COMPONENT_EVIDENCE` | `tests/contract/action-execution.contract.test.ts`, action API integration, and browser lifecycle tests                                                                                                                                                                                                            | Discovery finding creation through Candidate/Risk/Approval/Execute/Verify needs a final AKP-connected fixture                                           |
| K   | Derived relation/pattern/conflict never appears, is cited, or exported as Canonical because of a high score                                                                                                                                 | `PARTIAL_COMPONENT_EVIDENCE` | Graph negative tests; Review/history security tests; AKP-2/3 type/provenance contracts                                                                                                                                                                                                                             | Cross-surface citation/export negative journey is not captured in one final fixture                                                                     |
| L   | Epistemic feedback routes to validation/correction; utility feedback affects ranking/suppression only                                                                                                                                       | `PROVEN_EXISTING`            | AKP-7 WP4 six-kind routing/validation tests, utility feedback tests, and ADR-150 fail-closed comparator boundary                                                                                                                                                                                                   | Both lane semantics and non-interference are proven; a final A-P presentation fixture remains optional closure evidence                                 |
| M   | Conflict hypothesis enters existing Conflict comparison/review; ordinary suppression cannot erase mandatory conflict                                                                                                                        | `PARTIAL_COMPONENT_EVIDENCE` | AKP-3 conflict fixtures and type mapping; AKP-7 mandatory visibility tests                                                                                                                                                                                                                                         | The conflict-to-review path and suppression exception need integrated proof                                                                             |
| N   | Superseded/retired/ineligible resource receives tombstone/invalidation; incremental/full equivalence; vector payload may be pruned only                                                                                                     | `PARTIAL_COMPONENT_EVIDENCE` | semantic generation lifecycle, index parity, stale/freshness, and AKP-5 reconciliation tests                                                                                                                                                                                                                       | Full resource lifecycle through Discovery findings and prune/retention needs one equivalence acceptance fixture                                         |
| O   | Query and AI Discovery use ADR-133 provider/credential/egress authority; restricted transfer fails closed; content is not instructions/tools/credentials                                                                                    | `PARTIAL_COMPONENT_EVIDENCE` | A9 completion record is `COMPLETE / FINAL_AFTER_MERGE / ACTUAL_USE_VERIFIED` after PR #114; R4/R5 uses a deterministic provider-network boundary; AKP-3 WP5 prompt/privacy/security closure proves data-only handling and fail-closed negatives                                                                    | AKP-specific integrated Query→Discovery→egress evidence remains, but live third-party acceptance is not required and no external dependency is recorded |
| P   | Projection wait deadline yields typed degraded/retryable/terminal state; later reconciliation yields RESOLVED/STALE/SUPERSEDED with history                                                                                                 | `PARTIAL_COMPONENT_EVIDENCE` | AKP-4 WP2 projection wait/deadline tests; AKP-4 WP4 reconciliation tests; AKP-5 freshness tests                                                                                                                                                                                                                    | One final deadline → later Canonical reconciliation journey and Product lifecycle presentation is missing                                               |

### A-P classification counts

| Classification                      |  Count |
| ----------------------------------- | -----: |
| `PROVEN_EXISTING`                   |      5 |
| `PARTIAL_COMPONENT_EVIDENCE`        |     11 |
| `MISSING_ACCEPTANCE_TEST`           |      0 |
| `MISSING_PRODUCT_CAPABILITY`        |      0 |
| `APPROVED_NON_BLOCKING_DISPOSITION` |      0 |
| `EXTERNAL_ACCEPTANCE_DEPENDENCY`    |      0 |
| `BLOCKED_ARCHITECTURE_GAP`          |      0 |
| **Total A-P**                       | **16** |

The five `PROVEN_EXISTING` rows are independently bounded requirements already
proven by current canonical evidence. The eleven partial rows identify missing
cross-module or final-campaign evidence; they do not imply missing Product
capability.

## 5. Cross-cutting Critical/High gap audit

Severity here is the AKP closure-gate severity. It does not assert that the
current implementation created a forbidden authority. The audit found no new
direct Canonical, Claim/Fact, Evidence, Action, or cross-project authority
violation; it did find unresolved closure blockers.

| Gap ID   | Severity | Finding                                                                                                                                                       | Classification               | Owning area       | Required disposition                                                                                                    |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| GAP-H-01 | HIGH     | No single final A-P acceptance campaign proves the required causal journeys and handoffs                                                                      | `MISSING_ACCEPTANCE_TEST`    | AKP-8             | Add bounded, fixture-driven acceptance scenarios; do not repeat every existing unit/component suite                     |
| GAP-H-02 | HIGH     | PAC-01..30 and all Section AC criteria have not yet been dispositioned with final closure evidence                                                            | `MISSING_ACCEPTANCE_TEST`    | AKP-8             | Use the companion matrix as the control register and close each row with exact evidence or an accepted deferral         |
| GAP-H-03 | HIGH     | Cross-project H proof is distributed across semantic, Discovery, Graph, Review, Activity, and feedback tests rather than one restrictive common-scope journey | `PARTIAL_COMPONENT_EVIDENCE` | AKP-1, 4, 5, 6, 7 | Add one cross-surface non-disclosure fixture with egress negative assertions; this is acceptance evidence only          |
| GAP-H-04 | HIGH     | Durable restart, later reconciliation, and governed finding/feedback retention/restore are not proven as one final chain                                      | `PARTIAL_COMPONENT_EVIDENCE` | AKP-4, 5, 7       | Add bounded recovery/restore/retention acceptance evidence; preserve existing replay tests                              |
| GAP-H-05 | HIGH     | AKP-specific provider/credential/privacy behavior is evidenced in separate A9, R4/R5, and AKP-3 records but not one integrated O journey                      | `PARTIAL_COMPONENT_EVIDENCE` | AKP-1, 3, 8       | Add deterministic provider-double and prompt/privacy cross-section evidence; no live third-party acceptance is required |

Critical direct architecture/security violations found: **0**.

Unresolved High closure gaps: **5**. Therefore AKP v1 cannot be declared
complete by this WP1 audit, and AKP-8 AC-03 is not satisfied.

## 6. Accepted refinement register

These are AKP-scoped, user-accepted refinements. They are not silently reopened
as implementation work in WP1.

| ADR     | Accepted boundary                                                                                                                  | WP1 disposition                     | Closure effect                                                                                                                                                                                               |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ADR-147 | FACT authority is reserved/deferred; current semantic Product eligibility is CLAIM, ENTITY, RELATION, EVENT, and DECISION          | `APPROVED_NON_BLOCKING_DISPOSITION` | Non-blocking while v1 remains within the five-type Product boundary; future FACT authority needs a separate approved decision                                                                                |
| ADR-148 | Semantic runtime authority is unified through the bounded R0-R5 repair; no new semantic truth authority                            | `APPROVED_NON_BLOCKING_DISPOSITION` | Accepted implementation-mechanics refinement; PR #125 is merged and current R4/R5 production-composition evidence exists. Remaining proof is AKP-specific acceptance evidence, not unfinished Product repair |
| ADR-149 | Server-owned `discovery-semantic-essence:v1` is derived before persistence; existing `discovery-fingerprint:v1` remains frozen     | `APPROVED_NON_BLOCKING_DISPOSITION` | Refines AKP-3 identity without adding a new Canonical authority; integrated acceptance evidence remains required                                                                                             |
| ADR-150 | No approved epistemic comparator exists; default outcome is `INSUFFICIENTLY_RESOLVABLE` and Review remains outcome/lifecycle-bound | `APPROVED_NON_BLOCKING_DISPOSITION` | Fail-closed behavior is intentional for v1; a future comparator requires a separate user-approved ADR and re-evaluation version                                                                              |

## 7. Bounded Deferred register

| Deferred item                                  | Reason and current boundary                                                                     | Re-evaluation trigger                                                                 | WP1 status                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------- |
| FACT semantic/Product authority                | Would create a new truth/eligibility boundary outside accepted v1 scope                         | Separately scoped AKP v2 proposal with authority, migration, and rollback             | `APPROVED_NON_BLOCKING_DISPOSITION` |
| General-purpose durable queue/workflow product | Current AKP runtime uses existing Outbox/PostgreSQL durable stages; no demonstrated v1 need     | Measured throughput/recovery need plus a separate adoption decision                   | `APPROVED_NON_BLOCKING_DISPOSITION` |
| ANN/HNSW/IVFFlat external index                | Current lexical/semantic Port boundary and measured scale do not require promotion              | Benchmark shows PostgreSQL adapter ceiling                                            | `APPROVED_NON_BLOCKING_DISPOSITION` |
| Raw/source-exploration corpus vectorization    | Outside the approved Product semantic corpus boundary                                           | New corpus authority and privacy review                                               | `APPROVED_NON_BLOCKING_DISPOSITION` |
| Implicit telemetry or ML ranking               | v1 ranking is deterministic, versioned, and explainable                                         | Separate product/authority approval and privacy review                                | `APPROVED_NON_BLOCKING_DISPOSITION` |
| Semantic epistemic comparator                  | No approved owner or truth-comparison authority; ADR-150 mandates fail-closed unresolved result | Separate ADR defining owners, inputs, thresholds, versioning, migration, and rollback | `APPROVED_NON_BLOCKING_DISPOSITION` |

## 8. Minimum remaining work plan (proposed, not started)

This is a gap-driven plan, not an authorization to begin WP2 in this branch.

| Proposed work package                                               | Evidence target                                                                                                                                    | Candidate scenarios/criteria                  | Start condition                                                                                         |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| AKP-8 WP2 — Cross-section causal acceptance                         | Complete bounded A/F/G/L/M/P and B/C slices through Product boundaries                                                                             | A, B, C, F, G, L, M, P; PAC-10, 13, 15, 28    | GPT issues a bounded WP2 request and the relevant fixtures are agreed                                   |
| AKP-8 WP3 — Semantic runtime and privacy acceptance                 | Provide AKP-specific acceptance evidence for generation/invalidation/degradation/common-scope/egress behavior; R4/R5 repair is already implemented | D, H, I, N, O; PAC-02, 03, 04, 23, 24, 25, 26 | GPT issues a bounded evidence-only request; no semantic runtime repair or parallel authority is planned |
| AKP-8 WP4 — Durability, restore, retention, and recovery acceptance | Prove restart/reclaim/replay/retention/restore across governed findings and feedback                                                               | E, H, N, P; PAC-13, 26, 27                    | A bounded recovery/retention fixture and owner are approved                                             |
| AKP-8 WP5 — Final closure campaign                                  | Resolve every PAC/Section AC row and record final governance evidence                                                                              | A-P, PAC-01..30, AKP8-AC-01..08               | All Critical/High gaps are closed or explicitly accepted; user approval remains required                |

No proposed package is started by this WP1 document. The next work package is
GPT-controlled and must be separately requested.

## 9. Verification and non-change record

Required WP1 local checks are intentionally documentation-only:

```text
npm run docs:validate
npm run test:architecture
git diff --check
Markdown formatting check for the two WP1 documents
```

Product typecheck, lint, database, integration, and browser suites are not
rerun by WP1 because no non-document file is modified. Existing test paths are
used as evidence references, not reclassified as final A-P proof.

No Product implementation, database migration, runtime dependency, lockfile,
new ADR, E2E test, repair handoff, Ready transition, merge, deployment, or AKP
v1 completion declaration is authorized by this audit.
