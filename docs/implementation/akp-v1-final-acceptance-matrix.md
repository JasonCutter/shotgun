# AKP v1 Final Acceptance Matrix

- Audit owner: AKP-8 WP1
- Baseline: `main@d6ed927654d04a44be0b3b068e7aef69e22d39f0`
- Matrix status: **component evidence mapped; final closure not proven**
- Companion audit: [AKP-8 WP1 Final Acceptance & Evidence Gap Audit](./akp-8-wp1-final-acceptance-evidence-audit.md)
- Product/runtime changes in WP1: **NONE**

This is the control matrix for all frozen AKP v1 acceptance items. A status of
`PROVEN_COMPONENT` means the named boundary has direct repository evidence; it
does not by itself satisfy the final A-P campaign or AKP-8 closure gate.

## Status legend

| Status                              | Meaning                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `PROVEN_EXISTING`                   | Existing accepted authority or policy directly satisfies the row’s bounded requirement               |
| `PROVEN_COMPONENT`                  | Contract, database, unit, integration, or browser evidence covers the named component boundary       |
| `PARTIAL_COMPONENT_EVIDENCE`        | Relevant evidence exists, but the cross-module, lifecycle, or final acceptance handoff is incomplete |
| `MISSING_ACCEPTANCE_TEST`           | Capability is evidenced, but the required final acceptance proof is absent                           |
| `MISSING_PRODUCT_CAPABILITY`        | The normal product capability or operational composition is not yet complete                         |
| `APPROVED_NON_BLOCKING_DISPOSITION` | User-accepted bounded refinement/deferral that does not expand v1                                    |
| `EXTERNAL_ACCEPTANCE_DEPENDENCY`    | Local boundary evidence exists, but an external authority/environment must accept the final behavior |
| `BLOCKED_ARCHITECTURE_GAP`          | A required architecture authority or boundary is absent; none was newly found in this audit          |

## 1. Frozen PAC-01..30 matrix

