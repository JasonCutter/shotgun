# Active Knowledge Productization v1 — Master Architecture Candidate

- Status: **CANDIDATE / WHOLE-DESIGN REVIEW REQUIRED**
- Program: `AKP — Active Knowledge Productization v1`
- Subject base: `main@f08ae632220ac613ae0e90c04930ceb323aac40b`
- Prepared at: 2026-08-11
- Decision owner: `USER`
- Master structure: **USER-CONFIRMED**
- Detailed architecture decisions: **CANDIDATE / NOT YET ACCEPTED**
- Proposed ADR range: `ADR-134` through `ADR-142`
- Product implementation: **NOT_AUTHORIZED**
- Canonical Phase ADD mutation: **NOT PERFORMED**

> AKP v1 productizes capabilities already designed in Shotgun Knowledge Flow Steps 16, 17, 18/20 and 22. It does not create a new Knowledge Flow phase, does not change Canonical authority, and does not authorize Product implementation. This revision incorporates the completed whole-design gap review; Git history preserves the earlier candidate text.

## 1. Finite program purpose

AKP v1 closes this governed Product loop:

```text
Canonical Commit
  -> Compiled Truth / Search / Graph projections
  -> Hybrid Semantic Retrieval
  -> bounded Active Discovery
  -> durable Derived Finding + provenance/security
  -> automatic Phase 3 derived validation/re-entry
  -> comparison / conflict / impact preparation
  -> existing Review / explicit approval
  -> approved ChangeSet
  -> Canonical
  -> projection refresh + finding reconciliation + Discovery again

Explicit Feedback
  -> epistemic correction -> validation/correction/review
  -> preference/utility -> ranking/suppression only
```

AKP v1 is complete only when this loop works through persistent runtime and Product UI with evidence lineage, security, recovery, failure/degraded states, feedback and final user governance. A backend-only algorithm, manual Discovery endpoint, enum-only scheduler, or `reentryPhase` label with no consumer is insufficient.

## 2. Architecture invariants

AKP must preserve:

1. Canonical is the sole authority for approved knowledge/history.
2. Claim and Fact remain distinct; AI/Discovery cannot auto-promote either.
3. Compiled Truth, lexical/semantic search, Graph overlays and Discovery are derived/non-Canonical.
4. Discovery cannot directly mutate Canonical or execute an external Action.
5. Existing direct Source Evidence semantics remain strict; derived hypotheses use a separate provenance origin.
6. Existing Outbox, Review, Graph, Activity, External Action and AI-provider authority are reused rather than duplicated.
7. Project/access/sensitivity is preserved and restrictively composed for multi-resource derivation.
8. Retrieval/discovery scores are never Fact confidence or Evidence strength.
9. Explicit preference feedback cannot become truth authority.
10. Same-exact-head PASS evidence is reused; duplicate test/CI execution is not required.

## 3. AKP-0 exact-main capability baseline

Audit base: `main@f08ae632220ac613ae0e90c04930ceb323aac40b`.

