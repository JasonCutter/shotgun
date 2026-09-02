# AKP v1 Final Acceptance Matrix

- Audit owner: AKP-8 WP1
- Baseline: `main@ddb318f4a447b62c687d9b0ebf25d3df08362192`
- Matrix status: **technical closure candidate; final user approval not recorded**
- Companion audit: [AKP-8 WP1 Final Acceptance & Evidence Gap Audit](./akp-8-wp1-final-acceptance-evidence-audit.md)
- Final closure record: [AKP v1 Final Technical and Governance Closure](./akp-8-final-technical-governance-closure.md)
- Product/runtime changes in WP1: **NONE**

This is the control matrix for all frozen AKP v1 acceptance items. Each row is
classified independently against current canonical evidence. `PROVEN_EXISTING`
means the frozen bounded requirement is directly proven; `PARTIAL_COMPONENT_EVIDENCE`
means the implementation pieces exist but a lifecycle or cross-surface handoff
remains unproven. Neither status alone declares the ADR-142 A-P campaign complete.

The rows and summaries below preserve the historical WP1 audit snapshot and
its intermediate dispositions. The final exact-head reconciliation, including
previous disposition → final disposition → closing evidence for every A-P, PAC,
and Section AC row, is recorded in the linked closure record. That record is the
current technical candidate and deliberately leaves the ADR-142 final user gate
open; it does not declare `AKP v1 COMPLETE`.

### Canonical reconciliation after WP2/WP3/Stage 4 merge (2026-09-02)

The historical candidate wording in the WP2A/WP2/WP3 records is retained as
history. The current canonical sequence is:

- WP2A PR #157 merged as `ba6f8e9e1fd5e2d0335bb054bde1a3d9a2d2fa01`;
- WP2 PR #158 merged as `71920f4bc9f0815a8aae251a898bf5af723140c5`;
- WP3 PR #159 merged as `73044a7844fa008f7b0fce598799e9cba6d9b000`;
- PR #160 final technical/governance closure merged as
  `b2c70eed403e2a51772d8e53b052aaf21339647d`;
- PR #161 Standing AI Policy / Stage 4 completion merged as
  `ddb318f4a447b62c687d9b0ebf25d3df08362192`;
- current canonical `main` is `ddb318f4a447b62c687d9b0ebf25d3df08362192`;
- WP3 post-merge automatic CI #1237 / run `33542369178` passed on that exact
  merge head, including Quality database tests, Frontend E2E, and Required
  Gates.
- PR #161 exact-head CI #1241 / run `33637477935` and post-merge main CI #1242 /
  run `33638529588` both passed.

The final closure record consumes these exact-head results and the accepted
component evidence without rerunning A-P or duplicating accepted suites.

The historical closure baseline `main@73044a7844fa008f7b0fce598799e9cba6d9b000`
is preserved as history; it is not the current canonical subject.

### Standing AI Policy / Stage 4 authority reconciliation

- ADR-153 final disposition is `ACCEPTED / IMPLEMENTED / CANONICAL`. Its
  Project-level policy is provider-bound and layered with provider
  configuration, vault credential revision, deployment ceiling, access scope
  and sensitivity controls.
- The validated ADR-153 correction head is
  `7c5bad0c298a9e00fb5a56dfa9e54a7ea8aa512d`; migration
  `060_project_standing_ai_processing_policy.sql` retains append-only policy
  revisions, `ON DELETE RESTRICT`, HIGH-risk audit and historical A4 records.
- Stage 4 Product implementation head was
  `82c04b2ca5784b95f48bd6a33486a13067007b18`; CI-contract correction head was
  `593bdbda6da1ea375b5810dc1b2c357ee064d3cc`.
- Accepted actual-use evidence is one real execution for SourceVersion
  `b8049064-0b10-44ec-a962-d09ef361669b` using DeepSeek
  `deepseek-v4-flash`: providerResponseId
  `bf795e2e-2050-4e10-98dc-9065b8307f6b`, attemptId
  `fc6e07a9-d0b5-4548-a903-28b91ea5080f`, token usage `6103 / 1845 / 7948`,
  29 READY Candidates, authoritative Evidence binding, deterministic
  Validation, and no Canonical write. This evidence is reused; no provider
  execution is repeated.
- The governed continuation is `SourceVersion → Transformation → Evidence →
governed Stage 4 AI → ClaimCandidate → deterministic Validation`. Candidate
  output remains `DERIVED_INFERENCE`, cannot establish Fact, Stage 4 failure
  cannot invalidate authoritative Source/Evidence, and restricted external
  transfer remains fail-closed.
- Accepted Stage 4 failure-isolation evidence shows that durable Stage 3
  Evidence is authoritative Source success: Standing Policy `OFF` leaves
  Source `SUCCEEDED` with Evidence retained, zero provider calls and zero
  Candidates; provider failure leaves Source `SUCCEEDED` with Evidence retained;
  a genuine Stage 3 failure remains `OUTCOME_INDETERMINATE`; and replay does not
  duplicate the Candidate batch or provider execution.
- CI #1240 / run `33627500881` remains visible as historical test-contract and
  fixture drift: stale standing-policy fixture cleanup after migration 060,
  stale SourceVersion citation expectation, ambiguous Graph `role=status`
  locator, and stale Privacy copy expectation. Its test-only correction was
  committed at `593bdbda6da1ea375b5810dc1b2c357ee064d3cc`; production behavior
  and migration/FK authority were not weakened.

### Reconciliation closure boundary

- A-P remains `16/16 PASS`, reused from accepted exact-head evidence; A-P is not
  rerun by this documentation reconciliation.
- PAC technical closure remains unchanged except for PAC-23 moving from
  component evidence to `PROVEN_EXISTING` because the accepted Standing AI and
  real Stage 4 execution now close its integrated provider/privacy evidence.
- Section AC technical dispositions remain unchanged; the new Stage 4 evidence
  strengthens the existing O/provider boundary without changing its epistemic
  meaning.
- Critical unresolved gaps remain `0`; High unresolved gaps remain `0`.
- Deferred items remain explicit, including FACT authority (ADR-147) and the
  epistemic comparator (ADR-150).
- Final USER approval remains `NOT RECORDED`. The ADR-142 final user gate is
  still open, and `AKP v1 COMPLETE` is not declared.

## Status legend

