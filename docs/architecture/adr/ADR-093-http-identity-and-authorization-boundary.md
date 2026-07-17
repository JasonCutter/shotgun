# ADR-093 - HTTP Identity and Authorization Boundary

- 상태: **Accepted**
- 날짜: 2026-07-17
- ADR 번호: `ADR-093`
- 상위 전략: [Stage 12.1 Hardening Strategy](../../engineering/stage-12-1-hardening-strategy.md)
- 관련 결정: [ADD](../module-architecture/shotgun-module-architecture-add.md), [ADR-077](../module-architecture/adr/ADR-077-common-contracts-and-connector-runtime.md), [ADR-080](ADR-080-stage-1-kernel-contracts-and-runtime.md), [ADR-086](ADR-086-stage-6-canonical-commit-history-outbox.md), [ADR-091](ADR-091-stage-11-risk-controlled-external-action.md)

## Context

현재 HTTP `requestContext()`는 `x-project-id`, `x-actor-id`, `x-access-scope`, `x-sensitivity`를 Message Envelope의 신원·권한 값으로 사용하며, 값이 없으면 `shotgun`/`owner`/`owner` 기본값을 만든다. Module manifest와 Connector Runtime은 context 누락과 scope 부족을 거부하지만, context의 출처가 클라이언트이므로 이 검사는 trust boundary가 아니다.

이 ADR은 HTTP 인증·인가 경계만 결정한다. Canonical 단일 write, Evidence, Approval, Action 흐름은 유지한다. P0-2 Action Candidate server-side binding은 [ADR-094](ADR-094-action-candidate-server-side-binding-and-approval-snapshot.md)에서 별도로 결정하며 여기서 구현하거나 변경하지 않는다.

## Decision

### 1. Trusted request flow

```text
HTTP Request
  -> Authentication Adapter
  -> Authenticated Principal
  -> Project Membership 확인
  -> Server-side Authorization
  -> Trusted SecurityContext
  -> Module Command / Query
```

`AuthenticatedPrincipal`은 `principalId`, Envelope용 `actor`, `authenticationMethod`, `credentialId`, `authenticatedAt`을 가진 HTTP 계층의 불변 값이다. `TrustedSecurityContext`는 서버가 membership과 route policy로 결정한 `projectId`, actor, access scopes, sensitivity clearance, data classification을 가진다.

기존 Envelope의 `projectId`, `actor`, `security.accessScope`, `security.sensitivity` 형태는 1차로 유지한다. 단, HTTP header parser가 아닌 authorization service만 그 값을 만든다. session/token 원문이나 authentication metadata는 domain payload가 아니라 제한된 audit에만 남긴다.

### 2. Browser 최초 인증과 session

- 최초 구현은 local account ID + password credential을 사용한다. password는 Argon2id hash 문자열로만 저장한다.
- `auth.credentials`는 principal ID, credential type, 정규화·고유 account ID, Argon2id password hash, password 변경 시각, disabled/revoked 시각을 소유한다.
- password 원문, 복호화 가능한 password, reversible encryption은 금지한다.
- 최초 Owner는 migration에서 암묵적으로 만들지 않는다. `npm run auth:bootstrap-owner`가 account ID, password, 초기 project membership을 명시적으로 생성한다. 활성 Owner가 하나라도 있으면 실패한다.
- password 변경은 현재 credential 또는 별도 recovery/owner 절차를 검증한 뒤 Argon2id hash를 교체하고 principal의 모든 session을 revoke한다. account 비활성화는 모든 session과 API token을 revoke한다.
- production cookie는 `__Host-shotgun_session`이며 HttpOnly, Secure, SameSite=Lax, Path=/를 모두 강제한다.
- local HTTP development는 별도 development cookie 이름을 loopback에서만 사용한다. production 또는 non-loopback bind에서 development cookie/auth mode가 설정되면 startup validation은 fatal error로 종료한다.
- session DB record에는 session hash, principal ID, active project ID, expiry, revoked time, credential version, CSRF metadata만 저장한다. session 원문은 저장하지 않는다.
- state-changing browser request는 CSRF/origin validation을 통과해야 한다.

