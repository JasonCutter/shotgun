---
id: FRONTEND-PHASE-5-SECTION-2-CONTRACT-PREPARATION-260808001
classification: CANDIDATE
status: user_review_required
work_item: FE-P5-S2-A0
created_at: 2026-08-08
authority: FE-P5-S2-A0-REQUEST-260808001 (user A0 authorization 2026-08-08)
subject_base: 8cc93c0aa798ca98adaeba863eb5a6145b62bff1
gap_audit: docs/engineering/frontend-phase-5-section-2-gap-audit-260808001.md
---

# FE-P5-S2 — History·Audit·Rollback Contract Preparation (A0 Candidate)

> 이 문서는 **Candidate**다. A0에서는 Frozen Snapshot을 만들지 않는다.
> `docs/architecture/contracts/snapshots/frontend-phase-5-section-2/`에 실제
> Frozen Snapshot은 **A1에서 사용자 승인된 내용만** 생성한다.

## 1. Product boundary (Proposed)

FE-P5-S2는 Project-scoped **History Workspace**와 History·Audit·Rollback의
장기 보존·안전한 Reversal/Compensation 시작을 제공한다.

Included (후보):

- 통합 History Workspace (federated read projection of existing Domain History).
- Canonical Revision/Commit, Review Decision/Approval, External Action
  Attempt/Verification/Audit 조회 (Canonical Implementation Plan §2 필수 범위:
  Append-only History, Revision, Decision, Approval, Canonical Commit, External
  Result, Retention/Tombstone, Reversal DraftChangeSet, Compensating Action).
- Source version, Ask history — `REUSE_AVAILABLE / OPTIONAL_HISTORY_FAMILY`
  (필수 scope 여부는 A1에서 결정, 범위 확대 방지).
- Settings/Policy Change History — `REUSE / ADAPTER / NEW READ CAPABILITY`
  판정 필요 (NEEDS_EXACT_AUDIT, ADR-112 Context의 "Policy history" 재현 요구).
- Event Payload Availability 상태 (`AVAILABLE / REDACTED / PURGED_BY_POLICY /
UNAVAILABLE`).
- History Retention / Tombstone (Payload redaction, Identity 보존).
- Canonical Rollback = **Reversal DraftChangeSet** (직접 복원 금지).
- External Rollback = 기존 **Compensating Action** 재사용.
- Deleted Project audit access (ProjectTombstone, DeletedProjectAuditScope,
  Capability 재검증).
- Ordering / Cursor / Pagination 규약.

Excluded (후보):

- Activity Workspace (FE-P5-S1) 재구현 — reuse.
- 장기 Activity Event 원장 (중앙 원장) 생성 — 금지 (ADR-111/112).
- Generic execution authority, Cancel/Retry 권위.
- Cross-Phase Product Verification.
- Deployment/Production Verification.
- 신규 runtime dependency.

## 2. Proposed resource / view types

| Type                                                | Kind                                                                              | 근거                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------- |
| `HistoryWorkspaceViewV1`                            | federated read model root (project-scoped)                                        | 통합 조회의 루트                                   |
| `HistoryEntryV1`                                    | 하나의 통합 이벤트 항목 (source domain + domain event ref + timestamp + identity) | ordering/cursor 규약의 단위                        |
| `HistoryCursorV1`                                   | continuation cursor                                                               | activity `ActivityEventContinuationV1` 패턴 재사용 |
| `PayloadAvailabilityV1`                             | `AVAILABLE / REDACTED / PURGED_BY_POLICY / UNAVAILABLE`                           | phase-5 §S2, ADR-112 §9                            |
| `RetentionPolicyViewV1`                             | History retention 정책 (Log와 분리)                                               | ADR-112 §8                                         |
| `TombstoneV1`                                       | Event identity 보존 + payload redaction                                           | ADR-112 §9                                         |
| `ReversalDraftChangeSetV1`                          | Canonical rollback candidate (DraftChangeSet 기반)                                | ADR-112 §5/§6                                      |
| `ProjectTombstoneV1` / `DeletedProjectAuditScopeV1` | 삭제된 Project lineage 보존·접근 경계                                             | ADR-112 §11/§12                                    |
| `CompensatingActionV1`                              | 기존 재사용 (external rollback)                                                   | ADR-129                                            |