| Status                              | Meaning                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `PROVEN_EXISTING`                   | Current canonical evidence directly satisfies the row’s independently bounded requirement            |
| `PARTIAL_COMPONENT_EVIDENCE`        | Relevant evidence exists, but the cross-module, lifecycle, or final acceptance handoff is incomplete |
| `MISSING_ACCEPTANCE_TEST`           | Capability is evidenced, but the required final acceptance proof is absent                           |
| `MISSING_PRODUCT_CAPABILITY`        | The normal product capability or operational composition is not complete                             |
| `APPROVED_NON_BLOCKING_DISPOSITION` | User-accepted bounded refinement/deferral that does not expand v1                                    |
| `EXTERNAL_ACCEPTANCE_DEPENDENCY`    | An exact requirement truly needs an external authority/environment acceptance                        |
| `BLOCKED_ARCHITECTURE_GAP`          | A required architecture authority or boundary is absent                                              |
| `NOT_APPLICABLE_BY_FROZEN_CONTRACT` | The frozen contract explicitly excludes the item                                                     |

### WP2R E2E-M disposition (2026-09-01)

The former `E2E-M` `MISSING_PRODUCT_CAPABILITY` gap is remediated by the
bounded AKP-8 WP2R production conflict-signal implementation. E2E-M remains
`NOT YET PROVEN_EXISTING`: only resumed WP2 can prove the complete Conflict
Finding → derived re-entry → Conflict Review → prior `SUPPRESS_SIMILAR` →
mandatory-visibility journey. WP2R does not mark E2E-M PASS or resume WP2.

### WP2A Product remediation disposition (2026-09-01)

The bounded ADR-152 Product remediation is implemented on PR #157. E2E-A is
now `PRODUCT_CAPABILITY_REMEDIATED / FULL E2E ACCEPTANCE STILL PENDING WP2`;
the implementation does not make E2E-A `PROVEN_EXISTING`, and WP2 remains
blocked until the remediation is canonical and the complete journey is
accepted.

| Control                                          | Status                        | Authority / resume condition                                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E2E-A — Canonical-triggered active relation loop | `PARTIAL_COMPONENT_EVIDENCE`  | PRODUCT CAPABILITY REMEDIATED / FULL E2E ACCEPTANCE STILL PENDING WP2. PR #157 now has the bounded Review → Draft → Approval → Canonical Relation path, relation-aware projection, and current-semantics reconciliation evidence; the complete cross-surface E2E-A campaign remains pending. |
| AKP-8 WP2                                        | `BLOCKED_PENDING_REMEDIATION` | The bounded remediation is implemented but not yet canonical/accepted. WP2 remains stopped until the exact PR is reviewed, merged under its gates, and the complete E2E-A journey is accepted.                                                                                               |

The bounded architecture decision is [ADR-152](../architecture/adr/ADR-152-discovery-authoring-and-canonical-relation-change-authority.md)
and its audit is [AKP-8 WP2A](./akp-8-wp2a-discovery-canonical-relation-authority-audit.md).
ADR-152 was explicitly accepted by the User on 2026-09-01 and authorizes only
the bounded Product remediation on PR #157. This matrix still does not resume
WP2, authorize WP3/deployment, or declare AKP v1 complete.

## 1. Frozen PAC-01..30 matrix

