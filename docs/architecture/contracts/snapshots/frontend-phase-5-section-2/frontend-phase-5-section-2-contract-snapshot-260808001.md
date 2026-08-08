---
id: FRONTEND-PHASE-5-SECTION-2-CONTRACT-SNAPSHOT-260808001
classification: CANDIDATE
status: candidate_awaiting_architecture_contract_approval
revision: 1
created_at: 2026-08-08
work_item: FE-P5-S2-A1
subject_base: 3a1ea4f2e65da3b67b79b654c69d64f62120c654
governing_adr: ADR-131 (CANDIDATE)
gap_audit: docs/engineering/frontend-phase-5-section-2-gap-audit-260808001.md
contract_preparation: docs/engineering/frontend-phase-5-section-2-contract-preparation-260808001.md
---

# FE-P5-S2 — History·Audit·Rollback Contract Snapshot r1 (A1 Candidate)

> **Candidate only.** This becomes FROZEN only after the user
> Architecture/Contract approval (A1 step 7). A1 execution authorization alone
> does not freeze this contract or its AC.

## 1. Authority

- A0 COMPLETE / A0_ACCEPTED (`main@3a1ea4f2`, CI #659 SUCCESS).
- A1 EXECUTION: user-approved 2026-08-08 (Candidate writing only).
- Governing ADR: **ADR-131 (CANDIDATE)** — accepted only after user approval.
- Product implementation: `NOT_AUTHORIZED` / Additive migration:
  `NOT_AUTHORIZED` / New runtime dependency: `NOT_REQUIRED`.
- Acceptance Criteria: `FE-P5-S2-AC-01` through `FE-P5-S2-AC-16` (Candidate).

## 2. Product boundary

FE-P5-S2 provides a Project-scoped **History Workspace** over authoritative
Domain History, plus History·Audit·Rollback long-term preservation and safe
Reversal/Compensation initiation.

Included:

- Federated History Workspace read projection (no new authoritative ledger).
- History Families per §6 (mandatory/optional/defers).
- Event Payload Availability (`AVAILABLE / REDACTED / PURGED_BY_POLICY /
UNAVAILABLE`).
- History Retention / Tombstone (payload redaction, identity preserved).
- Canonical Rollback = **Reversal DraftChangeSet** (direct restore forbidden).
- External Rollback = existing **Compensating Action** reuse.
- Deleted Project audit access (ProjectTombstone, DeletedProjectAuditScope,
  Capability revalidation).
- Ordering / Cursor / Pagination contract.

Excluded:

- Activity Workspace (FE-P5-S1) reimplementation — reuse.
- Long-term Activity Event ledger — forbidden (ADR-111/112).
- Generic execution authority, Cancel/Retry authority.
- Cross-Phase Product Verification.
- Deployment/Production Verification.
- New runtime dependency.

## 3. Federated read projection

```text
History Workspace
  → History Federated Read Projection (rebuildable read model)
  → Canonical History adapter
  → Review Decision/Approval adapter
  → External Action Audit adapter
  → Policy Change History adapter (per §6 decision)
  → optional Source/Ask adapter (DEFER by default)
```

Detail reads re-resolve the owning authoritative Domain History. The read model
index is rebuildable from authoritative Domain History and is never Event
authority.

## 4. A1 decisions (final recommendations — Candidate)

### 4.1 History Ownership

| Capability                                   | Decision                                                                                                  | Ownership                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Reversal                                     | AUGMENT `change-set-review`                                                                               | Reversal = DraftChangeSet sourced from Historical Revision |
| Payload Availability / Retention / Tombstone | AUGMENT shared History contract + `settings-policy` (retention policy owner) + owning Domain augmentation | no new standalone Domain                                   |
| DeletedProjectAuditScope                     | AUGMENT `project-administration` + security boundary                                                      | ProjectTombstone + separate audit scope                    |
| History Workspace read model                 | persistent rebuildable read model (FE-P5-S1 pattern)                                                      | no new authoritative Domain                                |

No new standalone Domain resource is introduced without evidence.

### 4.2 History read model

**Decision: persistent projection index (rebuildable read model)** — FE-P5-S1
`activity_index` + `projection_watermarks` pattern (atomic project-scoped
commit). Rationale: cross-Domain pagination/cursor uniformity and performance;
authority remains in owning Domain History. On-read-only aggregation rejected
as baseline because per-Domain cursor/sequence differences make a unified
cursor fragile.

### 4.3 Migration / Dependency

- Migration: **REQUIRED / ADDITIVE**. Required persistence scopes:
  ```
  A. History Projection
     - rebuildable history projection index
     - projection watermark/checkpoint
     Authority: NON-AUTHORITATIVE READ MODEL
  B. Deleted Project
     - ProjectTombstone persistence
     - DeletedProjectAuditScope / authorization binding persistence
     Authority: project-administration / security
  C. Payload Availability / Retention
     - authoritative payload availability/tombstone state
     - purge AuditEvent persistence
     Authority: each owning Domain
     Retention policy authority: settings-policy
  D. Policy History
     - append-only policy-change history persistence
     Authority: settings-policy
  No destructive migration. No existing event/history rewrite.
  ```
- Actual table/column/migration numbers are deferred to the Product
  Implementation Request (implementation detail).
- Runtime dependency: **NOT_REQUIRED**.

### 4.4 Performance

- No arbitrary numeric threshold at A1. Procedure only:
  `baseline measurement → proposed budget → user approval → frozen numeric
threshold` (per AC-16).

## 5. Identity contract

### 5.1 HistoryEntryV1

- `historyEntryId`: History Workspace projection identity (never replaces
  source Domain identity).
- source Domain ref: `domainKind` + authoritative event identity
  (`historyEventId` / `auditEventId` / `revisionId` / `decisionId` / ...).
- `domainResourceId` / concrete identity preserved.
- `resourceProjectId`, `occurredAt`, ordering/cursor key (domain event time +
  domain + stable source identity + sequence).
- Payload Availability state.
- Shared `OperationalResourceKindRegistry` (ADR-113): Aggregate vs Concrete
  Resource Kind distinct.

### 5.2 PayloadAvailabilityV1

`AVAILABLE / REDACTED / PURGED_BY_POLICY / UNAVAILABLE`.

- `PURGED_BY_POLICY`: payload redaction/tombstone, never identity deletion.
- Tombstone metadata + purge AuditEvent remain.

### 5.3 ReversalDraftChangeSetV1

- Source: Historical Revision.
- Historical approval: evidence/reference only; reuse **FORBIDDEN**.
- Authorization: current server-derived capability; current Review + current
  Approval required.
- Flow: `Historical Revision → Reversal DraftChangeSet → current Snapshot impact
→ current Review → current Approval → Canonical Commit`.

### 5.4 ProjectTombstoneV1 / DeletedProjectAuditScopeV1

- Deleted Project → ProjectTombstone; general Workspace access stops.
- DeletedProjectAuditScope is separately authorized; past membership never
  grants access; restoration creates explicit recovery lineage.

## 6. History Family Scope

| Family                         | Mandatory/Optional          | A1 decision                              |
| ------------------------------ | --------------------------- | ---------------------------------------- |
| Canonical Revision / Commit    | Mandatory                   | INCLUDE                                  |
| Review Decision / Approval     | Mandatory                   | INCLUDE                                  |
| External Action Result / Audit | Mandatory                   | INCLUDE                                  |
| Policy Change History          | Mandatory (ADR-112 Context) | INCLUDE (read capability per 4.x/8)      |
| Source Version                 | Optional                    | DEFER (not in mandatory Canonical scope) |
| Ask / Conversation             | Optional                    | DEFER                                    |

Silent scope expansion is forbidden; changes require A1 amendment.

## 7. Proposed API boundary

Read (federated read model — not authoritative):

- `ListHistoryWorkspace` — project-scoped unified events (cursor, filters:
  kind/domain/date/family).
- `GetHistoryEntry` — single event + payload availability.
- Existing Domain APIs reused for authoritative reads
  (`ListCanonicalHistory`, `ListActionAudit`, review decision, ...).

Write / Action:

- `CreateReversalDraftChangeSet` (new; server-derived eligibility, current
  Review + Approval).
- External rollback: existing `Rollback` / `PREPARE_COMPENSATING_ACTION` reuse.
- Retention/tombstone application command (policy-driven payload redaction,
  identity preserved).

Capabilities (server-derived): `history:read`, `history:audit:read`,
`action:rollback` (existing), `action:audit:read` (existing),
`project:deleted-audit:read` (new), etc.

## 8. Policy History recommendation

- Current state: `SettingsRepositoryPort.getSettingsSnapshot`,
  `getPrincipalPreferenceRevision`, `getPrivacyRetention` — snapshot/revision/
  command status exist; no long-term `ListPolicyHistory`.
- **Decision (final recommendation):**
  ```
  Policy History
  Current authoritative state: settings-policy current snapshot/revision
  Long-term authoritative policy-change record: MISSING
  Decision: NEW APPEND-ONLY POLICY CHANGE HISTORY CAPABILITY owned by settings-policy
  History Workspace: reads it through an adapter
  Therefore: Authority = settings-policy / Read integration = History adapter
  No new standalone Policy History Domain
  ```
- 미결 표현(`ADAPTER or NEW READ CAPABILITY`)은 제거됨 — authority와 read
  integration을 분리해 확정.

## 9. Proposed AC matrix (Candidate)

| AC    | Title                                                                                                                                                                                                        | Verification               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| AC-01 | History Workspace reads existing Domain History federated (no central ledger)                                                                                                                                | Contract/unit + read model |
| AC-02 | HistoryEntry references source Domain identity (shared OperationalResourceKindRegistry; Aggregate vs Concrete Resource Kind; domainResourceId preserved; projection identity never replaces source identity) | Contract                   |
| AC-03 | Event identity never edited/deleted                                                                                                                                                                          | negative test              |
| AC-04 | Payload Availability states exposed (AVAILABLE/REDACTED/PURGED_BY_POLICY/UNAVAILABLE)                                                                                                                        | Contract + golden          |
| AC-05 | PURGED_BY_POLICY = payload redaction/tombstone, not identity deletion; tombstone + purge AuditEvent remain                                                                                                   | negative test              |
| AC-06 | History retention separated from Log retention; cache retention cannot remove Approval/Audit/Canonical history                                                                                               | Contract + unit            |
| AC-07 | Canonical Rollback = Reversal DraftChangeSet (direct restore forbidden)                                                                                                                                      | negative test              |
| AC-08 | Reversal uses current Snapshot impact + current Review + current Approval; historical approval reuse forbidden                                                                                               | golden + security          |
| AC-09 | External rollback reuses Compensating Action                                                                                                                                                                 | reuse test                 |
| AC-10 | Deleted Project audit access requires ProjectTombstone + DeletedProjectAuditScope + Capability revalidation                                                                                                  | security negative test     |
| AC-11 | Past membership alone never grants deleted-project audit access                                                                                                                                              | security negative test     |
| AC-12 | Restoration creates explicit recovery lineage                                                                                                                                                                | golden                     |
| AC-13 | Read-time Capability revalidation (fail-closed)                                                                                                                                                              | security                   |
| AC-14 | Ordering/cursor/pagination contract (stable tie-breaker)                                                                                                                                                     | contract + golden          |
| AC-15 | FE-P5-S2 completion mapping (observe→trace→query→Reversal/Compensation)                                                                                                                                      | E2E                        |
| AC-16 | Performance gate: baseline measurement → proposed budget → user approval → frozen numeric threshold (no arbitrary number)                                                                                    | performance procedure      |

## 10. FE-P5-S2 status

- FE-P5-S2: `NOT_STARTED` during A1. `IN_PROGRESS` transition is determined in
  the Implementation Request together with Product implementation
  authorization.
- This snapshot is `CANDIDATE`; it becomes `FROZEN` only after user
  Architecture/Contract approval.
