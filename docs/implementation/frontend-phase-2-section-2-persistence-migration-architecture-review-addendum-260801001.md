# Frontend Phase 2 Section 2 — Persistence Migration Architecture Review Addendum

- Addendum ID: `frontend-phase-2-section-2-persistence-migration-architecture-review-addendum-260801001`
- Date: 2026-08-01
- Status: **APPROVED CREATION PRESERVED / ACTIVATION BLOCKED PENDING REVISION**
- Applies to:
  - `frontend-phase-2-section-2-persistence-migration-proposal-260801001.md`
  - `db/migrations/021_frontend_phase2_ask_product_persistence.sql`
- Governing ADR: ADR-123
- Governing Frozen Contract: `frontend-phase-2-section-2-slices-4-5-frozen-implementation-contract-260801001.md`

## 1. Approval interpretation

The user’s earlier approval of the migration proposal authorized creation of migration 021 on the draft branch. That approval is preserved and is not silently revoked.

The earlier approval did not establish that the first DDL draft satisfied the complete production persistence architecture. Architecture review found additional requirements that must be resolved before PR Ready, merge or database activation.

Therefore:

- Migration file creation: **APPROVED / COMPLETED**.
- Current DDL as final production design: **NOT ACCEPTED**.
- Database activation or merge: **NOT AUTHORIZED**.
- Revision on the unmerged draft branch: **REQUIRED AND AUTHORIZED** under ADR-123 and the Frozen Contract.

## 2. Required corrections before activation

Migration 021 must be revised to include or align with:

1. repository-managed schema ownership, defaulting to `frontend_ask` unless an existing canonical owner is selected;
2. globally unique runtime-compatible Conversation, Branch, Turn, AnswerRun and child identities;
3. Conversation, Branch, Turn and AnswerRun revision columns usable in optimistic update predicates;
4. unique Branch Turn ordinal and concurrency-safe allocation;
5. foreign keys and aggregate relationship constraints;
6. valid active Branch ownership by Conversation;
7. ordered uniqueness for SourceSelections, Statements and Citations;
8. compatibility with the existing Frontend Command Ledger rather than parallel command tables;
9. production PostgreSQL repository and application assembly wiring;
10. database reset and verification registration;
11. transaction rollback and restart durability tests;
12. explicit activation and rollback or forward-repair procedure.

## 3. Historical DDL status

The DDL embedded in the original proposal and the initial migration 021 file are preserved as the first candidate design. They are not the frozen target. The frozen target is defined by ADR-123 and the Slices 4–5 Frozen Implementation Contract.

Because migration 021 has not been merged to Canonical `main`, it may be corrected in place while retaining this addendum as the change reason and history. After merge, any schema correction requires a new additive migration.

## 4. Completion evidence

Migration 021 may be marked ready only when the remediation submission includes:

- final DDL and schema ownership;
- PostgreSQL repository implementation;
- production application wiring;
- reset and verify evidence;
- transaction and concurrency tests;
- restart durability test;
- exact-head CI result;
- ADR-123 and S45-G12/S45-G13 conformance.

This addendum does not authorize PR Ready, merge, Section completion or migration execution against a production database.
