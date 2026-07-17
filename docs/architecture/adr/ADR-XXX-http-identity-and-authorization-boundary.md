# ADR-XXX - HTTP Identity and Authorization Boundary

- 상태: **Proposed - Stage 12.1 P0-1 승인 대기**
- 날짜: 2026-07-17
- 관련 상위 전략: [Stage 12.1 Hardening Strategy](../../engineering/stage-12-1-hardening-strategy.md)
- 관련 기존 결정: [ADD](../module-architecture/shotgun-module-architecture-add.md), [ADR-077](../module-architecture/adr/ADR-077-common-contracts-and-connector-runtime.md), [ADR-080](ADR-080-stage-1-kernel-contracts-and-runtime.md), [ADR-086](ADR-086-stage-6-canonical-commit-history-outbox.md), [ADR-091](ADR-091-stage-11-risk-controlled-external-action.md)

## Context

현재 `assemblies/shotgun-app/src/server.ts`의 `requestContext()`는 HTTP 요청의 `x-project-id`, `x-actor-id`, `x-access-scope`, `x-sensitivity`를 Message Envelope의 신원·권한 context로 사용한다. 값이 빠지면 `shotgun`/`owner`/`owner` 기본값을 준다.

Module manifest와 Connector Runtime은 context 누락을 거부하고 required scope를 검사한다. 하지만 이 context가 클라이언트 입력에서 만들어지므로 검사 자체가 신뢰 경계를 만들지 못한다. P0 검증에서 위조 header로 cross-project asset read와 Action lifecycle 진행이 재현됐다.

이 ADR은 HTTP 진입점의 trust boundary만 정의한다. Canonical write, Action Preview binding(P0-2), durable outbox, Stage 9/10 관계는 바꾸지 않는다.

## Decision

### 1. HTTP 인증과 authorization flow

모든 보호 HTTP 요청은 다음 순서를 거친다.

```text
HTTP request
  -> select AuthenticationAdapter
  -> authenticate credential
  -> AuthenticatedPrincipal
  -> resolve requested or active project
  -> ProjectMembership lookup
  -> server-side authorization decision
  -> TrustedSecurityContext
  -> create Command / Query envelope
  -> module policy and resource authorization
```

`AuthenticatedPrincipal`은 HTTP 계층에서만 쓰는 불변 값이다.

| 필드                   | 의미                                                           |
| ---------------------- | -------------------------------------------------------------- |
| `principalId`          | 인증된 사람 또는 service principal의 server-side ID            |
| `actor`                | Envelope에 넣을 `Actor` (`user` 또는 `service`)                |
| `authenticationMethod` | `browser_session`, `api_token`, `development` 중 하나          |
| `credentialId`         | session ID 또는 token ID. 원문 credential는 저장·전달하지 않음 |
| `authenticatedAt`      | 인증 시각                                                      |

`TrustedSecurityContext`는 project membership과 route/module policy를 합쳐 서버에서 만든다.

| 필드                                   | 결정 근거                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `projectId`                            | server-side active session project 또는 token 요청 project + membership 확인 |
| `actor`                                | AuthenticatedPrincipal                                                       |
| `accessScope`                          | membership role scope와 token allowlist의 교집합                             |
| `sensitivityClearance`                 | membership 또는 principal의 서버 저장 ceiling                                |
| `dataClassification`                   | route/resource policy가 정한 값                                              |
| `authenticationMethod`, `credentialId` | audit 전용 metadata                                                          |

기존 Envelope의 `projectId`, `actor`, `security.accessScope`, `security.sensitivity` 형식은 당장 유지한다. 값의 생성자만 HTTP header parser에서 authorization service로 바뀐다. 인증 method와 credential ID는 token/session을 노출하지 않도록 일반 module payload가 아니라 audit record에 저장한다.

### 2. Browser session authentication