| PAC    | Frozen acceptance requirement                                                                                                   | Status                           | Evidence / authority                                                                    | A-P / Section AC linkage                     | Remaining work or disposition                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| PAC-01 | Reuse existing Knowledge Flow; do not create a parallel Canonical phase                                                         | `PROVEN_EXISTING`                | AKP master design, accepted amendments, ADR-142                                         | A, J, K, M; AKP0-AC-01..04                   | Keep the existing Canonical/Derived boundary through final fixtures                  |
| PAC-02 | Vectors are derived and rebuildable; never Canonical, Evidence, or Fact confidence                                              | `PARTIAL_COMPONENT_EVIDENCE`     | Semantic representation/generation lifecycle tests; ADR-148                             | D, I, N; AKP1-AC-01, 10, 11                  | Complete R4/R5 operational composition and prove rebuild/non-mutation end to end     |
| PAC-03 | Lexical search remains independently usable and preserves Evidence/SourceVersion citation                                       | `PROVEN_COMPONENT`               | Semantic retriever/index parity and Evidence citation contracts                         | D, K, O; AKP1-AC-03, 07, 09                  | Add final degraded/citation journey across Product surfaces                          |
| PAC-04 | Project/access/sensitivity precedes candidate selection; use restrictive common scope/highest sensitivity                       | `PARTIAL_COMPONENT_EVIDENCE`     | Semantic privacy tests; AKP-4/5/7 project isolation tests                               | H; AKP1-AC-06, 08; AKP2-AC-04                | One all-surface common-scope and egress acceptance fixture remains                   |
| PAC-05 | Seven finding types are typed and governed                                                                                      | `PROVEN_COMPONENT`               | AKP-2/3 schemas, type mapping and AKP-5 manifest contracts                              | A, J, K, M; AKP2-AC-01, 11; AKP5-AC-06       | Prove all seven types in a final cross-module campaign                               |
| PAC-06 | Finding records durably retain source base/resources/evidence/method/provenance/security/fingerprint/summary                    | `PROVEN_COMPONENT`               | AKP-2 finding contracts and AKP-5 provenance/materialization database tests             | A, K, N; AKP2-AC-03..07                      | Add final retention/restore evidence for the whole governed record                   |
| PAC-07 | Discovery/AI cannot directly write Canonical, Claim→Fact, or external Action                                                    | `PROVEN_COMPONENT`               | Action, Graph, Review, and history negative tests; authority contracts                  | J, K; AKP2-AC-02, 08, 09; AKP5-AC-03, 09, 10 | Preserve negative tests in the final A-P campaign                                    |
| PAC-08 | Candidate selection reads only bounded authorized neighborhoods; no whole-project/all-pairs LLM loop                            | `PROVEN_COMPONENT`               | AKP-3 bounded strategy/candidate contracts and budget evidence                          | B, H, O; AKP3-AC-01..04, 09                  | Final scheduled/semantic campaign must retain bounds                                 |
| PAC-09 | Deterministic, AI, and hybrid methods are distinguishable                                                                       | `PROVEN_COMPONENT`               | AKP-3 method/provenance contracts and degradation record                                | D, O; AKP3-AC-03, 07                         | Include method labels in final evidence                                              |
| PAC-10 | CanonicalCommitted is idempotent, incremental, and reconciles prior findings                                                    | `PARTIAL_COMPONENT_EVIDENCE`     | AKP-4 trigger/idempotency/reconciliation database tests                                 | A, F, P; AKP4-AC-01, 07, 11                  | Prove event-to-finding behavior in one complete fixture                              |
| PAC-11 | A real persistent periodic scheduler exists                                                                                     | `PROVEN_COMPONENT`               | AKP-4 WP3 contract/database schedule and CAS tests                                      | B; AKP4-AC-02                                | Add the scheduler-to-finding final journey                                           |
| PAC-12 | Manual Discovery is server-authorized and bounded                                                                               | `PROVEN_COMPONENT`               | AKP-4 WP3 manual trigger contract/database tests                                        | B; AKP4-AC-03                                | Include authorization and scope in final acceptance                                  |
| PAC-13 | Job/Run/Attempt/Stage are durable, restart-safe, deadline-aware, retry-bounded, and duplicate-safe                              | `PARTIAL_COMPONENT_EVIDENCE`     | AKP-4 WP4 durable execution/reclaim/replay database tests                               | B, E, P; AKP4-AC-05..09                      | Cross restart/reclaim through final finding and retention/restore                    |
| PAC-14 | Exact finding dedupe is separate from feedback/suppression                                                                      | `PROVEN_COMPONENT`               | AKP-4 idempotency and AKP-7 dedupe/suppression database tests                           | C, F; AKP4-AC-07, AKP7-AC-05, 07             | Prove both identities through Product reload                                         |
| PAC-15 | Eligible findings automatically enter real Phase-3 validation/re-entry; Review reads normalized eligible resources              | `PARTIAL_COMPONENT_EVIDENCE`     | AKP-5 FindingReady/re-entry/materialization tests                                       | A, G, L, M; AKP5-AC-01, 02, 07, 08           | Add complete finding-to-review and later-reconciliation proof                        |
| PAC-16 | Derived hypotheses never fabricate SourceVersion or weaken direct Claim authority                                               | `PROVEN_COMPONENT`               | AKP-2 provenance/fingerprint and AKP-5 no-fake-SourceVersion tests                      | K, M; AKP2-AC-02, 06, 08; AKP5-AC-04, 05     | Keep derived provenance visible in final UI evidence                                 |
| PAC-17 | Existing ADR-128 Review remains approval authority and validated Discovery is persistent                                        | `PROVEN_COMPONENT`               | AKP-5 persistent Review bridge/materialization tests; frontend review tests             | A, G, J; AKP5-AC-07, 09                      | Add the final Approval handoff to the A journey                                      |
| PAC-18 | Product UI explains authority, reason, evidence, provenance, freshness, lifecycle, and actions                                  | `PROVEN_COMPONENT`               | AKP-6 API/UI record and frontend workspace/review tests                                 | A, D, G, J, K; AKP6-AC-01..04, 08, 09        | Prove complete inspectability in final scenarios                                     |
| PAC-19 | Graph overlays are distinct from Canonical and have accessible fallback                                                         | `PROVEN_COMPONENT`               | Graph overlay unit and negative integration tests                                       | A, K, M; AKP6-AC-05, 10                      | Include citation/export negative proof                                               |
| PAC-20 | Existing Activity/Attention is reused through an adapter                                                                        | `PROVEN_COMPONENT`               | AKP-4 WP5 activity contract/database tests; AKP-6/7 UI records                          | B, H, L; AKP4-AC-10; AKP6-AC-06, 07          | Add cross-surface H and final activity lifecycle evidence                            |
| PAC-21 | Epistemic feedback causes correction/validation; utility feedback only ranks/suppresses; mandatory visibility remains           | `PROVEN_COMPONENT`               | AKP-7 WP1/WP3/WP4 contract/database/integration tests; ADR-150                          | C, L, M; AKP7-AC-02..08                      | Final fixture must prove both lanes and mandatory Conflict visibility                |
| PAC-22 | Prioritization is deterministic, versioned, bounded, and explainable; no implicit ML/telemetry requirement                      | `PROVEN_COMPONENT`               | AKP-7 ranking contracts/database tests and implementation record                        | C, L; AKP7-AC-09, 10                         | Retain deterministic ranking evidence in closure campaign                            |
| PAC-23 | ADR-133 governs provider, credential, and egress authority; content is not tool/credential authority                            | `EXTERNAL_ACCEPTANCE_DEPENDENCY` | ADR-133/A9 authority records; semantic/browser negative tests                           | H, O; AKP1-AC-04, 08; AKP3-AC-07, 08         | External provider/credential/egress acceptance and ADR-148 semantic closure required |
| PAC-24 | Semantic/AI unavailability degrades safely to typed deterministic/lexical behavior                                              | `PARTIAL_COMPONENT_EVIDENCE`     | R4 unit tests and AKP-3 degradation/security closure record                             | D, O; AKP1-AC-09; AKP3-AC-06, 08             | Prove Product/Graph/Review visibility of degraded state                              |
| PAC-25 | Golden Query/Discovery evaluation covers exact, typo, synonym, paraphrase, multilingual, temporal, conflict, and negative cases | `PARTIAL_COMPONENT_EVIDENCE`     | `tests/fixtures/akp-1-semantic-golden-corpus.v1.json`; semantic unit/evaluation records | D, I, O; AKP1-AC-12; AKP3-AC-10              | Run the bounded final evaluation and record rank/cutoff evidence                     |
| PAC-26 | Incremental/full semantic equivalence removes obsolete/ineligible resources and preserves retention/sensitivity                 | `PARTIAL_COMPONENT_EVIDENCE`     | semantic index parity/generation tests; AKP-5 freshness and reconciliation tests        | H, I, N; AKP1-AC-10, 11                      | Integrated equivalence plus governed finding retention/restore proof                 |
| PAC-27 | Findings/re-entry/feedback support backup, restore, project deletion, and audit retention                                       | `PARTIAL_COMPONENT_EVIDENCE`     | Existing retention/backup/restore records and AKP-5/7 durable histories                 | C, E, H, N; AKP2-AC-10; AKP7-AC-11           | Produce AKP-specific restore/deletion/retention acceptance evidence                  |
| PAC-28 | All ADR-142 E2E scenarios A-P are mandatory                                                                                     | `MISSING_ACCEPTANCE_TEST`        | ADR-142 defines the campaign; current component inventory is mapped in companion audit  | A-P; AKP8-AC-01, 04                          | Execute bounded A-P campaign without duplicating all component suites                |
| PAC-29 | Closure requires all PAC/AC, zero Critical/High, Deferred assignments, CI, and user approval                                    | `MISSING_ACCEPTANCE_TEST`        | ADR-142, master design PAC-29, Phase-6 amendment                                        | All; AKP8-AC-02, 03, 07, 08                  | Resolve six High gaps, record governance approval, normal merge/post-merge           |
| PAC-30 | Reuse only exact-head PASS evidence; do not duplicate full campaigns                                                            | `PROVEN_EXISTING`                | ADR-142 exact-head rule; AKP-7 WP5 exact-head CI #1194/#1195 record                     | AKP8-AC-06                                   | Apply exact SHA/run linkage for each reused result in final closure                  |

