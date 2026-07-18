# Stage 12.1 - Security, Durability and Release Readiness Hardening

- 상태: **IN_PROGRESS — Security Gate P0-1·P0-2 COMPLETE**
- 기준 문서: `Shotgun Stage 12.1 보안·내구성 보정 전략.pdf` (2026-07-17)
- 적용 범위: Stage 12 이후의 보정 작업
- Security Gate 기준 `main` SHA: `d9e29bc588ff8c2badfd20c87cd3d4c2e695ba28`
- 현재 작업 Section: **Security Gate 완료, 다음 Stage 12.1 Section 미착수**

## 1. 전략적 결정

Stage 12 뒤에는 새 기능 Stage를 바로 시작하지 않는다. 먼저 Stage 12.1을 두어, 지금까지 구현한 MVP를 안전하게 운영·확장할 수 있는 기반으로 보정한다.

Stage 12.1 완료 전에는 다음을 금지한다.

- 실제 Gmail, Calendar, GitHub 등 외부 Action Connector 활성화
- 서버의 외부 네트워크 공개
- Stage 12 또는 Stage 12.1을 production-ready 또는 release-ready라고 표현
- 검증하지 않은 Assembly를 독립 재사용 가능하다고 표현
- Claim 추출 또는 자연어 검색 품질이 확보됐다고 표현

이 전략은 기존 ADD의 Knowledge Flow, Canonical 단일 write, Evidence, Approval, Action 경계를 바꾸지 않는다. 기존 ADR을 조용히 덮어쓰지 않으며, 중요한 구조 변경은 ADR 승인 뒤에만 구현한다.

## 2. 완료 목표

Stage 12.1은 다음 네 Gate가 모두 통과할 때만 완료다.

| Gate | 목표 | 현재 상태 |
| --- | --- | --- |
| Security | 인증되지 않은 actor, scope, project, sensitivity 위조 불가. 실제 Action은 서버 저장 근거만 사용. | **P0-1·P0-2 COMPLETE** |
| Durability | AI 중간 장애 뒤 후보 완전 복구, Canonical Outbox·Projection 자동 복구, clean restore 성공. | `IN_PROGRESS` 전 단계 |
| Quality | Claim 추출과 자연어 검색을 corpus와 수치로 평가하고 regression suite로 고정. | `IN_PROGRESS` 전 단계 |
| Reuse and Operations | 외부 consumer package 설치, Ubuntu·Windows CI, secret history scan, backup·restore 증거 보존. | `IN_PROGRESS` 전 단계 |

Security Gate 완료만으로 Stage 12.1 전체를 `COMPLETE`로 표시하지 않는다.

## 3. 고정된 전체 순서

| Wave | 범위 | Gate 전 제한 |
| --- | --- | --- |
| Wave 0 | localhost 기본 bind, 실제 Action Connector OFF, legacy owner 기본값 제거 준비, Gemini secret pattern, 상태 문구 정정 | 임시 봉쇄일 뿐 최종 해결책이 아님 |
| Wave 1 | P0-1 인증된 Security Context, P0-2 Action server-side binding, UI trusted session/project context, 위조 테스트 | 외부 공개와 실제 Action Connector 금지 |
| Wave 2 | durable AI state machine, candidate replay, Outbox worker, Compiled Truth 자동 projection, restore drill | production data 내구성을 보장한다고 표현 금지 |
| Wave 3 | Golden corpus, Claim·검색 benchmark, lexical 개선, 필요 시 semantic retrieval 검토 | 지표 없는 검색 기술 채택 금지 |
| Wave 4 | Assembly package boundary, 외부 consumer 설치, Windows CI, compatibility test, 실제 consumer Assembly | workspace 내부 테스트를 독립 재사용으로 표현 금지 |

Wave 1의 서버·API Security Gate는 완료됐지만 Dedicated Product Frontend의 최종 Session·Project UX는 별도 Frontend Delivery Roadmap에서 관리한다.

## 4. Security Gate 완료 기록

### P0-1 — Authenticated Security Context

보호 HTTP 요청은 다음 신뢰 경계를 통과한다.

```text
HTTP Request
  -> Authentication Adapter
  -> Authenticated Principal
  -> Project Membership 확인
  -> Server-side Authorization
  -> TrustedSecurityContext
  -> Module Command / Query
```

완료 결과:

- `x-project-id`, `x-actor-id`, `x-access-scope`, `x-sensitivity`를 production trust source로 사용하지 않는다.
- no-header owner/project fallback을 제거했다.
- 브라우저는 서버 관리 Session과 HttpOnly Cookie를 사용하며 상태 변경은 CSRF·Origin 검증을 통과한다.
- API·자동화는 Opaque API Token을 사용하고 원문은 발급 시 한 번만 표시한다.
- 실제 Scope는 Project Membership, Token Scope Ceiling과 Route Requirement의 교집합이다.
- 최초 Owner는 `npm run auth:bootstrap-owner`로 명시적으로 생성한다.
- Development Auth Adapter는 기본 OFF이며 production과 non-loopback 환경에서 활성화할 수 없다.

### P0-2 — Action Candidate Server-side Binding

```text
candidateId + expectedRevision + operationKey
  -> Candidate 조회
  -> Validation 조회와 Digest 재계산
  -> Evidence 조회와 Canonical Digest 재계산
  -> SourceVersion·Original Asset 조회
  -> Transformation Revision 결속 확인
  -> Risk 재계산
  -> Immutable Preview Snapshot
  -> Immutable Approval Record
  -> Atomic Execution Claim
  -> Connector Execute
  -> Verify and Audit
```

