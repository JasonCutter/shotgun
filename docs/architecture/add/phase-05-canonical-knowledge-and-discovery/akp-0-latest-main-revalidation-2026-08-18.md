---
id: AKP-0-LATEST-MAIN-REVALIDATION-260818001
classification: ACCEPTED
status: BASELINE_REVALIDATED_FROZEN
accepted_at: 2026-08-18
accepted_by: USER
program: AKP — Active Knowledge Productization v1
section: AKP-0 — Program Baseline & Completion Contract
original_audit_base: f08ae632220ac613ae0e90c04930ceb323aac40b
subject_base: 4d4623ffde04b1f7d4ca2835b3a3cc0137578a96
governing_adr: ADR-134
product_implementation: NOT_AUTHORIZED
---

# AKP-0 — Latest-main Revalidation and Baseline Freeze

## 1. Authority

This record freezes the user-approved AKP-0 latest-main revalidation against `main@4d4623ffde04b1f7d4ca2835b3a3cc0137578a96`.

It does **not** redesign AKP v1. The accepted AKP Master structure, ADR-134 through ADR-142, AKP-PAC-01 through AKP-PAC-30, Section boundaries and frozen non-scope remain unchanged.

Product code, database migration, dependency change, Ready, merge, deployment and Production Verification remain separately unauthorized.

## 2. Why revalidation was required

The accepted AKP whole-design audit used `main@f08ae632220ac613ae0e90c04930ceb323aac40b`. The repository advanced materially before AKP Product implementation began, including:

- Runtime-selectable AI Settings A1–A9 completion;
- ADR-144 Source classification/security authority repair;
- FE-P5-S1 Activity Product completion;
- ADR-146 and HFM-S0 through HFM-S8 Product-shell completion.

The latest-main audit therefore verifies whether these later changes invalidate, replace, satisfy or sharpen any frozen AKP gap.

## 3. Revalidation result

```text
AKP-0 latest-main revalidation: PASS
New Critical blockers: 0
New High blockers: 0
Master Scope Amendment: NOT_REQUIRED
AKP-PAC change: NOT_REQUIRED
Section change: NOT_REQUIRED
New architecture ADR required before AKP-1: NONE
```

The accepted AKP architecture remains implementable on the current Canonical main.

## 4. Latest capability matrix

| Capability | Latest-main state | AKP disposition |
| --- | --- | --- |
| Canonical revision / History / Transactional Outbox | COMPLETE | REUSE |
| `CanonicalCommitted` durable publication/retry/restart | COMPLETE | REUSE |
| Compiled Truth full/incremental projection | COMPLETE | REUSE |
| PostgreSQL FTS + `pg_trgm` lexical retrieval | COMPLETE | REUSE |
| EvidenceSpan / SourceVersion citation lineage | COMPLETE | REUSE |
| Provider/model/credential/privacy authority foundation | COMPLETE via A1–A9 | REUSE |
| Provider registry embedding capability/model | MISSING | AKP-1 WP1 |
| Semantic embedding execution adapter | MISSING | AKP-1 WP1/WP2 |
| Semantic embedding/vector projection | MISSING | AKP-1 |
| Hybrid lexical + semantic ranking | MISSING | AKP-1 |
| Semantic Golden Query benchmark | MISSING over existing quality foundation | AKP-1 |
| Resource classification durable security pin | COMPLETE via ADR-144 | REUSE |
| Typed Semantic Graph authority foundation | COMPLETE FOUNDATION | REUSE |
| Persistent Discovery -> Graph overlay binding | MISSING | AKP-6 |
| Deterministic disconnected-Entity Knowledge Gap | COMPLETE / NARROW | REUSE + EXPAND |
| Narrow Discovery persistence + exact fingerprint dedupe | COMPLETE / NARROW | REUSE + MIGRATE |
| Seven-type Discovery Finding Envelope | MISSING | AKP-2 |
| Evidence/Relation/Pattern/Conflict/Question/Action discovery | MISSING | AKP-2/3 |
| Multi-signal / AI-assisted Discovery | MISSING | AKP-3 |
| Manual Discovery run | COMPLETE | REUSE |
| Canonical-triggered Discovery | MISSING | AKP-4 |
| Persistent periodic scheduler | MISSING | AKP-4 |
| Durable Discovery Job/Run/Attempt lifecycle | MISSING | AKP-4 |
| Finding reconciliation after Canonical change | MISSING | AKP-4 |
| `reentryPhase: VALIDATION` declaration | PARTIAL | AKP-5 |
| Real derived finding re-entry consumer | MISSING | AKP-5 |
| Direct Source Evidence validation | COMPLETE | REUSE / DO NOT WEAKEN |
| Derived multi-resource provenance validation | MISSING | AKP-5 |
| Review target abstraction | COMPLETE FOUNDATION | REUSE |
| Persistent validated Discovery -> Review source | MISSING | AKP-5 |
| Activity infrastructure | COMPLETE via FE-P5-S1 | REUSE |
| Discovery Activity/Attention adapter | MISSING | AKP-6 |
| PC Global Shell / GUI+Slash interaction foundation | COMPLETE via ADR-146 / HFM | REUSE |
| Discovery Workspace/Product UX | MISSING | AKP-6 |
| Explicit feedback/snooze/suppression | MISSING | AKP-7 |
| Epistemic vs preference feedback separation | MISSING | AKP-7 |
| Adaptive transparent non-epistemic ranking | MISSING | AKP-7 |
| End-to-end governed active loop | MISSING | AKP-8 |