PAC summary: `PROVEN_EXISTING` 2, `PROVEN_COMPONENT` 16,
`PARTIAL_COMPONENT_EVIDENCE` 9, `MISSING_ACCEPTANCE_TEST` 2,
`MISSING_PRODUCT_CAPABILITY` 0, `APPROVED_NON_BLOCKING_DISPOSITION` 0,
`EXTERNAL_ACCEPTANCE_DEPENDENCY` 1, `BLOCKED_ARCHITECTURE_GAP` 0. A PAC may
have direct component evidence and still remain partial because the final A-P or
cross-section acceptance proof is absent.

## 2. Frozen Section AC matrix

The following tables include every frozen Section AC criterion from the detailed
design: 94 rows across AKP0 through AKP8. `PROVEN_COMPONENT` records direct
boundary evidence; `PARTIAL_COMPONENT_EVIDENCE` records a remaining cross-section
or final-campaign gap. AKP8 rows are closure rows and therefore remain open until
the required final campaign and governance records exist.

### AKP0 — Scope and governance

| AC         | Criterion                                                                        | Status             | Evidence / remaining work                                                                                  |
| ---------- | -------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| AKP0-AC-01 | Exact canonical main SHA recorded                                                | `PROVEN_EXISTING`  | `main@d6ed927654d04a44be0b3b068e7aef69e22d39f0` is recorded and verified; preserve exact-head linkage      |
| AKP0-AC-02 | Every active-knowledge capability classified with repository evidence            | `PROVEN_EXISTING`  | Master design, section design, implementation records, and this matrix provide the classification register |
| AKP0-AC-03 | Outbox/Review/Graph/Activity/provider authority reuse identified                 | `PROVEN_EXISTING`  | ADR-142, AKP-4/5/6/7 records, and ADR-133 records identify each owner; final journey proof remains open    |
| AKP0-AC-04 | PAC and non-scope frozen after whole-design approval                             | `PROVEN_EXISTING`  | Accepted AKP architecture record and amendments freeze the boundary                                        |
| AKP0-AC-05 | Every gap has one owner and cross-section dependencies                           | `PROVEN_COMPONENT` | GAP-H-01..06 and the remaining-work plan assign owners; future closure updates must retain one owner       |
| AKP0-AC-06 | ADR ownership is unique and approval state is explicit                           | `PROVEN_EXISTING`  | Accepted ADR records identify decision owner/status; no duplicate authority found                          |
| AKP0-AC-07 | ADD/Product/migration/dependency/Ready/Merge remain unauthorized before approval | `PROVEN_EXISTING`  | WP1 makes no such change; branch remains documentation-only and Draft                                      |
| AKP0-AC-08 | Scope expansion requires a Master Scope Amendment                                | `PROVEN_EXISTING`  | Master design and ADR-142 boundary retained; no scope amendment introduced                                 |

### AKP1 — Hybrid semantic retrieval

