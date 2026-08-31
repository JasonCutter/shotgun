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
3. `PROVEN_EXISTING` is reserved for an already accepted policy/authority or a
   directly evidenced existing boundary. No A-P scenario receives that status in
   this audit because no single final A-P campaign is present on the baseline.
4. `APPROVED_NON_BLOCKING_DISPOSITION` is used only for accepted, bounded
   deferrals such as FACT authority and the fail-closed comparator boundary.
5. No new Canonical authority, Claim-to-Fact promotion, Evidence fabrication,
   external Action authority, cross-project disclosure path, or unapproved scope
   amendment was found in the inspected evidence. The unresolved items below are
   closure blockers, not permission to implement around an authority boundary.

## 2. Acceptance sources inspected

The audit used the repository versions of the required baseline documents and
the accepted AKP records below.

| Source                                                                                                                                                                                                                                                            | Use in this audit                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `docs/architecture/adr/ADR-142-finite-end-to-end-acceptance-gate-and-akp-v1-closure-boundary.md`                                                                                                                                                                  | Exact A-P journeys, closure gate, evidence-reuse rule                                    |
| `docs/architecture/akp/active-knowledge-productization-v1-master-design.md`                                                                                                                                                                                       | Frozen PAC-01..30 and authority boundaries                                               |
| `docs/architecture/akp/akp-v1-section-detailed-design.md`                                                                                                                                                                                                         | Frozen Section AC rows AKP0..AKP8                                                        |
| `docs/architecture/akp/AKP-V1-ARCHITECTURE-ACCEPTANCE.md`                                                                                                                                                                                                         | Whole-design acceptance record and approved snapshot                                     |
| `docs/architecture/add/phase-05-canonical-knowledge-and-discovery/akp-v1-accepted-amendment-2026-08-12.md`                                                                                                                                                        | Seven finding types and automatic re-entry boundary                                      |
| `docs/architecture/add/phase-06-utilization-results-feedback/akp-v1-accepted-amendment-2026-08-12.md`                                                                                                                                                             | Final closure conditions and v2 boundary                                                 |
| `docs/architecture/adr/ADR-147-akp-1-fact-authority-deferral-and-semantic-product-eligibility.md`                                                                                                                                                                 | Accepted FACT reservation and five-type Product eligibility                              |
| `docs/architecture/adr/ADR-148-akp-1-semantic-runtime-authority-unification.md`                                                                                                                                                                                   | Semantic runtime R0-R5 repair status and closure blocker                                 |
| `docs/architecture/adr/ADR-149-discovery-semantic-essence-and-pre-persistence-fingerprint-identity-boundary.md`                                                                                                                                                   | Accepted semantic identity refinement for AKP-3                                          |
| `docs/architecture/adr/ADR-150-akp-7-epistemic-comparator-authority-deferral-and-governed-unresolved-reentry-boundary.md`                                                                                                                                         | Accepted fail-closed comparator refinement for AKP-7                                     |
| `docs/implementation/definition-of-done.md`, `implementation-roadmap.md`, `oss-integration-roadmap.md`, `oss-evaluation-plan.md`                                                                                                                                  | Stage and OSS Integration Gate requirements                                              |
| `docs/engineering/AKP-3-WP5-EVALUATION-DEGRADATION-SECURITY-CLOSURE.md`                                                                                                                                                                                           | AKP-3 evaluation, degradation, prompt/privacy, and budget evidence                       |
| `docs/implementation/akp-1-hybrid-semantic-retrieval-implementation-request-260818001.md`                                                                                                                                                                         | Recorded AKP-1R status; historical plan status is not treated as proof of later sections |
| `docs/implementation/akp-6-wp1-discovery-product-api.md`                                                                                                                                                                                                          | Discovery Product/API boundary and OSS review                                            |
| `docs/implementation/akp-7-wp1-feedback-suppression-ranking-foundation.md`, `akp-7-wp2-feedback-product-commands-state.md`, `akp-7-wp3-ranking-suppression-adaptive-presentation.md`, `akp-7-wp4-epistemic-feedback-reentry.md`, `akp-7-wp5-ui-audit-security.md` | AKP-7 implementation and review records                                                  |
| `tests/contract/`, `tests/database/`, `tests/unit/`, `tests/integration/`, `tests/browser/` AKP/semantic/action/graph/review suites                                                                                                                               | Component evidence inventory                                                             |
| Canonical GitHub PR #154 and automatic CI #1194/#1195                                                                                                                                                                                                             | Exact-head AKP-7 WP5 merge and post-merge evidence                                       |

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

