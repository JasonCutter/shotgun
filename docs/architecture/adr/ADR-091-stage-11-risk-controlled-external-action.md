# ADR-091 — Stage 11 Risk-controlled External Action

- 상태: Accepted
- 날짜: 2026-07-17

## 결정

1. `ActionCandidate`는 실행 권한이 아니다. 실행 모듈은 검증된 후보를 별도
   `ActionExecutionRecord`로 만들고 Canonical write 권한을 갖지 않는다.
2. 필수 순서는
   `Validation → ActionCandidate → Risk Decision → Preview → User Approval → Preflight → Execute → Verify → Feedback & Reentry`다.
3. R0~R4는 `stage11.action-risk.v1` 결정적 정책으로 판정한다. Restricted 데이터는 최소 R3,
   보상 Action은 최소 R2다. AI 설명은 이 판정을 바꿀 수 없다.
4. 후보 등록, 사용자 승인, 실행, 검증, 조회와 Audit 조회는 각각
   `action:candidate:stage`, `action:approve`, `action:execute`, `action:verify`,
   `action:read`, `action:audit:read` Scope로 분리한다.
5. Approval Token은 `actionId`, Candidate Revision, Target Digest, Parameter Digest와
   Preview Digest에 결속한다. 승인 뒤 하나라도 달라지거나 Token이 만료되면
   `STALE_APPROVAL`로 거부한다. 사용자 Actor만 승인할 수 있다.
6. PostgreSQL row lock으로 승인된 Action의 실행권을 한 Worker만 claim한다. Provider 호출 전
   Connector credential·대상·지원 operation·중복·현재 상태를 Preflight한다.
7. 응답 유실 또는 Timeout은 `OUTCOME_UNKNOWN`으로 기록하고 실행을 자동 재호출하지 않는다.
   Provider 재조회인 `VerifyActionOutcome`만 결과를 확정할 수 있다.
8. 보상 작업은 원 Action을 자동으로 되돌리는 내부 절차가 아니다. `compensationForActionId`를
   가진 별도 후보로 만들고 Risk·Preview·Approval·Preflight·Audit를 다시 통과한다.
9. Connector Secret은 Adapter 내부 private field가 소유한다. Domain Module, Preview,
   Approval, 일반 Audit, AI Prompt에는 secret 값이나 Provider SDK 객체를 전달하지 않는다.
10. Stage 11의 첫 Adapter는 실제 외부 서비스를 호출하지 않는 Fake Draft Connector다.
    실제 Provider는 별도 승인된 대상·최소 권한·공식 SDK 또는 MCP 결정과 같은 Contract Test가
    준비된 뒤 Adapter로 추가한다.

## OSS 결정

- gbrain `a25209b`: operation allowlist, mutating scope, remote default-deny와 adversarial
  side-effect test를 `REFERENCE_ONLY`로 사용한다.
- PostgreSQL 16.14: 원자 execution claim, 불변 Approval과 append-only Audit에 `ADOPT`한다.
- MCP TypeScript SDK v1.29.0과 Octokit.js v5.0.5: 실제 Provider 승인 전까지 `DEFER`한다.
- OPA v1.18.2, node-casbin v5.51.1, OpenFGA v1.18.1: 현재 고정 정책과 단일 소유자
  MVP보다 운영·모델 비용이 커서 `DEFER`한다.
- Temporal TypeScript SDK v1.20.3: timer·multi-day wait·saga 요구가 없어 `DEFER`한다.

## 결과

- Preview에서 본 내용과 다른 외부 작업은 같은 승인으로 실행할 수 없다.
- 동시 요청과 재전송이 Provider side effect를 중복 호출하지 않는다.
- 결과가 불명확한 실행을 성공이나 실패로 추측하지 않는다.
- 실제 Connector를 교체해도 Shotgun 승인·상태·Audit 계약은 유지된다.
