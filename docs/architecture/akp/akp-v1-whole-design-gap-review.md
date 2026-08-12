# AKP v1 — Whole-Design Gap Review and Required Candidate Amendments

- Status: **CANDIDATE REVIEW FINDINGS**
- Subject branch: `docs/akp-v1-full-architecture-candidate`
- Base: `main@f08ae632220ac613ae0e90c04930ceb323aac40b`
- Product implementation: **NOT_AUTHORIZED**

This review was performed only after AKP-0 through AKP-8 were designed together. It records gaps that were not sufficiently explicit in the first full candidate and the required architecture disposition before any ADR is accepted.

## GR-01 — Potential conflict/contradiction needs an explicit finding type

**Finding:** Treating every unresolved/new contradiction as a generic Knowledge Gap hides a core active-knowledge behavior and makes mapping to the existing `CONFLICT` candidate/Review path ambiguous.

**Disposition:** Add `CONFLICT_HYPOTHESIS` to the AKP v1 Discovery finding taxonomy. It represents a *potential* contradiction between approved/current claims/facts/events/relations and is not an already-resolved Canonical Conflict. After derived validation it maps to existing Conflict comparison/review authority. Existing unresolved Canonical Conflict may still generate a Knowledge Gap such as "what evidence is missing to resolve this?"; these are distinct findings.

## GR-02 — Derived security context must use restrictive composition

**Finding:** A derived finding can reference multiple resources with different access scopes/sensitivity. Merely saying "inherit security" is ambiguous and can widen disclosure.

**Disposition:** A multi-resource finding may be created only inside one project. Its effective access scope is no broader than the intersection/authorized common audience of all source resources and execution context; sensitivity is the most restrictive/highest classification among inputs and applicable policy. If no safe common scope exists, cross-resource finding materialization is rejected. AI egress uses this composed classification.

## GR-03 — Semantic projection needs canonical invalidation/tombstone rules

**Finding:** Build/switch/rollback was defined, but incremental update semantics for superseded/retired/deleted knowledge were not explicit.

**Disposition:** Semantic projection consumes the same canonical/projection lineage and applies deterministic upsert/remove/tombstone behavior. An item that is no longer eligible for the active semantic corpus cannot remain retrievable in an active generation. Rebuild equivalence between full and incremental projection is an acceptance requirement.

Old vector payloads are rebuildable cache/projection data: retain only active + bounded last-known-good generations as policy requires, then prune vector payloads safely. Minimal build/audit metadata may be retained longer. Embeddings inherit source sensitivity.

## GR-04 — Query embedding is also external data transfer

**Finding:** Privacy discussion focused on indexing text, but semantic query text may also be sent to an external embedding provider.

**Disposition:** Query-embedding calls resolve through the same ADR-133 provider/credential/egress authority. Sensitive query text is not globally cached or logged. Any cache is project/profile/policy scoped and stores no unnecessary raw text.

## GR-05 — Re-entry is automatic governance flow, not a user opt-in shortcut

**Finding:** The Product candidate wording could imply the user first clicks "send to re-entry". Canonical Step 17 requires Discovery results to return to Phase 3; user authority belongs at Review/Approval, not at whether validation happens.

**Disposition:** Every eligible persisted finding automatically enters the type-appropriate derived validation/re-entry coordinator under policy. Raw findings may remain visible in Discovery UI, but Review Center receives only review-eligible material after validation/comparison preparation. User action in Discovery UI can open the governed Review context; it is not what creates epistemic validity.

## GR-06 — Suppression cannot erase mandatory epistemic/safety visibility

**Finding:** Explicit `SUPPRESS_SIMILAR` could create a filter bubble and hide a serious new contradiction or high-risk finding.

**Disposition:** Suppression affects ordinary Discovery resurfacing/ranking. It cannot suppress mandatory conflict/safety/policy findings from the dedicated Review/Attention surfaces when the underlying facts materially changed or policy marks the finding non-suppressible. A newly material revision is evaluated against suppression policy rather than blindly discarded.

## GR-07 — Discovery/feedback retention differs from semantic-index retention

**Finding:** Semantic vectors are rebuildable; explicit user feedback and governed re-entry/provenance are not fully reconstructable.

**Disposition:** Semantic vector generations are rebuildable projection assets. Discovery findings that entered governance, Reentry manifests, validation links, user feedback and suppression events are durable non-Canonical records and must participate in normal backup/restore/project-deletion/audit retention policy. Ephemeral rejected pre-persistence proposals need not be retained.

## GR-08 — Finding reconciliation after Canonical change is required

**Finding:** A finding can become obsolete or fulfilled after a later approved change; stale-base checks only at Review time are not enough for the Inbox.

**Disposition:** Canonical/projection change triggers bounded finding reconciliation. Findings whose proposed relation/knowledge is now Canonical or whose source resources were superseded become `SUPERSEDED`/`RESOLVED`/stale as appropriate, preserving history. They must not remain presented as fresh unresolved findings.

## GR-09 — AI-assisted Discovery must treat knowledge content as data, never instructions

**Finding:** Approved knowledge may still contain adversarial/prompt-like text. AI-assisted Discovery must not give embedded content control over model behavior or tools.

**Disposition:** Discovery AI inputs use bounded structured envelopes and explicit instruction/data separation. Discovery model calls have no external Action/tool execution authority. Structured output is validated deterministically; content-derived instructions cannot alter system/provider/security/budget policy.

## GR-10 — Projection wait requires a bounded timeout/disposition

**Finding:** `WAITING_FOR_PROJECTION` without timeout/recovery policy can leave a Discovery Job stuck forever.

**Disposition:** Each Job records a maximum projection-wait policy/deadline. On expiry it either proceeds with an explicitly allowed degraded strategy set, becomes `FAILED_RETRYABLE`, or `FAILED_TERMINAL` according to typed policy. No infinite silent wait.

## Effect on candidate design

Before ADR acceptance, the candidate set must reflect:

- seven Discovery finding types, adding `CONFLICT_HYPOTHESIS`;
- restrictive multi-input security composition;
- semantic incremental invalidation/tombstone and retention rules;
- query-embedding egress policy;
- automatic Phase-3 re-entry with Review seeing only review-eligible material;
- suppression exceptions for mandatory conflict/safety visibility;
- durable retention/backup classification for feedback/governed derived records;
- finding reconciliation after Canonical changes;
- prompt-injection/tool isolation for Discovery AI;
- bounded projection-wait timeout.

These amendments remain candidate architecture until explicit user whole-design approval.