# Stage 11 — Risk-controlled External Action

## 완료 상태

**COMPLETE — 2026-07-17**

실제 외부 서비스 호출은 활성화하지 않았다. Fake Draft Connector로 안전 계약과 수직 흐름을
검증한 상태이며, 실제 Gmail·Calendar·GitHub Adapter는 별도 Provider 승인 뒤 추가한다.

## 구현 범위

- `packages/contracts/src/action-execution.ts`: Candidate·Risk·Preview·Approval·실행·검증·Audit 계약
- `packages/policy`: 결정적인 R0~R4 정책 `stage11.action-risk.v1`
- `modules/action-execution`: 승인된 외부 Action 상태 머신과 Connector Port
- `adapters/action-connector-fake`: Secret 격리와 Provider 결과 조회가 가능한 안전 Adapter
- `adapters/stage11-in-memory`: Contract Test 저장소
- `adapters/postgres-stage11`: 원자 claim, Approval, Audit 영속 저장소
- `011_stage11_risk_controlled_action.sql`: `action` Schema와 불변 Trigger
- `/actions/*`: Preview·Approval·Execute·Verify·조회·Audit API

## 실행 흐름

| 단계             | 상태·검사                                                        |
| ---------------- | ---------------------------------------------------------------- |
| Validation       | `VALIDATED`, validation ID, Evidence ID가 있는 후보만 수신       |
| Risk Decision    | operation·sensitivity·compensation으로 R0~R4 결정                |
| Preview          | Candidate·Target·Parameter·Risk와 각 Digest를 고정               |
| User Approval    | 사용자만 승인, Token을 Revision·세 Digest에 결속                 |
| Preflight        | Connector credential·대상·operation·idempotency·현재 상태 재검사 |
| Execute          | PostgreSQL 또는 in-memory 원자 claim 뒤 Provider 1회 호출        |
| Verify           | Provider에서 다시 읽어 `APPLIED` 여부 확인                       |
| Feedback/Reentry | `ActionFeedbackRecorded`를 `ACTION_REVIEW`로 발행                |

`OUTCOME_UNKNOWN`은 Execute를 다시 호출하지 않는다. `POST /actions/:actionId/verify`가
Provider 상태만 조회해 결과를 확정한다.

## 권한 Scope

| API                         | 필요한 `x-access-scope`  |
| --------------------------- | ------------------------ |
| `POST /actions/preview`     | `action:candidate:stage` |
| `POST /actions/:id/approve` | `action:approve`         |
| `POST /actions/:id/execute` | `action:execute`         |
| `POST /actions/:id/verify`  | `action:verify`          |
| `POST /actions/:id/query`   | `action:read`            |
| `POST /actions/:id/audit`   | `action:audit:read`      |

Scope가 없으면 Handler와 Provider 호출 전에 기본 거부한다.

## 완료 기준 검증

| 기준                                     | 검증                                                       |
| ---------------------------------------- | ---------------------------------------------------------- |
| Candidate와 실행 상태·권한 분리          | 별도 계약·저장소·6개 Scope와 API 403 테스트                |
| Token이 Revision·Target·Parameter에 결속 | 잘못된 Preview, 같은 Revision 변경, 만료 Token 음성 테스트 |
| Preflight 재검사                         | DENIED 상태에서 Provider execute 0회                       |
| 동시·중복 실행 방지                      | 동시 execute 2개에서 Provider execute 1회                  |
| Provider 결과 재조회                     | execute 뒤 `APPLIED` 검증과 별도 Verify command            |
| Timeout·응답 유실                        | `OUTCOME_UNKNOWN`, 자동 재실행 0회, Verify로만 확정        |
| Secret 격리                              | record·HTTP·Audit 직렬화에서 Connector Secret 미검출       |
| 보상 Action                              | 별도 Candidate·R2 하한·별도 Approval·Audit                 |
| DB 재시작·불변성                         | restart, row-lock claim, Approval·Audit 변조 Trigger       |
| OSS Gate                                 | 후보별 version·license·decision·rollback 등록              |

## Migration과 Rollback

- 개발 환경은 `npm run db:reset`으로 001~011을 순서대로 재생성하고 `npm run db:verify`로
  세 Action 표를 확인한다.
- 배포 Rollback은 먼저 Action API와 Worker를 중지해 새 실행 claim을 막고 `action` Schema를
  백업한 뒤 이전 Application revision으로 되돌린다.
- 이전 Runtime은 `action` Schema를 읽지 않으므로 기존 Stage 0~10 데이터와 분리된다.
- Fake Connector를 제거하거나 교체해도 `ActionConnectorPort`와 PostgreSQL 승인 원장은 유지한다.

## 현재 제한

- 실제 Provider credential과 외부 network write는 활성화하지 않았다.
- Fake Connector의 Provider effect는 process memory에만 있으므로 개발 재시작 뒤 실제 Provider
  복구를 흉내 내지 않는다. Action 승인·상태·Audit는 PostgreSQL에 남는다.
- R3·R4 실제 실행 Adapter는 제공하지 않는다. 고위험 Provider는 별도 운영·법률·보안 승인이 필요하다.
- 장기 대기와 timer가 필요해지면 Temporal을 `ActionConnectorPort` 밖의 orchestration Adapter로
  재평가한다.
