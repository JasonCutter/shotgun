# Stage 12.1 P0-1 - Authenticated Security Context Implementation Plan

- 상태: **ADR-XXX 승인 대기 / 구현 시작 금지**
- 범위: HTTP Identity and Authorization Boundary
- ADR 초안: [ADR-XXX](../architecture/adr/ADR-XXX-http-identity-and-authorization-boundary.md)
- 상위 전략: [Stage 12.1 Hardening Strategy](stage-12-1-hardening-strategy.md)
- 제외: P0-2, durable AI/Outbox, search quality, packaging, CI, backup/restore의 구현

## 1. 목표와 고정 경계

HTTP 요청의 신원·project·scope·sensitivity를 서버가 결정하고, trusted context만 Module Command/Query Envelope에 전달한다.

이번 구현 계획은 다음을 하지 않는다.

- P0-2 ActionCandidate/Validation/Evidence server-side binding 변경
- 외부 IdP나 실제 external Action Connector 도입
- Stage 9/10 architecture 변경
- production 외부 bind 또는 release-ready 선언

## 2. 권장 구현 순서

### Step 0. 승인과 시작 조건

1. ADR-XXX를 Accepted로 승인하고, `ADR-092`와 충돌하지 않는 번호를 배정한다.
2. local account/password, opaque API token, immediate header cutover, development mode hard block을 승인한다.
3. 기존 P0 reproduction을 보존하고, 이후에는 같은 공격이 explicit denial인지 확인한다.
4. P0-2 request body, handler, repository는 변경하지 않는다.

### Step 1. Auth domain과 persistence

새 migration은 예를 들어 `db/migrations/012_stage12_1_auth_identity.sql`로 추가한다. 기존 business schema를 rewrite하지 않으며, 기존 project data에 implicit owner를 부여하지 않는다.

| 저장 대상                  | 최소 필드                                                                                                    | 목적                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `auth.principals`          | principal ID, actor type, status, created/disabled time                                                      | 사람/service identity             |
| `auth.credentials`         | principal ID, credential type, normalized account ID, Argon2id password hash, password changed/disabled time | local account/password credential |
| `auth.project_memberships` | principal ID, project ID, scopes, sensitivity clearance, expiry, status                                      | authorization source              |
| `auth.sessions`            | session hash, principal ID, active project ID, expiry, revoked time, credential version, CSRF metadata       | Browser session                   |
| `auth.api_tokens`          | token ID, token hash, principal ID, scope ceiling, expiry, revoked time                                      | opaque API token                  |
| `auth.audit_events`        | event ID, principal/credential hash, project, decision, reason code, trace/correlation, timestamp            | auth decision audit               |

### Step 2. Explicit Owner bootstrap and credential lifecycle

1. `npm run auth:bootstrap-owner`를 추가한다. 명령은 account ID, password, 초기 project membership을 명시적으로 받는다.
2. 활성 Owner가 이미 존재하면 명령은 실패한다.
3. password는 Argon2id로 hash한 값만 저장한다. raw password, reversible encryption은 금지한다.
4. password 변경은 현재 credential 또는 owner/recovery 절차를 확인한 뒤 hash를 교체하고, 해당 principal의 모든 session을 revoke한다.
5. account 비활성화는 login을 거부하고 모든 session/API token을 revoke한다.

### Step 3. AuthenticationAdapter와 authorization service

```text
packages/authentication/
  contracts.ts                       AuthenticatedPrincipal, TrustedRequestContext
  authorization.ts                   membership and policy decision ports
  session-auth-adapter.ts            Browser session
  opaque-api-token-auth-adapter.ts   Bearer opaque token
  development-auth-adapter.ts        local/test only
  postgres-auth-repository.ts
```

핵심 interfaces:

- `AuthenticationAdapter.authenticate(request): AuthenticatedPrincipal | AuthenticationDenied`
- `AuthorizationRepository.findMembership(principalId, projectId)`
- `AuthorizationService.authorize(principal, requestedProject, routePolicy): TrustedRequestContext`
- `AuditAuthDecisionPort.append(event)`

각 route는 `requestContext(headers)` 대신 Fastify pre-handler가 만든 trusted context를 사용한다. Module과 Connector Runtime은 HTTP request, password, cookie, authorization token을 보지 않는다.

### Step 4. Browser session, cookie, active project

