---
id: AKP-1-PRODUCT-IMPLEMENTATION-AUTHORIZATION-260818001
classification: ACCEPTED
status: AUTHORIZED_IN_PROGRESS
accepted_at: 2026-08-18
updated_at: 2026-08-19
accepted_by: USER
program: AKP — Active Knowledge Productization v1
section: AKP-1 — Hybrid Semantic Retrieval
subject_base: 3ea9a8ec5aada6f026b8cccd8b72cdc3bae677a5
contract_acceptance: docs/architecture/contracts/snapshots/akp-1/AKP-1-CONTRACT-ACCEPTANCE-260818001.md
repair_contract_amendment: docs/architecture/contracts/snapshots/akp-1/AKP-1-CONTRACT-AMENDMENT-SEMANTIC-RUNTIME-AUTHORITY-260819001.md
governing_adrs: ADR-135, ADR-147, ADR-148
---

# AKP-1 — Product Implementation Authorization

## 1. Current authority

The USER originally authorized AKP-1 Product implementation on 2026-08-18. After a full cross-WP implementation audit on 2026-08-19, the USER explicitly authorized the proposed improvement path and replacement implementation plan.

The active implementation authority is now:

```text
AKP-1R — Cross-WP Semantic Runtime Repair
R0 -> R1 -> R2 -> R3 -> R4 -> R5 -> existing AKP-1 WP5 closure
```

The former WP1–WP5 implementation request is replaced by the current repair plan at:

```text
docs/implementation/akp-1-hybrid-semantic-retrieval-implementation-request-260818001.md
```

The detailed implementation authority is:

```text
docs/implementation/akp-1-semantic-runtime-repair-detailed-design-260819001.md
```

ADR-148 and the semantic runtime Contract Amendment govern the repair.

## 2. Authorized scope

Authorized now:

- R0 architecture/contract/plan replacement and obsolete-current-tree cleanup;
- R1 durable SemanticEmbeddingProfile authority and bounded provider embedding execution router;
- R2 coherent semantic corpus source snapshot and representation v2;
- R3 generation build/persisted validation/CAS/readiness/rollback/pruning repair;
- R4 normal Product semantic composition and explicit server-owned refresh boundary;
- R5 cross-WP production-chain proof;
- after R5 acceptance, existing AKP-1 WP5 final quality/security/privacy/performance closure.

Implementation proceeds in this order. A later Repair WP must not be used to hide an unresolved earlier authority defect.

## 3. Cleanup authority

The USER authorized removal of obsolete implementation material. On the repair branch, code/docs/tests may be deleted when they implement only superseded mechanics and no accepted Product path depends on them.

This does not authorize rewriting Git history or deleting accepted ADR/Canonical/Evidence/audit history. Historical rationale remains available through Git and explicit ADR relationships; obsolete active-tree implementation instructions should not remain as competing authority.

## 4. Branch authority

Repair branch:

```text
codex/akp-1r-semantic-runtime-repair
```

Base:

```text
main@3ea9a8ec5aada6f026b8cccd8b72cdc3bae677a5
```

The existing WP4 Draft PR is superseded and must not be merged into Canonical main. A new Draft PR is the repair vehicle.

## 5. External provider boundary

R1 may implement the real provider embedding connectivity needed by ADR-148 using the already accepted provider/model/credential/privacy authority. At least one concrete external embedding adapter must be production-capable before AKP-1 final closure.

Deterministic fake connectivity is allowed for deterministic tests at the provider-network boundary. Repeated paid/live calls are not required for deterministic mechanics and remain bounded verification work.

No raw credential may leave CredentialVault as generic plaintext Product data.

## 6. Migration and dependency authority

Additive semantic-owned PostgreSQL migrations required by R1/R3 are authorized. No destructive Canonical/Evidence/SourceVersion/Stage-7 migration is authorized.

Existing `pg`/PostgreSQL/pgvector foundations are reused. No external vector database is authorized. New runtime dependencies require demonstrated need; prefer existing platform/runtime facilities where possible.

## 7. Verification discipline

- Never rerun already-PASS exact-head CI.
- R1–R4 use focused changed-scope tests plus normal automatic PR CI for pushed exact heads.
- R5 owns the real cross-WP production-chain proof.
- WP5 owns final Golden Query/security/privacy/performance closure.
- Do not create no-op commits for CI.
- Do not duplicate low-level tests when a stronger cross-WP proof protects the same invariant.

## 8. Explicitly not authorized

- Ready for Review;
- merge;
- deployment;
- Production Verification;
- AKP-2 through AKP-8 implementation;
- Raw Source vectorization;
- FACT Product authority;
- external vector DB;
- automatic AI/Discovery Canonical mutation.

## 9. Current state

```text
AKP-0: COMPLETE / FROZEN
AKP-1 strategy/ADR-135 direction: ACCEPTED / PRESERVED
ADR-147: ACCEPTED / FACT EXCLUDED
ADR-148: ACCEPTED
AKP-1R R0: IN_PROGRESS
AKP-1R R1-R5: AUTHORIZED IN SEQUENCE
AKP-1 WP5: BLOCKED UNTIL R5
Old WP4 Draft: SUPERSEDED / DO_NOT_MERGE
Ready / Merge: NOT_AUTHORIZED
AKP-2+: NOT_STARTED
```