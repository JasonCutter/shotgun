# Stage 12.1 - Security, Durability and Release Readiness Hardening

- 상태: **확정된 상위 전략**
- 기준 문서: `Shotgun Stage 12.1 보안·내구성 보정 전략.pdf` (2026-07-17)
- 적용 범위: Stage 12 이후의 보정 작업
- 현재 작업 Section: **P0-1 인증된 Security Context 설계만**

## 1. 전략적 결정

Stage 12 뒤에는 새 기능 Stage를 바로 시작하지 않는다. 먼저 Stage 12.1을 두어, 지금까지 구현한 MVP를 안전하게 운영·확장할 수 있는 기반으로 보정한다.

Stage 12.1 완료 전에는 다음을 금지한다.

- 실제 Gmail, Calendar, GitHub 외부 Action Connector 활성화
- 서버의 외부 네트워크 공개
- Stage 12를 production-ready 또는 release-ready라고 표현
- 검증하지 않은 Assembly를 독립 재사용 가능하다고 표현
- Claim 추출 또는 자연어 검색 품질이 확보됐다고 표현

이 전략은 기존 ADD의 Knowledge Flow, Canonical 단일 write, Evidence, Approval, Action 경계를 바꾸지 않는다. 기존 ADR을 조용히 덮어쓰지 않으며, 중요한 구조 변경은 ADR 승인 뒤에만 구현한다.

## 2. 완료 목표

Stage 12.1은 다음 네 Gate가 모두 통과할 때만 완료다.

| Gate                 | 목표                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Security             | 인증되지 않은 actor, scope, project, sensitivity 위조 불가. 실제 Action은 서버 저장 근거만 사용. |
| Durability           | AI 중간 장애 뒤 후보 완전 복구, Canonical Outbox/Projection 자동 복구, clean restore 성공.       |
| Quality              | Claim 추출과 자연어 검색을 corpus와 수치로 평가하고 regression suite로 고정.                     |
| Reuse and Operations | 외부 consumer package 설치, Ubuntu/Windows CI, secret history scan, backup/restore 증거 보존.    |

## 3. 고정된 전체 순서

| Wave   | 범위                                                                                                                 | Gate 전 제한                                      |
| ------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Wave 0 | localhost 기본 bind, 실제 Action Connector OFF, legacy owner 기본값 제거 준비, Gemini secret pattern, 상태 문구 정정 | 임시 봉쇄일 뿐 최종 해결책이 아님                 |
| Wave 1 | P0-1 인증된 Security Context, P0-2 Action server-side binding, UI trusted session/project context, 위조 테스트       | 외부 공개와 실제 Action Connector 금지            |
| Wave 2 | durable AI state machine, candidate replay, Outbox worker, Compiled Truth 자동 projection, restore drill             | production data 내구성을 보장한다고 표현 금지     |
| Wave 3 | Golden corpus, Claim/검색 benchmark, lexical 개선, 필요 시 semantic retrieval 검토                                   | 지표 없는 검색 기술 채택 금지                     |
| Wave 4 | Assembly package boundary, 외부 consumer 설치, Windows CI, compatibility test, 실제 consumer Assembly                | workspace 내부 테스트를 독립 재사용으로 표현 금지 |

## 4. 현재 허용 범위: P0-1

이번 작업은 `P0-1 HTTP Identity and Authorization Boundary`의 **설계와 승인 자료**만 만든다. 제품 코드, DB migration, API 동작은 수정하지 않는다.

목표 흐름은 다음과 같다.

```text
HTTP Request
  -> Authentication Adapter
  -> Authenticated Principal
  -> Project Membership 확인
  -> Server-side Authorization
  -> Trusted SecurityContext
  -> Module Command / Query
```

고정 원칙:

- `x-project-id`, `x-actor-id`, `x-access-scope`, `x-sensitivity`는 production trust source가 아니다.
- 브라우저는 서버 관리 세션과 HttpOnly cookie를 사용한다.
- API와 자동화는 서명된 short-lived API token을 사용한다.
- Local Development Auth Adapter는 기본 OFF, loopback 전용, 명시적 테스트 principal만 허용한다.
- production에서 Development Auth Adapter가 설정되면 서버가 시작하지 않아야 한다.
- 사용자가 project를 선택할 수는 있어도 membership 확인 전에는 SecurityContext에 반영하지 않는다.
- Module은 HTTP header를 직접 읽지 않고, 인증·인가 계층이 만든 context만 받는다.

## 5. 후속 Section의 경계

| Section                                   | 상태                           | 이번 변경 여부        |
| ----------------------------------------- | ------------------------------ | --------------------- |
| P0-1 Authenticated Security Context       | 설계 작성 중                   | 문서만 작성           |
| P0-2 Action Candidate server-side binding | 확정 전략이나 후속 작업        | 코드·ADR 변경 금지    |
| AI durable materialization                | Wave 2                         | 변경 금지             |
| Outbox/Projection recovery                | Wave 2                         | 변경 금지             |
| UI session context                        | Wave 1이지만 P0-1 구현 승인 뒤 | 설계 영향만 기록      |
| Quality, packaging, CI, restore           | Wave 3~4                       | 변경 금지             |
| Stage 9/10 architecture tension           | 별도 Architecture Section      | ADR-089/090 변경 금지 |

## 6. P0-1 승인 전 Acceptance Gate

다음 공격은 모두 거부되어야 한다.

- 임의 actor ID 위조
- `owner` scope 직접 주입
- 다른 project ID 접근
- sensitivity 하향 조작
- 무인증 요청에서 owner 기본값 획득
- production에서 Development Auth Adapter 활성화
- 권한 없는 사용자의 Review, Canonical, Action 접근

정상 흐름도 함께 통과해야 한다.

- 로그인 사용자가 허용된 project를 조회
- project를 바꿀 때 membership에 맞는 context 재구성
- API token scope보다 넓은 작업 거부
- 모든 Review, Canonical, Action 변경에 principal과 인증 방식 audit 기록

## 7. 현재 상태 표기

Stage 12.1 Security Gate가 통과하기 전의 Shotgun은 **개발·로컬 검증용 MVP**다. 외부 공개, 실제 외부 Action, release-ready 표기는 허용하지 않는다.