| AC         | Criterion                                                                   | Status                           | Evidence / remaining work                                                                                       |
| ---------- | --------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| AKP1-AC-01 | Vectors are derived/rebuildable and never Canonical/Evidence/confidence     | `PARTIAL_COMPONENT_EVIDENCE`     | Semantic representation/generation tests support the boundary; ADR-148 R4/R5 closure and final I/N proof remain |
| AKP1-AC-02 | Corpus excludes unapproved/raw bulk content                                 | `PROVEN_COMPONENT`               | Semantic corpus/representation contracts and privacy tests; final O campaign remains                            |
| AKP1-AC-03 | Deterministic typed representation, digest, and version exist               | `PROVEN_COMPONENT`               | Semantic representation, fingerprint, and generation unit/contract tests                                        |
| AKP1-AC-04 | Embedding profile is independent and ADR-133 resolved                       | `EXTERNAL_ACCEPTANCE_DEPENDENCY` | Profile/registry tests and ADR-133 records exist; external provider/credential/egress acceptance remains        |
| AKP1-AC-05 | Vector store is behind a Port; pgvector is only the first adapter candidate | `PROVEN_COMPONENT`               | Semantic embedding/index contracts and module architecture boundary                                             |
| AKP1-AC-06 | Authorization and sensitivity are enforced before/in retrieval              | `PROVEN_COMPONENT`               | Semantic privacy and cross-project negative tests; final all-surface H proof remains                            |
| AKP1-AC-07 | Hybrid results preserve EvidenceSpan/SourceVersion citation                 | `PROVEN_COMPONENT`               | Retriever/citation and Evidence lineage contracts; final K/O journey remains                                    |
| AKP1-AC-08 | Query/index embedding follows provider-egress policy                        | `EXTERNAL_ACCEPTANCE_DEPENDENCY` | ADR-133 and semantic egress negative tests; external acceptance remains                                         |
| AKP1-AC-09 | Semantic degradation falls back to lexical where allowed                    | `PROVEN_COMPONENT`               | `tests/unit/semantic-runtime-r4.test.ts` and degradation record; cross-surface D proof remains                  |
| AKP1-AC-10 | Incremental invalidation/tombstone and full equivalence are proven          | `PARTIAL_COMPONENT_EVIDENCE`     | Semantic index parity/lifecycle tests cover components; final N equivalence fixture is missing                  |
| AKP1-AC-11 | Generation switch/rollback/pruning do not mutate Canonical                  | `PARTIAL_COMPONENT_EVIDENCE`     | Generation lifecycle tests cover parts; ADR-148 production composition and final I evidence remain              |
| AKP1-AC-12 | Golden Query evidence approves final rank/cutoff policy                     | `PARTIAL_COMPONENT_EVIDENCE`     | Golden corpus fixture exists; final rank/cutoff acceptance record is not present                                |

### AKP2 — Finding and provenance model

| AC         | Criterion                                                          | Status                       | Evidence / remaining work                                                                              |
| ---------- | ------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| AKP2-AC-01 | Seven types are schema-discriminated                               | `PROVEN_COMPONENT`           | AKP-2/3 type contracts and AKP-5 mapping tests                                                         |
| AKP2-AC-02 | Every finding is explicitly non-Canonical DERIVED_INFERENCE        | `PROVEN_COMPONENT`           | Finding/provenance contracts and Graph/Review negative tests                                           |
| AKP2-AC-03 | Generation method and provenance are durable                       | `PROVEN_COMPONENT`           | AKP-2 finding contracts and AKP-5 materialization database tests                                       |
| AKP2-AC-04 | Restrictive multi-resource security composition is enforced        | `PROVEN_COMPONENT`           | AKP-4/5/7 project isolation and semantic privacy tests; final H journey remains                        |
| AKP2-AC-05 | Lineage supports revalidation and reconciliation                   | `PROVEN_COMPONENT`           | AKP-4 reconciliation and AKP-5 freshness/re-entry tests                                                |
| AKP2-AC-06 | Fingerprint is versioned and independent of wording/time           | `PROVEN_COMPONENT`           | Fingerprint contracts and ADR-149 semantic essence boundary                                            |
| AKP2-AC-07 | Lifecycle/history is retained, including RESOLVED/STALE/SUPERSEDED | `PROVEN_COMPONENT`           | AKP-4/5 lifecycle/reconciliation and AKP-7 history tests; restore proof remains                        |
| AKP2-AC-08 | Signals cannot become Fact confidence                              | `PROVEN_COMPONENT`           | Semantic truth-boundary, finding, and feedback negative tests; ADR-147 retained                        |
| AKP2-AC-09 | Action Suggestion is non-executable                                | `PROVEN_COMPONENT`           | Action contract/API/browser negative and governed lifecycle tests                                      |
| AKP2-AC-10 | Governed findings participate in retention/backup policy           | `PARTIAL_COMPONENT_EVIDENCE` | Existing retention/backup records and durable schemas; AKP-specific restore/retention campaign remains |
| AKP2-AC-11 | Explicit type-to-governance mapping exists                         | `PROVEN_COMPONENT`           | AKP-5 strict manifest and seven-type mapping contracts                                                 |

