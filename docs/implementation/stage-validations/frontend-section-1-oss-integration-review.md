# Frontend Section 1 OSS Integration Review

- 상태: 구현 후보 검증 중
- 기준일: 2026-07-22
- 대상: Application Shell, Product Session, Project Context, Routing, Frontend test foundation
- Canonical 경계: Frontend는 Session·Membership·Scope·Sensitivity·Approval·Canonical의 권위 원본이 아니다.

## 결정

| 후보                    | 결정             | 고정 버전               | License                 | 사용 범위                                      |
| ----------------------- | ---------------- | ----------------------- | ----------------------- | ---------------------------------------------- |
| React                   | `ADOPT`          | `19.2.8`                | MIT                     | Component와 accessible Application Shell       |
| Vite                    | `ADOPT`          | `8.1.5`                 | MIT                     | loopback 개발 서버, same-origin proxy, build   |
| React Router Data Mode  | `ADOPT`          | `8.3.0`                 | MIT                     | Session loader, 보호 Route, navigation         |
| TanStack Query          | `ADOPT`          | `5.101.4`               | MIT                     | Session query와 Project cache 격리             |
| Vitest                  | `ADOPT`          | `4.1.10`                | MIT                     | Frontend workspace component test              |
| React Testing Library   | `ADOPT`          | `16.3.2`                | MIT                     | Role·Accessible Name 중심 component test       |
| Playwright              | `ADOPT`          | `1.61.1`                | Apache-2.0              | Chromium Product flow와 security E2E           |
| ddsyasas/llm-wiki UI    | `REFERENCE_ONLY` | 기존 registry pin       | MIT                     | Action 중심 Home·Settings 정보 계층만 참고     |
| Inkeep OpenKnowledge UI | `REFERENCE_ONLY` | 기존 registry pin       | 확인된 upstream license | Cockpit·Activity 패턴만 참고                   |
| Next.js                 | `REJECT`         | 설치하지 않음           | MIT                     | SSR·RSC·별도 frontend runtime을 도입하지 않음  |
| Redux / Zustand         | `DEFER`          | 설치하지 않음           | MIT                     | Section 1에는 전역 presentation store가 불필요 |
| Yjs / Tiptap            | `DEFER`          | 기존 registry 결정 유지 | 기존 registry 참조      | Editor·collaboration은 Section 1 제외          |

## Adapter·교체·제외 경계

- `shotgun-web`은 `@shotgun/api-client`만 Shotgun 내부 의존성으로 사용한다. Backend Module, DB Row, Fastify, Auth Repository를 import하지 않는다.
- React Router와 TanStack Query는 Browser orchestration만 담당한다. 서버가 반환한 Product Session을 대체하거나 Project 전환을 optimistic하게 확정하지 않는다.
- Vite는 `127.0.0.1` 개발과 정적 build에만 사용한다. Production SPA serving, SSR, PWA, Service Worker와 CORS 완화는 제외한다.
- Playwright fixture는 In-memory Auth와 Fake Action Connector를 사용하고 Production test route를 추가하지 않는다.
- ddsyasas와 OpenKnowledge 코드는 복사하지 않았다. UX·Architecture pattern만 참고했다.

교체 시에는 해당 npm package와 구성 코드를 제거하고 Product API Contract, 보호 Route, cache isolation, keyboard/accessibility, Chromium security flow를 동일하게 통과하는 대체 구현을 넣는다. Rollback은 `apps/shotgun-web`, `packages/shotgun-api-client`와 새 Product API route를 제거하면 되며 기존 `/auth/*` 및 Inline Backend UI는 그대로 유지된다.

## 검증 Gate

- Product API와 Client Contract: runtime decoder, safe error, CSRF serialization, no automatic retry
- Security: legacy authority header 거부, stale CSRF 거부, membership 없는 Project 거부
- Replacement boundary: Architecture test로 Frontend의 Backend import 차단
- Browser: login, Session 복원, Project 전환·새로고침, navigation, logout, 보호 Route redirect
- Dependency: exact lockfile pin, `npm audit --audit-level=high`, OSS registry verification, SBOM

최종 PASS 수와 명령별 증거는 Draft PR 본문에 기록한다.