### 3. Opaque API token

- API/automation은 `Authorization: Bearer <opaque-token>`을 사용한다.
- token은 cryptographically secure random generator로 생성한 256-bit 이상의 opaque random value다. 원문은 발급 시 한 번만 보이며 재조회·로그·audit·DB에서 복원할 수 없다.
- `auth.api_tokens`는 token ID, token hash, principal ID, scope ceiling, expiry, revoked time, created time을 저장한다.
- 매 요청은 token hash lookup, expiry/revocation, principal status, project membership을 모두 확인한다.
- 실제 scope는 `membership scopes ∩ token scopes ∩ route/module requirement`다. token scope 또는 project selector만으로 권한이 생기지 않는다.

#### Decision history: signed token proposal replaced

초기 초안은 EdDSA-signed JWT를 제안했다. 그러나 현재 권한 결정은 revoke와 최신 project membership 확인을 위해 이미 매 요청 DB 조회가 필요하다. 이 구조에서는 JWT의 무상태 검증 이점이 없고 signing key 생성·보관·회전 복잡도만 MVP에 추가된다. 따라서 P0-1은 opaque token을 채택한다. JWT/OIDC는 분산 검증이나 외부 Identity Provider가 실제로 필요할 때 별도 AuthenticationAdapter로 도입한다.

### 4. Project membership, scope, sensitivity

- `auth.project_memberships`가 principal, project, role/scopes, sensitivity clearance, 상태, 만료를 소유한다.
- Browser는 server-side session active project만 사용한다. API는 `X-Shotgun-Project` 또는 명시적 request field를 project selector로 쓸 수 있다.
- project selector는 권한이 아니다. membership 확인이 성공한 경우에만 TrustedSecurityContext에 반영한다.
- `x-actor-id`, `x-access-scope`, `x-sensitivity`는 어떤 환경에서도 authorization input이 아니다.
- 새 resource의 sensitivity는 server route policy와 principal/membership ceiling으로 결정하고, 기존 resource는 저장된 sensitivity로 검사한다.
- 현재 `security.sensitivity`가 request classification과 clearance를 함께 표현하는 모호성은 compatibility adapter로 먼저 격리한다. breaking change가 필요하면 기존 1.x를 수정하지 않고 additive v2 contract를 추가한다.

### 5. Local Development Auth Adapter

- 기본값 OFF, `development`/`test`와 loopback peer에서만 허용한다.
- production, non-loopback bind, CI release mode 중 하나에서 enabled이면 서버 startup을 거부한다.
- 명시적 fixture principal과 membership만 허용한다. owner 자동 부여와 arbitrary header impersonation은 금지한다.
- adapter와 development cookie 사용은 structured audit event에 남긴다.

### 6. Legacy header immediate cutover

P0-1 implementation merge와 동시에 compatibility 기간 없이 아래를 적용한다.

| Header           | 정책                                                              |
| ---------------- | ----------------------------------------------------------------- |
| `x-actor-id`     | 항상 400 `LEGACY_SECURITY_HEADER_FORBIDDEN`                       |
| `x-access-scope` | 항상 400 `LEGACY_SECURITY_HEADER_FORBIDDEN`                       |
| `x-sensitivity`  | 항상 400 `LEGACY_SECURITY_HEADER_FORBIDDEN`                       |
| `x-project-id`   | 제거. 요청에 존재하면 항상 400 `LEGACY_SECURITY_HEADER_FORBIDDEN` |

기존 E2E, script, test helper는 같은 작업에서 Browser session, opaque token 또는 explicit development fixture로 전환한다. no-header owner/project fallback은 완전히 제거한다. `/health` 같은 public allowlist 외에는 anonymous 요청을 허용하지 않는다.

