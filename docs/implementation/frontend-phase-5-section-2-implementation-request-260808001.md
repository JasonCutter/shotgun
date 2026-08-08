---
id: FE-P5-S2-IMPLEMENTATION-REQUEST-260808001
classification: CANDIDATE
status: user_review_required
work_item: FE-P5-S2
created_at: 2026-08-08
authority: FE-P5-S2-A1-COMPLETE-2026-08-08 (A1 FINAL, main@701e0bfa, CI #664 SUCCESS)
subject_base: 701e0bfac5af60daa48d9155185956b91650ecbd
---

# Project Shotgun — FE-P5-S2 History·Audit·Rollback Implementation Request

> IR는 ADR-131/Frozen Contract 내용을 **재선택하거나 변경하지 않는다**. 무엇을
> 어떤 순서로 구현하고 각 AC를 어떤 증거로 검증할지를 고정한다.

## 1. Authority / Exact Base

```text
Repository: JasonCutter/shotgun
Canonical Branch: main
Exact Base: 701e0bfac5af60daa48d9155185956b91650ecbd
Post-Merge Main CI: #664 Run ID: 31273066755 SUCCESS
Do not rerun #664.
```

Canonical inputs:

```text
ADR-131 — ACCEPTED
docs/architecture/contracts/snapshots/frontend-phase-5-section-2/
  frontend-phase-5-section-2-contract-snapshot-260808001.md — FROZEN
FE-P5-S2-AC-01 ~ AC-16 — APPROVED/FROZEN
```

## 2. 현재 권위 상태

```text
FE-P5-S2: NOT_STARTED
IR: CANDIDATE / USER_REVIEW_REQUIRED
Product Implementation: NOT_AUTHORIZED
Migration Execution: NOT_AUTHORIZED
```

IR 작성 자체는 Product 구현 승인이 아니다. 사용자가 IR을 검토한 후 별도로
Product 구현을 승인해야 한다.

## 3. Frozen Implementation Scope

Included (Frozen Contract에서 내려온 구현 범위):

```text
- Persistent rebuildable History projection
  - History index + watermark/checkpoint
  - Canonical History adapter
  - Review/Approval adapter
  - External Action Audit adapter
  - Policy History adapter
- settings-policy append-only Policy Change History
- PayloadAvailability AVAILABLE / REDACTED / PURGED_BY_POLICY / UNAVAILABLE
- Retention / Tombstone
- purge AuditEvent
- Event identity preservation
- ProjectTombstone
- DeletedProjectAuditScope
- current Capability revalidation
- Reversal DraftChangeSet
  - current eligibility
  - current Review
  - current Approval
- History Workspace Product API
- History Workspace UI
- ordering / cursor / pagination
- OperationalResourceKindRegistry integration
```

Excluded:

```text
- Source Version History integration: DEFER
- Ask / Conversation History integration: DEFER
- Central authoritative History ledger: FORBIDDEN
- Historical approval authority reuse: FORBIDDEN
- Direct canonical restore: FORBIDDEN
- New runtime dependency: FORBIDDEN unless Contract Amendment
- Cross-Phase Product Verification: NOT PART OF FE-P5-S2 IMPLEMENTATION
- Deployment: NOT AUTHORIZED
```

## 4. Migration 구현 범위

`Migration: REQUIRED / ADDITIVE` (A1에서 확정 — 재판단하지 않음).

4개 persistence scope를 각각 구현 항목으로 고정:

```text
A. History Projection
   - rebuildable history projection index
   - watermark/checkpoint
   - authority = NON-AUTHORITATIVE
B. Deleted Project
   - ProjectTombstone persistence
   - DeletedProjectAuditScope / authorization binding
C. Payload Availability / Retention
   - payload availability/tombstone state
   - purge AuditEvent
D. Policy History
   - append-only policy-change history
```

IR에서 처음으로 실제 **migration number table / index constraint /
rollback-rebuild strategy**를 제안한다. 단, IR 승인 전 migration 파일을 실제
생성하거나 실행하지 않는다. 기존 데이터 무변경, destructive migration 없음.

## 5. Work Package 분해

```text
WP1 — Shared Contracts + Additive Persistence Foundation
WP2 — Authoritative History Capabilities (WP2-A/B/C internal slices)
WP3 — Reversal DraftChangeSet
WP4 — Federated History Projection + Product API
WP5 — History Workspace UI
WP6 — Integrated Verification + Security + Performance
```

### Work Package execution rule (ONE WP AT A TIME)

```text
- Only ONE Work Package may be implemented at a time.
- Each WP requires focused verification and review before the next WP begins.
- Acceptance of WPn does not authorize WPn+1 unless the approved Product
  Implementation Request explicitly authorizes sequential continuation.
- A blocking Contract/Architecture conflict stops implementation and requires
  amendment; it must not be silently resolved in Product code.
```

운용 순서: `WP1 구현 → focused verification → WP1 review → ACCEPTED → WP2 ...`
같은 exact head에서 이미 PASS한 검증을 다음 WP에서 다시 돌리지 않는다.

### WP1 — Shared Contracts + Persistence Foundation

공통 contract와 migration 기반:

```text
HistoryEntryV1
HistoryCursorV1
PayloadAvailabilityV1
ProjectTombstoneV1
DeletedProjectAuditScopeV1
Reversal-related contract
DB migration (History projection index, watermarks, Policy History persistence,
Tombstone persistence)
```

WP1에서는 UI를 만들지 않는다.

### WP2 — Authoritative History Capabilities

WP2 내부 implementation slices (별도 WP 번호 증가 없음):

```text
WP2
├─ WP2-A Policy History
│    owner: settings-policy
│
├─ WP2-B Payload Availability / Retention / Tombstone
│    owner: each authoritative Domain
│    retention policy: settings-policy
│
└─ WP2-C ProjectTombstone / DeletedProjectAuditScope
     owner: project-administration / security
```

```text
WP2 COMPLETE IFF WP2-A PASS AND WP2-B PASS AND WP2-C PASS
```

(Policy History만 끝나고 DeletedProject security 미완료인 상태를 WP2 COMPLETE로
처리하지 않는다.)

### WP3 — Reversal DraftChangeSet

```text
Historical Revision → eligibility check → Reversal DraftChangeSet
  → current Snapshot impact → Review → Approval → Canonical Commit
```

필수 negative cases:

```text
historical approval reuse → reject
stale target → reject
superseded target → reject
dependent revision conflict → typed reject
missing current capability → typed reject
```

### WP4 — Federated History Projection + Product API

```text
Canonical adapter
Review adapter
External Audit adapter
Policy History adapter
  ↓
persistent rebuildable History projection
  ↓
ListHistoryWorkspace
GetHistoryEntry
```

source identity를 projection identity로 바꾸지 않는다.

### WP5 — History Workspace UI

`/history` Workspace 최소 기능:

```text
History list, filters, pagination, detail
payload availability display
audit lineage
Reversal entry point
Compensation link/action
deleted-project audit handling
```

### WP6 — Integrated Verification + Security + Performance

새 기능 WP가 아니라 Section 완료 검증:

```text
AC-01~16 evidence closure
security negative cases
rebuild/recovery
E2E
accessibility
performance
```

## 6. AC → WP → Evidence Matrix

| AC       | 제목                               | Primary WP | Evidence                 |
| -------- | ---------------------------------- | ---------- | ------------------------ |
| AC-01    | federated History (중앙 원장 금지) | WP4        | contract/unit/E2E        |
| AC-02    | identity preservation              | WP1/WP4    | contract + negative      |
| AC-03    | identity immutable                 | WP2        | negative                 |
| AC-04~06 | retention/payload                  | WP2        | unit/golden/negative     |
| AC-07~08 | Reversal                           | WP3        | golden/security/negative |
| AC-09    | Compensation reuse                 | WP4/5      | reuse/E2E                |
| AC-10~13 | deleted-project/security           | WP2/5      | security negative        |
| AC-14    | cursor/order                       | WP4        | contract/golden          |
| AC-15    | full Section flow                  | WP6        | E2E                      |
| AC-16    | performance                        | WP6        | measured evidence        |

## 7. AC-16 성능 Gate 절차

```text
대표적인 구현 상태 확보 → baseline 측정 → 측정 결과 제출
→ numeric budget 제안 → 사용자 명시 승인 → threshold freeze
→ performance verification
```

Codex/구현자가 임의로 숫자를 정하지 않는다 (예: `P95 <= 2 sec` 금지).

## 8. 테스트 정책

```text
- 동일 exact head에서 PASS한 검증 재실행 금지
- 수동 duplicate CI 금지
- empty commit으로 CI 재실행 금지
- 변경된 WP에 필요한 focused test만 실행
- normal push가 만든 automatic CI를 authoritative CI evidence로 사용
- 이전 PASS evidence가 그대로 유효하면 재검증하지 않음
- #664 (A1 docs main)는 재실행하지 않음
- Product branch의 새 exact head에 필요한 검증만 실행
- Run the final complete FE-P5-S2 Section verification ONCE, immediately
  before Section completion review (WP 구현 중에는 focused verification만,
  전체 Section 검증을 WP마다 반복하지 않음)
```

## 9. 구현 승인 이후 Status 전환 규칙

```text
IR Review ACCEPTED
  ↓
IR r1 → FROZEN / PRODUCT_IMPLEMENTATION_NOT_AUTHORIZED
  ↓
사용자 Product Implementation 명시 승인
  ↓
FE-P5-S2 → IN_PROGRESS
Migration Implementation → AUTHORIZED
WP1 → AUTHORIZED
  ↓
실제 구현
```

IR 검토 통과 자체가 구현 승인은 아니다. 사용자 승인 시 다음을 명시적으로
포함한다:

```text
I approve FE-P5-S2 Product Implementation under the Frozen Implementation
Request r1.
Authorized:
- FE-P5-S2 → IN_PROGRESS
- additive migration implementation A/B/C/D
- WP1 implementation
- approved sequential WP execution under IR gates
Not authorized:
- Contract/ADR semantic changes
- Source/Ask History scope expansion
- new runtime dependencies
- Cross-Phase Verification
- Deployment
- Merge without separate merge authorization
```

Ready/merge도 Product 구현 승인과 분리한다.

이후 Section 완료:

```text
구현 → AC evidence → exact-head CI PASS → GPT verification
→ 사용자 completion approval → merge → post-merge main CI
→ Completion Manifest / Governance Closure → FINAL_AFTER_MERGE
```

## 10. IR Exit Criteria

```text
IR_EXIT_CRITERIA
1. Exact canonical base 고정
2. ADR-131 / Frozen Contract authority 명시
3. Included / Excluded scope 고정
4. Migration A/B/C/D 구현 계획 고정
5. Runtime dependency = NOT_REQUIRED 유지
6. WP 순서와 dependency 고정
7. AC-01~16 → WP 매핑 완료
8. AC-01~16 → evidence/test 매핑 완료
9. Security negative cases 명시
10. Reversal eligibility/error cases 명시
11. Projection rebuild/recovery 전략 명시
12. AC-16 deferred numeric Gate 절차 명시
13. 불필요한 duplicate test 금지
14. Completion/merge 권위 분리
15. Product implementation은 사용자 별도 승인 필요
```

## 권장 구현 순서

`WP1 → WP2 → WP3 → WP4 → WP5 → WP6` (dependency 순서). 각 WP는 exact-head
automatic CI로 검증한다.

## Next Gate

```text
NEXT FE-P5-S2 Implementation Request
Status: DRAFT / USER_REVIEW_REQUIRED
FE-P5-S2: NOT_STARTED
Product Implementation: NOT_AUTHORIZED
```