- 브라우저 UI는 random opaque session ID를 `__Host-shotgun_session` HttpOnly, Secure, SameSite=Lax cookie로만 전달한다.
- 세션 원문은 DB에 저장하지 않고 SHA-256 hash, principal ID, expiry, revocation, active project reference만 저장한다.
- 상태 변경 요청은 CSRF token 또는 동등한 origin-bound 보호를 추가한다. SameSite cookie만으로 충분하다고 간주하지 않는다.
- UI의 project 선택은 `POST /session/active-project` 같은 명시적 endpoint를 통해 처리한다. 서버가 membership을 확인한 뒤에만 session의 active project를 바꾼다.
- `/ask`, `/knowledge`, Review, Canonical, Action UI fetch는 actor/scope/sensitivity header를 보내지 않는다.

### 3. Signed API token authentication

- API/automation은 `Authorization: Bearer <signed token>`을 사용한다.
- token은 short-lived EdDSA-signed JWT를 기본안으로 하며 `sub`, `jti`, expiry, issuer, audience, token scope ceiling을 가진다. signing key는 key ID로 rotation 가능해야 한다.
- DB는 token family/JTI hash, principal ID, revoked timestamp, expiry를 저장한다. 서명 검증 뒤에도 revoke 여부와 membership을 매 요청 확인한다.
- token의 scope는 상한일 뿐이다. 실제 scope는 `membership scopes ∩ token scopes ∩ route/module requirement`이다.
- API token도 project ID만으로 접근하지 못한다. 요청 project의 membership과 sensitivity clearance를 다시 확인한다.

### 4. Project membership, scope, sensitivity

- 새 `auth.project_memberships`가 principal, project, role/scopes, sensitivity clearance, 상태, 만료를 소유한다.
- project selector는 권한이 아니다. Browser는 server-side active project를 기본으로 사용하고, token API는 별도 `X-Shotgun-Project` 또는 request field를 selector로 사용할 수 있다. 어느 경우든 membership 확인이 실패하면 context를 만들지 않는다.
- `x-actor-id`와 `x-access-scope`는 어떤 환경에서도 authorization input이 될 수 없다.
- `x-sensitivity`는 권한 또는 resource classification input이 될 수 없다. 새 resource의 sensitivity는 서버 route policy와 principal/membership ceiling으로 결정하며, 이미 저장된 resource는 저장된 sensitivity를 계속 사용한다.
- `security.sensitivity`의 현재 단일 field가 request classification과 user clearance를 함께 표현하는 모호성은 구현 시 분리한다. v1 module envelope에는 server-determined effective value를 넣고, resource sensitivity는 각 owning repository의 저장 값으로 검사한다. breaking contract 분리가 필요해지면 기존 1.x를 수정하지 않고 v2 contract를 추가한다.

### 5. Local Development Auth Adapter

Development Auth Adapter는 실제 인증의 대체물이 아니라 test/local convenience adapter다.

- 기본값 OFF
- `NODE_ENV=development` 또는 `test`와 loopback peer address에서만 허용
- `NODE_ENV=production` 또는 non-loopback bind에서 설정되어 있으면 startup validation이 fatal error로 종료
- `SHOTGUN_DEV_PRINCIPAL_ID`처럼 명시한 fixture principal만 허용. owner 자동 부여와 arbitrary header impersonation은 금지
- membership은 in-memory fixture 또는 local auth store에서 실제처럼 조회
- adapter 선택, principal ID, local mode 사용은 structured audit log에 남김

### 6. Legacy header policy

| Header           | 전환 중 정책                                                                                                                     | 완료 후 정책                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `x-actor-id`     | 무시하지 말고 400 `LEGACY_SECURITY_HEADER_FORBIDDEN`으로 거부                                                                    | 거부                                                                         |
| `x-access-scope` | 동일                                                                                                                             | 거부                                                                         |
| `x-sensitivity`  | 동일                                                                                                                             | 거부                                                                         |
| `x-project-id`   | identity source로는 즉시 폐기. migration 기간에는 인증 뒤 project selector로만 허용할 수 있으나, 명시적 deprecation audit를 남김 | Browser에서는 미사용, token API는 새 selector 이름 또는 request field만 허용 |

무인증·무header 요청에 `owner` 또는 기본 project를 주지 않는다. `/health`처럼 public endpoint만 allowlist로 인증 제외한다.

### 7. Failure and denial policy

