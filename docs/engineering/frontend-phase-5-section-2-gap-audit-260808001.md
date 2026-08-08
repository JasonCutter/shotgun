---
id: FRONTEND-PHASE-5-SECTION-2-GAP-AUDIT-260808001
classification: CANONICAL
status: a0_accepted_contract_frozen_not_authorized
work_item: FE-P5-S2-A0
created_at: 2026-08-08
authority: FE-P5-S2-A0-REQUEST-260808001 (user A0 authorization 2026-08-08)
approved_by: gpt_review_gate
approved_at: 2026-08-08
subject_base: 8cc93c0aa798ca98adaeba863eb5a6145b62bff1
---

# FE-P5-S2 — History·Audit·Rollback Gap Audit (A0 Candidate)

## 1. Authority

- 사용자 FE-P5-S2 A0 실행 승인 (2026-08-08).
- GPT Review Gate: A0 요청문 `APPROVED_FOR_USER_AUTHORIZATION` (2026-08-08).
- Governing boundary: `docs/architecture/frontend/phase-5-operations-audit.md`
  §Section 2, ADR-111/112 (`adr-100-113-consolidated-record.md`).
- **Status: CANDIDATE / USER_REVIEW_REQUIRED** — CI PASS는 문서·governance 검증
  증거일 뿐 Architecture Approval이 아니다. FE-P5-S2는 계속 `NOT_STARTED`.

## 2. 조사 방법