| Capability | Current state | AKP disposition |
|---|---|---|
| Canonical revision + HistoryEvent + Transactional Outbox | COMPLETE | REUSE |
| `CanonicalCommitted` durable publication/retry/restart | COMPLETE | REUSE |
| Compiled Truth full/incremental projection + digest/readiness | COMPLETE | REUSE |
| PostgreSQL FTS + `pg_trgm` canonical retrieval | COMPLETE | REUSE |
| EvidenceSpan/SourceVersion citation lineage | COMPLETE | REUSE |
| Semantic embedding/vector retrieval | MISSING / DEFERRED | AKP-1 |
| Hybrid lexical+semantic ranking | MISSING | AKP-1 |
| Semantic Golden Query benchmark | MISSING on top of quality foundation | AKP-1 |
| Typed Semantic Graph authority model | COMPLETE FOUNDATION | REUSE |
| Real persistent Discovery -> Graph overlay binding | MISSING | AKP-6 |
| Deterministic disconnected-Entity Knowledge Gap | COMPLETE / NARROW | REUSE + EXPAND |
| Discovery finding persistence + exact fingerprint dedupe | COMPLETE / NARROW | REUSE + MIGRATE |
| Seven-type Discovery finding model | MISSING | AKP-2 |
| Evidence/Relation/Pattern/Conflict/Question/Action discovery | MISSING | AKP-2/3 |
| Multi-signal Discovery using semantic+graph+temporal+evidence | MISSING | AKP-3 |
| AI-assisted Discovery profile/quality/budget | MISSING | AKP-3 |
| Manual Discovery run | COMPLETE | REUSE |
| Canonical-triggered automatic Discovery | MISSING | AKP-4 |
| Real persistent periodic scheduler | MISSING | AKP-4 |
| Durable Discovery Job/Run/Attempt/Stage recovery | MISSING | AKP-4 |
| Finding reconciliation after Canonical change | MISSING | AKP-4 |
| `reentryPhase: VALIDATION` declaration | PARTIAL | AKP-5 |
| Production finding-ready/re-entry consumer | MISSING | AKP-5 |
| Direct-evidence source Claim validation | COMPLETE | REUSE / DO NOT WEAKEN |
| Derived multi-resource provenance validation | MISSING | AKP-5 |
| Review `DISCOVERY_CANDIDATE` target abstraction | PARTIAL FOUNDATION | REUSE |
| Persistent validated Discovery -> Review adapter | MISSING | AKP-5 |
| Discovery Inbox/detail/owner workflow | MISSING | AKP-6 |
| Discovery Activity/Attention adapter | MISSING over reusable foundation | AKP-6 |
| Explicit feedback/snooze/user suppression | MISSING | AKP-7 |
| Epistemic vs preference feedback separation | MISSING | AKP-7 |
| Adaptive transparent non-epistemic ranking | MISSING | AKP-7 |
| ADR-133 provider/model/credential/privacy authority | ACCEPTED ARCHITECTURE / PRODUCT NOT IMPLEMENTED | EXTERNAL DEPENDENCY |
| Full autonomous-but-governed active loop | MISSING | AKP-8 |

## 4. Cross-Section gaps found only after whole-design review

These are now incorporated into ADR-135 through ADR-142:

1. **Derived vs direct Evidence:** multi-resource Discovery cannot masquerade as Stage 4 `DIRECT_EVIDENCE`; AKP-5 owns a separate derived-provenance origin/validation path.
2. **Real scheduling:** `WEEKLY` mode is not a scheduler; AKP-4 owns persistent schedule state and trigger runtime.
3. **Real re-entry:** `DerivedInferenceReady` without a consumer is terminal; AKP-5 owns automatic re-entry.
4. **Review source gap:** Review knows `DISCOVERY_CANDIDATE` but current production wiring has an empty in-memory source; AKP-5 connects validated persistent resources.
5. **Graph bridge gap:** authority types exist but actual persistent Discovery overlay binding is missing; AKP-6 owns it.
6. **Activity bridge gap:** reuse Activity via a Discovery adapter; do not create another activity system.
7. **Dedupe vs user suppression:** fingerprints prevent exact duplicate work; they are not user feedback/suppression.
8. **Restrictive derived security:** multi-resource findings use one project, common/intersection audience and highest effective sensitivity; unsafe composition is rejected.
9. **Independent AI profiles:** active Ask model, SemanticEmbeddingProfile and DiscoveryModelProfile are distinct configuration concerns resolved through ADR-133.
10. **Independent readiness:** semantic failure degrades to healthy lexical retrieval where allowed; it does not make lexical search unavailable.
11. **Durable Discovery != generic queue:** AKP-4 uses existing Outbox/Job foundations and does not promote PR #30's generalized durable processing scope.
12. **Conflict needs first-class finding semantics:** add `CONFLICT_HYPOTHESIS`; do not bury all new contradictions in `KNOWLEDGE_GAP`.
13. **Semantic invalidation:** incremental semantic projection must remove/tombstone superseded/retired/ineligible items and equal a full rebuild at the same base/profile.
14. **Query embedding is egress:** semantic query text follows ADR-133 provider/privacy rules just like indexed text.
15. **Re-entry is automatic governance flow:** user authority is Review/Approval, not whether validation begins.
16. **Suppression safety:** preference suppression cannot hide materially new mandatory Conflict/Safety/Policy findings.
17. **Retention classes differ:** vectors are rebuildable projection assets; governed findings/re-entry/feedback are durable non-Canonical history.
18. **Finding reconciliation:** later Canonical changes resolve/stale/supersede old findings instead of leaving them fresh forever.
19. **Prompt/content isolation:** AI Discovery treats knowledge as data, has no tool/Action authority and validates structured output deterministically.
20. **Projection wait is bounded:** `WAITING_FOR_PROJECTION` has a deadline and typed degraded/retryable/terminal outcome.

