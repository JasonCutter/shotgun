# ADR-099: Frontend Section 1 — Local Owner Session 및 Method-Neutral Authentication Boundary

- **Status**: ACCEPTED
- **Date**: 2026-07-23
- **Context**: 개인용·로컬 환경에서 작동하는 Shotgun 시스템의 로그인 없는 사용자 경험 및 인증 계약/프로비저닝 경계 수립.

---

## 1. 배경 및 문제 정의

개인용·로컬 환경에서 작동하는 Shotgun 애플리케이션은 사용자가 로그인 화면을 거칠 필요 없이 실행 즉시 `Application Shell`로 진입해야 한다.
그러나 인증 방식을 프론트엔드 UI 컴포넌트나 백엔드 Route, 데이터 스토리지 계층에 직접 하드코딩하면 향후 Password, OAuth, Passkey 등의 인터랙티브 다중 사용자 인증 방식을 확장할 때 포트 및 UI 계약을 대거 수정해야 하는 문제가 발생한다.

따라서 다음 아키텍처 원칙을 확정한다:

1. **Method-Neutral Authentication Port**: 포트 메쏘드 및 결과 계약에 `LocalOwner`, `Password`, `OAuth` 등을 하드코딩하지 않는 일반화된 계약 수립.
2. **인증과 Provisioning의 분리**: 인증 어댑터(`LocalOwnerAuthenticationAdapter`)는 보안 평가 및 세션 수립 방식만 담당하며, Principal/Project/Membership 프로비저닝은 `LocalOwnerProvisioningService` 응용 서비스가 전담함.
3. **Strict Loopback 보안 검증**: 서버 Bind, Client Remote IP, Same-origin 조건을 정밀 평가하여 외부/비-Loopback 접근 시 403 거부.
4. **Logout UI 제거 및 보존**: 현재 Local Owner 모드에서는 Logout UI 버튼을 사용하지 않고 숨기며, 세션 revoke API와 백엔드 계약 경계는 향후 Interactive Authentication 연결을 위해 보존함.
5. **Legacy `/auth/*` 격리**: 기존 폼 기반 `/auth/*` 라우트는 레거시/개발 테스트용으로 격리하며 Product Frontend는 오직 `@shotgun/api-client` (`/api/v1/session/*`)를 사용함.

---

## 2. 결정을 위한 고려 사항 & 원칙

1. **Clean / Hexagonal Architecture**:
   - `AuthRepositoryPort`: 순수 저장소 CRUD (Find, Create, Revoke) 책임만 담당.
   - `AuthenticationPort`: `establishSession(context)`, `revokeSession(sessionId)` 방식 중립 계약.
   - `LocalOwnerProvisioningService`: 로컬 소유자 Principal 및 Project Membership 멱등 프로비저닝.
2. **보안 평가 및 멱등성**:
   - 서버 바인드, Remote IP Socket Address, Same-Origin 검증 불통과 시 `authentication_unavailable` 반환.
   - 멱등성 보장: 동일 요청 반복 시 Principal/Project/Membership이 중복 생성되지 않음.
3. **연기된 기능 (DEFER)**:
   - 로그인 화면, Account ID/PW 입력, 비밀번호 재설정, OAuth/OIDC, Passkey, 원격 사용자 로그인, 다중 사용자 인증.

---

## 3. 결정 사항 (Decision)

### 3.1. 인증 아키텍처 경계

```text
shotgun-web (Frontend)
 └─ Frontend Session Boundary (ensureSession / sessionLoader)
     └─ Typed Product Session API (ShotgunApiClient.bootstrapLocalOwner)
         └─ Authentication Port (AuthenticationPort.establishSession)
             ├─ LocalOwnerAuthenticationAdapter ──> LocalOwnerProvisioningService
             └─ FakeInteractiveAuthenticationAdapter (Test/Validation)
```

### 3.2. API 경로 및 상태 표현

- API 경로: `POST /api/v1/session/local-bootstrap`
- `AuthenticationResult` 상태 표현:
  - `authenticated`: 세션 정상 수립 ➔ App Shell 진입
  - `authentication_required`: 인터랙티브 로그인 요구
  - `authentication_unavailable`: 환경/보안 제약으로 인증 불가능 (Loopback 위반 등)

---

## 4. 파급 효과 및 검증 (Consequences & Verification)

1. **Adapter 교체성 증명**:
   - `FakeInteractiveAuthenticationAdapter` 교체 시에도 타 도메인 모듈(`Sources`, `Ask`, `Knowledge` 등) 및 Product API 계약에 아무 영향이 없다.
2. **테스트 통과**:
   - `tests/contract/authentication-port.test.ts` 및 프론트엔드/백엔드 테스트 슈트 전체 통과.
