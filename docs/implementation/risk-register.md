# Shotgun Implementation Risk Register

> 목적: 구현 실패 가능성을 조기에 발견하고, 발생 전에 완화하거나 중단·재설계 기준을 정한다.

## 1. 평가 기준

### 가능성

- `L1`: 드묾
- `L2`: 가능
- `L3`: 높음
- `L4`: 거의 확실

### 영향

- `I1`: 국소 불편
- `I2`: 일정·품질 영향
- `I3`: 데이터·안전·구조 영향
- `I4`: Canonical 손상·민감정보·외부 피해

### 우선순위

- `LOW`: 관찰
- `MEDIUM`: 완화 계획 필요
- `HIGH`: 해당 Stage 완료 전 해결
- `CRITICAL`: 구현·릴리스 차단

## 2. 핵심 위험

| ID | 위험 | 가능성 | 영향 | 우선순위 | 담당 영역 |
|---|---|---:|---:|---|---|
| R-001 | 공통 계약을 너무 크게 설계해 MVP가 지연됨 | L3 | I2 | HIGH | Contracts·Planning |
| R-002 | Phase별 코드 중복으로 모듈 재사용성이 사라짐 | L3 | I3 | HIGH | Module Architecture |
| R-003 | 모듈 간 직접 DB 접근이 임시로 도입돼 영구 결합됨 | L3 | I3 | HIGH | Architecture Test |
| R-004 | 처음부터 마이크로서비스화해 운영 복잡도가 폭증함 | L2 | I3 | HIGH | Runtime·Deployment |
| R-005 | AI가 원문에 없는 후보를 생성해 Canonical로 유입됨 | L3 | I4 | CRITICAL | Candidate·Validation |
| R-006 | 승인 대상 변경 후 기존 Approval이 재사용됨 | L2 | I4 | CRITICAL | Review·Policy |
| R-007 | Claim이 자동 Fact로 승격됨 | L2 | I4 | CRITICAL | Canonical |
| R-008 | History·Revision이 업데이트로 덮어써짐 | L2 | I4 | CRITICAL | Canonical·Migration |
| R-009 | Event 중복·Replay가 중복 Side Effect를 발생시킴 | L3 | I4 | CRITICAL | Connector·Action |
| R-010 | Timeout 뒤 외부 Action을 재실행해 중복 작업 발생 | L2 | I4 | CRITICAL | Action Execution |
| R-011 | Provider Secret·개인자료가 Prompt·Log에 노출됨 | L2 | I4 | CRITICAL | Security·AI |
| R-012 | Projection을 Canonical처럼 사용해 오래된 결과가 Truth로 표시됨 | L3 | I3 | HIGH | Projection·Output |
| R-013 | PDF·Office 변환에서 Evidence 위치가 잘못 연결됨 | L3 | I3 | HIGH | Transformation·Evidence |
| R-014 | 특정 AI·OSS 공급자에 Domain이 강결합됨 | L3 | I3 | HIGH | Adapter·OSS |
| R-015 | OSS License·유지보수 검증 없이 코드가 유입됨 | L2 | I3 | HIGH | OSS Governance |
| R-016 | 테스트가 Mock에만 의존해 실제 종단 실패를 놓침 | L3 | I3 | HIGH | Testing |
| R-017 | Graph·Search 제품을 너무 일찍 도입해 복잡도 증가 | L3 | I2 | MEDIUM | Projection |
| R-018 | Discovery가 반복 후보를 무한 생성해 비용·잡음 증가 | L3 | I3 | HIGH | Discovery |
| R-019 | 사용자 피드백이 Fact·Directive·장기 기억으로 자동 저장됨 | L2 | I4 | CRITICAL | Feedback |
| R-020 | 오디오·영상 직접 분석이 Adapter로 우회 활성화됨 | L2 | I3 | HIGH | Scope·Assembly |
| R-021 | 개인 프로젝트 규모를 넘어 과도한 제품 범위를 구현함 | L4 | I2 | HIGH | Product Scope |
| R-022 | 비용 측정 없이 다중 AI 호출이 확대됨 | L3 | I2 | HIGH | AI FinOps |
| R-023 | Backup은 있으나 실제 Restore가 불가능함 | L2 | I4 | CRITICAL | Operations |
| R-024 | Module Package가 Shotgun 내부 Context에 의존해 재사용 실패 | L3 | I3 | HIGH | Stage 12 |
| R-025 | 기술 선택 결정을 늦춰 Critical Path가 반복 재작성됨 | L2 | I2 | MEDIUM | Stage 0 |