완료 결과:

- Preview 요청은 참조 값만 받고 Candidate, Validation, Evidence, Target, Payload, Risk와 Project를 클라이언트 권위 입력으로 사용하지 않는다.
- Execute 요청은 `approvalId`만 받으며 승인된 Snapshot Payload만 실행한다.
- Approval JSON·저장 열, Snapshot JSON·저장 Digest, Snapshot ID와 만료 시각을 상호 검증한다.
- Execution Projection의 Preview·Approval 누락 또는 불일치를 차단한다.
- Candidate·Validation·Evidence·SourceVersion·Original Asset·Transformation Revision이 승인 후 변경되면 실행을 차단한다.
- 동일 Approval의 동시 Execute에서 Connector 호출과 `ACTION_EXECUTION_CLAIMED` Audit은 각각 최대 1회다.

### Evidence Hash 의미

```text
SourceVersion content hash
= SHA-256 of the complete immutable source content

Evidence exact hash
= SHA-256 of Evidence.quote.exact
```

일반 Sentence Evidence에서 두 Hash가 다른 것은 정상이다. Evidence의 Exact Hash는 Quote 자체로 검증하고, Evidence와 전체 Source Content의 관계는 Transformation Revision의 `sourceContentHash`를 통해 결속한다.

## 5. 완료 증거

- 승인 소스 SHA: `62d2ef114f172aa0b8bd1903c84b15a215a01db3`
- `main` Merge SHA: `d9e29bc588ff8c2badfd20c87cd3d4c2e695ba28`
- Merge 방식: `--no-ff`, `ort`
- 전체 Test: `227 passed, 0 failed, 0 skipped`
- PostgreSQL Security Gate: `38 passed, 0 failed, 0 skipped`
- 집중 Integration Action API: `2 passed, 0 failed, 0 skipped`
- Mandatory Security Test Skip: 없음
- 승인 소스와 Merge 결과 사이 파일 차이: 없음

상세 근거:

- [ADR-093 — HTTP Identity and Authorization Boundary](../architecture/adr/ADR-093-http-identity-and-authorization-boundary.md)
- [ADR-094 — Action Candidate Server-side Binding and Approval Snapshot](../architecture/adr/ADR-094-action-candidate-server-side-binding-and-approval-snapshot.md)
- [Stage 12.1 P0-1/P0-2 Security Gate Implementation Record](../architecture/adr/implementation-records/stage-12-1-p0-1-p0-2-security-gate.md)

Merge SHA에 연결된 GitHub Actions 실행 기록은 없다. Test 수치는 Codex의 로컬 PostgreSQL 실행 결과이며, 원격 코드와 Test 구현은 별도로 검토됐다.

## 6. Security Gate Acceptance 결과

다음 공격을 모두 차단했다.

- 임의 Actor ID와 Owner Scope 주입
- 다른 Project 접근
- Sensitivity 하향 조작
- 무인증 요청의 Owner 기본값 획득
- 제한 Token의 Scope 상승 발급
- production의 Development Auth Adapter 활성화
- CSRF 없는 상태 변경
- 승인 뒤 Candidate·Validation·Evidence·SourceVersion·Transformation Revision 변조
- Preview·Approval 불변 레코드와 Execution Projection 변조
- 동일 Approval 동시 실행
- Token·Session 원문 또는 내부 Binding Digest의 로그·HTTP 노출

정상 흐름도 통과했다.

- 로그인 사용자의 허용 Project 조회와 Project 변경
- Token Scope Ceiling을 넘지 않는 API 요청
- 실제 PostgreSQL Repository를 사용한 Preview·Approval·Execute·Verify
- Source Content Hash와 다른 정상 Sentence Evidence Exact Hash
- 동일 Snapshot 기반 Connector 실행과 Audit 기록

## 7. 후속 Section 경계

| Section | 상태 | 후속 범위 |
| --- | --- | --- |
| P0-1 Authenticated Security Context | **COMPLETE** | 운영 Auth Adapter·IdP 확장은 별도 결정 |
| P0-2 Action Candidate server-side binding | **COMPLETE** | Connector별 활성화 Gate는 별도 |
| Dedicated Product Frontend Session·Project UX | 설계 확정, 구현 대기 | Frontend Delivery Roadmap에서 관리 |
| AI durable materialization | 미착수 | Wave 2 |
| Outbox·Projection recovery | 미착수 | Wave 2 |
| Claim·검색 Quality Benchmark | 미착수 | Wave 3 |
| External Consumer·Windows CI·Restore | 미착수 | Wave 4 |
| Stage 9·10 architecture tension | 별도 Architecture Section | 기존 ADR-089·090을 조용히 변경하지 않음 |

## 8. 현재 상태 표기

현재 Shotgun은 **Security Gate가 완료된 개발·로컬 검증용 MVP**다.

다음 제한은 유지한다.

- Stage 12.1 전체 상태는 `IN_PROGRESS`다.
- 실제 외부 Action Connector는 Connector별 Capability·권한·Preflight·Verify·복구와 활성화 승인을 통과하기 전까지 OFF다.
- 외부 네트워크 공개와 production-ready·release-ready 표기는 금지한다.
- Durability·Quality·Reuse and Operations Gate를 순서대로 별도 검토한다.
- Stage 13은 시작하지 않는다.