| PAC    | Frozen acceptance requirement                                                                                                   | Status                       | Evidence / authority                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | A-P / Section AC linkage                     | Remaining work or disposition                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| PAC-01 | Reuse existing Knowledge Flow; do not create a parallel Canonical phase                                                         | `PROVEN_EXISTING`            | AKP master design, accepted amendments, ADR-142                                                                                                                                                                                                                                                                                                                                                                                                                                                           | A, J, K, M; AKP0-AC-01..04                   | Keep the existing Canonical/Derived boundary through final fixtures                                                   |
| PAC-02 | Vectors are derived and rebuildable; never Canonical, Evidence, or Fact confidence                                              | `PROVEN_EXISTING`            | `tests/unit/semantic-runtime-r4.test.ts`, `tests/database/semantic-runtime-r5-production-chain.database.test.ts`, and `tests/unit/semantic-generation-lifecycle.test.ts` prove the derived/vector boundary, normal composition, persisted candidate activation, pointer/CAS, restart, and rollback behavior                                                                                                                                                                                               | D, I, N; AKP1-AC-01, 10, 11                  | Remaining gap is AKP-specific final acceptance evidence; no missing Product capability or new authority is identified |
| PAC-03 | Lexical search remains independently usable and preserves Evidence/SourceVersion citation                                       | `PROVEN_EXISTING`            | `tests/unit/semantic-runtime-r4.test.ts` and `tests/unit/akp-1-wp5-closure.test.ts` cover lexical-only, semantic-only, Hybrid retrieval and Evidence citation contracts                                                                                                                                                                                                                                                                                                                                   | D, K, O; AKP1-AC-03, 07, 09                  | Preserve the degraded/citation behavior in the final closure fixtures                                                 |
| PAC-04 | Project/access/sensitivity precedes candidate selection; use restrictive common scope/highest sensitivity                       | `PARTIAL_COMPONENT_EVIDENCE` | Semantic privacy tests; AKP-4/5/7 project isolation tests                                                                                                                                                                                                                                                                                                                                                                                                                                                 | H; AKP1-AC-06, 08; AKP2-AC-04                | One all-surface common-scope and egress acceptance fixture remains                                                    |
| PAC-05 | Seven finding types are typed and governed                                                                                      | `PROVEN_EXISTING`            | AKP-2/3 schemas, type mapping and AKP-5 manifest contracts                                                                                                                                                                                                                                                                                                                                                                                                                                                | A, J, K, M; AKP2-AC-01, 11; AKP5-AC-06       | Prove all seven types in a final cross-module campaign                                                                |
| PAC-06 | Finding records durably retain source base/resources/evidence/method/provenance/security/fingerprint/summary                    | `PROVEN_EXISTING`            | AKP-2 finding contracts and AKP-5 provenance/materialization database tests                                                                                                                                                                                                                                                                                                                                                                                                                               | A, K, N; AKP2-AC-03..07                      | Add final retention/restore evidence for the whole governed record                                                    |
| PAC-07 | Discovery/AI cannot directly write Canonical, Claim→Fact, or external Action                                                    | `PROVEN_EXISTING`            | Action, Graph, Review, and history negative tests; authority contracts                                                                                                                                                                                                                                                                                                                                                                                                                                    | J, K; AKP2-AC-02, 08, 09; AKP5-AC-03, 09, 10 | Preserve negative tests in the final A-P campaign                                                                     |
| PAC-08 | Candidate selection reads only bounded authorized neighborhoods; no whole-project/all-pairs LLM loop                            | `PROVEN_EXISTING`            | AKP-3 bounded strategy/candidate contracts and budget evidence                                                                                                                                                                                                                                                                                                                                                                                                                                            | B, H, O; AKP3-AC-01..04, 09                  | Final scheduled/semantic campaign must retain bounds                                                                  |
| PAC-09 | Deterministic, AI, and hybrid methods are distinguishable                                                                       | `PROVEN_EXISTING`            | AKP-3 method/provenance contracts and degradation record                                                                                                                                                                                                                                                                                                                                                                                                                                                  | D, O; AKP3-AC-03, 07                         | Include method labels in final evidence                                                                               |
| PAC-10 | CanonicalCommitted is idempotent, incremental, and reconciles prior findings                                                    | `PARTIAL_COMPONENT_EVIDENCE` | AKP-4 trigger/idempotency/reconciliation database tests                                                                                                                                                                                                                                                                                                                                                                                                                                                   | A, F, P; AKP4-AC-01, 07, 11                  | Prove event-to-finding behavior in one complete fixture                                                               |
| PAC-11 | A real persistent periodic scheduler exists                                                                                     | `PROVEN_EXISTING`            | AKP-4 WP3 contract/database schedule and CAS tests                                                                                                                                                                                                                                                                                                                                                                                                                                                        | B; AKP4-AC-02                                | Add the scheduler-to-finding final journey                                                                            |
| PAC-12 | Manual Discovery is server-authorized and bounded                                                                               | `PROVEN_EXISTING`            | AKP-4 WP3 manual trigger contract/database tests                                                                                                                                                                                                                                                                                                                                                                                                                                                          | B; AKP4-AC-03                                | Include authorization and scope in final acceptance                                                                   |
| PAC-13 | Job/Run/Attempt/Stage are durable, restart-safe, deadline-aware, retry-bounded, and duplicate-safe                              | `PARTIAL_COMPONENT_EVIDENCE` | AKP-4 WP4 durable execution/reclaim/replay database tests                                                                                                                                                                                                                                                                                                                                                                                                                                                 | B, E, P; AKP4-AC-05..09                      | Cross restart/reclaim through final finding and retention/restore                                                     |
| PAC-14 | Exact finding dedupe is separate from feedback/suppression                                                                      | `PROVEN_EXISTING`            | AKP-4 idempotency and AKP-7 dedupe/suppression database tests                                                                                                                                                                                                                                                                                                                                                                                                                                             | C, F; AKP4-AC-07, AKP7-AC-05, 07             | Prove both identities through Product reload                                                                          |
| PAC-15 | Eligible findings automatically enter real Phase-3 validation/re-entry; Review reads normalized eligible resources              | `PARTIAL_COMPONENT_EVIDENCE` | AKP-5 FindingReady/re-entry/materialization and Review evidence now connect through the server-owned accepted-for-authoring bridge on PR #157; complete cross-surface E2E-A acceptance remains pending                                                                                                                                                                                                                                                                                                    | A, G, L, M; AKP5-AC-01, 02, 07, 08           | Review the exact PR/CI evidence and complete the E2E-A Draft/Review/Canonical campaign                                |
| PAC-16 | Derived hypotheses never fabricate SourceVersion or weaken direct Claim authority                                               | `PROVEN_EXISTING`            | AKP-2 provenance/fingerprint and AKP-5 no-fake-SourceVersion tests                                                                                                                                                                                                                                                                                                                                                                                                                                        | K, M; AKP2-AC-02, 06, 08; AKP5-AC-04, 05     | Keep derived provenance visible in final UI evidence                                                                  |
| PAC-17 | Existing ADR-128 Review remains approval authority and validated Discovery is persistent                                        | `PROVEN_EXISTING`            | AKP-5 persistent Review bridge/materialization tests; frontend review tests                                                                                                                                                                                                                                                                                                                                                                                                                               | A, G, J; AKP5-AC-07, 09                      | Add the final Approval handoff to the A journey                                                                       |
| PAC-18 | Product UI explains authority, reason, evidence, provenance, freshness, lifecycle, and actions                                  | `PROVEN_EXISTING`            | AKP-6 API/UI record and frontend workspace/review tests                                                                                                                                                                                                                                                                                                                                                                                                                                                   | A, D, G, J, K; AKP6-AC-01..04, 08, 09        | Prove complete inspectability in final scenarios                                                                      |
| PAC-19 | Graph overlays are distinct from Canonical and have accessible fallback                                                         | `PROVEN_EXISTING`            | Graph overlay unit and negative integration tests                                                                                                                                                                                                                                                                                                                                                                                                                                                         | A, K, M; AKP6-AC-05, 10                      | Include citation/export negative proof                                                                                |
| PAC-20 | Existing Activity/Attention is reused through an adapter                                                                        | `PROVEN_EXISTING`            | AKP-4 WP5 activity contract/database tests; AKP-6/7 UI records                                                                                                                                                                                                                                                                                                                                                                                                                                            | B, H, L; AKP4-AC-10; AKP6-AC-06, 07          | Add cross-surface H and final activity lifecycle evidence                                                             |
| PAC-21 | Epistemic feedback causes correction/validation; utility feedback only ranks/suppresses; mandatory visibility remains           | `PROVEN_EXISTING`            | AKP-7 WP1/WP3/WP4 contract/database/integration tests; ADR-150                                                                                                                                                                                                                                                                                                                                                                                                                                            | C, L, M; AKP7-AC-02..08                      | Final fixture must prove both lanes and mandatory Conflict visibility                                                 |
| PAC-22 | Prioritization is deterministic, versioned, bounded, and explainable; no implicit ML/telemetry requirement                      | `PROVEN_EXISTING`            | AKP-7 ranking contracts/database tests and implementation record                                                                                                                                                                                                                                                                                                                                                                                                                                          | C, L; AKP7-AC-09, 10                         | Retain deterministic ranking evidence in closure campaign                                                             |
| PAC-23 | ADR-133 governs provider, credential, and egress authority; content is not tool/credential authority                            | `PROVEN_EXISTING`            | ADR-133 plus ADR-153 provider/configuration/credential/deployment authority; accepted real Stage 4 execution on SourceVersion `b8049064-0b10-44ec-a962-d09ef361669b` with DeepSeek `deepseek-v4-flash`, 29 READY Candidates, authoritative Evidence, deterministic Validation and no Canonical write; exact-head CI #1241 and post-merge CI #1242                                                                                                                                                         | H, O; AKP1-AC-04, 08; AKP3-AC-07, 08         | Preserve provider-bound policy, Candidate/DERIVED_INFERENCE and restricted fail-closed boundaries; no A-P rerun       |
| PAC-24 | Semantic/AI unavailability degrades safely to typed deterministic/lexical behavior                                              | `PROVEN_EXISTING`            | `tests/unit/semantic-runtime-r4.test.ts` covers lexical health without a generation and conservative degraded classification; AKP-3 WP5 records typed degradation and safe fallback                                                                                                                                                                                                                                                                                                                       | D, O; AKP1-AC-09; AKP3-AC-06, 08             | Broader Product/Graph/Review presentation may be added as closure evidence                                            |
| PAC-25 | Golden Query/Discovery evaluation covers exact, typo, synonym, paraphrase, multilingual, temporal, conflict, and negative cases | `MISSING_ACCEPTANCE_TEST`    | `tests/fixtures/akp-1-semantic-golden-corpus.v1.json` and `tests/unit/akp-1-wp5-closure.test.ts` exact tests: `loads an approved closed Golden Query corpus and preserves Product semantic eligibility`; `compares lexical-only, semantic-only and Hybrid retrieval through the existing Stage 12 evaluator`; `proves security-before-top-k, request-local degradation, and privacy-safe evaluation output`; `records measured local retrieval latency without asserting an invented universal threshold` | D, I, O; AKP1-AC-12; AKP3-AC-10              | Final rank/cutoff acceptance record is missing; this is an evidence gap, not an external dependency                   |
| PAC-26 | Incremental/full semantic equivalence removes obsolete/ineligible resources and preserves retention/sensitivity                 | `PARTIAL_COMPONENT_EVIDENCE` | `tests/unit/semantic-index-parity.test.ts`, generation lifecycle tests, and R5 production-chain evidence cover parity, invalidation, pointer, restart, and stale/security boundaries                                                                                                                                                                                                                                                                                                                      | H, I, N; AKP1-AC-10, 11                      | Integrated equivalence plus governed finding retention/restore proof remains                                          |
| PAC-27 | Findings/re-entry/feedback support backup, restore, project deletion, and audit retention                                       | `PARTIAL_COMPONENT_EVIDENCE` | Existing retention/backup/restore records and AKP-5/7 durable histories                                                                                                                                                                                                                                                                                                                                                                                                                                   | C, E, H, N; AKP2-AC-10; AKP7-AC-11           | Produce AKP-specific restore/deletion/retention acceptance evidence                                                   |
| PAC-28 | All ADR-142 E2E scenarios A-P are mandatory                                                                                     | `MISSING_ACCEPTANCE_TEST`    | ADR-142 defines the campaign; current component inventory is mapped in companion audit                                                                                                                                                                                                                                                                                                                                                                                                                    | A-P; AKP8-AC-01, 04                          | Execute bounded A-P campaign without duplicating all component suites                                                 |
| PAC-29 | Closure requires all PAC/AC, zero Critical/High, Deferred assignments, CI, and user approval                                    | `MISSING_ACCEPTANCE_TEST`    | ADR-142, master design PAC-29, Phase-6 amendment                                                                                                                                                                                                                                                                                                                                                                                                                                                          | All; AKP8-AC-02, 03, 07, 08                  | Resolve five High evidence gaps, record governance approval, normal merge/post-merge                                  |
| PAC-30 | Reuse only exact-head PASS evidence; do not duplicate full campaigns                                                            | `PROVEN_EXISTING`            | ADR-142 exact-head rule; AKP-7 WP5 exact-head CI #1194/#1195 record                                                                                                                                                                                                                                                                                                                                                                                                                                       | AKP8-AC-06                                   | Apply exact SHA/run linkage for each reused result in final closure                                                   |