## 4. ADR-142 A-P final journey audit

The classification in this table is the required primary classification for each
scenario. Evidence paths identify the strongest existing component evidence; a
row remains non-final when the complete cross-module journey, handoff, or closure
condition is absent.

| ID  | Required final journey                                                                                                                                                                                                                      | Primary classification           | Existing evidence                                                                                                                           | Gap / minimum remaining proof                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | Canonical change → event → projections → incremental Discovery → durable relation hypothesis → validation/re-entry → Product/Graph → Review/Approval → Canonical relation/change → projection regeneration → later Discovery reconciliation | `PARTIAL_COMPONENT_EVIDENCE`     | AKP-4 WP2/WP4 trigger, projection wait, reconciliation tests; AKP-5 re-entry/materialization tests; Graph/Review security integration tests | One authorized fixture must prove the entire causal loop and the later reconciliation observation; no integrated A-P proof exists                           |
| B   | Persistent scheduled full scan with non-interactive Job/Run/Attempt/Stage and bounded finding creation/suppression                                                                                                                          | `PARTIAL_COMPONENT_EVIDENCE`     | `tests/contract/akp-4-wp3-discovery-scheduler-manual.contract.test.ts`; scheduler database tests; durable execution tests                   | Scheduled trigger, full scan, finding lifecycle, and bounded suppression need one end-to-end acceptance fixture                                             |
| C   | Feedback and snooze/suppression persist, rerun obeys scope, and confidence/truth authority is unchanged                                                                                                                                     | `PARTIAL_COMPONENT_EVIDENCE`     | AKP-7 WP1/WP2 contract/database/integration tests; semantic truth-boundary tests                                                            | Cross-surface rerun plus persisted history and unchanged Canonical/Fact/Claim authority are not one final journey                                           |
| D   | Semantic/AI unavailable → Canonical unchanged → deterministic/lexical fallback → explicit degraded/partial state                                                                                                                            | `PARTIAL_COMPONENT_EVIDENCE`     | `tests/unit/semantic-runtime-r4.test.ts`; AKP-3 degradation/security closure record                                                         | Runtime degradation and Product/Discovery/Graph/Review presentation need a single final fixture                                                             |
| E   | Queued/running work survives restart/lease expiry with bounded recovery, one logical outcome, and no duplicate finding                                                                                                                      | `PARTIAL_COMPONENT_EVIDENCE`     | AKP-4 WP4 database/contract durable stage, reclaim, retry, and FindingReady replay tests                                                    | Restart through final Product finding and duplicate-free closure is not proven as one journey                                                               |
| F   | Duplicate `CanonicalCommitted` delivery does not duplicate jobs or findings                                                                                                                                                                 | `PARTIAL_COMPONENT_EVIDENCE`     | AKP-4 WP2 trigger uniqueness and idempotency tests; semantic replay tests                                                                   | Canonical outbox → final finding dedupe across the complete chain needs an integrated fixture                                                               |
| G   | Stale review revalidates or fails closed                                                                                                                                                                                                    | `PARTIAL_COMPONENT_EVIDENCE`     | AKP-5 WP5 freshness/security database tests; frontend review security tests                                                                 | One final stale-review journey must include the user-visible disposition and no unsafe approval path                                                        |
| H   | Cross-project non-disclosure across semantic/Discovery/Graph/Review/Activity/feedback, with restrictive scope and fail-closed egress                                                                                                        | `PARTIAL_COMPONENT_EVIDENCE`     | AKP-4/5/7 cross-project tests; frontend history/review security negatives; semantic privacy tests                                           | All named surfaces and AI/embedding egress require one common-scope acceptance proof                                                                        |
| I   | New embedding profile → generation build → readiness → active pointer → rollback without Canonical mutation                                                                                                                                 | `MISSING_PRODUCT_CAPABILITY`     | Semantic generation lifecycle and R4 unit tests cover parts of build/activation/rollback                                                    | ADR-148 records R4 production composition and R5 cross-WP proof as unfinished; do not relabel the missing operational sensor/composition as a test-only gap |
| J   | Action Suggestion becomes governed Candidate but never externally executes without Action authority                                                                                                                                         | `PARTIAL_COMPONENT_EVIDENCE`     | `tests/contract/action-execution.contract.test.ts`, action API integration, and browser lifecycle tests                                     | Discovery finding creation through Candidate/Risk/Approval/Execute/Verify needs a final AKP-connected fixture                                               |
| K   | Derived relation/pattern/conflict never appears, is cited, or exported as Canonical because of a high score                                                                                                                                 | `PARTIAL_COMPONENT_EVIDENCE`     | Graph negative tests; Review/history security tests; AKP-2/3 type/provenance contracts                                                      | Cross-surface citation/export negative journey is not captured in one final fixture                                                                         |
| L   | Epistemic feedback routes to validation/correction; utility feedback affects ranking/suppression only                                                                                                                                       | `PARTIAL_COMPONENT_EVIDENCE`     | AKP-7 WP4 six-kind contract/database tests; WP1/WP2/WP3 feedback tests                                                                      | One fixture must prove both lanes and authority non-interference through Product reload                                                                     |
| M   | Conflict hypothesis enters existing Conflict comparison/review; ordinary suppression cannot erase mandatory conflict                                                                                                                        | `PARTIAL_COMPONENT_EVIDENCE`     | AKP-3 conflict fixtures and type mapping; AKP-7 mandatory visibility tests                                                                  | The conflict-to-review path and suppression exception need integrated proof                                                                                 |
| N   | Superseded/retired/ineligible resource receives tombstone/invalidation; incremental/full equivalence; vector payload may be pruned only                                                                                                     | `PARTIAL_COMPONENT_EVIDENCE`     | semantic generation lifecycle, index parity, stale/freshness, and AKP-5 reconciliation tests                                                | Full resource lifecycle through Discovery findings and prune/retention needs one equivalence acceptance fixture                                             |
| O   | Query and AI Discovery use ADR-133 provider/credential/egress authority; restricted transfer fails closed; content is not instructions/tools/credentials                                                                                    | `EXTERNAL_ACCEPTANCE_DEPENDENCY` | ADR-133/A9 provider authority records; semantic prompt/privacy and browser authority-negative tests                                         | External provider/credential/egress acceptance and the ADR-148 semantic runtime closure remain outside the completed local component evidence               |
| P   | Projection wait deadline yields typed degraded/retryable/terminal state; later reconciliation yields RESOLVED/STALE/SUPERSEDED with history                                                                                                 | `PARTIAL_COMPONENT_EVIDENCE`     | AKP-4 WP2 projection wait/deadline tests; AKP-4 WP4 reconciliation tests; AKP-5 freshness tests                                             | One final deadline → later Canonical reconciliation journey and Product lifecycle presentation is missing                                                   |

