---
id: FRONTEND-PHASE-5-SECTION-2-GAP-AUDIT-260808001
classification: CANDIDATE
status: user_review_required
work_item: FE-P5-S2-A0
created_at: 2026-08-08
authority: FE-P5-S2-A0-REQUEST-260808001 (user A0 authorization 2026-08-08)
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

| #   | History/Audit 대상                         | authoritative Domain                 | persistence                                     | Product API                                                                                     | UI                                                  | 근거                                                  |
| --- | ------------------------------------------ | ------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| 1   | Source Version History                     | frontend-sources-product             | source version store                            | `getSourceVersionHistory`, `SourceVersionHistoryView`                                           | source-detail-workspace.tsx "Version history"       | ADR-122, contracts                                    |
| 2   | Ask/Conversation history                   | frontend-ask-execution, cited-answer | ask store                                       | Ask read 계열                                                                                   | Ask workspace                                       | module 존재                                           |
| 3   | Canonical Revision/Commit history          | canonical-knowledge                  | canonical commit/history store                  | `ListCanonicalHistory`, `CanonicalHistoryEvent`                                                 | (전용 UI 없음)                                      | ADR-086; canonical-knowledge + projection-search 모듈 |
| 4   | DraftChangeSet history                     | change-set-review                    | draft change set store                          | `ListDraftChangeSets`, `getDraftChangeSet`                                                      | review UI                                           | change-set-review module                              |
| 5   | Review/Decision/Approval history           | frontend-review                      | decisions/comments append-only                  | review read                                                                                     | review-workspace.tsx `ReviewHistory`                | frontend-review module                                |
| 6   | External Action Attempt/Verification/Audit | frontend-external-action             | audit append-only (`repositories.audit`)        | `ListActionAudit`, `ActionAuditEventV1`                                                         | external-action-workspace.tsx audit                 | ADR-129; frontend-external-action                     |
| 7   | Activity-derived operational references    | frontend-activity                    | `frontend_activity.activity_index` (projection) | Activity read                                                                                   | Activity Workspace                                  | FE-P5-S1; ADR-130                                     |
| 8   | Project lifecycle/deletion                 | project-administration               | project store                                   | `requestDeleteProject`                                                                          | (전용 UI 확인 필요)                                 | project-administration module                         |
| 9   | Reversal (Canonical rollback)              | **없음**                             | **없음**                                        | **없음**                                                                                        | **없음**                                            | contracts에 `Reversal` 미존재                         |
| 10  | Compensation (External rollback)           | frontend-external-action             | rollbacks/compensations store                   | `RollbackV1`, `CompensatingActionV1`, `PREPARE_COMPENSATING_ACTION`, `ROLLBACK_EXTERNAL_ACTION` | external-action-workspace.tsx rollback/compensation | ADR-129; frontend-external-action                     |

## 4. Existing Authority / Reuse Matrix

각 History 대상의 FE-P5-S2 ownership 판정 (evidence 기반, 기본 가정 없음).

| History 대상                                             | Existing authoritative Domain              | Existing persistence | Existing Product API | Existing UI                 | Missing capability                                     | FE-P5-S2 ownership                    |
| -------------------------------------------------------- | ------------------------------------------ | -------------------- | -------------------- | --------------------------- | ------------------------------------------------------ | ------------------------------------- |
| Source Version History                                   | ✅ frontend-sources-product                | ✅                   | ✅                   | ✅                          | 없음                                                   | `REUSE_DIRECT`                        |
| Ask/Conversation history                                 | ✅ frontend-ask-execution                  | ✅                   | ✅                   | ✅                          | 없음                                                   | `REUSE_DIRECT`                        |
| Canonical Revision/Commit history                        | ✅ canonical-knowledge                     | ✅                   | ✅                   | ❌ (전용 UI 없음)           | History Workspace에서 조회 UI                          | `FEDERATED_READ_PROJECTION`           |
| DraftChangeSet history                                   | ✅ change-set-review                       | ✅                   | ✅                   | ✅                          | 없음                                                   | `REUSE_DIRECT`                        |
| Review/Decision/Approval history                         | ✅ frontend-review                         | ✅                   | ✅                   | ✅                          | 없음                                                   | `REUSE_DIRECT`                        |
| External Action Attempt/Verification/Audit               | ✅ frontend-external-action                | ✅                   | ✅                   | ✅                          | 없음                                                   | `REUSE_DIRECT`                        |
| Activity-derived operational references                  | ✅ frontend-activity                       | ✅                   | ✅                   | ✅                          | 없음                                                   | `REUSE_DIRECT`                        |
| Project lifecycle/deletion                               | ✅ project-administration                  | ✅ (삭제 요청)       | ✅                   | ❌                          | Tombstone·deleted-project audit scope                  | `NEW_DOMAIN_RESOURCE_REQUIRED` (후보) |
| Reversal (Canonical rollback)                            | ❌ 없음                                    | ❌ 없음              | ❌ 없음              | ❌ 없음                     | Reversal DraftChangeSet semantics                      | `NEW_DOMAIN_RESOURCE_REQUIRED` (후보) |
| Compensation (External rollback)                         | ✅ frontend-external-action                | ✅                   | ✅                   | ✅                          | 없음                                                   | `REUSE_DIRECT`                        |
| History Event Payload Availability / Retention·Tombstone | ❌ (부분: idempotency `RETENTION_EXPIRED`) | ❌                   | ❌                   | ❌                          | Payload Availability 상태, History retention/tombstone | `NEW_DOMAIN_RESOURCE_REQUIRED` (후보) |
| 통합 History Workspace                                   | ❌ 없음                                    | ❌ 없음              | ❌ 없음              | ❌ (`/history` placeholder) | federated read projection UI                           | `NEW_READ_MODEL_REQUIRED` (후보)      |

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
Audit Scope는 기존 Domain에 없으므로 신규 authoritative capability 후보**이며,
기존 Domain 확장(AUGMENT) 또는 신규 Domain resource로 FE-P5-S2 A1에서 결정.

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
| 11  | History Ownership Model                                  | §5 판정                                                                                                                                                        | FEDERATED_READ_PROJECTION + 신규 authoritative capability 후보                                                        |
| 12  | Ordering/Cursor/Pagination                               | Activity: `ActivityEventContinuationV1` cursor 존재. audit: `sequence`. Canonical: 배열                                                                        | 통합 ordering/cursor 규약 **MISSING** (domain별로 상이)                                                               |
| 13  | Rebuildability/Persistence                               | Activity index rebuildable projection. Canonical/Review/External은 authoritative store                                                                         | 통합 rebuildability 구분 없음. additive migration 여부는 A1 판정                                                      |
| 14  | Security/Non-disclosure                                  | External audit: allowlist payload (`ActionAuditEventDataV1`). Review: visibility filter                                                                        | cross-project masking / deleted-project audit / sensitivity downgrade 후 payload **MISSING** (ADR-112 §10~§12 경계만) |
| 15  | Reversal Eligibility                                     | **없음**                                                                                                                                                       | 신규 설계 필요 — server-derived capability, stale/superseded/dependent 처리, approval 재사용 여부                     |