PAC summary: `PROVEN_EXISTING` 21, `PARTIAL_COMPONENT_EVIDENCE` 6,
`MISSING_ACCEPTANCE_TEST` 3, `MISSING_PRODUCT_CAPABILITY` 0,
`APPROVED_NON_BLOCKING_DISPOSITION` 0, `EXTERNAL_ACCEPTANCE_DEPENDENCY` 0,
`BLOCKED_ARCHITECTURE_GAP` 0, `NOT_APPLICABLE_BY_FROZEN_CONTRACT` 0. A PAC may
have direct component evidence and still remain partial because the final A-P or
cross-section acceptance proof is absent; the former E2E-A authority gap is now
tracked as a remediated Product capability pending canonical review and full
E2E acceptance.

## 2. Frozen Section AC matrix

The following tables include every frozen Section AC criterion from the detailed
design: 94 rows across AKP0 through AKP8. `PROVEN_EXISTING` records a bounded
requirement directly proven by current canonical evidence; `PARTIAL_COMPONENT_EVIDENCE`
records a remaining cross-section or final-campaign gap. AKP8 rows are closure
rows and therefore remain open until the required final campaign and governance
records exist.

### AKP0 — Scope and governance

| AC         | Criterion                                                                        | Status            | Evidence / remaining work                                                                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AKP0-AC-01 | Exact canonical main SHA recorded                                                | `PROVEN_EXISTING` | Historical WP1 snapshot `main@d6ed927654d04a44be0b3b068e7aef69e22d39f0` is retained; current canonical is `main@ddb318f4a447b62c687d9b0ebf25d3df08362192` after PR #161; preserve exact-head linkage |
| AKP0-AC-02 | Every active-knowledge capability classified with repository evidence            | `PROVEN_EXISTING` | Master design, section design, implementation records, and this matrix provide the classification register                                                                                           |
| AKP0-AC-03 | Outbox/Review/Graph/Activity/provider authority reuse identified                 | `PROVEN_EXISTING` | ADR-142, AKP-4/5/6/7 records, and ADR-133 records identify each owner; final journey proof remains open                                                                                              |
| AKP0-AC-04 | PAC and non-scope frozen after whole-design approval                             | `PROVEN_EXISTING` | Accepted AKP architecture record and amendments freeze the boundary                                                                                                                                  |
| AKP0-AC-05 | Every gap has one owner and cross-section dependencies                           | `PROVEN_EXISTING` | GAP-H-01..05 and the remaining-work plan assign owners; future closure updates must retain one owner                                                                                                 |
| AKP0-AC-06 | ADR ownership is unique and approval state is explicit                           | `PROVEN_EXISTING` | Accepted ADR records identify decision owner/status; no duplicate authority found                                                                                                                    |
| AKP0-AC-07 | ADD/Product/migration/dependency/Ready/Merge remain unauthorized before approval | `PROVEN_EXISTING` | WP1 makes no such change; branch remains documentation-only and Draft                                                                                                                                |
| AKP0-AC-08 | Scope expansion requires a Master Scope Amendment                                | `PROVEN_EXISTING` | Master design and ADR-142 boundary retained; no scope amendment introduced                                                                                                                           |

### AKP1 — Hybrid semantic retrieval

