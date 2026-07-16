# ADR-079 — Stage 0 Engineering Foundation

- 상태: **Accepted**
- 결정일: 2026-07-16
- 관련 계획: `../../implementation/implementation-roadmap.md`

## 결정

Stage 0의 기본 구현은 다음으로 고정한다.

- **언어:** TypeScript (Node.js 24 이상)
- **저장소:** npm Workspaces 기반 모노레포
- **API:** Fastify 단일 Application Assembly
- **개발 DB:** PostgreSQL 16 + Docker Compose
- **품질 검사:** ESLint, Prettier, TypeScript, Vitest
- **CI:** GitHub Actions에서 품질 검사와 PostgreSQL Bootstrap 검증 실행

## 이유

단일 프로세스 Modular Monolith 원칙을 유지하면서도 `packages/`, `modules/`, `adapters/`, `assemblies/` 경계를 코드와 테스트로 확인할 수 있다. Stage 0에서는 Queue, ORM, AI SDK, 독립 서비스는 추가하지 않는다.

## 결과

- Kernel은 Module Manifest를 등록하고 Application은 빈 테스트 모듈을 로딩한다.
- `GET /health`는 Application과 모듈 로딩 상태를 확인한다.
- PostgreSQL의 `runtime` Schema는 migration과 reset 명령으로 재생성한다.
- Architecture Test는 Domain Module의 Adapter·다른 Module·DB SDK 직접 import를 차단한다.

## 되돌리기

이 결정은 아직 제품 데이터나 외부 연동을 만들지 않는다. PostgreSQL 개발 데이터는 `npm run db:reset`으로 재생성할 수 있으며, Framework·ORM 같은 추가 선택은 실제 Stage 요구가 생길 때 별도 ADR로 결정한다.