### A-P classification counts

| Classification                      |  Count |
| ----------------------------------- | -----: |
| `PROVEN_EXISTING`                   |      0 |
| `PARTIAL_COMPONENT_EVIDENCE`        |     14 |
| `MISSING_ACCEPTANCE_TEST`           |      0 |
| `MISSING_PRODUCT_CAPABILITY`        |      1 |
| `APPROVED_NON_BLOCKING_DISPOSITION` |      0 |
| `EXTERNAL_ACCEPTANCE_DEPENDENCY`    |      1 |
| `BLOCKED_ARCHITECTURE_GAP`          |      0 |
| **Total A-P**                       | **16** |

The zero `PROVEN_EXISTING` count is intentional: existing component evidence is
valuable and is mapped below, but ADR-142 requires the finite A-P journeys as
acceptance evidence rather than a collection of isolated passing tests.

## 5. Cross-cutting Critical/High gap audit

Severity here is the AKP closure-gate severity. It does not assert that the
current implementation created a forbidden authority. The audit found no new
direct Canonical, Claim/Fact, Evidence, Action, or cross-project authority
violation; it did find unresolved closure blockers.

| Gap ID   | Severity | Finding                                                                                                                                                                                      | Classification                   | Owning area                 | Required disposition                                                                                                                             |
| -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| GAP-H-01 | HIGH     | No single final A-P acceptance campaign proves the required causal journeys and handoffs                                                                                                     | `MISSING_ACCEPTANCE_TEST`        | AKP-8                       | Add bounded, fixture-driven acceptance scenarios; do not repeat every existing unit/component suite                                              |
| GAP-H-02 | HIGH     | PAC-01..30 and all Section AC criteria have not yet been dispositioned with final closure evidence                                                                                           | `MISSING_ACCEPTANCE_TEST`        | AKP-8                       | Use the companion matrix as the control register and close each row with exact evidence or an accepted deferral                                  |
| GAP-H-03 | HIGH     | ADR-148 semantic runtime authority unification remains incomplete: R0 is in progress and R1-R5 are not started in the recorded plan; production composition and cross-WP proof are not final | `MISSING_PRODUCT_CAPABILITY`     | AKP-1 / AKP-8 dependency    | Complete the bounded AKP-1R repair and then run the I/N/O-related acceptance fixtures; do not implement a parallel semantic authority            |
| GAP-H-04 | HIGH     | Cross-project H proof is distributed across semantic, Discovery, Graph, Review, Activity, and feedback tests rather than one restrictive common-scope journey                                | `PARTIAL_COMPONENT_EVIDENCE`     | AKP-1, 4, 5, 6, 7           | Add one cross-surface non-disclosure fixture with egress negative assertions                                                                     |
| GAP-H-05 | HIGH     | Durable restart, later reconciliation, and governed finding/feedback retention/restore are not proven as one final chain                                                                     | `PARTIAL_COMPONENT_EVIDENCE`     | AKP-4, 5, 7                 | Add bounded recovery/restore/retention acceptance evidence; preserve existing replay tests                                                       |
| GAP-H-06 | HIGH     | ADR-133 external provider/credential/egress acceptance is a real dependency for O; local negative tests do not equal external acceptance                                                     | `EXTERNAL_ACCEPTANCE_DEPENDENCY` | AKP-1 / platform acceptance | Record the external acceptance owner and bounded test environment, or record an explicit accepted dependency disposition; fail closed until then |