## 3. 위험별 대응

### R-001 — 과도한 Contract 설계

**조기 신호**

- 실제 Slice 없이 Schema만 계속 증가
- 사용 사례가 없는 Field·Event 추가
- Stage 1이 장기간 종료되지 않음

**완화**

- WS-0~WS-2에 필요한 Contract만 우선
- Additive Evolution
- 사용 사례 없는 Contract는 `experimental`
- Contract Review에 실제 Producer·Consumer 예시 요구

**중단 기준**

2개 이상 수직 슬라이스에서 사용되지 않는 공통 추상화는 Core에서 제거 또는 연기한다.

### R-002·R-003 — 중복과 직접 DB 결합

**조기 신호**

- `phase-*` 폴더 안에 동일 기능 반복
- 다른 모듈 Table을 직접 Query
- Integration Test를 위해 DB Row 직접 삽입

**완화**

- Module 중심 Directory
- Architecture Test
- DB Role·Schema Permission
- Query Port·Projection 제공

**중단 기준**

직접 접근 없이는 기능을 구현할 수 없다면 모듈 경계를 ADR로 재검토한다. 임시 예외를 조용히 허용하지 않는다.

### R-004 — 조기 분산 시스템화

**조기 신호**

- 비즈니스 기능보다 배포·네트워크 설정 작업이 많음
- Local Development에 여러 서비스가 필수
- 분산 Trace·Consistency 문제가 초기부터 발생

**완화**

- 모듈러 모놀리스
- In-process Transport
- PostgreSQL Job Table
- 분리 기준을 성능·보안·재사용 측정으로 제한

### R-005 — AI Hallucination의 Canonical 유입

**조기 신호**

- Evidence 없는 Direct Candidate
- 원문과 다른 수량·시간·부정
- 모델 합의를 승인 근거로 사용

**완화**

- direct-only 기본 Profile
- Field-level Evidence
- Deterministic Schema와 Evidence Alignment
- 사용자 승인
- Unsupported·Contradicted 상태

**중단 기준**

미승인·무근거 후보가 Canonical Commit Test에서 한 번이라도 통과하면 관련 Release를 차단한다.

### R-006·R-007·R-008 — 승인·Fact·History 손상

**완화**

- Approval Token에 Revision·Digest·Expected Version 결속
- Claim·Fact 별도 Operation
- Append-only Revision·HistoryEvent
- Optimistic Concurrency
- Transactional Commit

**중단 기준**

Safety Negative Test가 실패하면 Main Merge와 Release를 차단한다.

### R-009·R-010 — 중복 Side Effect

**완화**

- at-least-once 전제
- Idempotency Key와 Dedup Store
- Preflight
- Provider 상태 Verify
- Timeout 후 `OUTCOME_UNKNOWN`
- 자동 재실행 금지

**중단 기준**

Sandbox Chaos Test에서 중복 외부 객체가 발생하면 Connector를 `DEFERRED`로 되돌린다.

### R-011 — Secret·민감정보 노출

**완화**

- Secret Broker
- 최소 권한 Token
- Prompt·Log Redaction
- Security Context 기반 Provider Policy
- Test Secret과 실제 Secret 분리

**중단 기준**

Secret Scan 또는 Test에서 민감정보가 출력되면 즉시 Key Rotation과 Release 차단을 수행한다.

### R-012 — Projection Staleness

**완화**

- Watermark·Readiness
- `READY_WITH_LAG`, `DEGRADED`, `STALE`
- Canonical Revision 표시
- Projection 재생성

### R-013 — Evidence 위치 오류

**완화**

- Golden Corpus Round-trip
- Quote·Hash 검증
- Page·BBox·Cell·Shape Selector
- Multimodal Re-render Validation

**중단 기준**

Evidence Round-trip 오류율이 형식별 허용 기준을 넘으면 해당 Adapter를 Release에서 제외한다.

### R-014·R-015 — 공급자·OSS Lock-in

**완화**

- Port·Adapter
- Role Matrix
- Version Pin·SBOM
- License·Security·Maintenance Gate
- 대체 Adapter Contract Test

