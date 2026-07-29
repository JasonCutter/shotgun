---
id: FRONTEND-PHASE-1-PLATFORM-BOUNDARY
classification: CANONICAL
status: complete_user_approved
approved_by: user
approved_at: 2026-07-30
legacy_source_id: 3a65181d-71ad-81b1-836e-c4503df86c46
---

# Frontend Phase 1 — Platform Boundary

## 현재 판정

- Section 1: 구현·검증·사용자 승인·`main` 병합 완료
- Section 2: 구현·검증·사용자 승인·`main` 병합 완료
- Section 3: 구현·검증·성능 Gate·사용자 승인·`main` 병합 완료
- AC-01~AC-27: **PASS**
- Frontend Phase 1: **COMPLETE / USER APPROVED**

최종 완료 판정은
[`Frontend Phase 1 Completion Review`](../../engineering/frontend-phase-1-completion-review-260730001.md)에 기록한다.

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

완료일: 2026-07-26

증거:

- PR #20
- Implementation Head: `b67929e9a04ac62aeeb8986c6ef552cdf58a38ac`
- Merge Commit: `4b5c90a1bccad520c1bdfa2fc5114d8852ed59d2`
- GitHub Actions Run: `30185605553`
- Verification: `docs/engineering/frontend-phase-1-section-2-verification-260725001.md`
- AC-01~AC-30 구현·검증·사용자 승인 완료

확정 경계:

- Settings UI는 설정값의 권위를 소유하지 않는다.
- Principal Preference, Project Setting, System/Deployment Setting, Resource-bound Setting을 구분한다.
- Project 생성·이름 변경·Archive·Restore·Delete Request의 상태와 Capability는 Server가 제공한다.
- Draft는 Project와 Revision에 고정하고 Route·Project 전환 시 자동 이전하지 않는다.
- Server Revision 변경 시 Draft를 조용히 덮어쓰지 않고 `STALE`로 전환한다.
- `OUTCOME_UNKNOWN`에서는 동일 Command를 자동 재제출하지 않는다.
- Secret·Credential 전체 값을 Browser에 표시하거나 저장하지 않는다.
- User Directive와 Fact Priority 변경은 일반 Preference가 아니라 별도 Proposal·Review 경계를 따른다.

관련 ADR: ADR-103, ADR-105, ADR-114, ADR-119.

## Section 3 — Home·Action Center·Global Shell

완료일: 2026-07-30

증거:

- PR #42
- Tested Product Head: `fc62776f0cda90d832815f51af15a014d91e0425`
- Final Evidence Head: `73c67f623c5cf3ae9f65e641c172d2bf746f2564`
- Merge Commit: `3f1aa93c7b5ce6a795b796f44124ed67112716c0`
- Product GitHub Actions Run: `30468293220`
- Evidence GitHub Actions Run: `30496773651`
- Verification: `docs/engineering/frontend-phase-1-section-3-verification-260729001.md`
- Final Evidence: `docs/engineering/frontend-phase-1-section-3-final-evidence-260730001.md`
- AC-01~AC-26 구현·검증 PASS
- AC-27: 별도 Completion Review에서 PASS

완료 범위:

- Desktop·Tablet·Mobile Global Shell
- Active Project Selector와 Resource Project 표시
- Home Action Center, Attention Queue, Continue Working, Recent·Pinned
- Background Summary, Notification Summary, Global Banner
- 보호된 Global Search, Navigation-only Command Palette
- First-run, 0-Project Session, Route Guard, Deep Link Recovery
- Offline·Degraded·Session Recovery
- 접근성·Responsive·Cache Isolation
- ADR-116 Migration 019의 V1/V2 호환성과 원자적 Principal Project Bootstrap
- 승인된 Local Product Performance Budget v1.0과 자동 Performance Gate

핵심 계약:

- Home은 Active Project-scoped Action Center이며 Domain Action을 직접 실행하지 않는다.
- Global Background·Notification은 Principal의 Accessible Project Set 범위일 수 있다.
- Browser Draft는 Server Resource와 별도 Presentation View로 합성하며 Stable ID를 공유하지 않는다.
- Project 0개 상태도 정상 Session이며 Browser는 가짜 Project ID를 생성하지 않는다.
- `project.create.v1`은 Principal Scope Bootstrap Command를 사용한다.
- Route Guard와 Project 권위는 Server가 계산한다.
- V1 계약과 Migration 019 호환 계층 제거는 별도 승인 대상이다.

## Phase 1 완료 판정

```text
Local Owner Session 수립
→ Project 생성·선택·관리
→ Settings와 Project Policy 관리
→ Global Shell과 Home에서 상태·필요 조치 확인
→ 각 소유 Workspace로 안전하게 이동
```

위 흐름과 Section별 완료 조건이 모두 충족됐다. Frontend Phase 1은 2026-07-30 사용자 승인으로 완료한다.

## 명시적 비범위·미착수

Frontend Phase 1 완료는 다음을 의미하지 않는다.

- Frontend Phase 2 구현 또는 착수 승인
- Frontend Phases 3~5 완료
- Cross-Phase Product Verification 완료
- 전체 Frontend 완료
- Production SPA Serving
- 배포 완료 또는 Production SLO 검증
- Notification Detail·Mark-read 구현
- Route-level Code Splitting 완료
- Migration 019 Schema Contraction 또는 V1 계약 제거

다음 계획상 Product Section은 Frontend Phase 2 Section 1 — Sources Workspace다. 별도 요청서와 승인 전에는 구현을 시작하지 않는다.
