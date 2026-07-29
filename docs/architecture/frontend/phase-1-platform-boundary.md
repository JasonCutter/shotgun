---
id: FRONTEND-PHASE-1-PLATFORM-BOUNDARY
classification: CANONICAL
status: section_1_2_implemented_section_3_design_frozen_phase_incomplete
approved_by: user
approved_at: 2026-07-28
legacy_source_id: 3a65181d-71ad-81b1-836e-c4503df86c46
---

# Frontend Phase 1 — Platform Boundary

## 현재 판정

- Section 1: 구현·검증·사용자 승인·`main` 병합 완료
- Section 2: 구현·검증·사용자 승인·`main` 병합 완료
- Section 3: ADR-115·ADR-116 Accepted, AC-01~AC-27 및 Persistence Contract Revision 승인·동결, Product 구현 미착수
- Frontend Phase 1: **미완료**

Phase 1 전체 완료는 Section 3의 구현·검증·병합과 별도 사용자 완료 승인 후 판정한다.

## Section 1 — Local Owner Session·Authentication·Project Boundary

완료일: 2026-07-25

증거:

- PR #19
- Implementation Head: `a57e9dd909e2cd0dedb40d7d907a687a3bee7079`
- Merge Commit: `ba8995287a43964774fe4b97eb6a791712f56ad4`
- GitHub Actions Run: `30150769554`
- Verification: `docs/engineering/frontend-phase-1-section-1-verification-260724001.md`

확정 경계:

- 개인 로컬 모드는 Login·Password·Logout UI 없이 Local Owner Session을 수립한다.
- 인증 구조는 `Authentication Port + Adapter`로 유지한다.
- Frontend는 Principal, Session, Membership, Scope, Revocation 또는 Provisioning 권위를 소유하지 않는다.
- Loopback 또는 허용 Local Socket, Same-origin, Local-owner-enabled 조건을 검증한다.
- Connectivity, Authentication, Session, Backend Readiness를 별도 상태 축으로 표현한다.
- Session 장애 시 익명 권한으로 추락하지 않고 Adapter 전용 Recovery를 제공한다.
- Server-authoritative Active Project, CSRF, Project Cache 격리와 Legacy Authority Header 거부 원칙을 유지한다.

## Section 2 — Settings·Project Administration

완료 확정일: 2026-07-26

증거:

- PR #20
- Implementation Head: `b67929e9a04ac62aeeb8986c6ef552cdf58a38ac`
- Merge Commit: `4b5c90a1bccad520c1bdfa2fc5114d8852ed59d2`
- GitHub Actions Run: `30185605553`
- AC-01~AC-30 구현·검증 증거 확인

목적:

Settings는 단순 Preference 화면이 아니라 사용자 Preference, Project 운영 정책, Model·Cost·Privacy·Connector·Directive·Schema·진단을 관리하는 Typed Project Policy Control Plane이다.

확정 경계:

- Settings UI는 설정값의 권위를 소유하지 않는다.
- Principal Preference, Project Setting, System/Deployment Setting, Resource-bound Setting을 구분한다.
- Project 생성·이름 변경·Archive·Restore·Delete Request의 상태와 Capability는 Server가 제공한다.
- Setting별 적용 방식은 `IMMEDIATE`, `CONFIRM_REQUIRED`, `REVIEW_REQUIRED`, `RESTART_REQUIRED`, `MIGRATION_REQUIRED`, `READ_ONLY`, `UNAVAILABLE`로 구분할 수 있다.
- Draft는 Project에 고정하고 Route·Project 전환 시 자동 이전하지 않는다.
- Server Revision 변경 시 Draft를 조용히 덮어쓰지 않고 `STALE`로 전환한다.
- `OUTCOME_UNKNOWN`에서는 동일 Command를 자동 재제출하지 않는다.
- Secret·Credential 전체 값을 Browser에 표시하거나 저장하지 않는다.
- User Directive와 Fact Priority 변경은 일반 Preference가 아니라 별도 Proposal·Review 경계를 따른다.

관련 ADR: ADR-103, ADR-105, ADR-114, ADR-119.

## Section 3 — Home·Action Center·Global Shell

현재 상태:

- 설계·Contract 승인·동결 완료
- ADR-115 Accepted
- ADR-116 Accepted
- AC-01~AC-27 Approved and frozen
- Product 구현·검증 미착수

확정 범위:

- Desktop·Tablet·Mobile Global Shell
- Active Project Selector와 Resource Project 표시
- Home Action Center, Attention Queue, Continue Working, Recent·Pinned
- Background Summary, Notification, Global Banner
- Global Search, Command Palette
- First-run, 0-Project Session, Route Guard, Deep Link Recovery
- Offline·Degraded·Session Recovery
- 접근성·Responsive·Cache Isolation

핵심 계약:

- Home은 Active Project-scoped Action Center이며 Domain Action을 직접 실행하지 않는다.
- Global Background·Notification은 Principal의 Accessible Project Set 범위일 수 있다.
- Notification Presentation State는 Domain 문제 해결 또는 Attention 해결과 다르다.
- Browser Draft는 Server Resource와 별도 Presentation View로 합성하며 Stable ID를 공유하지 않는다.
- Project 0개 상태도 정상 Session이다. `activeProject: null`, `accessibleProjects: []`일 때 Home Action Center를 조회하지 않고 `/settings/projects` Onboarding을 제공한다.
- `project.create.v1`은 Principal Scope Bootstrap Command를 사용한다.
- Browser는 가짜 Project ID를 생성하지 않는다.
- Route Guard 권위는 Server가 계산한다.

## 명시적 비완료

다음은 이 문서의 Canonical 이관으로 완료되지 않는다.

- Section 3 Product 구현
- Frontend Phase 1 완료 선언
- Phase 2 착수 또는 구현 완료
- Production SPA Serving
- 숫자 성능 완료 예산 승인