| AC         | Criterion                                                                   | Status                       | Evidence / remaining work                                                                                                                                                                              |
| ---------- | --------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AKP1-AC-01 | Vectors are derived/rebuildable and never Canonical/Evidence/confidence     | `PROVEN_EXISTING`            | Semantic runtime R4 and R5 production-chain tests prove the derived boundary, normal `startShotgunApplication` composition, generation pointer, restart, policy/stale, and CAS behavior                | Current R3/R4/R5 evidence is canonical; only AKP-specific final closure evidence remains |
| AKP1-AC-02 | Corpus excludes unapproved/raw bulk content                                 | `PROVEN_EXISTING`            | Semantic corpus/representation contracts and privacy tests; final O campaign remains                                                                                                                   |
| AKP1-AC-03 | Deterministic typed representation, digest, and version exist               | `PROVEN_EXISTING`            | Semantic representation, fingerprint, and generation unit/contract tests                                                                                                                               |
| AKP1-AC-04 | Embedding profile is independent and ADR-133 resolved                       | `PROVEN_EXISTING`            | Profile/registry tests, ADR-133, ADR-153, A9 `ACTUAL_USE_VERIFIED`, R5 deterministic provider-network boundary and accepted Stage 4 actual-use evidence prove the authority boundary                   | Preserve the provider/configuration/credential boundary; no new authority is introduced  |
| AKP1-AC-05 | Vector store is behind a Port; pgvector is only the first adapter candidate | `PROVEN_EXISTING`            | Semantic embedding/index contracts and module architecture boundary                                                                                                                                    |
| AKP1-AC-06 | Authorization and sensitivity are enforced before/in retrieval              | `PROVEN_EXISTING`            | Semantic privacy and cross-project negative tests; final all-surface H proof remains                                                                                                                   |
| AKP1-AC-07 | Hybrid results preserve EvidenceSpan/SourceVersion citation                 | `PROVEN_EXISTING`            | Retriever/citation and Evidence lineage contracts; final K/O journey remains                                                                                                                           |
| AKP1-AC-08 | Query/index embedding follows provider-egress policy                        | `PROVEN_EXISTING`            | ADR-133/153, semantic egress-negative tests, A9 completion record, R5 provider boundary and accepted Stage 4 policy-bound execution prove policy-controlled egress                                     | Preserve deployment ceiling and restricted fail-closed behavior                          |
| AKP1-AC-09 | Semantic degradation falls back to lexical where allowed                    | `PROVEN_EXISTING`            | `tests/unit/semantic-runtime-r4.test.ts` (`keeps lexical search healthy when normal semantic runtime is constructed but no generation exists`) and the AKP-3 WP5 typed degradation record              | Preserve the bounded fallback in final closure evidence                                  |
| AKP1-AC-10 | Incremental invalidation/tombstone and full equivalence are proven          | `PARTIAL_COMPONENT_EVIDENCE` | `tests/unit/semantic-index-parity.test.ts` and generation lifecycle tests cover component parity/invalidation; R5 proves pointer/restart/stale boundaries                                              | One AKP-specific equivalence and governed-retention fixture remains                      |
| AKP1-AC-11 | Generation switch/rollback/pruning do not mutate Canonical                  | `PARTIAL_COMPONENT_EVIDENCE` | `tests/unit/semantic-generation-lifecycle.test.ts` and R5 `uses normal startShotgunApplication composition...` prove persisted activation, pointer/CAS, restart, and rollback boundaries after PR #125 | Final AKP-specific I/N proof remains; no repair work is pending                          |
| AKP1-AC-12 | Golden Query evidence approves final rank/cutoff policy                     | `MISSING_ACCEPTANCE_TEST`    | Golden corpus and `tests/unit/akp-1-wp5-closure.test.ts` evaluator evidence exist                                                                                                                      | Final rank/cutoff acceptance decision and exact recorded result are absent               |

### AKP2 — Finding and provenance model

| AC         | Criterion                                                          | Status                       | Evidence / remaining work                                                                              |
| ---------- | ------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| AKP2-AC-01 | Seven types are schema-discriminated                               | `PROVEN_EXISTING`            | AKP-2/3 type contracts and AKP-5 mapping tests                                                         |
| AKP2-AC-02 | Every finding is explicitly non-Canonical DERIVED_INFERENCE        | `PROVEN_EXISTING`            | Finding/provenance contracts and Graph/Review negative tests                                           |
| AKP2-AC-03 | Generation method and provenance are durable                       | `PROVEN_EXISTING`            | AKP-2 finding contracts and AKP-5 materialization database tests                                       |
| AKP2-AC-04 | Restrictive multi-resource security composition is enforced        | `PROVEN_EXISTING`            | AKP-4/5/7 project isolation and semantic privacy tests; final H journey remains                        |
| AKP2-AC-05 | Lineage supports revalidation and reconciliation                   | `PROVEN_EXISTING`            | AKP-4 reconciliation and AKP-5 freshness/re-entry tests                                                |
| AKP2-AC-06 | Fingerprint is versioned and independent of wording/time           | `PROVEN_EXISTING`            | Fingerprint contracts and ADR-149 semantic essence boundary                                            |
| AKP2-AC-07 | Lifecycle/history is retained, including RESOLVED/STALE/SUPERSEDED | `PROVEN_EXISTING`            | AKP-4/5 lifecycle/reconciliation and AKP-7 history tests; restore proof remains                        |
| AKP2-AC-08 | Signals cannot become Fact confidence                              | `PROVEN_EXISTING`            | Semantic truth-boundary, finding, and feedback negative tests; ADR-147 retained                        |
| AKP2-AC-09 | Action Suggestion is non-executable                                | `PROVEN_EXISTING`            | Action contract/API/browser negative and governed lifecycle tests                                      |
| AKP2-AC-10 | Governed findings participate in retention/backup policy           | `PARTIAL_COMPONENT_EVIDENCE` | Existing retention/backup records and durable schemas; AKP-specific restore/retention campaign remains |
| AKP2-AC-11 | Explicit type-to-governance mapping exists                         | `PROVEN_EXISTING`            | AKP-5 strict manifest and seven-type mapping contracts                                                 |

### AKP3 — Active Discovery engine

| AC         | Criterion                                                             | Status            | Evidence / remaining work                                                                                                                                                                        |
| ---------- | --------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AKP3-AC-01 | Strategy registry is versioned and bounded                            | `PROVEN_EXISTING` | AKP-3 strategy registry and deterministic generation contracts                                                                                                                                   |
| AKP3-AC-02 | Signal reads are authorized and version-bound                         | `PROVEN_EXISTING` | AKP-3 bounded candidate/strategy contracts and security tests                                                                                                                                    |
| AKP3-AC-03 | Deterministic, AI, and hybrid methods are distinguishable             | `PROVEN_EXISTING` | AKP-3 method/provenance contracts and evaluation record                                                                                                                                          |
| AKP3-AC-04 | Relation/conflict/pattern candidate space is bounded before AI        | `PROVEN_EXISTING` | AKP-3 candidate enumeration and budget tests                                                                                                                                                     |
| AKP3-AC-05 | Every frozen v1 type has accepted generation/disposition              | `PROVEN_EXISTING` | Seven-type mapping, accepted amendments, and AKP-3 evaluation record                                                                                                                             |
| AKP3-AC-06 | Deterministic quality gate runs before persistence                    | `PROVEN_EXISTING` | AKP-3 quality/degradation contracts; final cross-section evidence remains                                                                                                                        |
| AKP3-AC-07 | DiscoveryModelProfile is distinct and ADR-133-pinned                  | `PROVEN_EXISTING` | Profile/registry tests, ADR-133/153 authority records, A9 completion state, deterministic R5 provider boundary and accepted Stage 4 provider/model identity prove the distinction and policy pin | Preserve the durable execution identity and provider-bound Standing AI policy; no external acceptance is required |
| AKP3-AC-08 | Prompt injection/content cannot alter policy or execute tools/Actions | `PROVEN_EXISTING` | AKP-3 WP5 evaluation/degradation/security closure records prompt injection/data-only handling, typed degradation, and negative Action/tool boundaries                                            | Preserve the negative proof in final closure evidence                                                             |
| AKP3-AC-09 | Token, cost, time, and concurrency budgets are enforced               | `PROVEN_EXISTING` | AKP-3 evaluation/degradation record and budget tests                                                                                                                                             |
| AKP3-AC-10 | Positive/negative quality fixtures include conflict cases             | `PROVEN_EXISTING` | AKP-3 evaluation fixtures and conflict strategy tests; final rank/cutoff record remains                                                                                                          |

