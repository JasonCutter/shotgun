# Shotgun Vertical Slice Plan

> 목적: 모듈을 개별적으로 완성하는 대신, 사용자가 확인할 수 있는 최소 기능을 Knowledge Flow 전체로 연결한다.

## 1. 수직 슬라이스 원칙

수직 슬라이스는 하나의 사용자 목표가 입력부터 결과까지 실제로 작동하는 단위다.

각 슬라이스는 다음을 포함한다.

- 사용자 또는 시스템 Trigger
- 관여 모듈
- 입력·출력 Contract
- 성공 시나리오
- 실패·재시도 시나리오
- 보안·승인 경계
- E2E Acceptance Test
- 명시적으로 제외한 기능

수직 슬라이스는 Phase 하나와 같지 않다. 하나의 슬라이스가 여러 Phase를 관통할 수 있고, 같은 Phase를 여러 슬라이스가 확장할 수 있다.

## 2. Slice WS-0 — Module Wiring Skeleton

### 사용자 가치

아직 지식 기능은 없지만 모듈을 Manifest로 등록하고 교체 가능한 Connector를 통해 호출할 수 있다.

### 흐름

```text
Test Client
→ PingCommand
→ Module A
→ PongEvent
→ Module B
→ Status Query
```

### 관여 모듈

- Contracts
- Module SDK
- Module Registry
- Connector Runtime
- Security Context
- Observability

### Acceptance Criteria

- Module A와 B가 서로의 구현 Package를 import하지 않음
- Manifest와 Capability로 Handler가 연결됨
- In-memory와 In-process Transport에서 같은 결과
- 동일 Command 중복 전달 시 Side Effect 한 번
- Trace 화면 또는 Log에서 Correlation 전체 확인
- Security Context 누락 요청 거부

### 제외

- Database Domain Schema
- AI
- 실제 Source 입력

## 3. Slice WS-1 — Text Source Preservation

### 사용자 가치

사용자가 텍스트를 입력하면 Shotgun이 원본을 잃지 않고 저장하며 다시 열 수 있다.

### 흐름

```text
Text Entry
→ IntakeSubmission
→ Source and SourceVersion
→ OriginalAsset
→ Asset Resolver
→ Original Text View
```

### 관여 모듈

- Intake
- Original Asset
- Connector Runtime
- Policy & Security
- Audit

### Acceptance Criteria

- 입력 텍스트와 저장 후 복원 텍스트가 Byte 또는 정규화 정책 기준으로 동일
- Source와 SourceVersion이 분리됨
- 동일 원본 재입력 시 중복 정책 적용
- 다른 Actor·Project 범위에서 접근 차단
- 저장 실패 후 Retry가 중복 Version을 만들지 않음
- 원본 삭제·변경 시도가 Audit과 정책으로 차단

### Demo

1. 텍스트 입력
2. Source ID 확인
3. 원본 다시 열기
4. 같은 입력 재등록
5. 중복 처리 결과 확인

## 4. Slice WS-2 — Evidence-backed Plain Text

### 사용자 가치

저장된 텍스트가 구조화되고, 선택한 문장이나 문단이 원문의 정확한 위치로 돌아간다.

### 흐름

```text
OriginalAssetStored
→ Plain Text Transformation
→ DocumentIR
→ SourceMap
→ EvidenceSpan
→ Original Source Highlight
```

### 관여 모듈

- Transformation
- Evidence
- Original Asset Query Port
- Validation

### Acceptance Criteria

- DocumentIR 문단 순서와 텍스트가 보존됨
- EvidenceSpan의 Start·End가 SourceVersion에 고정됨
- Evidence에서 원문 Highlight로 이동 가능
- 원본 Version이 다르면 Evidence 조회 거부
- 잘못된 Offset과 Hash 불일치 감지
- 변환 재실행 시 같은 Revision 또는 명시적 새 Revision 생성

### 실패 시나리오

- 인코딩 오류
- 비어 있는 문서
- 변환 도중 Worker 종료
- SourceVersion이 폐기된 상태

## 5. Slice WS-3 — Direct Claim Candidate

### 사용자 가치

Shotgun이 원문에 직접 적힌 주장만 후보로 제안하고 보호자가 근거를 확인할 수 있다.

### 흐름

```text
Evidence Bundle
→ AI Provider
→ ClaimCandidate
→ Schema Validation
→ Evidence Alignment
→ Candidate Review View
```

### 관여 모듈