### AKP3 — Active Discovery engine

| AC         | Criterion                                                             | Status                           | Evidence / remaining work                                                               |
| ---------- | --------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------- |
| AKP3-AC-01 | Strategy registry is versioned and bounded                            | `PROVEN_COMPONENT`               | AKP-3 strategy registry and deterministic generation contracts                          |
| AKP3-AC-02 | Signal reads are authorized and version-bound                         | `PROVEN_COMPONENT`               | AKP-3 bounded candidate/strategy contracts and security tests                           |
| AKP3-AC-03 | Deterministic, AI, and hybrid methods are distinguishable             | `PROVEN_COMPONENT`               | AKP-3 method/provenance contracts and evaluation record                                 |
| AKP3-AC-04 | Relation/conflict/pattern candidate space is bounded before AI        | `PROVEN_COMPONENT`               | AKP-3 candidate enumeration and budget tests                                            |
| AKP3-AC-05 | Every frozen v1 type has accepted generation/disposition              | `PROVEN_COMPONENT`               | Seven-type mapping, accepted amendments, and AKP-3 evaluation record                    |
| AKP3-AC-06 | Deterministic quality gate runs before persistence                    | `PROVEN_COMPONENT`               | AKP-3 quality/degradation contracts; final cross-section evidence remains               |
| AKP3-AC-07 | DiscoveryModelProfile is distinct and ADR-133-pinned                  | `EXTERNAL_ACCEPTANCE_DEPENDENCY` | Profile/registry tests and provider authority records; external acceptance remains      |
| AKP3-AC-08 | Prompt injection/content cannot alter policy or execute tools/Actions | `PROVEN_COMPONENT`               | AKP-3 prompt/privacy/security tests and negative action tests                           |
| AKP3-AC-09 | Token, cost, time, and concurrency budgets are enforced               | `PROVEN_COMPONENT`               | AKP-3 evaluation/degradation record and budget tests                                    |
| AKP3-AC-10 | Positive/negative quality fixtures include conflict cases             | `PROVEN_COMPONENT`               | AKP-3 evaluation fixtures and conflict strategy tests; final rank/cutoff record remains |

### AKP4 — Durable Discovery orchestration

| AC         | Criterion                                                               | Status                       | Evidence / remaining work                                                         |
| ---------- | ----------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------- |
| AKP4-AC-01 | CanonicalCommitted creates one idempotent incremental logical Job       | `PROVEN_COMPONENT`           | AKP-4 WP2 contract/database trigger tests; complete A/F chain remains             |
| AKP4-AC-02 | Persistent periodic scheduler exists, not enum-only                     | `PROVEN_COMPONENT`           | AKP-4 WP3 scheduler persistence/CAS tests; complete B chain remains               |
| AKP4-AC-03 | Manual trigger is server-authorized and bounded                         | `PROVEN_COMPONENT`           | AKP-4 WP3 manual trigger contract/database tests                                  |
| AKP4-AC-04 | Discovery never runs inside the Canonical transaction                   | `PROVEN_COMPONENT`           | AKP-4 trigger and execution boundary tests                                        |
| AKP4-AC-05 | Projection base, readiness, deadline, and fallback are explicit         | `PROVEN_COMPONENT`           | AKP-4 WP2 projection wait/deadline tests; P presentation remains                  |
| AKP4-AC-06 | Job/Run/Attempt/Stage survive restart                                   | `PROVEN_COMPONENT`           | AKP-4 WP4 durable stage/reclaim tests; final E journey remains                    |
| AKP4-AC-07 | Duplicate delivery cannot create duplicate Domain work                  | `PROVEN_COMPONENT`           | AKP-4 trigger uniqueness and execution replay tests                               |
| AKP4-AC-08 | Lease/retry preserves prior failure context                             | `PROVEN_COMPONENT`           | AKP-4 WP4 retry/reclaim database tests                                            |
| AKP4-AC-09 | Budgets persist across retries                                          | `PROVEN_COMPONENT`           | AKP-4 WP4 cumulative budget/reclaim tests                                         |
| AKP4-AC-10 | Existing Activity integrates via an adapter                             | `PROVEN_COMPONENT`           | AKP-4 WP5 Activity contract/database tests                                        |
| AKP4-AC-11 | Canonical changes reconcile prior findings                              | `PARTIAL_COMPONENT_EVIDENCE` | AKP-4 reconciliation tests exist; final A/P lifecycle and Product evidence remain |
| AKP4-AC-12 | No generalized queue/workflow dependency without separate need/approval | `PROVEN_EXISTING`            | Existing Outbox/PostgreSQL boundary retained; generalized queue remains deferred  |

### AKP5 — Validation and Review re-entry

