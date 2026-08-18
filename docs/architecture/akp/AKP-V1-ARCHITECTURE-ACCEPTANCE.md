# AKP v1 — Whole-Design Architecture Acceptance Record

- Status: **ACCEPTED**
- Accepted at: 2026-08-12
- Accepted by: `USER`
- Decision owner: `USER`
- Program: `AKP — Active Knowledge Productization v1`
- Canonical audit base: `main@f08ae632220ac613ae0e90c04930ceb323aac40b`
- Accepted whole-design candidate snapshot: `bfb8d1199c209e086c9669dcfcd78896ce7e95e2`
- Accepted ADRs: `ADR-134` through `ADR-142`
- Product implementation: **NOT_AUTHORIZED**
- Migration/dependency changes: **NOT_AUTHORIZED**
- Ready/Merge/Deployment/Production Verification: **NOT_AUTHORIZED**

## 1. Acceptance meaning

The user explicitly approved the AKP v1 whole-design candidate on 2026-08-12. The accepted content is the complete AKP-0 through AKP-8 architecture represented by the candidate snapshot above, including the second-pass whole-design gap corrections already normalized into the design and ADR bodies before approval.

The pre-approval Master and Section Detailed Architecture files remain historical review artifacts and therefore retain their candidate wording in Git history. This Acceptance Record is the authoritative state transition from candidate to accepted architecture. The individual ADR files are separately updated to `ACCEPTED` with the same decision date.

Architecture acceptance does **not** authorize Product implementation. Implementation authorization, Work Package execution, Ready, Merge, Deployment and Production Verification remain separate governance gates.

## 2. Frozen program boundary

AKP v1 contains exactly these Sections unless a user-approved AKP Master Scope Amendment is recorded:

1. AKP-0 — Program Baseline & Completion Contract
2. AKP-1 — Hybrid Semantic Retrieval
3. AKP-2 — Discovery Finding Model
4. AKP-3 — Active Discovery Engine
5. AKP-4 — Trigger, Scheduling & Durable Runtime
6. AKP-5 — Validation Re-entry & Governance
7. AKP-6 — Discovery Product Experience
8. AKP-7 — Feedback & Adaptive Prioritization
9. AKP-8 — End-to-End Active Knowledge Acceptance

## 3. Frozen architecture decisions

The accepted architecture includes these major boundaries:

- Semantic embeddings/vector indexes are rebuildable non-Canonical projections; lexical retrieval and Citation remain independently authoritative for retrieval behavior.
- AKP v1 uses seven Discovery finding types: `KNOWLEDGE_GAP`, `EVIDENCE_GAP`, `RELATION_HYPOTHESIS`, `PATTERN_HYPOTHESIS`, `CONFLICT_HYPOTHESIS`, `CLARIFICATION_QUESTION`, `ACTION_SUGGESTION`.
- Derived multi-resource findings use restrictive common/intersection access scope and highest effective sensitivity.
- AI-assisted Discovery operates only over bounded server-selected candidate neighborhoods; knowledge is data, never executable instruction, and Discovery AI has no tool/external-Action authority.
- Existing Transactional Outbox is reused. Real Canonical-triggered, scheduled and manual Discovery use a durable Job/Run/Attempt lifecycle with bounded projection-wait deadlines and restart/idempotency behavior.
- Eligible durable findings automatically enter a separate `DERIVED_DISCOVERY` provenance-validation/re-entry path; the existing Stage-4 `DIRECT_EVIDENCE` Source Claim contract is not weakened or faked.
- Review consumes only validated/review-eligible persistent derived resources through the existing Review authority; raw findings are not directly approvable Canonical mutations.
- Discovery Product UX reuses existing Knowledge Workspace, Graph, Review, Activity and Attention authorities; derived relation/conflict overlays stay visibly non-Canonical.
- Feedback is append-only and split into epistemic versus preference/utility classes. Preference/suppression never changes Fact confidence/Evidence strength and cannot erase materially new mandatory Conflict/Safety/Policy visibility.
- Semantic invalidation/tombstone, full/incremental rebuild equivalence, query-embedding privacy, governed finding retention/reconciliation and prompt/content isolation are required correctness boundaries.
- AKP v1 completion is finite and requires ADR-142 end-to-end closure evidence, including scenarios A-P.

## 4. Frozen Program Acceptance Criteria

`AKP-PAC-01` through `AKP-PAC-30` in the accepted Master Architecture are frozen as the program completion contract. They may only change through an explicit user-approved AKP Master Scope Amendment that records reason, affected Sections/ADRs and completion-boundary impact.

## 5. Frozen non-scope

AKP v1 does not include autonomous Fact approval, direct Discovery Canonical mutation, automatic external Action execution, generic autonomous web research, model fine-tuning/online self-training, implicit behavior-based truth scoring, mandatory external vector DB adoption, unconditional Raw Source vectorization, a generalized durable-import queue created merely for AKP, self-modifying agents, or redesign of the existing Knowledge Flow/Canonical authority.

## 6. ADR acceptance set

- ADR-134 — Active Knowledge Productization v1 Boundary and Completion Contract
- ADR-135 — Hybrid Semantic Retrieval as a Rebuildable Derived Projection
- ADR-136 — Typed Discovery Finding Envelope and Re-entry Mapping Boundary
- ADR-137 — Bounded Multi-Signal Active Discovery Engine Boundary
- ADR-138 — Durable Triggered Discovery Runtime over Existing Outbox and Job Foundations
- ADR-139 — Discovery Re-entry through Derived-Provenance Validation and Existing Review Authority
- ADR-140 — Discovery Workspace, Graph Overlay and Activity Product Boundary
- ADR-141 — Explicit Feedback Separation, Suppression and Non-Epistemic Adaptive Ranking
- ADR-142 — Finite End-to-End Acceptance Gate and AKP v1 Closure Boundary

All nine decisions were accepted together as one architecture system. Acceptance of one does not remove cross-ADR dependencies.

## 7. Next governance gate

The next permissible step is architecture publication/ADD reflection and Contract/Work Package preparation. Product implementation begins only after explicit implementation authorization. Existing exact-head PASS evidence is reused and unnecessary duplicate tests/CI runs remain prohibited.

## 8. Subsequent architecture refinements

- **2026-08-18 (ADR-147 / AKP-1 WP3 FACT Authority Deferral)**: An implementation audit during AKP-1 WP3 discovered that current canonical `main` contains no backend `FACT` authority model. The user approved [ADR-147](../adr/ADR-147-akp-1-fact-authority-deferral-and-semantic-product-eligibility.md) as a bounded refinement of ADR-135, classifying `FACT` as **RESERVED / DEFERRED** for current Product semantic retrieval while keeping ADR-134..142, AKP-PAC-01..30, and the whole-design acceptance system unchanged. No AKP Section was added or removed, no Master Scope expansion occurred, and Claim/Fact epistemic distinction remains mandatory.