Identity 규약 (후보): 통합 `HistoryEntryV1`는 domain event identity를 대체하지
않고 참조만 한다 (`historyEventId`, `auditEventId`, `revisionId`, `decisionId`
등 각 Domain의 stable identity를 유지). 삭제·덮어쓰기 금지 (ADR-112 §2/§3).

**OperationalResourceKindRegistry (ADR-113, 후보 반영)**: HistoryEntry는 공유
`OperationalResourceKindRegistry`를 사용하고, Aggregate Resource Kind와
Concrete Resource Kind를 구분한다. `domainResourceId`/concrete identity를
보존하며 History projection identity가 source Domain identity를 대체하지
않는다.

## 3. Proposed API boundary

Read (federated read model — authoritative 아님):

- `ListHistoryWorkspace` — project-scoped, 통합 이벤트 목록 (cursor, filter:
  kind/domain/date).
- `GetHistoryEntry` — 단일 이벤트 + payload availability.
- `ListCanonicalHistory` / `ListActionAudit` / review decision / source version
  history는 **기존 Domain API 재사용** (`REUSE_DIRECT`).
- `GetDeletedProjectAuditScope` — 삭제된 Project lineage 조회 (별도 승인).

Write / Action (기존 authoritative command 재사용 + 신규 후보):

- Canonical Rollback: **신규** `CreateReversalDraftChangeSet` (server-derived
  eligibility, approval 흐름 재사용) — 기존 `change-set-review` DraftChangeSet
  생성과 결합.
- External Rollback: 기존 `Rollback` / `PREPARE_COMPENSATING_ACTION` 재사용.
- Retention: **신규** retention/tombstone 적용 command (policy에 의한 payload
  redaction, Identity 보존).

Capability (후보): `history:read`, `history:audit:read`, `action:rollback`,
`action:audit:read`(기존), `project:deleted-audit:read`(신규) 등 서버-derived.

## 4. Proposed AC matrix (Candidate)

FE-P5-S1-AC-01~16 형식 참고. 확정은 A1 (Frozen 시 `FE-P5-S2-AC-01` ...).

| AC    | 제목 (후보)                                                                                                                               | 검증                       |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| AC-01 | History Workspace가 기존 Domain History를 federated로 조회 (중앙 원장 미생성)                                                             | Contract/unit + read model |
| AC-02 | HistoryEntry가 domain identity를 대체하지 않고 참조 (공유 OperationalResourceKindRegistry 사용, Aggregate vs Concrete Resource Kind 구분) | Contract                   |
| AC-03 | Event identity 삭제·덮어쓰기 금지                                                                                                         | negative test              |
| AC-04 | Payload Availability 상태 노출 (AVAILABLE/REDACTED/PURGED_BY_POLICY/UNAVAILABLE)                                                          | Contract + golden          |
| AC-05 | PURGED_BY_POLICY가 Identity가 아닌 payload redaction·tombstone                                                                            | negative test              |
| AC-06 | History retention이 Log retention과 분리                                                                                                  | Contract + unit            |
| AC-07 | Canonical Rollback이 Reversal DraftChangeSet (직접 복원 금지)                                                                             | negative test              |
| AC-08 | Reversal이 현재 snapshot·영향·Review·Approval 흐름 준수                                                                                   | golden + security          |
| AC-09 | External rollback이 별도 Compensating Action 재사용                                                                                       | reuse test                 |
| AC-10 | Deleted Project audit 접근이 ProjectTombstone + DeletedProjectAuditScope + Capability 재검증                                              | security negative test     |
| AC-11 | 과거 membership만으로 deleted-project audit 접근 불가                                                                                     | security negative test     |
| AC-12 | Restoration이 explicit recovery lineage 생성                                                                                              | golden                     |
| AC-13 | 조회 시 Capability 재검증 (fail-closed)                                                                                                   | security                   |
| AC-14 | ordering/cursor/pagination 규약 (tie-breaker 포함)                                                                                        | contract + golden          |
| AC-15 | FE-P5-S2 완료 조건 매핑 (관찰→추적→조회→Reversal/Compensation)                                                                            | E2E                        |
| AC-16 | 성능 Gate (숫자 없이 Frozen 금지): baseline 측정 → 숫자 budget 제안 → 사용자 승인 → Frozen numeric threshold                              | performance gate (A1 절차) |

## 5. ADR assessment (Candidate)

