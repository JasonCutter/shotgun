---
id: AKP-1-PRODUCT-IMPLEMENTATION-AUTHORIZATION-260818001
classification: ACCEPTED
status: AUTHORIZED_PENDING_CANONICALIZATION
accepted_at: 2026-08-18
accepted_by: USER
program: AKP — Active Knowledge Productization v1
section: AKP-1 — Hybrid Semantic Retrieval
subject_base: 4d4623ffde04b1f7d4ca2835b3a3cc0137578a96
contract_acceptance: docs/architecture/contracts/snapshots/akp-1/AKP-1-CONTRACT-ACCEPTANCE-260818001.md
governing_adr: ADR-135
---

# AKP-1 — Product Implementation Authorization

## 1. Authority

The USER explicitly instructed Shotgun to begin AKP-1 on 2026-08-18 after the AKP-1 Contract had been accepted and frozen.

This record authorizes AKP-1 Product implementation under the frozen Contract and Work Package sequence. It does **not** authorize Ready for Review, merge, deployment, Production Verification, AKP-2, or any scope outside AKP-1.

Because the frozen AKP-0 baseline and AKP-1 Contract are still carried by Draft PR #120 rather than Canonical `main`, implementation execution is gated as follows:

```text
Product implementation authority: AUTHORIZED
Execution before PR #120 canonicalization: BLOCKED
Execution after PR #120 canonicalization: AUTHORIZED
First implementation unit: AKP-1 WP1 only
Ready / Merge: NOT_AUTHORIZED
AKP-2+: NOT_AUTHORIZED
```

No implementation branch may treat this record as permission to bypass Canonical architecture/Contract authority.

## 2. Authorized implementation scope

Only the frozen AKP-1 sequence is authorized:

1. WP1 — Contracts, semantic representation, embedding capability and profile
2. WP2 — Projection persistence and PostgreSQL/pgvector adapter
3. WP3 — Semantic retrieval, Hybrid coordinator and citation preservation
4. WP4 — Incremental lifecycle, invalidation, readiness and generation switch
5. WP5 — Quality, security, privacy, performance and Section closure evidence

Implementation proceeds one Work Package at a time. WP2 cannot begin until WP1 is reviewed and accepted, and the same rule applies through WP5.

## 3. WP1 execution boundary

After PR #120 is Canonicalized, WP1 may implement only:

- deterministic typed semantic representation for Claim, Fact, Entity, Relation, Event and Decision;
- representation version and semantic text digest;
- independent semantic embedding capability/model registry boundary;
- `SemanticEmbeddingProfile` authority independent from Ask `ProjectAIConfiguration.activeModelId`;
- embedding execution Port and deterministic fake adapter for focused verification;
- reuse of existing provider identity, CredentialVault, provider privacy/deployment policy and immutable execution pinning;
- typed provider/configuration/policy/timeout/validation failures required by the frozen Contract;
- focused evidence for AKP1-AC-03 and AKP1-AC-04.

WP1 does not authorize vector persistence, `pgvector` migration, Search cutover, Hybrid ranking, AKP-2 finding generation, or live paid embedding verification beyond a separately bounded verification instruction.

## 4. Dependency and migration boundary

This authorization does not pre-authorize arbitrary dependencies or migrations.

- WP1: no vector-store migration is authorized.
- WP2: additive semantic-projection migration and PostgreSQL `vector` extension work become executable only after WP1 completion/acceptance and normal dependency/environment verification.
- External vector DB remains prohibited by the frozen Contract.
- A new runtime package must still have a demonstrated need and normal dependency review.

## 5. Verification discipline

The project-wide non-duplication rule remains mandatory:

- do not manually rerun CI already executed for the same exact head;
- use focused tests for changed WP scope;
- rely on automatically triggered CI for each new exact head;
- do not repeat Section-wide Golden Query/security/lifecycle closure before WP5;
- reuse valid unchanged Stage-7, A1–A9, ADR-144 and Stage-12 evidence.

## 6. PR #120 CI disposition at authorization time

The accepted Contract candidate head `6c3fd8ba927e804ef2b5e52b3e09bdd55ba25eea` passed automatic CI #1009 in full.

The subsequent freeze-record head `05890510bbea24e6716748c0e28340c2672d4566` passed Quality, frontend typecheck, frontend unit tests (289/289), frontend build, and 80 of 81 frontend E2E tests in automatic CI #1010. The single failed E2E was the pre-existing Sources test `Sources keeps Project switching blocked after a partial delete and releases it after the last delete`, which timed out waiting for the `Label` control. No Product/frontend/test code changed in that head.

No manual rerun was dispatched. This authorization record is a substantive governance change and therefore creates a new exact head whose automatically triggered CI is the next valid verification evidence.

## 7. Current decision state

```text
AKP-0: COMPLETE / BASELINE_REVALIDATED_FROZEN
AKP-1 Contract: ACCEPTED / FROZEN
AKP-1 Product implementation authority: AUTHORIZED
AKP-1 Product implementation execution: PENDING PR #120 CANONICALIZATION
First executable unit after canonicalization: WP1
PR #120 Ready / Merge: NOT_AUTHORIZED
Deployment / Production Verification: NOT_AUTHORIZED
AKP-2+: NOT_STARTED / NOT_AUTHORIZED
```