### AKP4 — Durable Discovery orchestration

| AC         | Criterion                                                               | Status                       | Evidence / remaining work                                                         |
| ---------- | ----------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------- |
| AKP4-AC-01 | CanonicalCommitted creates one idempotent incremental logical Job       | `PROVEN_EXISTING`            | AKP-4 WP2 contract/database trigger tests; complete A/F chain remains             |
| AKP4-AC-02 | Persistent periodic scheduler exists, not enum-only                     | `PROVEN_EXISTING`            | AKP-4 WP3 scheduler persistence/CAS tests; complete B chain remains               |
| AKP4-AC-03 | Manual trigger is server-authorized and bounded                         | `PROVEN_EXISTING`            | AKP-4 WP3 manual trigger contract/database tests                                  |
| AKP4-AC-04 | Discovery never runs inside the Canonical transaction                   | `PROVEN_EXISTING`            | AKP-4 trigger and execution boundary tests                                        |
| AKP4-AC-05 | Projection base, readiness, deadline, and fallback are explicit         | `PROVEN_EXISTING`            | AKP-4 WP2 projection wait/deadline tests; P presentation remains                  |
| AKP4-AC-06 | Job/Run/Attempt/Stage survive restart                                   | `PROVEN_EXISTING`            | AKP-4 WP4 durable stage/reclaim tests; final E journey remains                    |
| AKP4-AC-07 | Duplicate delivery cannot create duplicate Domain work                  | `PROVEN_EXISTING`            | AKP-4 trigger uniqueness and execution replay tests                               |
| AKP4-AC-08 | Lease/retry preserves prior failure context                             | `PROVEN_EXISTING`            | AKP-4 WP4 retry/reclaim database tests                                            |
| AKP4-AC-09 | Budgets persist across retries                                          | `PROVEN_EXISTING`            | AKP-4 WP4 cumulative budget/reclaim tests                                         |
| AKP4-AC-10 | Existing Activity integrates via an adapter                             | `PROVEN_EXISTING`            | AKP-4 WP5 Activity contract/database tests                                        |
| AKP4-AC-11 | Canonical changes reconcile prior findings                              | `PARTIAL_COMPONENT_EVIDENCE` | AKP-4 reconciliation tests exist; final A/P lifecycle and Product evidence remain |
| AKP4-AC-12 | No generalized queue/workflow dependency without separate need/approval | `PROVEN_EXISTING`            | Existing Outbox/PostgreSQL boundary retained; generalized queue remains deferred  |

### AKP5 — Validation and Review re-entry

| AC         | Criterion                                                                 | Status                       | Evidence / remaining work                                           |
| ---------- | ------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------- |
| AKP5-AC-01 | Real persistent FindingReady consumer exists                              | `PROVEN_EXISTING`            | AKP-4 WP4 replay and AKP-5 consumer tests                           |
| AKP5-AC-02 | Eligible findings automatically enter idempotent re-entry                 | `PROVEN_EXISTING`            | AKP-5 WP1/WP2 contract/database tests; complete A/L/M proof remains |
| AKP5-AC-03 | Direct ClaimCandidate semantics remain unchanged                          | `PROVEN_EXISTING`            | AKP-5 origin/manifest contracts and authority negatives             |
| AKP5-AC-04 | Separate derived-provenance validation origin/profile exists              | `PROVEN_EXISTING`            | AKP-5 derived origin and lineage contracts                          |
| AKP5-AC-05 | No fake SourceVersion is created                                          | `PROVEN_EXISTING`            | AKP-5 WP1/WP5 provenance and freshness tests                        |
| AKP5-AC-06 | All seven finding types have governed mapping                             | `PROVEN_EXISTING`            | AKP-5 strict mapping contracts and database materialization tests   |
| AKP5-AC-07 | Review reads persistent review-eligible derived resources, not raw source | `PROVEN_EXISTING`            | AKP-5 persistent Review bridge/materialization tests                |
| AKP5-AC-08 | Stale base fails closed or revalidates                                    | `PROVEN_EXISTING`            | AKP-5 WP5 stale/freshness/security database tests                   |
| AKP5-AC-09 | ADR-128 remains approval authority                                        | `PROVEN_EXISTING`            | Review security and approval boundary tests                         |
| AKP5-AC-10 | Action cannot execute without external Action governance                  | `PROVEN_EXISTING`            | Action contract/API/browser lifecycle and negative tests            |
| AKP5-AC-11 | Accepted Canonical change keeps origin/provenance history                 | `PARTIAL_COMPONENT_EVIDENCE` | Origin/history contracts exist; final A canonical loop remains      |

### AKP6 — Product UI and read model