| 상황                                    | HTTP / code                            | 원칙                                          |
| --------------------------------------- | -------------------------------------- | --------------------------------------------- |
| credential 없음                         | 401 `AUTHENTICATION_REQUIRED`          | owner fallback 금지                           |
| invalid, expired, revoked session/token | 401 `AUTHENTICATION_INVALID`           | 세부 credential 정보 노출 금지                |
| Legacy authority header                 | 400 `LEGACY_SECURITY_HEADER_FORBIDDEN` | 무시하고 진행하지 않음                        |
| active project 없음                     | 400 `PROJECT_CONTEXT_REQUIRED`         | browser에서 선택 흐름 안내                    |
| membership 없음 또는 만료               | 403 `PROJECT_ACCESS_DENIED`            | resource 존재 정보는 숨김                     |
| scope 부족                              | 403 `AUTHORIZATION_DENIED`             | 요구 scope의 전체 목록은 응답에 노출하지 않음 |
| sensitivity clearance 부족              | 403 `SENSITIVITY_ACCESS_DENIED`        | resource content/details 미노출               |
| auth store unavailable                  | 503 `AUTHORIZATION_UNAVAILABLE`        | fail closed, retryable 여부는 내부 기록       |
| CSRF/origin 검증 실패                   | 403 `REQUEST_ORIGIN_DENIED`            | 상태 변경 없음                                |

object ID가 포함된 cross-project read에서는 membership 확인 후에는 generic `NOT_FOUND`를 사용해 object enumeration을 최소화한다. audit에는 실제 denial reason을 남긴다.

### 8. Audit

다음은 `auth.audit_events`에 append-only로 남긴다.

- authentication success/failure, method, principal ID, credential ID hash, remote address hash, request/correlation/trace ID
- project selection, membership allow/deny, effective scopes hash, sensitivity clearance, policy version
- Review, Canonical, Action 같은 mutation의 principal, auth method, project, authorization decision, outcome
- Development Auth Adapter 사용과 production startup block

token 원문, session cookie 원문, authorization header, personal content는 audit에 남기지 않는다. 기존 Connector audit은 message delivery 추적을 유지하고, auth audit은 HTTP trust decision을 보완한다.

## Alternatives Considered

| 대안                           | 장점                                                                             | 단점                                                            | 결정                                                 |
| ------------------------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| 서버 세션 기반 인증            | browser logout/revocation/project switching이 단순, cookie를 JavaScript에서 숨김 | session store와 CSRF 보호 필요                                  | **Browser UI 채택**                                  |
| 서명된 API token               | automation/CLI에 적합, short-lived/rotation 가능, session cookie 불필요          | signing key, JTI revoke, membership 재검증 필요                 | **API 채택**                                         |
| 외부 Identity Provider         | MFA, account lifecycle, enterprise SSO 재사용 가능                               | MVP에는 provider 운영/redirect/callback/tenant 설정 복잡도가 큼 | 현재 `DEFER`; AuthenticationAdapter 뒤에서 향후 추가 |
| Local Development Auth Adapter | local/test 흐름 단순, real auth test double 가능                                 | 잘못 활성화하면 production bypass                               | **local/test 제한 채택**, production hard block      |
| 계속 header 기반 context       | 구현 변경이 작음                                                                 | 신원·scope·sensitivity 위조를 막을 수 없음                      | 거부                                                 |

## Consequences

- 모든 보호 API는 authentication pre-handler와 project authorization을 거쳐야 한다.
- `requestContext(headers)`는 제거되고 trusted context factory로 대체된다.
- DB migration과 auth adapter, session/token lifecycle, UI project selection, security regression tests가 추가된다.
- Module domain contract는 가능한 한 유지하되, SecurityContext의 server-origin invariant가 강제된다.
- P0-2 Action source binding은 이 ADR 승인 후에도 별도 ADR/작업으로 남는다.

## Approval Gates Before Implementation

1. 이 ADR의 Browser session + signed API token + local-only development adapter 조합 승인
2. auth schema와 bootstrap/migration 전략 승인
3. legacy header cutover 기간 및 production reject date 승인
4. P0-1 attack acceptance tests와 API/UI compatibility plan 승인

승인 전에는 제품 코드를 수정하지 않는다.