Critical direct architecture/security violations found: **0**.

Unresolved High closure gaps: **6**. Therefore AKP v1 cannot be declared
complete by this WP1 audit, and AKP-8 AC-03 is not satisfied.

## 6. Accepted refinement register

These are AKP-scoped, user-accepted refinements. They are not silently reopened
as implementation work in WP1.

| ADR     | Accepted boundary                                                                                                                  | WP1 disposition                     | Closure effect                                                                                                                  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| ADR-147 | FACT authority is reserved/deferred; current semantic Product eligibility is CLAIM, ENTITY, RELATION, EVENT, and DECISION          | `APPROVED_NON_BLOCKING_DISPOSITION` | Non-blocking while v1 remains within the five-type Product boundary; future FACT authority needs a separate approved decision   |
| ADR-148 | Unify the semantic runtime authority and complete the bounded R0-R5 repair; no new semantic truth authority                        | `BLOCKING_ACCEPTED_REFINEMENT`      | Blocks final AKP-1 semantic acceptance and dependent I/N/O proof until the recorded repair is complete                          |
| ADR-149 | Server-owned `discovery-semantic-essence:v1` is derived before persistence; existing `discovery-fingerprint:v1` remains frozen     | `APPROVED_NON_BLOCKING_DISPOSITION` | Refines AKP-3 identity without adding a new Canonical authority; integrated acceptance evidence remains required                |
| ADR-150 | No approved epistemic comparator exists; default outcome is `INSUFFICIENTLY_RESOLVABLE` and Review remains outcome/lifecycle-bound | `APPROVED_NON_BLOCKING_DISPOSITION` | Fail-closed behavior is intentional for v1; a future comparator requires a separate user-approved ADR and re-evaluation version |