| AC         | Criterion                                                                 | Status                       | Evidence / remaining work                                           |
| ---------- | ------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------- |
| AKP5-AC-01 | Real persistent FindingReady consumer exists                              | `PROVEN_COMPONENT`           | AKP-4 WP4 replay and AKP-5 consumer tests                           |
| AKP5-AC-02 | Eligible findings automatically enter idempotent re-entry                 | `PROVEN_COMPONENT`           | AKP-5 WP1/WP2 contract/database tests; complete A/L/M proof remains |
| AKP5-AC-03 | Direct ClaimCandidate semantics remain unchanged                          | `PROVEN_COMPONENT`           | AKP-5 origin/manifest contracts and authority negatives             |
| AKP5-AC-04 | Separate derived-provenance validation origin/profile exists              | `PROVEN_COMPONENT`           | AKP-5 derived origin and lineage contracts                          |
| AKP5-AC-05 | No fake SourceVersion is created                                          | `PROVEN_COMPONENT`           | AKP-5 WP1/WP5 provenance and freshness tests                        |
| AKP5-AC-06 | All seven finding types have governed mapping                             | `PROVEN_COMPONENT`           | AKP-5 strict mapping contracts and database materialization tests   |
| AKP5-AC-07 | Review reads persistent review-eligible derived resources, not raw source | `PROVEN_COMPONENT`           | AKP-5 persistent Review bridge/materialization tests                |
| AKP5-AC-08 | Stale base fails closed or revalidates                                    | `PROVEN_COMPONENT`           | AKP-5 WP5 stale/freshness/security database tests                   |
| AKP5-AC-09 | ADR-128 remains approval authority                                        | `PROVEN_COMPONENT`           | Review security and approval boundary tests                         |
| AKP5-AC-10 | Action cannot execute without external Action governance                  | `PROVEN_COMPONENT`           | Action contract/API/browser lifecycle and negative tests            |
| AKP5-AC-11 | Accepted Canonical change keeps origin/provenance history                 | `PARTIAL_COMPONENT_EVIDENCE` | Origin/history contracts exist; final A canonical loop remains      |

### AKP6 — Product UI and read model

| AC         | Criterion                                                                   | Status                       | Evidence / remaining work                                                                                        |
| ---------- | --------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| AKP6-AC-01 | Product UI exists, not backend-only                                         | `PROVEN_COMPONENT`           | AKP-6 Product API record and frontend workspace/browser evidence                                                 |
| AKP6-AC-02 | Derived authority is visibly distinct                                       | `PROVEN_COMPONENT`           | Discovery/Graph/Review UI contracts and negative tests                                                           |
| AKP6-AC-03 | Why, evidence, provenance, and freshness are inspectable subject to masking | `PROVEN_COMPONENT`           | Frontend knowledge/review/history and security evidence                                                          |
| AKP6-AC-04 | Automatic re-entry state is visible and Review is reused only when ready    | `PROVEN_COMPONENT`           | AKP-5 lifecycle plus frontend review tests; final A/G/L presentation remains                                     |
| AKP6-AC-05 | Candidate Graph semantics are distinct and have accessible fallback         | `PROVEN_COMPONENT`           | Graph overlay unit/integration negatives and frontend Graph evidence                                             |
| AKP6-AC-06 | Existing Activity integrates via an adapter                                 | `PROVEN_COMPONENT`           | AKP-4 WP5 Activity tests and frontend Activity workspace evidence                                                |
| AKP6-AC-07 | Attention/noise is bounded with mandatory-risk exception                    | `PROVEN_COMPONENT`           | AKP-7 ranking/mandatory visibility tests and UI records                                                          |
| AKP6-AC-08 | Commands are server-authoritative and capability-derived                    | `PROVEN_COMPONENT`           | AKP-7 command/API integration and authority-negative tests                                                       |
| AKP6-AC-09 | Degraded/partial states are explicit                                        | `PROVEN_COMPONENT`           | Semantic degradation and Product state evidence; final D/O journey remains                                       |
| AKP6-AC-10 | Keyboard, focus, and accessibility are proven                               | `PROVEN_COMPONENT`           | Frontend accessibility and workspace verification records                                                        |
| AKP6-AC-11 | Project/cache/non-disclosure is proven                                      | `PARTIAL_COMPONENT_EVIDENCE` | Cross-project negatives exist; all semantic/Discovery/Graph/Review/Activity/feedback surfaces need one H fixture |

### AKP7 — Feedback, suppression, and ranking

| AC         | Criterion                                                                                       | Status                       | Evidence / remaining work                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| AKP7-AC-01 | Feedback and audit are append-only                                                              | `PROVEN_COMPONENT`           | AKP-7 WP1/WP2/WP4 contract/database history tests                                          |
| AKP7-AC-02 | Epistemic and utility schemas are distinct                                                      | `PROVEN_COMPONENT`           | AKP-7 feedback contract and integration tests                                              |
| AKP7-AC-03 | Epistemic feedback routes to correction/validation                                              | `PROVEN_COMPONENT`           | AKP-7 WP4 six-kind routing/re-entry tests; ADR-150 fail-closed comparator boundary         |
| AKP7-AC-04 | Utility feedback cannot change Evidence/Fact/Claim authority                                    | `PROVEN_COMPONENT`           | Feedback command and authority-negative tests                                              |
| AKP7-AC-05 | Dedupe and user suppression are separate                                                        | `PROVEN_COMPONENT`           | AKP-7 WP1 database and WP2 API tests                                                       |
| AKP7-AC-06 | Snooze is temporary and history-preserving                                                      | `PROVEN_COMPONENT`           | Snooze expiry/history contract and database tests                                          |
| AKP7-AC-07 | Suppress-similar is explicit and versioned                                                      | `PROVEN_COMPONENT`           | Exact fingerprint/version and similar-suppression tests                                    |
| AKP7-AC-08 | Mandatory material Conflict/Safety/Policy visibility cannot be erased by preference suppression | `PROVEN_COMPONENT`           | Mandatory visibility contract/database tests                                               |
| AKP7-AC-09 | Ranking is deterministic, versioned, and explainable                                            | `PROVEN_COMPONENT`           | Ranking contract/database tests and implementation record                                  |
| AKP7-AC-10 | Implicit telemetry/ML is not a v1 requirement                                                   | `PROVEN_EXISTING`            | Accepted v1 boundary and deterministic ranking record; no telemetry dependency added       |
| AKP7-AC-11 | Feedback retention and project security are proven                                              | `PARTIAL_COMPONENT_EVIDENCE` | Feedback history/security tests exist; AKP-specific restore/retention and H closure remain |