## 5. Finite AKP v1 Program Acceptance Criteria

These are candidate completion criteria and freeze only after user whole-design approval.

- **AKP-PAC-01**: AKP remains a Productization program over existing Knowledge Flow; no new Canonical phase/philosophy is introduced.
- **AKP-PAC-02**: embeddings/vector indexes remain rebuildable derived projections and never become Canonical/Evidence/Fact confidence.
- **AKP-PAC-03**: lexical retrieval remains independently usable and every Hybrid result preserves existing Evidence/SourceVersion citation lineage.
- **AKP-PAC-04**: retrieval/discovery enforces project/access/sensitivity before candidate selection; multi-resource derivation uses restrictive common scope/highest sensitivity and rejects unsafe composition.
- **AKP-PAC-05**: v1 supports seven typed findings: Knowledge Gap, Evidence Gap, Relation Hypothesis, Pattern Hypothesis, Conflict Hypothesis, Clarification Question and Action Suggestion.
- **AKP-PAC-06**: every durable finding records source projection/canonical base, related resources/evidence, generation method, rule/model provenance, restrictive security envelope, fingerprint version and derivation summary.
- **AKP-PAC-07**: Discovery/AI never directly write Canonical, promote Claim to Fact or execute external Action.
- **AKP-PAC-08**: Discovery works on bounded authorized neighborhoods/signals; unbounded whole-project LLM prompts/all-pairs autonomous loops are forbidden.
- **AKP-PAC-09**: deterministic, AI-assisted and hybrid generation remain distinguishable in data/UI/audit/evaluation.
- **AKP-PAC-10**: `CanonicalCommitted` idempotently schedules incremental Discovery after eligible projection readiness and also reconciles prior findings.
- **AKP-PAC-11**: a real persistent periodic full-scan scheduler exists; `WEEKLY` enum/manual invocation alone is insufficient.
- **AKP-PAC-12**: authorized manual Discovery remains available under the same budget/security policies.
- **AKP-PAC-13**: Discovery Job/Run/Attempt/Stage is durable, restart-recoverable and bounded; projection waiting has a deadline and duplicate delivery cannot create duplicate logical work.
- **AKP-PAC-14**: exact fingerprint dedupe, user suppression and feedback are distinct persisted concepts.
- **AKP-PAC-15**: every eligible finding automatically enters real Phase-3 derived validation/re-entry; Review receives only review-eligible normalized material.
- **AKP-PAC-16**: derived hypotheses never fake SourceVersion or weaken existing direct-evidence Claim validation.
- **AKP-PAC-17**: Review uses the existing ADR-128 authority and a real persistent validated Discovery source; no parallel approval system exists.
- **AKP-PAC-18**: Product UI explains finding authority/reason/evidence/provenance/freshness/lifecycle and governed next actions without presenting inference as Canonical.
- **AKP-PAC-19**: Graph overlays show derived/discovery relation/conflict semantics distinctly from Canonical with accessible list/table fallback.
- **AKP-PAC-20**: Discovery integrates with existing Activity/Attention; no second Activity authority is introduced.
- **AKP-PAC-21**: epistemic feedback routes to correction/validation; preference/utility affects ranking/suppression only; suppression cannot erase mandatory materially new Conflict/Safety/Policy visibility.
- **AKP-PAC-22**: adaptive prioritization is transparent, deterministic and versioned for v1; ML/fine-tuning/implicit behavior telemetry is not required.
- **AKP-PAC-23**: external index/query embedding and AI-assisted Discovery resolve through ADR-133 authority; SemanticEmbeddingProfile and DiscoveryModelProfile are distinct and execution-pinned; knowledge content cannot gain instruction/tool authority.
- **AKP-PAC-24**: semantic/AI degradation cannot corrupt Canonical; lexical/deterministic fallback, stale/partial/readiness and typed failure behavior are explicit.
- **AKP-PAC-25**: Golden Query/Discovery evaluation covers exact, typo, synonym, paraphrase, multilingual alias, temporal, conflict and negative cases; ranking/cutoffs are evidence-driven, not truth confidence.
- **AKP-PAC-26**: semantic incremental/full rebuilds are logically equivalent at the same base/profile and obsolete/ineligible resources cannot remain active-retrievable; query/index vector data follows sensitivity/retention policy.
- **AKP-PAC-27**: governed findings, re-entry/validation lineage and explicit feedback/suppression participate in normal backup/restore/project-deletion/audit-retention behavior, distinct from disposable vector generations.
- **AKP-PAC-28**: mandatory E2E scenarios prove the complete loop plus conflict, suppression safety, stale-base, tombstone, privacy, prompt isolation, duplicate-event, restart, projection-wait, failure and Action non-execution cases.
- **AKP-PAC-29**: Program closure requires every frozen PAC/Section AC disposition, zero unresolved Critical/High architecture/security gaps, explicit Deferred register, required exact-head CI evidence and final user approval.
- **AKP-PAC-30**: already-PASS evidence at the same exact head is reused; duplicate full test/CI runs are not a completion requirement.

