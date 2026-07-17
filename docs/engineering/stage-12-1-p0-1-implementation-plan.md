# Stage 12.1 P0-1 - Authenticated Security Context Implementation Plan

- 상태: **ADR-XXX 승인 대기 / 구현 시작 금지**
- 범위: HTTP Identity and Authorization Boundary
- 제외: P0-2 Action Candidate 재검증, durable AI, Outbox worker, search quality, packaging, CI, backup/restore의 구현
- 상위 전략: [Stage 12.1 Hardening Strategy](stage-12-1-hardening-strategy.md)
- ADR 초안: [ADR-XXX](../architecture/adr/ADR-XXX-http-identity-and-authorization-boundary.md)

## 1. 목표와 비목표

### 목표

HTTP 요청에서 신원·project·scope·sensitivity를 신뢰할 수 있게 서버 측에서 결정하고, 그 결과만 Module Command/Query Envelope에 전달한다.

### 비목표

- P0-2의 ActionCandidate/Validation/Evidence server-side binding 구현
- 외부 IdP, Gmail, Calendar, GitHub connector 도입
- 모든 module contract의 대규모 v2 전환
- Stage 9/10 architecture 변경
- production 배포 또는 외부 bind 활성화

## 2. 권장 구현 순서

### Step 0. 승인 및 안전한 시작 조건

1. ADR-XXX를 Accepted로 승인하고 ADR 번호를 확정한다.
2. production config validation 기준과 legacy header cutover date를 확정한다.
3. 현재 `main`의 P0 regression reproduction을 보존한다. 이후 test는 같은 공격이 거부되는지 확인한다.
4. P0-2 관련 request body/handler/repository는 변경하지 않는다.

### Step 1. Auth domain과 persistence 추가

새 `auth` schema와 아래 repository port를 추가한다.

| 저장 대상                  | 최소 필드                                                                                         | 목적                          |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------- |
| `auth.principals`          | principal ID, actor type, status, created/disabled time                                           | 사람/service identity         |
| `auth.project_memberships` | principal ID, project ID, scopes, sensitivity clearance, expiry, status                           | project authorization source  |
| `auth.sessions`            | session hash, principal ID, active project ID, expiry, revoked time, CSRF metadata                | browser session               |
| `auth.api_tokens`          | token JTI hash, principal ID, scope ceiling, expiry, revoked time, key ID                         | signed token revoke/allowlist |
| `auth.audit_events`        | event ID, principal/credential hash, project, decision, reason code, trace/correlation, timestamp | auth decision audit           |

새 migration은 예를 들어 `db/migrations/012_stage12_1_auth_identity.sql`로 추가한다. migration은 기존 business schema를 rewrite하지 않으며, 기존 project data에 implicit owner를 부여하지 않는다.

### Step 2. AuthenticationAdapter와 authorization service

새 package 또는 assembly-owned adapter boundary를 만든다.

```text
packages/authentication/
  contracts.ts              AuthenticatedPrincipal, AuthenticatedRequest
  authorization.ts          membership and policy decision ports
  session-auth-adapter.ts   browser session
  api-token-auth-adapter.ts signed API token
  development-auth-adapter.ts local/test only
  postgres-auth-repository.ts
```

핵심 interfaces:

- `AuthenticationAdapter.authenticate(request): AuthenticatedPrincipal | AuthenticationDenied`
- `AuthorizationRepository.findMembership(principalId, projectId)`
- `AuthorizationService.authorize(principal, requestedProject, routePolicy): TrustedRequestContext`
- `AuditAuthDecisionPort.append(event)`

각 route는 `requestContext(headers)` 대신 공통 Fastify pre-handler가 만든 trusted request context를 사용한다. Module과 Connector Runtime은 HTTP request나 auth token을 보지 않는다.

### Step 3. Browser session과 project selection

1. login/session create, logout/revoke, current session, accessible project list endpoint를 만든다.
2. `POST /session/active-project`에서 membership을 검사하고 session active project를 원자적으로 갱신한다.
3. Ask, Knowledge, Review, Canonical, Action UI는 `credentials: 'same-origin'`으로 session cookie만 보낸다.
4. state-changing request에는 CSRF/origin validation을 적용한다.
5. UI에는 actor/scope/sensitivity 입력 또는 hidden header가 존재하지 않아야 한다.

### Step 4. API token route

1. token issuance/revocation은 owner-only administrative API 또는 초기 운영 CLI로 제한한다.
2. Bearer token signature, issuer, audience, expiry, JTI revoke를 검사한다.
3. 요청 project는 selector일 뿐 membership을 통과해야 한다.
4. token scope ceiling보다 넓은 Review, Canonical, Action route는 거부한다.