### 7. Failure and denial policy

| 상황                                 | HTTP / code                                              | 원칙                       |
| ------------------------------------ | -------------------------------------------------------- | -------------------------- |
| credential 없음                      | 401 `AUTHENTICATION_REQUIRED`                            | owner fallback 금지        |
| invalid, expired, revoked credential | 401 `AUTHENTICATION_INVALID`                             | credential 세부정보 미노출 |
| legacy authority header              | 400 `LEGACY_SECURITY_HEADER_FORBIDDEN`                   | 무시하고 진행하지 않음     |
| active project 없음                  | 400 `PROJECT_CONTEXT_REQUIRED`                           | Browser project 선택 유도  |
| membership 없음/만료                 | 403 `PROJECT_ACCESS_DENIED`                              | resource 존재 정보 최소화  |
| scope 또는 sensitivity 부족          | 403 `AUTHORIZATION_DENIED` / `SENSITIVITY_ACCESS_DENIED` | resource content 미노출    |
| auth store unavailable               | 503 `AUTHORIZATION_UNAVAILABLE`                          | fail closed                |
| CSRF/origin failure                  | 403 `REQUEST_ORIGIN_DENIED`                              | state 변경 없음            |

cross-project object read는 membership 확인 뒤 generic `NOT_FOUND`를 사용해 enumeration을 줄인다. audit에는 실제 denial reason을 남긴다.

### 8. Audit

`auth.audit_events`는 authentication success/failure, principal ID, credential ID hash, project selection, membership allow/deny, effective scopes hash, sensitivity clearance, Review/Canonical/Action mutation decision, correlation/trace ID를 append-only로 남긴다.

remote address가 필요하면 단순 SHA-256이 아니라 server-secret HMAC을 사용하거나, 운영 정책상 필요한 최소 정보만 기록한다. password, password hash, session token, API token, Authorization header 원문, 개인 content는 로그와 audit에 절대 남기지 않는다.

## Alternatives Considered

| 대안                               | 장점                                                          | 단점                                                    | 결정                                       |
| ---------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------ |
| local account/password + 서버 세션 | MVP에 필요한 login/logout/revoke/project switching이 단순     | credential/session store와 CSRF 보호 필요               | **Browser UI 채택**                        |
| opaque API token                   | revoke와 DB membership 확인에 자연스럽고 signing key가 불필요 | 매 요청 token hash lookup 필요                          | **API 채택**                               |
| signed JWT / OIDC token            | 분산 검증 또는 external IdP 연동에 유리                       | 현 구조에서는 DB 조회를 피하지 못하고 key 운영이 추가됨 | `DEFER`; 후속 adapter                      |
| External Identity Provider         | MFA, SSO, account lifecycle 재사용                            | MVP 운영 복잡도 증가                                    | `DEFER`; AuthenticationAdapter 뒤에서 추가 |
| Local Development Auth Adapter     | local/test 편의, real auth test double                        | 오설정 시 bypass 위험                                   | **local/test 제한**, production hard block |
| header 기반 context 유지           | 구현 변경이 작음                                              | 위조를 막을 수 없음                                     | 거부                                       |

## Consequences and Approval Gates

- HTTP pre-handler, auth schema/repository, session/token lifecycle, UI project selection, regression tests가 필요하다.
- Module domain contract는 가능한 유지하지만 server-origin SecurityContext invariant를 강제한다.
- P0-2, durable recovery, Stage 9/10 관계는 이 ADR에서 변경하지 않는다.

구현 전 승인 항목:

1. local account/password + Browser session + opaque API token + local-only development adapter 조합
2. `auth.credentials`와 explicit owner bootstrap 정책
3. legacy header immediate cutover와 동일 merge 전환 범위
4. P0-1 attack acceptance tests와 audit policy

승인 전에는 제품 코드, DB migration, config, test code를 수정하지 않는다.