## 7. ADR-111/112 충돌 여부 판정

- ADR-111 (Activity projection) — **SUFFICIENT_AS_IS**: FE-P5-S2가 Activity
  원장을 만들지 않고 federated History projection을 쓰는 한 충돌 없음.
- ADR-112 (Immutable History + Reversal ChangeSet Boundary) — **SUFFICIENT_AS_IS**
  (설계 경계). 단, 다음은 기존 결정으로 충분하지 않아 **NEW_ADR_REQUIRED 후보**:
  1. History Workspace federated read model의 identity/ordering/cursor 규약
  2. Payload Availability 상태 모델 + History retention/tombstone 적용 범위
  3. Reversal DraftChangeSet의 Product surface (elibility, approval 재사용,
     superseded 처리)
  4. DeletedProjectAuditScope 접근 경계와 Capability
- 결론: ADR-111/112를 STALE로 추정하지 않는다. A1에서 Amendment/new ADR
  필요성을 확정 판정.

## 8. Migration / Dependency 판정 (Candidate)

- Migration: Canonical·Review·External history는 이미 append-only 저장.
  History Workspace는 새 read model/인덱스가 필요할 수 있어 **additive
  migration REQUIRED 후보** (기존 데이터 무변경). A1에서 확정.
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

| #   | 기준                                  | 상태                                                     |
| --- | ------------------------------------- | -------------------------------------------------------- |
| 1   | Existing vs Missing capability 분리   | ✅ §3/§4                                                 |
| 2   | History ownership model 제안          | ✅ §5 (FEDERATED_READ_PROJECTION + 신규 capability 후보) |
| 3   | ADR-111/112 충돌 여부 판정            | ✅ §7 (SUFFICIENT_AS_IS, new ADR 후보 4건)               |
| 4   | New ADR / Amendment 필요 여부 판정    | 🔶 후보 제시, 확정은 A1                                  |
| 5   | Migration 필요 여부 판정              | 🔶 REQUIRED 후보 (additive), 확정은 A1                   |
| 6   | Runtime dependency 필요 여부 판정     | ✅ NOT_REQUIRED 후보                                     |
| 7   | Product Contract candidate 작성       | ✅ Contract Preparation 문서                             |
| 8   | AC candidate 작성                     | ✅ Contract Preparation 문서                             |
| 9   | unresolved architecture blockers 명시 | ✅ §11                                                   |
| 10  | A1 진입 가능/불가 판정                | ✅ §12 (CONDITIONAL_PROCEED)                             |

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

## 12. A1 진입 판정

**CONDITIONAL_PROCEED** — A0_EXIT_CRITERIA 1~10 중 1·2·3·6은 충족, 4·5·7·8은
Candidate 문서로 충족(확정은 A1), 9·10은 명시 완료.

A1 진입 조건 (Gap Audit 기준):

- History Ownership(FEDERATED_READ_PROJECTION) + 신규 capability 4건
  (Payload Availability, Retention/Tombstone, Reversal, DeletedProjectAuditScope)
  에 대한 Architecture Decision 확정.
- New ADR/Amendment 필요 여부 확정 (후보 4건).
- Frozen Contract Snapshot + AC 확정 (사용자 승인).
- Migration·Dependency 판정 확정.

FE-P5-S2 상태: **NOT_STARTED 유지** (A0는 구현 전 준비 조사).