## 5. AI authority clarification

A1–A9 closed the former external dependency at the **authority/runtime foundation** level: provider registry, credential vault, provider-specific privacy, execution pinning and provider routing are Product-capable and reusable.

This does **not** mean embeddings already exist. Current `AIProviderCapability` is limited to `text`, `image`, `audio` and `structuredOutput`; no embedding capability/model or embedding execution adapter is present. AKP-1 therefore owns the semantic embedding capability without reusing the active Ask generation model as embedding authority.

AKP-1 must reuse existing provider identity, credential-vault and privacy/deployment authority while keeping `SemanticEmbeddingProfile` independent from `ProjectAIConfiguration.activeModelId`.

## 6. Security authority clarification

ADR-144 now supplies a stronger reusable boundary than existed at the original AKP audit:

- Principal clearance and Resource classification are distinct;
- server-derived `effectiveResourceSecurity { sensitivity, accessScope }` is durable;
- SourceVersion security identity is pinned across retries/recovery.

AKP multi-resource retrieval/derivation must consume these server-owned classifications and still apply the frozen restrictive-common-scope/highest-sensitivity rule. No Browser-authored scope widening is allowed.

## 7. Product and Activity authority clarification

FE-P5-S1 Activity is COMPLETE and remains the single Activity read authority. AKP-6 adds a Discovery adapter into that system; it does not create a second Activity model.

ADR-146/HFM is the current PC owner-facing shell. AKP-6 must place Discovery capability into the existing Tree / Center Workspace / Right Conversation Pane / Global Composer architecture while preserving GUI+Slash dual-control and Human-Facing Minimalism.

This is implementation-context normalization, not a change to ADR-140 semantics.

## 8. Review gap confirmation

The current Review domain and PostgreSQL repository are real reusable authority. However the production composition still constructs the `DISCOVERY_CANDIDATE` target adapter with an empty in-memory Discovery reader rather than a persistent validated Discovery source.

Therefore the original AKP-5 gap remains valid: raw Stage-10 findings are not yet a persistent validated Review source, and Review must not be wired directly to unvalidated findings.

## 9. Legacy open PR disposition

### PR #30 — Record planned follow-up architecture work

- Hybrid Semantic Retrieval portion: **SUPERSEDED by accepted ADR-135 / AKP-1**.
- Generalized durable knowledge-processing/import queue portion: **DEFERRED / NON-BLOCKING** and remains outside AKP v1 unless independently promoted.
- PR #30 is not an AKP implementation authority.

### PR #70 / PR #72 — FE-P5-S1 preparation branches

FE-P5-S1 is already COMPLETE in Canonical records and implementation evidence. These old Draft PRs are **STALE / NON-BLOCKING legacy branches** and are not AKP authorities.

No open legacy PR blocks AKP-1 Contract preparation.

## 10. Frozen effect on AKP v1

No accepted architecture meaning changes:

- AKP Master structure: unchanged;
- AKP-0 through AKP-8: unchanged;
- AKP-PAC-01 through AKP-PAC-30: unchanged;
- ADR-134 through ADR-142: unchanged;
- frozen non-scope: unchanged;
- final E2E A–P closure set: unchanged.

## 11. Next governance gate

AKP-0 is now:

```text
COMPLETE / BASELINE_REVALIDATED_FROZEN
```

The next permissible work is **AKP-1 Hybrid Semantic Retrieval Contract preparation and freeze** against `main@4d4623ffde04b1f7d4ca2835b3a3cc0137578a96`.

AKP-1 Product implementation still requires a separate explicit USER authorization after its Contract Snapshot and Implementation Request are reviewed and frozen.
