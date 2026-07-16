# Shotgun Release Strategy

> 목적: 수직 슬라이스를 안전하게 통합·배포하고 Contract, Schema, Canonical과 Projection을 되돌릴 수 있게 관리한다.

## 1. 릴리스 단위

Shotgun의 릴리스는 단순 코드 버전이 아니라 사용 가능한 수직 기능과 Contract 집합이다.

릴리스 유형:

- `dev`: 개발 중 통합 상태
- `alpha`: 내부 Walking Skeleton과 제한된 자료
- `beta`: 실제 개인 자료로 제한 운영
- `rc`: Release Candidate와 Migration·Rollback 검증
- `stable`: 정의된 범위에서 일상 사용 가능

## 2. 버전 관리

### Application Version

Semantic Versioning을 기본으로 한다.

- Major: 호환되지 않는 Product·Contract·Data Migration
- Minor: 하위 호환 기능 추가
- Patch: 하위 호환 수정

### Module Version

각 재사용 가능 모듈은 독립 Version을 가질 수 있다.

Module Manifest에 다음을 기록한다.

- module version
- supported contract ranges
- runtime compatibility
- schema migration version
- capability version

### Contract Version

Message Type과 Payload Schema를 별도로 버전화한다.

- Additive 변경 우선
- Breaking Change는 새 Major
- Producer와 Consumer의 Compatibility Matrix 유지
- 구형 Event를 조용히 새 의미로 재해석하지 않음

## 3. 릴리스 Milestone

### R0 — Engineering Skeleton

포함:

- Stage 0
- Stage 1의 WS-0

완료 결과:

- Module Manifest
- In-memory·In-process Connector
- CI와 Architecture Test

### R1 — Source and Evidence Alpha

포함:

- WS-1
- WS-2

완료 결과:

- 직접 텍스트 입력
- 원본 보존
- DocumentIR·EvidenceSpan
- 원문 복귀

### R2 — Candidate Review Alpha

포함:

- WS-3
- Stage 5의 최소 Review

완료 결과:

- Direct ClaimCandidate
- Evidence Validation
- 신규·중복·단순 충돌 비교
- 사용자 승인·거절·보류

### R3 — Walking Skeleton MVP

포함:

- WS-4
- WS-5

완료 결과:

- 승인된 Canonical Claim
- HistoryEvent
- Search Projection
- Citation이 있는 답변

### R4 — Document Beta

포함:

- WS-6A~6F

완료 결과:

- PDF·Office·이미지
- 형식별 Evidence
- Multimodal Validation
- Translation Revision

### R5 — Knowledge Review Beta

포함:

- WS-7

완료 결과:

- Entity·Relation·Event·Decision
- Conflict·Impact
- Burst Diff와 항목별 승인

### R6 — Discovery Beta

포함:

- WS-8

완료 결과:

- Compiled Truth
- Semantic Graph Projection
- Knowledge Gap·Discovery Reentry

### R7 — Safe Action Beta

포함:

- WS-9

완료 결과:

- 첫 외부 Draft Action
- Risk·Preview·Approval·Preflight·Verify
- Outcome Unknown 처리

### R8 — Reusable Modules v1

포함:

- WS-10

완료 결과:

- 별도 Assembly
- 독립 Package Version
- Compatibility Matrix
- Adapter 교체 검증

## 4. Branch와 Merge 원칙

- `main`은 통합 가능한 상태를 유지한다.
- 기능은 작은 Branch와 PR로 개발한다.
- Architecture·Data Migration·Safety 변경은 Draft PR로 조기 공유한다.
- PR은 관련 Stage·Slice·Module·ADD·ADR을 연결한다.
- Main 직접 Push는 문서·긴급 수정 등 사용자가 명시적으로 요청한 경우에만 수행한다.

## 5. Feature Flag

미완성 고위험 기능은 Feature Flag 뒤에 둔다.

적용 후보:

- 새 AI Provider
- 새 Format Adapter
- Graph Projection
- Knowledge Discovery
- External Action Connector
- 자동 Batch

Feature Flag가 Canonical·Approval 안전 경계를 우회하는 수단이 되어서는 안 된다.

## 6. Database Migration

### 원칙