## 7. Bounded Deferred register

| Deferred item                                                    | Reason and current boundary                                                                     | Re-evaluation trigger                                                                 | WP1 status                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------- |
| FACT semantic/Product authority                                  | Would create a new truth/eligibility boundary outside accepted v1 scope                         | Separately scoped AKP v2 proposal with authority, migration, and rollback             | `APPROVED_NON_BLOCKING_DISPOSITION` |
| General-purpose durable queue/workflow product                   | Current AKP runtime uses existing Outbox/PostgreSQL durable stages; no demonstrated v1 need     | Measured throughput/recovery need plus a separate adoption decision                   | `APPROVED_NON_BLOCKING_DISPOSITION` |
| ANN/HNSW/IVFFlat external index                                  | Current lexical/semantic Port boundary and measured scale do not require promotion              | Benchmark shows PostgreSQL adapter ceiling                                            | `APPROVED_NON_BLOCKING_DISPOSITION` |
| Raw/source-exploration corpus vectorization                      | Outside the approved Product semantic corpus boundary                                           | New corpus authority and privacy review                                               | `APPROVED_NON_BLOCKING_DISPOSITION` |
| Implicit telemetry or ML ranking                                 | v1 ranking is deterministic, versioned, and explainable                                         | Separate product/authority approval and privacy review                                | `APPROVED_NON_BLOCKING_DISPOSITION` |
| Semantic epistemic comparator                                    | No approved owner or truth-comparison authority; ADR-150 mandates fail-closed unresolved result | Separate ADR defining owners, inputs, thresholds, versioning, migration, and rollback | `APPROVED_NON_BLOCKING_DISPOSITION` |
| Live external provider acceptance beyond bounded local negatives | ADR-133 keeps provider/credential/egress authority external to this audit                       | Named external acceptance owner and reproducible controlled environment               | `EXTERNAL_ACCEPTANCE_DEPENDENCY`    |

## 8. Minimum remaining work plan (proposed, not started)

This is a gap-driven plan, not an authorization to begin WP2 in this branch.

| Proposed work package                                               | Evidence target                                                                               | Candidate scenarios/criteria                  | Start condition                                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| AKP-8 WP2 — Cross-section causal acceptance                         | Complete bounded A/F/G/L/M/P and B/C slices through Product boundaries                        | A, B, C, F, G, L, M, P; PAC-10, 13, 15, 28    | GPT issues a bounded WP2 request and the relevant fixtures are agreed                    |
| AKP-8 WP3 — Semantic runtime and privacy acceptance                 | Close semantic R4/R5 dependency and prove generation/invalidation/degradation/egress behavior | D, H, I, N, O; PAC-02, 03, 04, 23, 24, 25, 26 | AKP-1R repair is complete or explicitly dispositioned; no parallel authority             |
| AKP-8 WP4 — Durability, restore, retention, and recovery acceptance | Prove restart/reclaim/replay/retention/restore across governed findings and feedback          | E, H, N, P; PAC-13, 26, 27                    | A bounded recovery/retention fixture and owner are approved                              |
| AKP-8 WP5 — Final closure campaign                                  | Resolve every PAC/Section AC row and record final governance evidence                         | A-P, PAC-01..30, AKP8-AC-01..08               | All Critical/High gaps are closed or explicitly accepted; user approval remains required |

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