- ADR-111: **SUFFICIENT_AS_IS** (Activity projection 경계 유지).
- ADR-112: **SUFFICIENT_AS_BASELINE** (retention·tombstone·reversal·
  deleted-project audit을 하나의 일관된 History 경계로 이미 묶음).
- **추가 후보: ONE FE-P5-S2 Section-specific hardening ADR (CANDIDATE)** —
  FE-P5-S1이 ADR-130 하나로 구현 경계를 구체화한 패턴. 하나의 ADR이 federated
  History read projection / identity·ordering·cursor / payload availability·
  retention·tombstone / Reversal ownership·eligibility / DeletedProject audit
  scope를 함께 커버. A1에서 독립 owner·lifecycle 근거가 있을 때만 분리.
- A1에서 hardening ADR 1건 확정 (이 문서의 결정 권위 아님).

## 6. Migration assessment (Candidate)

- **CONDITIONAL / UNRESOLVED** (동시 확정 금지):
  - on-read federated aggregation만 채택 → History read-model migration은
    `NONE`일 수 있음.
  - persistent projection index 채택 → **additive migration REQUIRED**.
  - ProjectTombstone / retention state에 새 persistence 필요 → 해당 범위
    **additive migration REQUIRED**.
- 삭제·재작성 migration 없음. Rollback: read model 재구축으로 원상 복구 가능.
- A1에서 read model 선택과 함께 확정.

## 7. Dependency assessment (Candidate)

- **NOT_REQUIRED 후보**: 기존 Domain API·store 재사용. 신규 OSS 런타임 없음.
- Reversal/Retention 구현 시 기존 `change-set-review`, `settings-policy`,
  `project-administration` 확장(AUGMENT) 후보.
- A1에서 확정.

## 8. Open questions / User decisions

1. Reversal Eligibility 규칙 확정 (server-derived, stale/superseded/dependent,
   approval 재사용).
2. Payload Availability 전이 정책 (누가/언제/어떤 정책으로 redact).
3. DeletedProjectAuditScope 부여 주체·경계·restoration lineage.
4. 통합 ordering tie-breaker (domain별 timestamp/sequence 상이).
5. History retention 정책 owner (`privacy.retentionDays` 적용 범위).
6. History Workspace가 새 read model 인덱스(DB)를 추가할지, 기존 API
   aggregation으로 충분한지 (→ Migration CONDITIONAL/UNRESOLVED).
7. Settings/Policy Change History의 장기 조회 능력 (REUSE/ADAPTER/NEW READ
   CAPABILITY) — `ListPolicyHistory` 부재 확인.
8. Ask/Source History를 History Workspace 필수 event family로 포함할지
   (OPTIONAL_HISTORY_FAMILY).
9. OperationalResourceKindRegistry (ADR-113) 적용 범위 — HistoryEntry 공유
   Registry 사용, Aggregate vs Concrete Resource Kind 구분.

## 9. A0 판정 요약

- History Ownership: **FEDERATED_READ_PROJECTION** (ACCEPTED) +
  `AUTHORITATIVE_CAPABILITY_REQUIRED` / `OWNERSHIP_UNRESOLVED` 3건 (소유권 A1
  결정, likely AUGMENT).
- ADR-111: SUFFICIENT_AS_IS / ADR-112: SUFFICIENT_AS_BASELINE + hardening ADR
  1건 후보 (A1 확정).
- Migration: **CONDITIONAL / UNRESOLVED**. Dependency: NOT_REQUIRED 후보.
- **A1 진입: NOT_YET_APPROVED** — A0 Review Round 2 ACCEPTED 이후에만 (Frozen
  Contract + AC + hardening ADR 확정).
- FE-P5-S2: `NOT_STARTED` 유지.

## 10. GPT Review Gate 검토 결과 기록

- **A0 Review Round 1 (2026-08-08): CHANGES_REQUIRED** — 상기 §1/§2/§4/§5/§6/
  §8 수정 반영 (NEW_DOMAIN_RESOURCE_REQUIRED→AUTHORITATIVE_CAPABILITY_REQUIRED,
  hardening ADR 1건, Migration CONDITIONAL/UNRESOLVED, Policy History 추가 +
  Ask/Source OPTIONAL 재분류, OperationalResourceKindRegistry 반영).
- 이 §10은 검토 이력/provenance 기록이며 ADR/Contract 결정 권위로 사용하지
  않는다.