### AKP8 — Final acceptance and closure

| AC         | Criterion                                                                       | Status                       | Evidence / remaining work                                                                   |
| ---------- | ------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| AKP8-AC-01 | E2E A-P is evidenced                                                            | `MISSING_ACCEPTANCE_TEST`    | ADR-142 defines the required journeys; this matrix finds no final A-P campaign              |
| AKP8-AC-02 | All PAC and Section AC dispositions are complete                                | `MISSING_ACCEPTANCE_TEST`    | WP1 provides the first complete row register; open/partial rows remain                      |
| AKP8-AC-03 | No Critical/High unresolved cross-section gap                                   | `PARTIAL_COMPONENT_EVIDENCE` | No direct Critical authority violation found, but six High closure gaps remain              |
| AKP8-AC-04 | Security/degraded/restart/invalidation are proven beyond happy paths            | `PARTIAL_COMPONENT_EVIDENCE` | Negative/component evidence exists; final cross-surface and lifecycle fixtures remain       |
| AKP8-AC-05 | Representative performance/cost is bounded                                      | `PARTIAL_COMPONENT_EVIDENCE` | AKP-3 budget evidence exists; final combined performance/cost acceptance record is absent   |
| AKP8-AC-06 | Exact-head evidence reuse policy is followed                                    | `PROVEN_COMPONENT`           | Baseline and AKP-7 exact-head CI linkage are recorded; apply same rule in closure campaign  |
| AKP8-AC-07 | User explicitly approves completion                                             | `MISSING_ACCEPTANCE_TEST`    | No final user approval is recorded by this WP1 artifact                                     |
| AKP8-AC-08 | Merge/post-merge records AKP v1 COMPLETE and later features become v2/follow-up | `MISSING_ACCEPTANCE_TEST`    | WP1 is Draft-only; no Ready, merge, post-merge completion record, or v1 declaration is made |

## 3. Consolidated Section AC status counts

Counts are row counts, not final pass counts.

| Section   |  Total | `PROVEN_EXISTING` | `PROVEN_COMPONENT` | `PARTIAL_COMPONENT_EVIDENCE` | `MISSING_ACCEPTANCE_TEST` | `EXTERNAL_ACCEPTANCE_DEPENDENCY` |
| --------- | -----: | ----------------: | -----------------: | ---------------------------: | ------------------------: | -------------------------------: |
| AKP0      |      8 |                 7 |                  1 |                            0 |                         0 |                                0 |
| AKP1      |     12 |                 0 |                  6 |                            4 |                         0 |                                2 |
| AKP2      |     11 |                 0 |                 10 |                            1 |                         0 |                                0 |
| AKP3      |     10 |                 0 |                  9 |                            0 |                         0 |                                1 |
| AKP4      |     12 |                 1 |                 10 |                            1 |                         0 |                                0 |
| AKP5      |     11 |                 0 |                 10 |                            1 |                         0 |                                0 |
| AKP6      |     11 |                 0 |                 10 |                            1 |                         0 |                                0 |
| AKP7      |     11 |                 1 |                  9 |                            1 |                         0 |                                0 |
| AKP8      |      8 |                 0 |                  1 |                            3 |                         4 |                                0 |
| **Total** | **94** |             **9** |             **66** |                       **12** |                     **4** |                            **3** |

The three `EXTERNAL_ACCEPTANCE_DEPENDENCY` rows are AKP1-AC-04,
AKP1-AC-08, and AKP3-AC-07. The matrix contains no
`BLOCKED_ARCHITECTURE_GAP` row; ADR-148 is recorded as a blocking accepted
refinement/capability dependency rather than a newly invented architecture gap.

## 4. Accepted AKP-scoped refinement register