### R-016 — Mock-only 성공

**완화**

- 수직 슬라이스 E2E
- 실제 PostgreSQL Integration
- Provider Sandbox·Recorded Test
- Release Candidate Manual Acceptance

### R-017 — 조기 Search·Graph 복잡도

**완화**

- PostgreSQL FTS·Adjacency 기준
- NetworkX Test Oracle
- 측정 후 전용 제품 도입

### R-018 — Discovery 폭주

**완화**

- Snapshot·Semantic Signature
- Suppression
- Depth·Node·Time·Cost Budget
- 주간 Batch 한도
- 사용자 거절 기록

### R-019 — 피드백의 자동 지식화

**완화**

- Feedback Type 구분
- 표현 수정은 Output Revision
- 사실 수정은 Candidate·ChangeSet 재진입
- Directive는 별도 Proposal·승인
- 일회성 만족도는 품질 신호만 기록

### R-020 — 미디어 범위 우회

**완화**

- Assembly Manifest에서 Capability 비활성
- Policy Test
- ffmpeg `DEFERRED`
- 영상 URL Text 처리만 허용

### R-021 — 범위 과다

**완화**

- Walking Skeleton 우선
- Stage 7 전 고급 기능 Product Integration 금지
- 각 Stage에 Explicit Exclusion
- 사용 가치가 없는 모듈은 연기

### R-022 — AI 비용 폭증

**완화**

- Provider별 비용·Token 기록
- Task Profile별 Budget
- Batch·Caching·Deterministic Preprocessing
- Challenger 선택 사용
- 월간·주간 한도

### R-023 — 복구 불가

**완화**

- Backup과 Restore Test 분리
- Canonical·Asset 우선 복구
- Projection 재생성
- 정기 Rehearsal

### R-024 — 재사용 실패

**완화**

- In-memory Adapter
- Assembly 독립 Test
- Module Manifest
- Shotgun 전용 Global Context 금지
- Stage 12 실제 예제 Project

### R-025 — 기술 결정 지연

**완화**

- Stage 0 Decision Deadline
- 짧은 Spike와 명시적 Exit Criteria
- 결정 후 ADR
- 제품 교체 가능한 Port 유지

## 4. Stage별 최고 위험

| Stage | 최고 위험 |
|---|---|
| 0 | 기술 선택 지연, CI·환경 재현 실패 |
| 1 | 과도한 추상화, 전달 의미 불명확 |
| 2 | 원본 손실, 접근 범위 오류 |
| 3 | Evidence 위치 오류 |
| 4 | Hallucination·Provider Lock-in·비용 |
| 5 | Approval Staleness·권한 오류 |
| 6 | Canonical·History 손상 |
| 7 | Citation 누락·Projection Staleness |
| 8 | 형식 품질·멀티모달 오류·범위 우회 |
| 9 | Entity 오병합·Impact 폭주 |
| 10 | Discovery 반복·Graph 복잡도 |
| 11 | 중복 Action·Secret 노출 |
| 12 | 실제 재사용 불가·Version 충돌 |

## 5. 위험 검토 주기

- 각 Stage 시작 전
- Stage Completion 전
- Architecture PR
- OSS 채택 PR
- Canonical·Action 변경 PR
- Release Candidate
- Critical Incident 후

## 6. 위험 상태

- `OPEN`
- `MITIGATING`
- `ACCEPTED_WITH_LIMITS`
- `BLOCKING`
- `CLOSED`
- `REOPENED`

Critical 위험은 사용자 또는 책임자의 명시적 승인 없이 `ACCEPTED_WITH_LIMITS`로 낮출 수 없다.

## 7. Issue 템플릿

```text
Risk ID:
Detected in stage / slice:
Description:
Likelihood / impact:
Evidence:
Affected modules and data:
Immediate containment:
Mitigation:
Owner:
Exit criteria:
Residual risk:
Related ADR / PR / incident:
```

## 8. 성공 지표

- Canonical Data Loss 0
- Unauthorized Canonical Write 0
- Duplicate External Action 0
- Secret Exposure 0
- Evidence Round-trip 오류가 형식별 기준 이하
- Projection Staleness가 사용자에게 숨겨진 사례 0
- Stage 7 이전 Walking Skeleton 완주
- Stage 12에서 실제 재사용 Assembly 성공