- AI Provider
- Candidate Generation
- Validation
- Evidence
- Observability

### Acceptance Criteria

- 모든 Candidate가 EvidenceSpan을 가짐
- 원문에 없는 추론은 기본 Profile에서 거부됨
- 모델·Prompt·Policy·Token·Cost·Attempt가 기록됨
- Structured Output 오류가 명확한 실패 상태로 남음
- Candidate Revision이 덮어쓰이지 않음
- 두 Provider Adapter 또는 Fake Adapter가 동일 Contract를 충족

### Golden Examples

- 단순 사실 주장
- 부정문
- 수량이 있는 주장
- 시간 범위가 있는 주장
- 의견·추정 표현
- 근거가 부족한 문장

## 6. Slice WS-4 — Human-approved Canonical Claim

### 사용자 가치

후보를 검토하고 승인한 내용만 공식 Claim으로 저장된다.

### 흐름

```text
ClaimCandidate
→ Canonical Snapshot
→ ComparisonResult
→ DraftChangeSet
→ Evidence and Diff Review
→ User Approval
→ ApprovedChangeSetManifest
→ Canonical Commit
→ HistoryEvent
```

### 관여 모듈

- Comparison & Conflict
- ChangeSet & Review
- Canonical Knowledge
- History·Outbox
- Policy & Security

### Acceptance Criteria

- 신규·정확 중복·단순 충돌을 구분
- 승인 전 Canonical 변경 불가
- 승인된 Content Digest와 Commit 대상 일치
- 승인 후 Candidate·Snapshot 변경 시 `STALE_APPROVAL`
- 동일 Commit 재시도에 중복 Claim 없음
- Claim이 Fact로 자동 승격되지 않음
- 승인·거절·보류 이유 조회 가능

### 부정 테스트

- Approval 없이 Commit 요청
- 다른 사용자의 Approval Token 사용
- 만료된 Token
- Snapshot Version 불일치
- Evidence 접근 권한 상실

## 7. Slice WS-5 — Cited Search and Answer

### 사용자 가치

사용자가 공식 지식을 검색하고 답변에서 원문 근거를 확인한다.

### 흐름

```text
CanonicalCommitted
→ Search Projection
→ Citation Lookup Projection
→ User Query
→ Canonical Retrieval
→ Answer Generation
→ Statement-level Citation
```

### 관여 모듈

- Projection
- Search
- Citation Lookup
- Output Generation
- AI Provider

### Acceptance Criteria

- Canonical Claim만 기본 검색에 포함
- Search Result가 Canonical Revision과 Evidence를 참조
- 사실 문장마다 Citation 또는 명시적 불확실성 표시
- Projection Watermark와 Readiness 확인 가능
- Projection Lag가 있으면 사용자에게 표시
- Source Exploration 결과를 Canonical 결과처럼 표시하지 않음

### Walking Skeleton 선언

WS-1부터 WS-5가 한 환경에서 순차 실행되고 하나의 Trace로 연결되면 최초 Walking Skeleton MVP가 완성된다.

## 8. Slice WS-6 — PDF and Office Evidence

### 사용자 가치

문서·표·프레젠테이션에서 추출된 지식의 페이지·셀·Shape 근거로 돌아갈 수 있다.

### 하위 슬라이스

- `WS-6A`: HTML·Markdown
- `WS-6B`: PDF
- `WS-6C`: DOCX
- `WS-6D`: CSV·XLSX
- `WS-6E`: PPTX
- `WS-6F`: 이미지
- `WS-6G`: URL과 영상 페이지의 텍스트 자막·스크립트

### Acceptance Criteria

- 형식별 Adapter가 같은 `DocumentIR`·`SourceMap` Contract 출력
- PDF 페이지·BBox, XLSX Cell, PPTX Shape 위치 복원
- 표 구조와 병합 Cell 정책 검증
- 이미지 의미가 있는 경우 Multimodal Validation
- 외국어 자동 번역은 별도 Revision이며 Citation은 원문을 가리킴
- 손상·암호화·미지원 자료의 실패 상태 명확

### 제외

- 오디오·영상 파일 직접 분석
- 자동 음성 전사
- 영상 프레임·음성·장면 분석

## 9. Slice WS-7 — Rich Knowledge Review

### 사용자 가치

Entity·Relation·Event·Decision 후보와 기존 지식의 충돌·영향을 이해하고 항목별로 승인한다.

### 흐름