| AC         | Criterion                                                                   | Status                       | Evidence / remaining work                                                                                        |
| ---------- | --------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| AKP6-AC-01 | Product UI exists, not backend-only                                         | `PROVEN_EXISTING`            | AKP-6 Product API record and frontend workspace/browser evidence                                                 |
| AKP6-AC-02 | Derived authority is visibly distinct                                       | `PROVEN_EXISTING`            | Discovery/Graph/Review UI contracts and negative tests                                                           |
| AKP6-AC-03 | Why, evidence, provenance, and freshness are inspectable subject to masking | `PROVEN_EXISTING`            | Frontend knowledge/review/history and security evidence                                                          |
| AKP6-AC-04 | Automatic re-entry state is visible and Review is reused only when ready    | `PROVEN_EXISTING`            | AKP-5 lifecycle plus frontend review tests; final A/G/L presentation remains                                     |
| AKP6-AC-05 | Candidate Graph semantics are distinct and have accessible fallback         | `PROVEN_EXISTING`            | Graph overlay unit/integration negatives and frontend Graph evidence                                             |
| AKP6-AC-06 | Existing Activity integrates via an adapter                                 | `PROVEN_EXISTING`            | AKP-4 WP5 Activity tests and frontend Activity workspace evidence                                                |
| AKP6-AC-07 | Attention/noise is bounded with mandatory-risk exception                    | `PROVEN_EXISTING`            | AKP-7 ranking/mandatory visibility tests and UI records                                                          |
| AKP6-AC-08 | Commands are server-authoritative and capability-derived                    | `PROVEN_EXISTING`            | AKP-7 command/API integration and authority-negative tests                                                       |
| AKP6-AC-09 | Degraded/partial states are explicit                                        | `PROVEN_EXISTING`            | Semantic degradation and Product state evidence; final D/O journey remains                                       |
| AKP6-AC-10 | Keyboard, focus, and accessibility are proven                               | `PROVEN_EXISTING`            | Frontend accessibility and workspace verification records                                                        |
| AKP6-AC-11 | Project/cache/non-disclosure is proven                                      | `PARTIAL_COMPONENT_EVIDENCE` | Cross-project negatives exist; all semantic/Discovery/Graph/Review/Activity/feedback surfaces need one H fixture |

### AKP7 — Feedback, suppression, and ranking

| AC         | Criterion                                                                                       | Status                       | Evidence / remaining work                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| AKP7-AC-01 | Feedback and audit are append-only                                                              | `PROVEN_EXISTING`            | AKP-7 WP1/WP2/WP4 contract/database history tests                                          |
| AKP7-AC-02 | Epistemic and utility schemas are distinct                                                      | `PROVEN_EXISTING`            | AKP-7 feedback contract and integration tests                                              |
| AKP7-AC-03 | Epistemic feedback routes to correction/validation                                              | `PROVEN_EXISTING`            | AKP-7 WP4 six-kind routing/re-entry tests; ADR-150 fail-closed comparator boundary         |
| AKP7-AC-04 | Utility feedback cannot change Evidence/Fact/Claim authority                                    | `PROVEN_EXISTING`            | Feedback command and authority-negative tests                                              |
| AKP7-AC-05 | Dedupe and user suppression are separate                                                        | `PROVEN_EXISTING`            | AKP-7 WP1 database and WP2 API tests                                                       |
| AKP7-AC-06 | Snooze is temporary and history-preserving                                                      | `PROVEN_EXISTING`            | Snooze expiry/history contract and database tests                                          |
| AKP7-AC-07 | Suppress-similar is explicit and versioned                                                      | `PROVEN_EXISTING`            | Exact fingerprint/version and similar-suppression tests                                    |
| AKP7-AC-08 | Mandatory material Conflict/Safety/Policy visibility cannot be erased by preference suppression | `PROVEN_EXISTING`            | Mandatory visibility contract/database tests                                               |
| AKP7-AC-09 | Ranking is deterministic, versioned, and explainable                                            | `PROVEN_EXISTING`            | Ranking contract/database tests and implementation record                                  |
| AKP7-AC-10 | Implicit telemetry/ML is not a v1 requirement                                                   | `PROVEN_EXISTING`            | Accepted v1 boundary and deterministic ranking record; no telemetry dependency added       |
| AKP7-AC-11 | Feedback retention and project security are proven                                              | `PARTIAL_COMPONENT_EVIDENCE` | Feedback history/security tests exist; AKP-specific restore/retention and H closure remain |

### AKP8 — Final acceptance and closure

| AC         | Criterion                                                                       | Status                       | Evidence / remaining work                                                                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AKP8-AC-01 | E2E A-P is evidenced                                                            | `MISSING_ACCEPTANCE_TEST`    | ADR-142 defines the required journeys; WP2R supplies the formerly missing conflict-signal capability, and E2E-A is PRODUCT CAPABILITY REMEDIATED / FULL E2E ACCEPTANCE STILL PENDING WP2. No final A-P campaign exists and E2E-M remains NOT YET PROVEN_EXISTING |
| AKP8-AC-02 | All PAC and Section AC dispositions are complete                                | `MISSING_ACCEPTANCE_TEST`    | WP1 provides the first complete row register; open/partial rows remain                                                                                                                                                                                           |
| AKP8-AC-03 | No Critical/High unresolved cross-section gap                                   | `PARTIAL_COMPONENT_EVIDENCE` | No direct Critical authority violation found; the former High E2E-A Canonical Relation authority gap is product-remediated on PR #157, while five other High evidence gaps remain in the companion audit                                                         | Complete the exact PR review and close or explicitly disposition the remaining High gaps |
| AKP8-AC-04 | Security/degraded/restart/invalidation are proven beyond happy paths            | `PARTIAL_COMPONENT_EVIDENCE` | Negative/component evidence exists; final cross-surface and lifecycle fixtures remain                                                                                                                                                                            |
| AKP8-AC-05 | Representative performance/cost is bounded                                      | `PARTIAL_COMPONENT_EVIDENCE` | AKP-3 budget evidence and `tests/unit/akp-1-wp5-closure.test.ts` measured local retrieval latency are present                                                                                                                                                    | Final combined performance/cost acceptance record remains                                |
| AKP8-AC-06 | Exact-head evidence reuse policy is followed                                    | `PROVEN_EXISTING`            | Baseline and AKP-7 exact-head CI linkage are recorded; this WP1 commit applies the same exact-SHA rule                                                                                                                                                           | Use exact SHA/run linkage for each reused result in the final closure campaign           |
| AKP8-AC-07 | User explicitly approves completion                                             | `MISSING_ACCEPTANCE_TEST`    | No final user approval is recorded by this WP1 artifact                                                                                                                                                                                                          |
| AKP8-AC-08 | Merge/post-merge records AKP v1 COMPLETE and later features become v2/follow-up | `MISSING_ACCEPTANCE_TEST`    | WP1 is Draft-only; no Ready, merge, post-merge completion record, or v1 declaration is made                                                                                                                                                                      |

## 3. Consolidated Section AC status counts

Counts are row counts, not final pass counts.