1. local account/password login, logout, session revoke, current session, accessible project list endpoint를 만든다.
2. production cookie는 `__Host-shotgun_session`, HttpOnly, Secure, SameSite=Lax, Path=/를 강제한다.
3. local HTTP는 별도 development cookie 이름을 loopback에서만 사용한다. production/non-loopback에서 development cookie 또는 development auth mode가 설정되면 startup 실패다.
4. `POST /session/active-project`는 membership 확인 뒤에만 session active project를 갱신한다.
5. Ask, Knowledge, Review, Canonical, Action UI는 `credentials: 'same-origin'`으로 session cookie만 보내며 actor/scope/sensitivity header를 보내지 않는다.
6. 상태 변경 request에는 CSRF/origin validation을 적용한다.

### Step 5. Opaque API token

1. token issuance/revocation은 owner-only administrative API 또는 초기 운영 CLI로 제한한다.
2. cryptographically secure random generator로 256-bit 이상 token을 만들고, 원문은 발급 시 한 번만 표시한다.
3. `Authorization: Bearer <opaque-token>`을 token hash와 대조하고 expiry, revoked time, principal status를 확인한다.
4. project는 `X-Shotgun-Project` 또는 명시적 request field selector일 뿐이며, membership 확인 뒤에만 context에 반영한다.
5. 실제 scope는 membership, token scope ceiling, route/module requirement의 교집합이다.

### Step 6. Legacy header immediate cutover

P0-1 implementation merge와 동시에 아래를 환경 구분 없이 400 `LEGACY_SECURITY_HEADER_FORBIDDEN`으로 거부한다.

- `x-actor-id`
- `x-access-scope`
- `x-sensitivity`
- `x-project-id`

같은 merge에서 Browser UI, E2E, script, test helper를 session, opaque token 또는 explicit development fixture로 전환한다. no-header owner/project fallback은 완전히 제거한다. `/health` 같은 public allowlist 외에는 anonymous 요청을 허용하지 않는다.

### Step 7. Sensitivity와 development safety

1. request header sensitivity 사용을 제거한다.
2. 새 resource sensitivity는 server route policy와 principal/membership ceiling으로 정하고, stored resource sensitivity는 owning repository가 검사한다.
3. clearance보다 높은 source/evidence/candidate/review/canonical/action data는 조회·변경 모두 거부한다.
4. Development Auth Adapter는 default OFF, explicit fixture principal/membership만 허용한다.
5. production, non-loopback bind, CI release mode에서 Development Auth Adapter가 enabled이면 startup을 거부한다.

## 3. 영향 범위 표

| 구분               | 변경 파일 후보 / 대상                                                                                    | 변경 내용                                                       | DB migration | 기존 테스트 영향          | 신규 테스트                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------ | ------------------------- | ---------------------------------------------- |
| HTTP boundary      | `assemblies/shotgun-app/src/server.ts`                                                                   | header parser 제거, auth pre-handler 적용                       | 아니오       | 모든 API integration      | forged header, anonymous, session/token routes |
| Runtime startup    | `assemblies/shotgun-app/src/main.ts`                                                                     | loopback default, dev mode/cookie fail-fast, auth wiring        | 아니오       | startup smoke             | production/dev matrix                          |
| Auth package       | `packages/authentication/*` (신규)                                                                       | credential, principal, opaque token, authorization, audit ports | 아니오       | 신규                      | password/session/token contract                |
| Owner bootstrap    | `scripts/auth-bootstrap-owner.ts`, `package.json`                                                        | explicit Owner creation command                                 | 아니오       | 신규                      | existing owner failure, password handling      |
| PostgreSQL adapter | `adapters/postgres-auth/*` (신규)                                                                        | credential/session/token/membership/audit repository            | 예           | database bootstrap/verify | password change, session/token revoke          |
| Migration          | `db/migrations/012_stage12_1_auth_identity.sql`, `scripts/database.ts`                                   | `auth` schema와 verify checks                                   | 예           | db verify/migrate         | migration forward, explicit bootstrap          |
| Contracts/policy   | `packages/contracts/src/types.ts`, `packages/policy/src/index.ts`                                        | trusted-context invariant, sensitivity compatibility            | 가능         | connector/contract tests  | context provenance/deny                        |
| UI                 | `server.ts` HTML 또는 향후 UI assets                                                                     | login, active project, credentials, CSRF, no authority headers  | 아니오       | UI/API integration        | session expiry, header absence                 |
| API                | protected `/intake`, `/search`, `/ask/query`, `/reviews/*`, `/canonical/*`, `/knowledge/*`, `/actions/*` | common pre-handler and route policy                             | 아니오       | all protected API tests   | 401/403/400, cross-project                     |
| Observability      | `packages/observability/*` 또는 auth adapter                                                             | append-only auth audit, remote-address HMAC/minimal policy      | 예           | audit tests               | secret redaction, denial audit                 |
| Test helpers       | `tests/helpers/*`, integration fixtures                                                                  | explicit session/token/development principal fixtures           | 아니오       | most integration tests    | Browser/token/local coverage                   |