```text
Rich Candidates
→ Entity and Temporal Resolution Candidate
→ Comparison and Conflict
→ Recursive Impact
→ Burst Diff
→ Item-level Review
→ Approved Atomic Groups
```

### 관여 모듈

- Candidate Generation
- Validation
- Comparison & Conflict
- Impact Analysis
- ChangeSet & Review
- Canonical Knowledge

### Acceptance Criteria

- Candidate 유형별 Evidence·Provenance
- `POSSIBLY_SAME` Entity 자동 병합 금지
- 시간·Actor·Due Date 추측 금지
- 실제 Typed Edge 기반 영향 경로
- Model Disagreement 보존
- Atomic Group 분리 시 무결성 검증
- 사용자 수정 유형에 따른 재검증 Routing

## 10. Slice WS-8 — Compiled Truth and Discovery

### 사용자 가치

현재·과거·예정·충돌 상태가 읽기 쉽게 정리되고, 부족한 지식과 새 관계 후보가 제안된다.

### 흐름

```text
CanonicalCommitted
→ Compiled Truth Projection
→ Search and Graph Projection
→ Incremental Discovery
→ KnowledgeGap or RelationCandidate
→ DiscoveryReentryManifest
→ Phase 3 Validation
```

### Acceptance Criteria

- Projection은 Canonical에서 재생성 가능
- 증분과 전체 Rebuild 결과 동등
- 현재·과거·예정·충돌 상태 구분
- Discovery 결과가 Canonical로 직접 기록되지 않음
- `DERIVED_INFERENCE` Provenance와 Dependency 보존
- 반복 제안 Suppression
- 비용·Depth·시간 Budget 적용

## 11. Slice WS-9 — Safe External Draft Action

### 사용자 가치

Shotgun이 외부 작업 초안을 만들고 사용자가 검토·승인한 뒤 안전하게 실행한다.

### 권장 첫 시나리오

Gmail Draft 생성 또는 GitHub Draft Issue·PR 생성처럼 되돌리기 쉽고 결과 확인이 쉬운 Action을 선택한다.

### 흐름

```text
User Intent or Knowledge Gap
→ ActionCandidate
→ Validation
→ Risk Decision
→ Preview
→ User Approval
→ Preflight
→ Execute
→ Provider Verification
→ Feedback Event
```

### Acceptance Criteria

- Candidate와 실행 권한 분리
- Preview에 대상·본문·파라미터·위험도 표시
- Approval Token이 Revision과 Digest에 결속
- Preflight가 권한·대상·중복·현재 상태 검사
- 실행 후 Provider에서 결과 재조회
- Timeout 시 자동 재실행 금지와 `OUTCOME_UNKNOWN`
- Secret이 AI Context와 일반 Log에 미노출
- Feedback가 적절한 Reentry Event로 기록

## 12. Slice WS-10 — Reusable Assembly

### 사용자 가치

Shotgun 전체가 아닌 필요한 모듈만 가져와 다른 제품을 구성한다.

### 첫 대상

`Document Review System`

```text
Intake
→ Original Asset
→ Transformation
→ Evidence
→ Validation
→ Comparison
→ Review Output
```

### Acceptance Criteria

- Canonical Knowledge 없이 실행 가능
- Assembly Manifest가 필요한 Capability와 Policy를 선언
- 모듈 Package를 원본 수정 없이 재사용
- Storage 또는 AI Adapter 한 개 교체 성공
- In-memory E2E Test 제공
- 설치·실행 예제와 Compatibility Matrix 제공

## 13. Slice 완료 템플릿

각 Slice 완료 PR은 다음을 포함한다.

```text
Slice:
User outcome:
Modules involved:
Contracts added or changed:
Security and approval boundary:
Acceptance tests:
Failure tests:
Known limits:
Migration or rollback:
Related ADD and ADR:
Demo steps:
```

## 14. 우선순위

1. WS-0 Module Wiring
2. WS-1 Text Source Preservation
3. WS-2 Evidence-backed Text
4. WS-3 Direct Claim Candidate
5. WS-4 Human-approved Canonical Claim
6. WS-5 Cited Search and Answer
7. WS-6 Format Expansion
8. WS-7 Rich Knowledge Review
9. WS-8 Compiled Truth and Discovery
10. WS-9 Safe External Action
11. WS-10 Reusable Assembly

기능 Prototype은 병렬로 진행할 수 있지만 Product Integration은 이 순서를 따른다.