## 6. Frozen candidate non-scope

AKP v1 excludes:

- autonomous AI Fact approval/direct Canonical mutation;
- automatic Canonical Relation/Conflict creation without governed Review/Approval;
- automatic external Action execution from Discovery;
- generic autonomous web research/general Internet agent;
- model fine-tuning, RL, online self-training or self-modifying agents;
- truth-confidence changes from clicks/views/frequency/popularity/approval rate;
- implicit user-behavior telemetry as a required learning input;
- unconditional Raw Source vectorization or collapse of Source Exploration into Canonical vector RAG;
- mandatory Qdrant/OpenSearch/Pinecone/external vector DB;
- a generalized durable-import/knowledge-processing queue created merely for AKP;
- redesign of Knowledge Flow, Claim/Fact or Canonical authority;
- unbounded all-pairs semantic comparisons or iterative agent loops;
- multimodal image/audio/video discovery as v1 completion requirement;
- mandatory independent-provider challenger for every finding.

A new idea enters v1 only when necessary to satisfy a frozen PAC. Otherwise it is AKP v2/follow-up. Section additions/splits require an explicit Master Scope Amendment.

## 7. Section boundaries and completion meaning

| Section | Responsibility | Section end condition | Proposed ADR |
|---|---|---|---|
| AKP-0 | Exact-main audit, PAC/non-scope, dependencies, gap register | Program contract accepted/frozen | ADR-134 |
| AKP-1 | Semantic projection + Hybrid retrieval + benchmark/invalidation/privacy | semantic sensor works with citation/fallback and rebuild correctness | ADR-135 |
| AKP-2 | Seven-type durable Finding Envelope/security/provenance/lifecycle | all v1 finding meanings and re-entry mappings are explicit | ADR-136 |
| AKP-3 | Bounded deterministic/AI multi-signal Discovery engine | every frozen finding type has accepted generation/disposition and quality/budget rules | ADR-137 |
| AKP-4 | Canonical/manual/scheduled triggers + durable runtime + reconciliation | proactive execution survives restart/duplicate/wait failures | ADR-138 |
| AKP-5 | automatic derived validation/re-entry + persistent Review bridge | eligible finding reaches existing governance without weakening direct evidence | ADR-139 |
| AKP-6 | Discovery Inbox/detail + Graph + Activity/Attention Product UX | owner can understand/govern active findings in Product | ADR-140 |
| AKP-7 | explicit feedback, suppression and deterministic adaptive priority | usefulness adapts without changing epistemic authority | ADR-141 |
| AKP-8 | cross-section E2E evidence and finite closure | all final scenarios/PAC/AC pass and user approves completion | ADR-142 |