| Section   |  Total | `PROVEN_EXISTING` | `PARTIAL_COMPONENT_EVIDENCE` | `MISSING_ACCEPTANCE_TEST` | `MISSING_PRODUCT_CAPABILITY` | `APPROVED_NON_BLOCKING_DISPOSITION` | `EXTERNAL_ACCEPTANCE_DEPENDENCY` | `BLOCKED_ARCHITECTURE_GAP` | `NOT_APPLICABLE_BY_FROZEN_CONTRACT` |
| --------- | -----: | ----------------: | ---------------------------: | ------------------------: | ---------------------------: | ----------------------------------: | -------------------------------: | -------------------------: | ----------------------------------: |
| AKP0      |      8 |                 8 |                            0 |                         0 |                            0 |                                   0 |                                0 |                          0 |                                   0 |
| AKP1      |     12 |                 9 |                            2 |                         1 |                            0 |                                   0 |                                0 |                          0 |                                   0 |
| AKP2      |     11 |                10 |                            1 |                         0 |                            0 |                                   0 |                                0 |                          0 |                                   0 |
| AKP3      |     10 |                10 |                            0 |                         0 |                            0 |                                   0 |                                0 |                          0 |                                   0 |
| AKP4      |     12 |                11 |                            1 |                         0 |                            0 |                                   0 |                                0 |                          0 |                                   0 |
| AKP5      |     11 |                10 |                            1 |                         0 |                            0 |                                   0 |                                0 |                          0 |
| AKP6      |     11 |                10 |                            1 |                         0 |                            0 |                                   0 |                                0 |                          0 |                                   0 |
| AKP7      |     11 |                10 |                            1 |                         0 |                            0 |                                   0 |                                0 |                          0 |                                   0 |
| AKP8      |      8 |                 1 |                            3 |                         4 |                            0 |                                   0 |                                0 |                          0 |                                   0 |
| **Total** | **94** |            **79** |                       **10** |                     **5** |                        **0** |                               **0** |                            **0** |                      **0** |                               **0** |

The former E2E-A `BLOCKED_ARCHITECTURE_GAP` is remediated by the bounded
Product implementation on PR #157. No `EXTERNAL_ACCEPTANCE_DEPENDENCY` or
`MISSING_PRODUCT_CAPABILITY` row is introduced; the remaining E2E-A and AKP8
work is acceptance evidence and canonical review. ADR-148 remains an accepted
implementation-mechanics refinement whose repair is already merged.

## 4. Accepted AKP-scoped refinement register

| ADR     | Effective rule                                                                                                                                    | Status in this matrix               | Why it is not silently reopened                                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ADR-147 | FACT is reserved/deferred; v1 semantic Product eligibility remains CLAIM, ENTITY, RELATION, EVENT, and DECISION                                   | `APPROVED_NON_BLOCKING_DISPOSITION` | It is an accepted scope boundary; adding FACT would create a new authority and needs a separate decision                                                                                                     |
| ADR-148 | Semantic runtime authority is unified through the bounded R0-R5 repair; no new truth authority is created                                         | `APPROVED_NON_BLOCKING_DISPOSITION` | Accepted implementation-mechanics refinement; PR #125 is merged and current R4/R5 production-composition evidence exists. Remaining proof is AKP-specific acceptance evidence, not unfinished Product repair |
| ADR-149 | Server derives `discovery-semantic-essence:v1` before persistence while `discovery-fingerprint:v1` remains frozen                                 | `APPROVED_NON_BLOCKING_DISPOSITION` | It refines identity inside the existing Port/quality boundary and does not alter Canonical authority                                                                                                         |
| ADR-150 | No approved epistemic comparator exists; unresolved correction defaults to `INSUFFICIENTLY_RESOLVABLE` and Review remains outcome/lifecycle-bound | `APPROVED_NON_BLOCKING_DISPOSITION` | Fail-closed is intentional v1 behavior; future comparator activation needs a separate approved ADR                                                                                                           |

ADR-143 through ADR-146 are not included in this register because they belong to
the AI settings/HFM stream rather than the AKP-scoped acceptance surface.

## 5. Bounded Deferred register

| Item                                   | Current disposition                                                                                 | Re-evaluation condition                                                      | Matrix linkage                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------- |
| FACT authority                         | `APPROVED_NON_BLOCKING_DISPOSITION`; AKP v2/separately scoped follow-up                             | New authority owner, eligibility rules, migration, and rollback are approved | PAC-02, PAC-07; AKP1-AC-01, AKP2-AC-08 |
| General durable queue/workflow product | `APPROVED_NON_BLOCKING_DISPOSITION`; existing Outbox/PostgreSQL durable runtime remains v1 boundary | Measured throughput/recovery need plus separate OSS/architecture decision    | PAC-10, PAC-13; AKP4-AC-12             |
| ANN/HNSW/IVFFlat external index        | `APPROVED_NON_BLOCKING_DISPOSITION`; no promotion without measured need                             | PostgreSQL adapter ceiling is demonstrated by benchmark                      | PAC-02, PAC-26; AKP1-AC-05, 10         |
| Raw/source-exploration semantic corpus | `APPROVED_NON_BLOCKING_DISPOSITION`; outside approved Product corpus                                | New source/corpus authority and privacy review                               | PAC-02, PAC-08                         |
| Implicit telemetry/ML ranking          | `APPROVED_NON_BLOCKING_DISPOSITION`; deterministic versioned ranking is v1                          | Separate product, privacy, and authority approval                            | PAC-21, PAC-22; AKP7-AC-09, 10         |
| Epistemic semantic comparator          | `APPROVED_NON_BLOCKING_DISPOSITION`; ADR-150 fail-closed unresolved result                          | Separate comparator authority and versioned re-evaluation decision           | PAC-21; AKP7-AC-03                     |

## 6. Minimum remaining work plan

The following work packages are proposed from the evidence gaps. They are not
started by this WP1 document, and no implementation authorization is implied.

| Proposed package                                    | Required outcome                                                                                                                                   | Primary matrix items                                               | Dependency                                                                                              |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| AKP-8 WP2 — Cross-section causal acceptance         | Bounded final fixtures for Canonical, scheduler, feedback, stale Review, conflict, and later reconciliation paths                                  | A, B, C, F, G, L, M, P; PAC-10, 13, 15, 28; AKP4/5/7 and AKP8 rows | Separate GPT request and fixture scope                                                                  |
| AKP-8 WP3 — Semantic runtime/privacy acceptance     | Provide AKP-specific acceptance evidence for generation/invalidation/degradation/common-scope/egress behavior; R4/R5 repair is already implemented | D, H, I, N, O; PAC-02, 03, 04, 23, 24, 25, 26; AKP1/3 rows         | GPT issues a bounded evidence-only request; no semantic runtime repair or parallel authority is planned |
| AKP-8 WP4 — Durability/restore/retention acceptance | Prove restart, lease recovery, replay, restore, deletion, and retention across governed findings and feedback                                      | E, H, N, P; PAC-13, 26, 27; AKP2/4/7 rows                          | Bounded recovery fixture and owner                                                                      |
| AKP-8 WP5 — Final closure campaign                  | Resolve every PAC/AC row, eliminate or explicitly accept High gaps, record CI and user approval                                                    | A-P, PAC-01..30, AKP8-AC-01..08                                    | All closure blockers addressed; normal Ready/merge/post-merge only then                                 |

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