- Read-only 조사: repository 파일·코드·contract·schema·UI route 확인, 실행 없음.
- 기존 exact-head CI 증거 재사용 (#652/#654 SUCCESS).
- 조사 대상: `packages/contracts/src/**`, `modules/**`, `apps/shotgun-web/src/**`,
  `docs/architecture/frontend/adr-100-113-consolidated-record.md`.

## 3. Existing capability inventory (기존 보유 능력)

| #   | History/Audit 대상                         | authoritative Domain                 | persistence                                                 | Product API                                                                                     | UI                                                  | 근거                                                                                                           |
| --- | ------------------------------------------ | ------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | Source Version History                     | frontend-sources-product             | source version store                                        | `getSourceVersionHistory`, `SourceVersionHistoryView`                                           | source-detail-workspace.tsx "Version history"       | ADR-122, contracts                                                                                             |
| 2   | Ask/Conversation history                   | frontend-ask-execution, cited-answer | ask store                                                   | Ask read 계열                                                                                   | Ask workspace                                       | module 존재. **Canonical Implementation Plan §2 필수 범위 아님 → `REUSE_AVAILABLE / OPTIONAL_HISTORY_FAMILY`** |
| 3   | Canonical Revision/Commit history          | canonical-knowledge                  | canonical commit/history store                              | `ListCanonicalHistory`, `CanonicalHistoryEvent`                                                 | (전용 UI 없음)                                      | ADR-086; canonical-knowledge + projection-search 모듈                                                          |
| 4   | DraftChangeSet history                     | change-set-review                    | draft change set store                                      | `ListDraftChangeSets`, `getDraftChangeSet`                                                      | review UI                                           | change-set-review module                                                                                       |
| 5   | Review/Decision/Approval history           | frontend-review                      | decisions/comments append-only                              | review read                                                                                     | review-workspace.tsx `ReviewHistory`                | frontend-review module                                                                                         |
| 6   | External Action Attempt/Verification/Audit | frontend-external-action             | audit append-only (`repositories.audit`)                    | `ListActionAudit`, `ActionAuditEventV1`                                                         | external-action-workspace.tsx audit                 | ADR-129; frontend-external-action                                                                              |
| 7   | Activity-derived operational references    | frontend-activity                    | `frontend_activity.activity_index` (projection)             | Activity read                                                                                   | Activity Workspace                                  | FE-P5-S1; ADR-130                                                                                              |
| 8   | Project lifecycle/deletion                 | project-administration               | project store                                               | `requestDeleteProject`                                                                          | (전용 UI 확인 필요)                                 | project-administration module                                                                                  |
| 9   | Reversal (Canonical rollback)              | **없음**                             | **없음**                                                    | **없음**                                                                                        | **없음**                                            | contracts에 `Reversal` 미존재                                                                                  |
| 10  | Compensation (External rollback)           | frontend-external-action             | rollbacks/compensations store                               | `RollbackV1`, `CompensatingActionV1`, `PREPARE_COMPENSATING_ACTION`, `ROLLBACK_EXTERNAL_ACTION` | external-action-workspace.tsx rollback/compensation | ADR-129; frontend-external-action                                                                              |
| 11  | Settings/Policy Change History             | settings-policy                      | Settings snapshot/revision/command status/Privacy Retention | 장기 `ListPolicyHistory` 같은 query **미확인**                                                  | ❌                                                  | ADR-112 Context의 "Policy history" 재현 요구. `NEEDS_EXACT_AUDIT`                                              |

## 4. Existing Authority / Reuse Matrix

각 History 대상의 FE-P5-S2 ownership 판정 (evidence 기반, 기본 가정 없음).

| History 대상                                             | Existing authoritative Domain              | Existing persistence                              | Existing Product API                            | Existing UI                 | Missing capability                                     | FE-P5-S2 ownership                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------- | ----------------------------------------------- | --------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Source Version History                                   | ✅ frontend-sources-product                | ✅                                                | ✅                                              | ✅                          | 없음                                                   | `REUSE_AVAILABLE / OPTIONAL_HISTORY_FAMILY` (필수 scope 여부 A1 결정)                                                      |
| Ask/Conversation history                                 | ✅ frontend-ask-execution                  | ✅                                                | ✅                                              | ✅                          | 없음                                                   | `REUSE_AVAILABLE / OPTIONAL_HISTORY_FAMILY` (필수 scope 여부 A1 결정)                                                      |
| Canonical Revision/Commit history                        | ✅ canonical-knowledge                     | ✅                                                | ✅                                              | ❌ (전용 UI 없음)           | History Workspace에서 조회 UI                          | `FEDERATED_READ_PROJECTION`                                                                                                |
| DraftChangeSet history                                   | ✅ change-set-review                       | ✅                                                | ✅                                              | ✅                          | 없음                                                   | `REUSE_DIRECT`                                                                                                             |
| Review/Decision/Approval history                         | ✅ frontend-review                         | ✅                                                | ✅                                              | ✅                          | 없음                                                   | `REUSE_DIRECT`                                                                                                             |
| External Action Attempt/Verification/Audit               | ✅ frontend-external-action                | ✅                                                | ✅                                              | ✅                          | 없음                                                   | `REUSE_DIRECT`                                                                                                             |
| Activity-derived operational references                  | ✅ frontend-activity                       | ✅                                                | ✅                                              | ✅                          | 없음                                                   | `REUSE_DIRECT`                                                                                                             |
| Project lifecycle/deletion                               | ✅ project-administration                  | ✅ (DELETE_REQUESTED 상태까지)                    | ✅                                              | ❌                          | Tombstone·deleted-project audit scope                  | `AUTHORITATIVE_CAPABILITY_REQUIRED` / `OWNERSHIP_UNRESOLVED` (likely `AUGMENT` project-administration/security)            |
| Reversal (Canonical rollback)                            | ❌ 없음                                    | ❌ 없음                                           | ❌ 없음                                         | ❌ 없음                     | Reversal DraftChangeSet semantics                      | `AUTHORITATIVE_CAPABILITY_REQUIRED` / `OWNERSHIP_UNRESOLVED` (likely `AUGMENT` change-set-review)                          |
| Compensation (External rollback)                         | ✅ frontend-external-action                | ✅                                                | ✅                                              | ✅                          | 없음                                                   | `REUSE_DIRECT`                                                                                                             |
| History Event Payload Availability / Retention·Tombstone | ❌ (부분: idempotency `RETENTION_EXPIRED`) | ❌                                                | ❌                                              | ❌                          | Payload Availability 상태, History retention/tombstone | `AUTHORITATIVE_CAPABILITY_REQUIRED` / `OWNERSHIP_UNRESOLVED` (likely shared History contract + policy/domain augmentation) |
| Settings/Policy Change History                           | ✅ settings-policy (현재 상태)             | ✅ (Settings snapshot/revision/Privacy Retention) | ❌ (`ListPolicyHistory` 같은 장기 query 미확인) | ❌                          | 장기 Policy revision history 조회 능력                 | `REUSE / ADAPTER / NEW READ CAPABILITY` → **A0에서 판정 필요 (NEEDS_EXACT_AUDIT)**                                         |
| 통합 History Workspace                                   | ❌ 없음                                    | ❌ 없음                                           | ❌ 없음                                         | ❌ (`/history` placeholder) | federated read projection UI                           | `NEW_READ_MODEL_REQUIRED` (후보)                                                                                           |

## 5. History Ownership 판정 (핵심 질문)

> **"FE-P5-S2 History Workspace는 기존 Domain History의 federated read
> projection인가, 아니면 새로운 authoritative History Domain이 필요한가?"**

**판정: FEDERATED_READ_PROJECTION (기본 가정이 아닌 evidence 기반).**

근거:

1. ADR-112 §1: "History reads append-only HistoryEvent, AuditEvent and Revision
   projections" — History는 기존 Domain의 append-only 이벤트·개정을 읽는
   projection으로 규정.
2. ADR-112 §9/§11: retention·tombstone·deleted-project audit은 **기존 Event
   identity와 lineage**에 대한 정책·접근 규칙이지 새 중앙 원장 요구가 아님.
3. Phase 5 §Section 1: "장기 Activity Event 원장은 만들지 않으며 FE-P5-S2
   History 경계를 침범하지 않는다" — Activity는 현재 projection, History는 장기
   기록이라는 역할 분리가 Canonical로 확정됨.
4. FE-P5-S1이 `ActivityProjectionBuilder` + adapter + projection watermark로
   federated read projection 패턴을 이미 검증 (Contract Snapshot §3).
5. §4 Matrix에서 대부분 대상이 `REUSE_DIRECT`이며 authoritative Domain이 이미
   존재 — 중앙 원장 중복 생성은 중복 권위를 만들 뿐.

**단, History Workspace 자체는 `NEW_READ_MODEL_REQUIRED`** — 기존 Domain History를
federated로 모아 읽는 read model/UI가 필요하며, 이는 canonical authority가
아니다. **Reversal·Payload Availability·Retention/Tombstone·DeletedProject
Audit Scope는 기존 Domain에 구현이 없으므로 `AUTHORITATIVE_CAPABILITY_REQUIRED`
(신규 authoritative capability 필요)이며, `OWNERSHIP_UNRESOLVED`** — 소유 Domain은
`NEW_DOMAIN_RESOURCE_REQUIRED`가 아니라 기존 Domain 확장(`AUGMENT`)이 likely
candidate (change-set-review, shared History contract + policy/domain
augmentation, project-administration/security). 소유권·신규 Domain 여부는
**A1에서 결정**한다.

## 6. 조사·판정 항목 (1~15)

| #   | 항목                                                     | 현재 상태                                                                                                                                                      | Gap/판정                                                                                                              |
| --- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | HistoryEvent/AuditEvent Identity                         | `historyEventId` (canonical: `history:${manifest.manifestId}`), `auditEventId` (generatedIdentity('audit')) 존재. append-only store port 명시                  | 통합 identity 규약 없음. ADR-112 §2/§3 삭제·덮어쓰기 금지 확정. A1에서 통합 규약 Candidate                            |
| 2   | Event Payload Availability                               | contracts에 `AVAILABLE/REDACTED/PURGED_BY_POLICY/UNAVAILABLE` 상태 **없음** (phase-5 §S2 설계 경계로만 명시)                                                   | **MISSING** — Product Contract 필요                                                                                   |
| 3   | Retention/Tombstone                                      | `RETENTION_EXPIRED`/`retentionClass`/`isRetentionExpired`는 **idempotency retention** (요청 재처리). Approval·Audit·Canonical History retention **없음**       | **MISSING** — History retention/tombstone Contract 필요 (Log vs History 분리, ADR-112 §8/§9)                          |
| 4   | Approval·Canonical Commit·External Result 장기 보존 조회 | Canonical `ListCanonicalHistory`, Review decision, External audit 각각 존재. 단일 통합 조회 없음                                                               | federated read projection으로 해소                                                                                    |
| 5   | Project 삭제 후 Audit 접근                               | `requestDeleteProject`만 존재. `ProjectTombstone`/`DeletedProjectAuditScope` contracts **없음**                                                                | **MISSING** — ADR-112 §11/§12 설계 경계만 존재. Contract 필요                                                         |
| 6   | Canonical Rollback = Reversal DraftChangeSet             | contracts에 `Reversal` **없음**. DraftChangeSet 생성(change-set-review)은 존재하나 Reversal semantics 없음                                                     | **MISSING** — ADR-112 §5/§6 확정 경계. Contract 필요 (직접 복원 금지)                                                 |
| 7   | External Rollback = Compensating Action                  | `RollbackV1`, `CompensatingActionV1`, `PREPARE_COMPENSATING_ACTION` 존재                                                                                       | **EXISTS** — `REUSE_DIRECT`                                                                                           |
| 8   | 권한 재검증                                              | External: `AUDIT_READ_SCOPES`/`ROLLBACK_SCOPES`. Review: fail-closed visibility                                                                                | 통합 History 조회 Capability 경계 **MISSING**                                                                         |
| 9   | 통합 History Workspace(UI)                               | `/history` placeholder (router.tsx). 각 Domain UI 존재                                                                                                         | **MISSING** — federated read projection UI                                                                            |
| 10  | FE-P5-S2 완료 조건 매핑                                  | 관찰(Activity)✅ → 실패·재시도 추적(Activity+External audit)✅ → 과거 조회(canonical/review/audit 각각)✅ → Reversal/Compensation (Compensation✅, Reversal❌) | Reversal이 완료 조건의 마지막 링크                                                                                    |
| 11  | History Ownership Model                                  | §5 판정                                                                                                                                                        | FEDERATED_READ_PROJECTION + AUTHORITATIVE_CAPABILITY_REQUIRED (소유권 A1 결정)                                        |
| 12  | Ordering/Cursor/Pagination                               | Activity: `ActivityEventContinuationV1` cursor 존재. audit: `sequence`. Canonical: 배열                                                                        | 통합 ordering/cursor 규약 **MISSING** (domain별로 상이)                                                               |
| 13  | Rebuildability/Persistence                               | Activity index rebuildable projection. Canonical/Review/External은 authoritative store                                                                         | 통합 rebuildability 구분 없음. additive migration 여부는 A1 판정                                                      |
| 14  | Security/Non-disclosure                                  | External audit: allowlist payload (`ActionAuditEventDataV1`). Review: visibility filter                                                                        | cross-project masking / deleted-project audit / sensitivity downgrade 후 payload **MISSING** (ADR-112 §10~§12 경계만) |
| 15  | Reversal Eligibility                                     | **없음**                                                                                                                                                       | 신규 설계 필요 — server-derived capability, stale/superseded/dependent 처리, approval 재사용 여부                     |

## 7. ADR-111/112 충돌 여부 판정

- ADR-111 (Activity projection) — **SUFFICIENT_AS_IS**: FE-P5-S2가 Activity
  원장을 만들지 않고 federated History projection을 쓰는 한 충돌 없음.
- ADR-112 (Immutable History + Reversal ChangeSet Boundary) —
  **SUFFICIENT_AS_BASELINE**: ADR-112가 retention·tombstone·reversal·
  deleted-project audit을 하나의 일관된 History 경계로 이미 묶고 있음.
- **추가 Architecture Decision 후보: ONE FE-P5-S2 SECTION-SPECIFIC HARDENING
  ADR (CANDIDATE)** — FE-P5-S1이 ADR-130 하나로 구현 경계를 구체화한 패턴을
  따른다. 이 하나의 hardening ADR이 다음을 함께 커버한다:
  1. federated History read projection
  2. identity / ordering / cursor
  3. payload availability / retention / tombstone
  4. Reversal ownership and eligibility
  5. DeletedProject audit scope
- A1에서 조사 결과 정말 독립적인 owner와 lifecycle이 필요한 경우에만 여러 ADR로
  분리한다. 현재 A0 증거로 4개의 독립 ADR이 필요하다고 말할 근거는 부족.
- 결론: ADR-111/112를 STALE로 추정하지 않는다. Round 2 ACCEPTED 후 A1에서
  hardening ADR 1건 확정 판정.

## 8. Migration / Dependency 판정 (Candidate)

- Migration: **CONDITIONAL / UNRESOLVED** (동시 확정 금지):
  - on-read federated aggregation만 채택 → History read-model migration은
    `NONE`일 수 있음.
  - persistent projection index 채택 → **additive migration REQUIRED**.
  - ProjectTombstone / retention state에 새 persistence 필요 → 해당 범위
    **additive migration REQUIRED**.
  - A1에서 read model 선택과 함께 확정.
- Runtime dependency: **NOT_REQUIRED 후보** — 기존 Domain API·store만 사용,
  신규 OSS 런타임 없음. (A0 요청문 §12 Not authorized: dependency 변경 없음)

## 9. FE-P5-S2 완료 조건 매핑

```text
현재 작업 관찰          → Activity (FE-P5-S1) ✅
실패·재시도 추적        → Activity + External Action audit/attempt ✅
과거 변경·승인·실행 조회 → Canonical history + Review decision + External audit
                          (federated History Workspace, 🔶 조회는 신규 read model)
안전한 Reversal/Compensation 시작
                        → Compensation ✅ (external)
                          Reversal 🔶 (신규 — Reversal DraftChangeSet)
```

## 10. A0_EXIT_CRITERIA 체크

| #   | 기준                                  | 상태                                                         |
| --- | ------------------------------------- | ------------------------------------------------------------ |
| 1   | Existing vs Missing capability 분리   | ✅ §3/§4                                                     |
| 2   | History ownership model 제안          | ✅ §5 (FEDERATED_READ_PROJECTION + 신규 capability 후보)     |
| 3   | ADR-111/112 충돌 여부 판정            | ✅ §7 (SUFFICIENT_AS_IS/AS_BASELINE, hardening ADR 후보 1건) |
| 4   | New ADR / Amendment 필요 여부 판정    | 🔶 hardening ADR 1건 후보, 확정은 A1                         |
| 5   | Migration 필요 여부 판정              | 🔶 CONDITIONAL / UNRESOLVED, 확정은 A1                       |
| 6   | Runtime dependency 필요 여부 판정     | ✅ NOT_REQUIRED 후보                                         |
| 7   | Product Contract candidate 작성       | ✅ Contract Preparation 문서                                 |
| 8   | AC candidate 작성                     | ✅ Contract Preparation 문서                                 |
| 9   | unresolved architecture blockers 명시 | ✅ §11                                                       |
| 10  | A1 진입 가능/불가 판정                | ✅ §12 (CONDITIONAL_PROCEED)                                 |

## 11. Unresolved architecture blockers / Open questions

1. Reversal Eligibility의 정확한 규칙 — 어떤 revision에서 Reversal이 가능한가
   (server-derived capability, stale/superseded/dependent, approval 재사용).
2. Payload Availability 상태 전이 — REDACTED/PURGED_BY_POLICY가 언제, 누가,
   어떤 정책으로 적용되는가.
3. DeletedProjectAuditScope — 접근 부여 주체·경계·restoration lineage.
4. History Workspace ordering — domain별 이벤트를 단일 시간순으로 합칠 때
   tie-breaker/cursor 규약 (activity는 ActivityEventContinuationV1이 있으나
   canonical/audit은 sequence/timestamp 상이).
5. History retention 정책의 owner — settings-policy `privacy.retentionDays`가
   History retention에 적용되는지 범위 판정 필요.
6. **Settings/Policy Change History** — `ListPolicyHistory` 같은 장기 policy
   history query가 없음 (SettingsRepositoryPort는 현재 snapshot/revision/command
   status/Privacy Retention 보유). REUSE/ADAPTER/NEW READ CAPABILITY 판정 필요.
7. **OperationalResourceKindRegistry (ADR-113)** — HistoryEntry가 공유 Resource
   Kind Registry를 사용하는지, Aggregate vs Concrete Resource Kind 구분과
   concrete identity 보존을 Contract/AC에 반영할지.

## 12. A1 진입 판정

**A1 진입: NOT_YET_APPROVED** — A0 Review Round 1 `CHANGES_REQUIRED` 수정 반영 후
**Review Round 2 → ACCEPTED**가 되어야만 A1 진입 가능 (GPT Review Gate 2026-08-08).
현재 Candidate 상태에서 A1 착수 금지.

A1 진입 조건 (Gap Audit 기준):

- History Ownership(FEDERATED_READ_PROJECTION) + `AUTHORITATIVE_CAPABILITY_REQUIRED`
  capability 3건 (Payload Availability, Retention/Tombstone, Reversal,
  DeletedProjectAuditScope)의 **소유권(OWNERSHIP)** 확정 — likely `AUGMENT`
  (change-set-review, shared History contract + policy/domain augmentation,
  project-administration/security). 신규 Domain 여부는 A1 evidence로 판정.
- **ONE FE-P5-S2 Section-specific hardening ADR** 확정 (독립 owner/lifecycle
  근거가 있을 때만 분리).
- Settings/Policy Change History의 REUSE/ADAPTER/NEW READ CAPABILITY 판정
  (NEEDS_EXACT_AUDIT).
- Ask/Source History의 OPTIONAL_HISTORY_FAMILY 포함 여부 결정.
- Frozen Contract Snapshot + AC 확정 (사용자 승인, ADR-113
  OperationalResourceKindRegistry 경계 포함).
- Migration(CONDITIONAL/UNRESOLVED)·Dependency 판정 확정.

FE-P5-S2 상태: **NOT_STARTED 유지** (A0는 구현 전 준비 조사).

## 13. GPT Review Gate 검토 결과 기록

- **A0 Review Round 2 (2026-08-08): ACCEPTED**
  - Verdict: `FE-P5-S2 A0 — Review Round 2 Verdict: ACCEPTED`
  - Status Authority: `A0_ACCEPTED`
  - Core Architecture: `FEDERATED_READ_PROJECTION` / ADR-111: SUFFICIENT_AS_IS /
    ADR-112: SUFFICIENT_AS_BASELINE / ONE Section-specific hardening ADR —
    CANDIDATE / Migration: CONDITIONAL-UNRESOLVED / Runtime Dependency:
    NOT_REQUIRED-CANDIDATE / FE-P5-S2: `NOT_STARTED / NOT_AUTHORIZED`
  - Round 1 5건 지적 모두 반영 확인. 추가 Architecture blocker 없음.
  - CI: exact head `f98dd419` run #657 (31261810575) SUCCESS.
  - A0 Closure: 문서 status 정규화 + provenance 추가 + PR #77 본문 갱신 후
    사용자 merge 승인 → post-merge main CI → A0 FINAL / CANONICAL INPUT FOR A1.
  - A1 준비: Section-specific hardening ADR / Ownership 결정 / read model 방식
    결정 / Migration 확정 / Frozen Contract / AC 확정. 사용자 A1 별도 승인.

- **A0 Review Round 1 (2026-08-08): CHANGES_REQUIRED**
  - Verdict: `FE-P5-S2 A0 — Review Round 1 Verdict: CHANGES_REQUIRED`
  - Core Architecture Direction: **VALID** — History Ownership
    `FEDERATED_READ_PROJECTION` **ACCEPTED**
  - A1 Entry: `NOT_YET_APPROVED` / PR #77: `KEEP DRAFT / DO NOT MERGE` /
    FE-P5-S2: `NOT_STARTED / NOT_AUTHORIZED`
  - Required corrections 5건 (모두 반영):
    1. `NEW_DOMAIN_RESOURCE_REQUIRED` → `AUTHORITATIVE_CAPABILITY_REQUIRED` /
       `OWNERSHIP_UNRESOLVED` (3건: Reversal, Payload Availability/Retention/
       Tombstone, DeletedProjectAuditScope)
    2. New ADR 후보 4건 → **ONE Section-specific hardening ADR candidate**
       (ADR-111: SUFFICIENT_AS_IS, ADR-112: SUFFICIENT_AS_BASELINE)
    3. Migration `REQUIRED 후보` → **CONDITIONAL / UNRESOLVED**
    4. **Policy History를 Reuse Matrix에 추가** (Settings/Policy Change
       History, NEEDS_EXACT_AUDIT) + Ask/Source History를
       `REUSE_AVAILABLE / OPTIONAL_HISTORY_FAMILY`로 재분류
    5. **OperationalResourceKindRegistry (ADR-113)** 경계를 Contract/AC
       후보에 반영
  - Preserve: FEDERATED_READ_PROJECTION / ADR-111/112 Accepted baseline /
    Compensation reuse / Reversal DraftChangeSet boundary / Payload identity
    preservation / Deleted-project capability revalidation / Runtime
    dependency NOT_REQUIRED candidate
  - 이 §13은 검토 이력/provenance 기록이며 ADR/Contract 결정 권위로 사용하지
    않는다.
