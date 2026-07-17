# Stage 12.1 Security Wave Implementation Verification

- 기준: `9bd898a0a9a07e10c13ee1ddf004451cdae4f00e` 이후 구현
- 검증일: 2026-07-17
- 범위: P0-1 HTTP Identity and Authorization Boundary, P0-2 Server-bound Action Candidate and Approval Snapshot

## 구현 결정

### P0-1 인증·권한 경계

- local account ID/password는 Node.js 내장 Argon2id hash만 저장한다.
- Browser session은 production에서 `__Host-shotgun_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`를 사용한다. 상태 변경 요청은 CSRF token이 필요하다.
- API token은 256-bit opaque random value이며 발급 시에만 원문을 반환한다. DB에는 SHA-256 hash, principal, scope ceiling, expiry, revoke 상태만 저장한다.
- project membership, scope, sensitivity는 서버가 결정한다. Browser의 active project는 session에서만 읽고, token API는 `X-Shotgun-Project` selector 후 membership을 다시 확인한다.
- `x-project-id`, `x-actor-id`, `x-access-scope`, `x-sensitivity`는 즉시 400 `LEGACY_SECURITY_HEADER_FORBIDDEN`으로 거부한다.
- 기본 bind는 loopback이며, 외부 bind는 명시적 `ALLOW_EXTERNAL_BIND=true`가 필요하다. development auth는 production 또는 non-loopback bind에서 시작 전에 거부한다.
- login 성공/실패 및 인증된 요청/거부는 append-only auth audit에 기록한다. password, session/API token, Authorization 원문은 기록하지 않는다.

### P0-2 Action 서버 결속

- `POST /actions/preview`는 `candidateId`, `expectedRevision`, `operationKey`만 받는다. target, recipient, parameter, payload, connector 등의 추가 필드는 400 `ACTION_SERVER_BINDING_REQUIRED`로 거부한다.
- Candidate, validation digest, evidence digest, source sensitivity는 trusted repository에서 다시 읽는다. HTTP로 Candidate를 stage하는 경로는 없다.
- Preview는 `action-preview-canonical-v1` + SHA-256로 만든 불변 Snapshot이며 15분 뒤 만료된다.
- approval은 서버 저장 `ActionApprovalRecord`이며 v1은 `requiredApprovalCount=1`, `selfApprovalAllowed=true`이다. Service Principal은 승인할 수 없다.
- `POST /actions/execute`는 `{ "approvalId": "..." }`만 받는다. 서버가 Approval -> Snapshot -> rendered payload를 읽고 atomic claim 뒤에만 connector를 호출한다.
- 일반 HTTP Verify endpoint는 제거했다. module의 Verify command는 internal Worker/Service Principal만 실행할 수 있다.
- preflight, single claim, `OUTCOME_UNKNOWN` automatic retry 금지, connector receipt Verify는 ADR-091의 기존 결정을 유지한다.

## DB migration

| 번호 | 파일                                                      | 내용                                                                             |
| ---- | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 012  | `db/migrations/012_stage12_1_auth_identity.sql`           | principal, credential, membership, session, opaque token, append-only auth audit |
| 013  | `db/migrations/013_stage12_1_action_snapshot_binding.sql` | trusted Action Candidate, immutable Preview Snapshot, server Approval Record     |

`npm run db:migrate` 및 `npm run db:verify`를 localhost `shotgun` DB에서 통과했다.

## 검증 결과

| 명령                           | 결과                               |
| ------------------------------ | ---------------------------------- |
| `npm run lint`                 | 통과                               |
| `npm run format:check`         | 통과                               |
| `npm run typecheck`            | 통과                               |
| `npm run test:unit`            | 통과                               |
| `npm run test:contract`        | 통과                               |
| `npm run test:integration`     | 통과                               |
| `npm run test:database`        | 통과 (P0-1 auth, P0-2 Action 포함) |
| `npm run test:architecture`    | 통과                               |
| `npm run test:stage12-package` | 통과                               |

필수 공격·회귀 검증에는 forged actor/scope/sensitivity/project legacy headers, unauthenticated owner fallback, browser CSRF, wrong project token, token revoke, stale Action revision, cross-project Candidate, restricted sensitivity, forbidden Action body field, Service Principal approval, concurrent Execute, immutable Snapshot/Approval DB trigger가 포함된다.

## 운영 경계와 남은 항목

- Gmail, Calendar, GitHub 등 실제 외부 connector는 활성화하지 않았다. 테스트는 `FakeDraftActionConnector`만 사용한다.
- 기본 서버는 외부 network bind를 허용하지 않는다.
- 이 문서는 P0-1/P0-2 검증 결과다. Stage 12.1의 P0-3 이후 항목은 이 구현에 포함하지 않는다.
- database 테스트는 local development DB의 auth/action 테스트 테이블을 truncate한 뒤 검증한다. production DB에서 실행하면 안 된다.