| ADR     | Effective rule                                                                                                                                    | Status in this matrix               | Why it is not silently reopened                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| ADR-147 | FACT is reserved/deferred; v1 semantic Product eligibility remains CLAIM, ENTITY, RELATION, EVENT, and DECISION                                   | `APPROVED_NON_BLOCKING_DISPOSITION` | It is an accepted scope boundary; adding FACT would create a new authority and needs a separate decision  |
| ADR-148 | Semantic runtime authority is unified through the bounded R0-R5 repair; no new truth authority is created                                         | `BLOCKING_ACCEPTED_REFINEMENT`      | The repair is a real dependency for final semantic acceptance; WP1 records it and does not work around it |
| ADR-149 | Server derives `discovery-semantic-essence:v1` before persistence while `discovery-fingerprint:v1` remains frozen                                 | `APPROVED_NON_BLOCKING_DISPOSITION` | It refines identity inside the existing Port/quality boundary and does not alter Canonical authority      |
| ADR-150 | No approved epistemic comparator exists; unresolved correction defaults to `INSUFFICIENTLY_RESOLVABLE` and Review remains outcome/lifecycle-bound | `APPROVED_NON_BLOCKING_DISPOSITION` | Fail-closed is intentional v1 behavior; future comparator activation needs a separate approved ADR        |

ADR-143 through ADR-146 are not included in this register because they belong to
the AI settings/HFM stream rather than the AKP-scoped acceptance surface.

## 5. Bounded Deferred register

| Item                                                     | Current disposition                                                                                 | Re-evaluation condition                                                      | Matrix linkage                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------- |
| FACT authority                                           | `APPROVED_NON_BLOCKING_DISPOSITION`; AKP v2/separately scoped follow-up                             | New authority owner, eligibility rules, migration, and rollback are approved | PAC-02, PAC-07; AKP1-AC-01, AKP2-AC-08 |
| General durable queue/workflow product                   | `APPROVED_NON_BLOCKING_DISPOSITION`; existing Outbox/PostgreSQL durable runtime remains v1 boundary | Measured throughput/recovery need plus separate OSS/architecture decision    | PAC-10, PAC-13; AKP4-AC-12             |
| ANN/HNSW/IVFFlat external index                          | `APPROVED_NON_BLOCKING_DISPOSITION`; no promotion without measured need                             | PostgreSQL adapter ceiling is demonstrated by benchmark                      | PAC-02, PAC-26; AKP1-AC-05, 10         |
| Raw/source-exploration semantic corpus                   | `APPROVED_NON_BLOCKING_DISPOSITION`; outside approved Product corpus                                | New source/corpus authority and privacy review                               | PAC-02, PAC-08                         |
| Implicit telemetry/ML ranking                            | `APPROVED_NON_BLOCKING_DISPOSITION`; deterministic versioned ranking is v1                          | Separate product, privacy, and authority approval                            | PAC-21, PAC-22; AKP7-AC-09, 10         |
| Epistemic semantic comparator                            | `APPROVED_NON_BLOCKING_DISPOSITION`; ADR-150 fail-closed unresolved result                          | Separate comparator authority and versioned re-evaluation decision           | PAC-21; AKP7-AC-03                     |
| Live external provider acceptance beyond local negatives | `EXTERNAL_ACCEPTANCE_DEPENDENCY`; ADR-133 remains authority                                         | Named owner and reproducible controlled external environment                 | PAC-23; A-P O; AKP1/3 provider rows    |

## 6. Minimum remaining work plan

The following work packages are proposed from the evidence gaps. They are not
started by this WP1 document, and no implementation authorization is implied.

| Proposed package                                    | Required outcome                                                                                                  | Primary matrix items                                               | Dependency                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| AKP-8 WP2 — Cross-section causal acceptance         | Bounded final fixtures for Canonical, scheduler, feedback, stale Review, conflict, and later reconciliation paths | A, B, C, F, G, L, M, P; PAC-10, 13, 15, 28; AKP4/5/7 and AKP8 rows | Separate GPT request and fixture scope                                  |
| AKP-8 WP3 — Semantic runtime/privacy acceptance     | Close ADR-148 R4/R5 and prove degraded, generation, invalidation, common-scope, and egress behavior               | D, H, I, N, O; PAC-02, 03, 04, 23, 24, 25, 26; AKP1/3 rows         | AKP-1R repair completion or explicit approved disposition               |
| AKP-8 WP4 — Durability/restore/retention acceptance | Prove restart, lease recovery, replay, restore, deletion, and retention across governed findings and feedback     | E, H, N, P; PAC-13, 26, 27; AKP2/4/7 rows                          | Bounded recovery fixture and owner                                      |
| AKP-8 WP5 — Final closure campaign                  | Resolve every PAC/AC row, eliminate or explicitly accept High gaps, record CI and user approval                   | A-P, PAC-01..30, AKP8-AC-01..08                                    | All closure blockers addressed; normal Ready/merge/post-merge only then |

## 7. WP1 non-change and verification record

The WP1 change set is limited to this matrix and its companion audit. It does
not add Product/runtime code, tests, migration, dependency, lockfile, ADR,
repair handoff, or external Action behavior. It remains Draft-only; AKP v1 is
not complete.

Required local verification:

```text
npm run docs:validate
npm run test:architecture
git diff --check
Markdown formatting check for both WP1 documents
```

Product typecheck/lint/database/integration/browser suites are not rerun when
only these Markdown files change. The final PR must use automatic CI only and
must preserve the exact baseline/head evidence policy.
