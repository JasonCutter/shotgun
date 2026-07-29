---
id: FRONTEND-CROSS-PHASE-CONTRACT-AND-COMPLETION-AUDIT
classification: CANONICAL
status: architecture_consistent_contract_normalized_implementation_verification_pending
approved_by: user
approved_at: 2026-07-24
legacy_sources:
  - 3a65181d-71ad-81e2-8b9c-fb13f322e983
  - 3a65181d-71ad-81a3-a99b-d868571275ea
---

# Frontend Cross-Phase Contract and Completion Audit

## 판정

- Frontend Phase 1~5, 총 12개 Section의 상위 아키텍처: **정합**
- 상세 Contract 충돌·문서 상충·Schema Drift·Resource Lifecycle 공백: **정규화 완료**
- Architecture 방향과 Resource 책임·Project·Revision·Approval·Retention 경계: **동결 가능**
- Product 코드 구현·배포·E2E·보안·접근성·성능: **미판정 또는 Section별 별도 판정**

## Project Context

```text
Active Project
Resource Project
Draft Project
Effective Project
```

- 새 Resource는 Active Project에 결속한다.
- 기존 Resource의 조회·Action은 Resource Project에 결속한다.
- Draft는 생성 Project에 고정한다.
- Deep Link로 다른 Project Resource를 열어도 Active Project를 자동 변경하지 않는다.
- Project 변경으로 실행 중 Resource, Draft, Review 또는 Action을 자동 이전·취소하지 않는다.
- Active/Resource 불일치를 Shell에 명시한다.
- Project-scoped Cache와 Command는 Principal, Session, Project, Scope·Policy Revision을 포함한다.

## Session·Security

- `connectivityState`, `authenticationState`, `sessionState`, `backendReadiness`를 별도 축으로 관리한다.
- Local Owner Session은 일반 Login UI가 아니라 Adapter Recovery를 제공한다.
- 모든 보호 Route는 공통 Auth Boundary 뒤에 둔다.
- 권한 상실 또는 Session 만료 시 보호 Answer, Evidence, Draft, Payload, Download Link와 Cache를 제거하거나 마스킹한다.
- Role 문자열이 아니라 Server Capability를 사용한다.
- 존재 자체가 민감한 Resource는 `NOT_FOUND`와 같은 방식으로 마스킹할 수 있다.

## Snapshot·Revision

공통 상위 개념은 `ResourceSnapshot`이다.

- SourceVersion, AskAnswerRunSnapshot, KnowledgeSnapshot, DraftChangeSetRevision, GraphSnapshot, ReviewRevision, Action Manifest·PreflightRevision, Activity Snapshot과 History Revision을 구분한다.
- Route와 Workspace 왕복에서 Snapshot·Revision·Focus를 보존한다.
- 새 Revision으로 조용히 자동 이동하지 않는다.
- Stale Snapshot을 자동 Merge·자동 제출하지 않는다.

## Command·Outcome

모든 Browser Write는 다음 경계를 따른다.

```text
Versioned FrontendCommandRequest
CSRF Transport Security
clientRequestId
Idempotency Key
Project Context
Policy Binding
Typed Preconditions
Correlation·Typed Causation
Server commandId·Semantic Digest
```

Outcome:

```text
ACCEPTED
COMPLETED
REJECTED
OUTCOME_UNKNOWN
```

`OUTCOME_UNKNOWN`에서는 새 Key로 자동 재제출하지 않고 기존 Command, Resource와 External Target 상태를 조회한다.

## Policy Context

중요 Command, 장기 Resource와 Attempt는 Server가 수락한 `FrontendPolicyContext`를 기록한다.

포함 가능 항목:

- Project Lifecycle
- Privacy·Sensitivity·Retention
- Model Routing·Budget
- Feature Availability·Schema
- Connector·Egress

외부 호출, Evidence 접근, 복사·Export, Review, Retry와 Execute 시 현재 정책을 재검증한다. 정책 강화는 제한할 수 있지만 정책 완화는 기존 권한을 자동 확대하지 않는다.

## Source·Evidence

```text
OriginalAsset
→ SourceVersion
→ SourceMap
→ EvidenceSpan
→ Citation
→ Statement·Candidate·Result·Knowledge
```

- Evidence는 특정 SourceVersion과 정확 Locator에 고정한다.
- 원문과 번역을 분리하며 번역문 자체는 Evidence가 아니다.
- CitationReturnTarget으로 원문 위치와 이전 Workspace Context를 복원한다.
- Evidence 오류는 별도 Revalidation Resource로 처리한다.

## Candidate·Canonical

- AI·사용자 결과는 승인 전 Candidate다.
- Claim은 승인돼도 자동으로 Fact가 되지 않는다.
- Candidate, DraftChangeSet과 UserDirectiveProposal을 분리한다.
- Discovery Gap·Relation·Derived Inference는 후보 검증 흐름으로 재진입한다.
- 미승인 Candidate는 기본 Canonical Search와 Compiled Truth에 포함하지 않는다.
- Canonical 변경은 승인된 ChangeSet만 원자적으로 Commit한다.

## Review·Action

- Review Center는 판단과 목적별 Approval Resource 생성을 담당한다.
- Approval, Canonical Commit, Directive Apply와 External Execute 결과를 구분한다.
- External Action은 `Validation → Candidate → Risk → Preview → Approval → Preflight → Execute → Verify`를 따른다.
- Timeout 자동 재실행, Approval 우회, Cancel의 Rollback 오표현을 금지한다.

## Activity·History

- Activity는 현재 Job·Run·Attempt·Stage·Event Projection이다.
- History는 Append-only Revision·Decision·Approval·Audit·Result다.
- Retry는 새 Attempt다.
- Activity Event 전체를 영구 History로 무차별 복제하지 않는다.
- Canonical Reversal과 External Compensation을 분리한다.

## Cache·Offline

- Cache Key는 Principal, Session, Active/Resource Project, Resource Identity·Revision, Scope, Sensitivity와 Policy Context를 반영한다.
- 보호 Answer 전체, Evidence, Action Payload, Credential과 Secret을 Browser 장기 저장소에 기본 저장하지 않는다.
- Offline에서는 안전한 기존 Snapshot만 제한적으로 읽고 Submit, Review, Execute, Search와 권한 의존 Action을 차단한다.
- Cached 상태를 최신 공식 상태로 표시하지 않는다.

## 접근성·보안 Gate

- Desktop·Tablet·Mobile 기능 동등성
- Keyboard 전 기능 접근
- Screen Reader Heading·Landmark·Label·Error·Status
- Dialog Focus Trap과 Trigger Focus 복원
- Source·Citation 왕복 Focus 복원
- 200% 확대, Reduced Motion, High Contrast
- Graph·Timeline·Chart의 Text·Table 대안
- 상태·Diff·Risk·Fact/Claim을 색상만으로 전달하지 않음
- Secret, Credential, Token, Raw Provider Payload, 비공개 추론, Stack Trace, 절대경로와 보호 원문의 기본 노출 금지

## 연기된 구현 선택

다음은 Architecture 완료를 막지 않지만 구현 전 별도 검토 또는 ADR이 필요하다.

- Frontend Framework와 State/Query Library의 정확 Version
- Editor Library
- Graph Library
- Yjs·CRDT·실시간 협업
- Cross-project 통합 Search·Analytics
- 다중 승인 Workflow DSL
- Legal Hold·전자서명 상세
- 대규모 Graph Virtualization
- Audit 무결성 강화 방식

이 항목들은 Canonical, Approval, Project, Action과 Audit 안전 경계를 우회하는 근거가 아니다.