## 8. Dependency order

```text
AKP-0
  -> AKP-1 Semantic Retrieval
  -> AKP-2 Finding Model
       -> AKP-3 Discovery Engine
            -> AKP-4 Trigger / Durable Runtime
            -> AKP-5 Automatic Re-entry / Governance
                 -> AKP-6 Product Experience
                      -> AKP-7 Feedback / Prioritization
                           -> AKP-8 End-to-End Closure
```

AKP-1 and AKP-2 may prepare independently after AKP-0, but AKP-3 needs both. AKP-4 makes Discovery proactive/durable. AKP-5 consumes durable findings and makes governance real. AKP-6/7 require those real surfaces. AKP-8 depends on all.

External dependency: accepted ADR-133 Product implementation is required before external embedding/AI-assisted Discovery can reach final acceptance. AKP does not duplicate its provider/model/credential/privacy authority.

## 9. Technology posture

- PostgreSQL remains primary persistence.
- `pgvector` is the **first adapter candidate**, not a pre-approved domain dependency.
- existing FTS + `pg_trgm` remains lexical baseline.
- deterministic rank fusion such as RRF is an initial benchmark candidate; final policy comes from quality evidence.
- existing PostgreSQL/in-process Outbox/Job patterns remain AKP-4 baseline; no new queue/workflow service without measured need and separate approval.
- external embedding/Discovery model execution resolves through ADR-133 once implemented.

## 10. ADR candidate inventory

| ADR | Section | Candidate decision | Status |
|---|---|---|---|
| ADR-134 | AKP-0 | Program Boundary and Completion Contract | PROPOSED |
| ADR-135 | AKP-1 | Hybrid Semantic Retrieval as Rebuildable Derived Projection | PROPOSED |
| ADR-136 | AKP-2 | Typed Discovery Finding Envelope and Re-entry Mapping | PROPOSED |
| ADR-137 | AKP-3 | Bounded Multi-Signal Active Discovery Engine | PROPOSED |
| ADR-138 | AKP-4 | Durable Triggered Discovery Runtime over Existing Outbox/Job | PROPOSED |
| ADR-139 | AKP-5 | Derived-Provenance Re-entry through Existing Review Authority | PROPOSED |
| ADR-140 | AKP-6 | Discovery Workspace, Graph Overlay and Activity Boundary | PROPOSED |
| ADR-141 | AKP-7 | Explicit Feedback, Suppression and Non-Epistemic Ranking | PROPOSED |
| ADR-142 | AKP-8 | Finite E2E Acceptance and Closure Boundary | PROPOSED |

## 11. Whole-design approval gate

Before any AKP ADR becomes ACCEPTED, Phase ADD changes, migration/dependency work, or Product implementation is authorized, the user reviews this entire architecture system and either:

- approves the full candidate; or
- identifies amendments, which are recorded explicitly and reconciled across affected ADRs/Section contracts before approval.

Only accepted decisions are then reflected into the canonical Phase ADD/architecture records. The current Draft PR deliberately leaves canonical ADD unchanged.