### Module impact

| Module group                | 예상 영향                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| All protected modules       | Envelope shape는 1차 유지. server-origin context만 받는다.                                      |
| Review / Canonical / Action | membership/scope/sensitivity check가 HTTP와 resource 경계에 추가. P0-2 logic은 변경하지 않는다. |
| Search / Evidence / Asset   | cross-project와 sensitivity resource check가 repository/query 경계에 추가.                      |
| Connector Runtime / Policy  | existing missing-context deny를 유지하고 trusted context factory invariant를 강화.              |

## 4. API와 UI 전환

| 소비자 | 현재 | 목표 | 전환 |
| --- | --- | --- |
| Browser UI | server default owner | account/password login + session cookie + active project | P0-1 merge에서 전환 |
| Scripted API | arbitrary `x-*` headers | Bearer opaque token + `X-Shotgun-Project` | P0-1 merge에서 전환 |
| Test helper | header owner/project | explicit test auth fixture | P0-1 merge에서 전환 |
| Module contract | header-derived Envelope | trusted Envelope | v1 형태 유지, factory 교체 |

## 5. Security regression Acceptance Tests

| 공격 또는 정상 흐름                            | 기대 결과                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 임의 `x-actor-id` 위조                         | 항상 400 legacy-header denial; impersonation 불가                                                      |
| `x-access-scope: owner` 주입                   | 항상 400; scope 상승 불가                                                                              |
| 다른 `x-project-id` 접근                       | 항상 400; 새 project selector 접근은 403/404                                                           |
| `x-sensitivity: public` 하향 조작              | 항상 400; 새 request는 stored sensitivity/clearance로 403                                              |
| credential 없는 Review/Canonical/Action        | 401, owner fallback 없음                                                                               |
| production에서 development auth/cookie enabled | server startup 실패                                                                                    |
| development adapter에서 arbitrary actor header | 거부; configured fixture principal만 허용                                                              |
| 허용 project 로그인 사용자 Ask                 | 200, 허용 project data만 반환                                                                          |
| 권한 없는 Review/Canonical/Action              | 403/404와 authorization audit                                                                          |
| token scope보다 넓은 request                   | 403                                                                                                    |
| session expiry/revoke 후 mutation              | 401, state unchanged                                                                                   |
| CSRF/origin invalid mutation                   | 403, state unchanged                                                                                   |
| bootstrap                                      | active Owner 없음에서만 성공, 존재하면 실패                                                            |
| password/account lifecycle                     | password 변경 후 session revoke, account disable 후 session/token revoke                               |
| audit                                          | password, token/cookie/Authorization 원문 없이 decision, trace, remote-address HMAC/minimal value 기록 |

테스트 레이어는 auth unit, PostgreSQL adapter, Fastify integration, architecture boundary, 기존 P0 regression denial test로 구성한다. 테스트 구현은 ADR 승인 뒤 별도 작업에서만 한다.

## 6. Migration, rollback, Definition of Done

### Forward migration

1. `auth` schema/table과 verify checks를 추가한다.
2. `npm run auth:bootstrap-owner`로만 first Owner와 initial membership을 만든다.
3. session/opaque-token adapter와 pre-handler를 구현한다.
4. existing E2E, scripts, test helpers를 같은 merge에서 전환한다.
5. merge와 동시에 legacy headers 및 owner/project fallback을 hard reject한다. compatibility flag는 두지 않는다.
6. P0 attack suite와 audit tests가 PASS해야 merge한다.

### Rollback

- auth records와 business records는 분리한다.
- security regression이 실패한 상태에서 production header trust mode를 재활성화하는 rollback은 허용하지 않는다.
- migration rollback이나 data deletion은 backup/restore 정책 승인 뒤 별도로 다룬다.

### P0-1 Done

- ADR-XXX Accepted 및 번호 확정
- local account/password, Browser session, opaque API token, local-only adapter contract 통과
- explicit Owner bootstrap과 credential lifecycle 구현·검증
- membership/scope/sensitivity의 server-side decision 동작
- legacy headers와 no-header owner/project fallback 완전 차단
- 모든 공격 acceptance test PASS
- Review/Canonical/Action audit에 principal, auth method, project, decision 기록
- authenticated principal/project context로 direct-claim E2E 재실행 PASS

## 7. Stop condition

이 문서는 구현 승인 자료다. ADR과 별도 구현 승인이 있기 전에는 제품 코드, DB migration, 설정, 테스트 코드를 수정하지 않는다. P0-2로 넘어가지 않는다.
