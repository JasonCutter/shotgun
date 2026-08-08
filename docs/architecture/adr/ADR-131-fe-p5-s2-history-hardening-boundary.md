# ADR-131 — FE-P5-S2 History Workspace Federated Projection, Identity, Retention and Reversal Boundary

- Status: **CANDIDATE** (A1)
- Proposed at: 2026-08-08
- Proposed by: `A1` (FE-P5-S2 A1 Architecture Decision + Contract Finalization)
- Work item: `FE-P5-S2`
- Subject base: `main@3a1ea4f2e65da3b67b79b654c69d64f62120c654`
- Related ADRs: ADR-111, ADR-112, ADR-113, ADR-118, ADR-119, ADR-124, ADR-126, ADR-128, ADR-129, ADR-130
- Gap audit:
  `docs/engineering/frontend-phase-5-section-2-gap-audit-260808001.md`
- Contract preparation:
  `docs/engineering/frontend-phase-5-section-2-contract-preparation-260808001.md`
- Contract snapshot (Candidate):
  `docs/architecture/contracts/snapshots/frontend-phase-5-section-2/frontend-phase-5-section-2-contract-snapshot-260808001.md`
- Decision owner: `USER` (Candidate → ACCEPTED requires user approval)
- Product implementation: `NOT_AUTHORIZED`

> A1 execution authorization alone does NOT make this ADR ACCEPTED. This is a
> Candidate until the user Architecture/Contract approval (A1 step 7).

## Context

ADR-112 establishes History as an immutable, append-only record of Revision,
Decision, Approval, Canonical Commit and External Result, with Reversal
DraftChangeSet / Compensating Action rollback and ProjectTombstone audit scope.
FE-P5-S1 (ADR-130) established the Federated Activity read projection pattern and
explicitly deferred long-term History to FE-P5-S2.

The repository already contains authoritative per-Domain History:

- Canonical: `CanonicalHistoryEvent`, `ListCanonicalHistory` (ADR-086).
- Review: append-only decision/comment records (ADR-128).
- External Action: append-only `ActionAuditEventV1` (ADR-129).
- Source version history (ADR-122), Ask conversation (ADR-123).
- Settings/Policy: current snapshot/revision; no long-term `ListPolicyHistory`.

A0 (gap audit) confirmed: no central ledger exists, no central ledger should be
created, and four authoritative capabilities are absent (Reversal,
Payload Availability/Retention/Tombstone, DeletedProjectAuditScope, and a
federated History read model).

## Decision

### 1. Federated History read projection (no new authoritative ledger)

FE-P5-S2 adopts a **Federated History Read Projection**. Existing Domain History
remains authoritative. History Workspace reads through adapters and never
invents a second authoritative History Domain.

```text
Canonical History ──────┐
Review / Approval ──────┤
External Action Audit ──┤→ History Federated Read Projection
Policy / Revision ──────┤          ↓
기타 authoritative refs ┘   History Workspace
```

A persistent projection index is allowed **only as a rebuildable read model**,
never as Event authority. Rebuild must reproduce from authoritative Domain
History.

### 2. Identity and ordering

- Each `HistoryEntry` references a source Domain event identity
  (`historyEventId`, `auditEventId`, `revisionId`, `decisionId`, ...) and never
  replaces it.
- Events are not edited or deleted (ADR-112 §2/§3).
- `HistoryEntry` uses the shared `OperationalResourceKindRegistry` (ADR-113);
  Aggregate Resource Kind and Concrete Resource Kind stay distinct, and
  `domainResourceId`/concrete identity is preserved.
- Ordering/cursor uses a stable tie-breaker across domains
  (domain event time + domain + stable source identity + sequence), because
  per-Domain sequences/timestamps differ.

### 3. Payload Availability, Retention and Tombstone

- Event Payload Availability is a separate state:
  `AVAILABLE / REDACTED / PURGED_BY_POLICY / UNAVAILABLE`.
- `PURGED_BY_POLICY` means payload redaction/tombstone, never Event identity
  deletion (ADR-112 §9). Tombstone metadata and a purge AuditEvent remain.
- History retention is separated from operational Log retention
  (ADR-112 §8). General cache retention cannot remove Approval/Audit/Canonical
  history.
- Legal Hold changes retention, not access permission (ADR-112 §10).

### 4. Reversal ownership and eligibility

- Reversal is owned by `change-set-review` as an **AUGMENT** (no new Domain):
  a Reversal is a `DraftChangeSet` whose source is a Historical Revision.
- Historical approval is **evidence/reference only**; historical approval
  authority reuse is **FORBIDDEN**.
- Reversal authorization is a **current server-derived capability**.
- Reversal flow:
  `Historical Revision → Reversal DraftChangeSet → current Snapshot impact → current Review → current Approval → Canonical Commit`.
- Reversal eligibility is server-derived: stale target, already-superseded and
  dependent-revision cases are rejected with typed failures.

### 5. External rollback = Compensating Action (reuse)

External Action rollback reuses the existing `Rollback` / `PREPARE_COMPENSATING_ACTION`
(ADR-129). No new external rollback authority.

### 6. DeletedProject audit scope

- Deleted Project becomes a `ProjectTombstone`; general Workspace access stops,
  while a separately authorized `DeletedProjectAuditScope` may preserve lineage
  (ADR-112 §11).
- Past membership alone never grants deleted-project audit access (ADR-112 §12);
  restoration creates explicit recovery lineage.
- Deleted-project audit read requires current Capability revalidation.

### 7. Policy History

- Settings/Policy Change History: current snapshot/revision is preserved.
  A long-term `ListPolicyHistory` read capability is evaluated with
  `REUSE / ADAPTER / NEW READ CAPABILITY` — A1 final recommendation records the
  outcome (see Contract snapshot).

### 8. History Family Scope

- Mandatory History Families: Canonical Revision/Commit, Review
  Decision/Approval, External Action Result/Audit, Policy Change History, and
  other Canonical-required families.
- Optional History Families: Source Version, Ask/Conversation.
- Each family is explicitly `INCLUDE / EXCLUDE / DEFER` in the Contract
  snapshot; silent scope expansion is forbidden.

### Rejected alternatives

- Central authoritative History ledger (duplicate authority).
- Database overwrite / direct old-state restore for rollback.
- Reusing historical approval as Reversal authority.
- Hard-deleting Event rows at retention expiry.
- Using Legal Hold as an access grant.
- Hard-deleting Project audit identity.
- New standalone History Domain resource without evidence.

## Consequences

Decision history remains immutable and lineage survives retention and deletion.
Reversal is always reviewed and approved against current state. History
Workspace is a rebuildable projection over authoritative Domain History with no
second ledger.

## Acceptance

Candidate → **ACCEPTED** requires user Architecture/Contract approval (A1 step 7).
Frozen Contract and AC live in the Contract snapshot Candidate.