- Migration은 Versioned·Forward-only를 기본으로 한다.
- 파괴적 변경은 Expand → Migrate → Contract 순서로 진행한다.
- Migration 전 Backup·Validation
- 대규모 변환은 Job과 Checkpoint 사용
- Migration 실패 시 상태와 재개 지점 기록

### Canonical Data

Canonical Revision과 HistoryEvent를 삭제·덮어쓰는 Migration을 금지한다.

의미 변경이 필요한 경우:

- 새 Schema Version
- Projection 재생성
- 명시적 HistoryEvent 또는 Migration Record
- 사용자 승인 영향 검토

### Projection Data

Projection은 새 Version을 병렬 생성하고 검증 후 Active Pointer를 전환한다.

Rollback은 이전 Projection Pointer로 전환하거나 Canonical에서 재생성한다.

## 7. Rollback

### Application Rollback

- 이전 Application Artifact 유지
- Contract·Schema Compatibility 확인
- Rollback 후 새 데이터 처리 가능 여부 확인

### Canonical Rollback

과거 Row를 삭제하거나 직접 되돌리지 않는다.

- 역방향 DraftChangeSet 생성
- Phase 4 비교·Impact·사용자 승인
- 새 Canonical Revision과 HistoryEvent

### External Action Rollback

외부 Action은 자동 원상복구를 보장하지 않는다.

- 가능한 Compensation Candidate 생성
- 현재 외부 상태 확인
- 별도 Preview·Approval·Preflight
- 결과 Audit

## 8. Release Candidate Gate

RC 생성 전:

- Definition of Done 통과
- 전체 Vertical Slice E2E
- Migration Dry-run
- Rollback Rehearsal
- Security Negative Test
- Dependency·License Scan
- Performance Regression
- Known Risk Review
- User Acceptance Demo

## 9. 배포 환경

### Local Development

- 합성 데이터
- Fake Provider 기본
- 로컬 PostgreSQL·Asset Storage

### Integration

- 실제와 유사한 Database·Queue
- Sandbox Connector
- Recorded 또는 제한된 AI Provider

### Personal Production

- 실제 개인 자료
- Backup
- Secret Store
- 접근 제한
- 비용 한도
- Audit 보존

다중 사용자·공개 서비스 환경은 별도 Security·Privacy 검토 전 지원하지 않는다.

## 10. Configuration and Secrets

- 설정 Schema Version 관리
- 환경별 Override
- Secret은 전용 Store 또는 안전한 환경변수 주입
- Secret Value를 Config Dump에 포함하지 않음
- Provider·Connector별 최소 권한
- Rotation 절차

## 11. Observability Release Gate

릴리스 전에 최소 다음을 확인한다.

- Health·Readiness
- Job Queue 상태
- Provider 오류·비용
- Canonical Commit 실패
- Projection Lag
- Action Outcome Unknown
- Security Deny·Approval 실패
- Storage 사용량

새 기능은 운영 상태를 확인할 Telemetry 없이 Stable로 승격하지 않는다.

## 12. Backup and Restore

대상:

- Canonical Database
- HistoryEvent·Audit
- Original Assets
- Configuration와 Contract Registry

Projection과 Cache는 재생성 가능하므로 별도 중요도 등급을 가진다.

복구 Test:

- 정기 Backup 생성
- 격리 환경 Restore
- Canonical Hash·Revision 검증
- Projection Full Rebuild
- Asset Reference 검증

## 13. Release Note 필수 내용

```text
Version:
Included stages and slices:
Modules changed:
Contract versions:
Schema migrations:
OSS changes and pinned versions:
User-visible changes:
Security and approval impact:
Known limitations:
Backup and rollback:
Tests and evidence:
Upgrade instructions:
```

## 14. Deprecation

- Deprecated Contract·Module·Adapter를 문서에 표시
- 대체 경로와 종료 Version 제공
- Consumer 사용 현황 확인
- Migration Tool 또는 Guide 제공
- 안전 경계 관련 기능은 조용히 제거하지 않음

## 15. Stable 승격 기준

- 반복적인 실제 사용 성공
- Critical·High Risk 미해결 없음
- Data Loss·Duplicate Action 없음
- Backup·Restore 검증
- 비용과 성능이 운영 한도 내
- 사용자 오류 복구 가능
- 문서와 Demo 최신
- OSS License·Security 상태 확인