### Step 5. Legacy header cutover

1. `x-actor-id`, `x-access-scope`, `x-sensitivity` 사용을 서버 access log/audit에서 탐지한다. 값은 절대 context에 반영하지 않는다.
2. non-development 환경에서는 즉시 400으로 거부한다.
3. `x-project-id`는 migration 기간에만 authentication 뒤 selector로 허용할 수 있다. Browser UI는 active project session으로 전환한다.
4. API client migration이 끝나면 `x-project-id`도 제거하고 새 selector 또는 request field로 통일한다.
5. no-header owner/project fallback을 완전히 제거한다. `health` 등 public allowlist만 anonymous로 남긴다.

### Step 6. Resource sensitivity enforcement

1. request header sensitivity 사용을 제거한다.
2. 새 resource sensitivity는 route/server policy가 정하고, stored resource sensitivity는 owning repository query에서 확인한다.
3. membership clearance보다 높은 source/evidence/candidate/review/canonical/action data는 조회·변경 모두 거부한다.
4. `SecurityContext.sensitivity`의 현재 의미가 clearance와 classification을 혼합하므로, compatibility adapter를 먼저 두고 필요 시 additive v2 contract로 분리한다.

### Step 7. Local development safety

1. Development Auth Adapter default OFF.
2. startup validation: production, non-loopback bind, CI release mode 중 하나에서 enabled이면 process exit.
3. local/test principal과 membership은 explicit fixture/config only.
4. development adapter 사용은 audit event와 startup warning을 남긴다.

## 3. 영향 범위 표

| 구분               | 변경 파일 후보 / 대상                                                                          | 변경 내용                                                               | DB migration | 기존 테스트 영향                               | 신규 테스트                                         |
| ------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------ | ---------------------------------------------- | --------------------------------------------------- |
| HTTP boundary      | `assemblies/shotgun-app/src/server.ts`                                                         | `SecurityHeaders`/`requestContext` 제거, authenticated pre-handler 적용 | 아니오       | 모든 API integration                           | forged header, anonymous, session/token routes      |
| Runtime startup    | `assemblies/shotgun-app/src/main.ts`                                                           | loopback default, production dev-adapter fail-fast, auth wiring         | 아니오       | startup smoke                                  | production/dev adapter matrix                       |
| Auth package       | `packages/authentication/*` (신규)                                                             | principal, adapter, authorization, audit ports                          | 아니오       | 신규                                           | unit/contract                                       |
| PostgreSQL adapter | `adapters/postgres-auth/*` (신규)                                                              | principal/session/token/membership/audit repository                     | 예           | database bootstrap/verify                      | session revoke, membership expiry, token JTI        |
| Migration          | `db/migrations/012_stage12_1_auth_identity.sql`, `scripts/database.ts`                         | `auth` schema와 verify table checks                                     | 예           | db verify/migrate                              | migration forward, clean bootstrap                  |
| Contracts/policy   | `packages/contracts/src/types.ts`, `packages/policy/src/index.ts`                              | trusted context invariant, sensitivity compatibility policy             | 가능         | connector/contract tests                       | context provenance and deny tests                   |
| UI                 | HTML in `server.ts` 또는 향후 UI assets                                                        | session projects, credentials, no authority headers, CSRF               | 아니오       | UI/API integration                             | active project, session expiry, no header injection |
| API                | `/intake`, `/search`, `/ask/query`, `/reviews/*`, `/canonical/*`, `/knowledge/*`, `/actions/*` | common auth pre-handler and route policy                                | 아니오       | all integration tests calling protected routes | 401/403/400 and cross-project cases                 |
| Observability      | `packages/observability/*` 또는 auth adapter                                                   | auth audit append-only event                                            | 예           | audit tests                                    | credential redaction, denial audit                  |
| Test helpers       | `tests/helpers/*`, integration fixtures                                                        | explicit authenticated principal/session/token fixture                  | 아니오       | most existing API tests                        | browser/token/local adapter coverage                |

### Module impact

| Module group                | 예상 영향                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| All protected modules       | Envelope shape는 1차 유지. 이제 server-origin context만 받음.                                        |
| Review / Canonical / Action | route policy와 membership/scope/sensitivity check가 앞단에 추가. P0-2 handler logic은 변경하지 않음. |
| Search / Evidence / Asset   | cross-project and sensitivity resource checks가 repository/query 경계에 추가.                        |
| Connector Runtime / Policy  | missing-context deny는 유지. HTTP-origin invariant를 검증 가능한 context factory로 강화.             |

## 4. API and UI compatibility policy

| 소비자 | 현재 | 목표 | 전환 방식 |
| --- | --- | --- |
| Browser UI | authority header 없음, server default owner가 동작 | session cookie + active project | UI가 session endpoint를 먼저 호출 |
| Existing scripted API | arbitrary `x-*` headers | Bearer signed token + project selector | migration guide와 fixture token 제공 |
| Test helper | header로 owner/project 지정 | explicit test auth adapter/principal fixture | helper factory 교체 |
| Module contract | header-derived Envelope | trusted Envelope | v1 유지, server factory 교체 |

## 5. Security regression Acceptance Tests

| 공격 또는 정상 흐름                                        | 기대 결과                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 임의 `x-actor-id`로 victim impersonation                   | 400 legacy-header denial 또는 authenticated principal 유지; impersonation 불가 |
| `x-access-scope: owner` 주입                               | 400 legacy-header denial; scope 상승 불가                                      |
| 다른 `x-project-id`로 asset/search/review 조회             | 403/404; content와 existence 정보 미노출                                       |
| `x-sensitivity: public`으로 restricted resource 요청       | stored sensitivity/clearance로 403; header 영향 없음                           |
| credential 없는 `/canonical/*`, `/reviews/*`, `/actions/*` | 401, owner default 없음                                                        |
| production config에서 Development Auth Adapter enabled     | server startup 실패                                                            |
| development adapter에서 arbitrary actor header             | 거부; configured fixture principal만 허용                                      |
| 허용 project 로그인 사용자 Ask                             | 200 with only allowed project data                                             |
| 권한 없는 사용자 Review/Canonical/Action                   | 403/404 and authorization audit                                                |
| API token scope보다 넓은 Action/Canonical request          | 403                                                                            |
| session expiry/revocation 후 mutation                      | 401, state unchanged                                                           |
| CSRF/origin invalid mutation                               | 403, state unchanged                                                           |
| auth audit                                                 | token/cookie 원문 없이 principal, project, decision, trace가 기록              |

테스트 레이어:

1. `packages/authentication` unit tests: token/session parsing, expiry, revocation, production dev block.
2. PostgreSQL adapter tests: membership/sensitivity lookup, session/token storage, audit append-only.
3. Fastify integration tests: 모든 P0 공격과 UI/API 정상 흐름.
4. Architecture test: `assemblies/shotgun-app` 외 module이 HTTP header나 AuthenticationAdapter를 import하지 않음.
5. Regression test: 기존 P0 reproduction script가 성공이 아니라 explicit denial을 반환.

## 6. Migration and rollback strategy

### Forward migration

1. auth schema/table/migration verification을 추가한다.
2. first owner principal과 project membership은 explicit bootstrap command 또는 migration-safe operator command로 만든다. 기존 project에 implicit owner를 만들지 않는다.
3. development/test fixture는 production database와 분리한다.
4. session/token adapter와 pre-handler를 feature flag 뒤에 도입한다.
5. staging에서 browser/session과 API token consumers를 전환한다.
6. production mode에서는 legacy authority headers와 owner fallback을 hard reject한다.
7. audit와 P0 attack suite가 PASS한 뒤 feature flag를 기본 ON으로 고정한다.

### Rollback

- DB auth records와 business records는 분리한다. rollback은 application adapter version을 되돌리되, 이미 발급된 session/token은 revoke하거나 compatibility adapter를 명시적으로 유지한다.
- security regression이 실패한 상태로 header trust mode를 production에서 다시 켜는 rollback은 허용하지 않는다.
- migration rollback SQL은 credential/session 원문을 복구하지 않으며, 데이터 삭제 전 backup/restore 절차를 별도 승인한다.

## 7. Definition of Done for P0-1

- ADR-XXX Accepted 및 security model/legacy policy 승인
- browser session, signed API token, local-only adapter가 contract test 통과
- project membership과 scope/sensitivity server-side decision이 PostgreSQL에서 동작
- 무인증 owner fallback과 authority headers가 production에서 차단
- 모든 필수 P0 attack acceptance tests PASS
- Review, Canonical, Action mutation audit에 principal/auth method/project/decision 기록
- existing direct-claim E2E가 authenticated principal과 project context로 재실행 PASS
- no production external bind or real action connector enablement in this work

## 8. Implementation stop condition

이 문서는 구현 승인 자료다. ADR 승인과 별도 구현 승인 전에는 Step 1 이후의 제품 코드, migration, config, API 변경을 시작하지 않는다. P0-2로도 넘어가지 않는다.
